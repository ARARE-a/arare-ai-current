import { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  requirePlatformAdminContext,
  requireRequestStoreContext,
  StoreAccessError,
  type PlatformAdminContext,
  type RequestStoreContext
} from "@/lib/store-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const roleSchema = z.enum(["OWNER", "MANAGER", "STAFF"]);

const upsertUserSchema = z.object({
  id: z.string().optional(),
  storeId: z.string().optional(),
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  name: z.string().min(1).max(120).optional(),
  role: roleSchema
});

const idealPermissionRoles = [
  { role: "OWNER", label: "オーナー", capability: "店舗設定、権限、予約、通知、電話AI設定を管理" },
  { role: "MANAGER", label: "マネージャー", capability: "日常運用、店舗設定、通知再送、電話AI設定を管理" },
  { role: "STAFF", label: "スタッフ", capability: "予約、顧客、通知、会話履歴を確認" }
] as const;

type PermissionContext = {
  storeId: string;
  actorEmail?: string;
  actorRole?: string;
  isPlatformAdmin: boolean;
  source: PlatformAdminContext["source"] | RequestStoreContext["source"];
};

export async function GET(request: NextRequest) {
  try {
    const requestedStoreId = request.nextUrl.searchParams.get("storeId") ?? undefined;
    const context = await resolvePermissionContext(requestedStoreId);
    const [store, stores, users] = await prisma.$transaction([
      prisma.store.findUnique({ where: { id: context.storeId }, select: { id: true, name: true, phone: true, address: true } }),
      context.isPlatformAdmin
        ? prisma.store.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true, phone: true } })
        : prisma.store.findMany({ where: { id: context.storeId }, select: { id: true, name: true, phone: true } }),
      prisma.user.findMany({
        where: { storeId: context.storeId },
        orderBy: [{ role: "asc" }, { updatedAt: "desc" }],
        select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true }
      })
    ]);

    if (!store) throw new Error("Store was not found.");

    return ok({
      context,
      store,
      stores,
      users: users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      })),
      idealRoles: idealPermissionRoles
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = upsertUserSchema.parse(await request.json());
    const context = await resolvePermissionContext(payload.storeId);
    const name = payload.name?.trim() || payload.email.split("@")[0] || payload.email;
    const existing = payload.id
      ? await prisma.user.findUnique({ where: { id: payload.id } })
      : await prisma.user.findUnique({ where: { email: payload.email } });

    if (existing && existing.storeId !== context.storeId && !context.isPlatformAdmin) {
      throw statusError("This user email already belongs to another store.", 409);
    }

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            storeId: context.storeId,
            email: payload.email,
            name,
            role: payload.role
          }
        })
      : await prisma.user.create({
          data: {
            storeId: context.storeId,
            email: payload.email,
            name,
            role: payload.role
          }
        });

    await recordPermissionAudit(context, existing ? "permissions.user_updated" : "permissions.user_created", existing, user);

    return ok(
      {
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      },
      { status: existing ? 200 : 201 }
    );
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    const requestedStoreId = request.nextUrl.searchParams.get("storeId") ?? undefined;
    if (!id) throw new Error("id is required.");

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw new Error("User was not found.");

    const context = await resolvePermissionContext(requestedStoreId ?? before.storeId);
    if (before.storeId !== context.storeId && !context.isPlatformAdmin) {
      throw statusError("This user does not belong to the current store.", 403);
    }

    const remainingOwners = await prisma.user.count({
      where: { storeId: before.storeId, role: "OWNER", NOT: { id: before.id } }
    });
    if (before.role === "OWNER" && remainingOwners === 0) {
      throw statusError("At least one OWNER must remain for this store.", 409);
    }

    await prisma.user.delete({ where: { id: before.id } });
    await recordPermissionAudit(context, "permissions.user_deleted", before, null);

    return ok({ deleted: true, id: before.id });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

async function resolvePermissionContext(requestedStoreId?: string | null): Promise<PermissionContext> {
  const platformContext = await getPlatformContextOrNull();
  if (platformContext) {
    if (platformContext.scope === "single-store") {
      if (!platformContext.storeId) throw statusError("Platform context store was not found.", 403);
      if (requestedStoreId && requestedStoreId !== platformContext.storeId) {
        throw statusError("This platform context can only manage its own store.", 403);
      }
      return {
        storeId: platformContext.storeId,
        actorEmail: platformContext.userEmail,
        isPlatformAdmin: true,
        source: platformContext.source
      };
    }

    const storeId = requestedStoreId ?? (await findDefaultStoreId());
    return {
      storeId,
      actorEmail: platformContext.userEmail,
      isPlatformAdmin: true,
      source: platformContext.source
    };
  }

  const storeContext = await requireRequestStoreContext(["OWNER", "MANAGER"]);
  if (requestedStoreId && requestedStoreId !== storeContext.storeId) {
    throw statusError("This account cannot manage another store.", 403);
  }

  return {
    storeId: storeContext.storeId,
    actorEmail: storeContext.userEmail,
    actorRole: storeContext.role,
    isPlatformAdmin: false,
    source: storeContext.source
  };
}

async function getPlatformContextOrNull() {
  try {
    return await requirePlatformAdminContext();
  } catch {
    return null;
  }
}

async function findDefaultStoreId() {
  const store = await prisma.store.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  if (!store) throw new Error("Store was not found.");
  return store.id;
}

async function recordPermissionAudit(context: PermissionContext, action: string, before: unknown, after: unknown) {
  await prisma.auditLog
    .create({
      data: {
        storeId: context.storeId,
        actorType: "ADMIN",
        actorId: context.actorEmail ?? context.source,
        action,
        before: before ? JSON.parse(JSON.stringify(before)) : undefined,
        after: after ? JSON.parse(JSON.stringify(after)) : undefined
      }
    })
    .catch(() => null);
}

function statusError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

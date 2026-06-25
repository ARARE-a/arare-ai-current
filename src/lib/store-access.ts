import { auth, currentUser } from "@clerk/nextjs/server";
import type { UserRole } from "@prisma/client";
import { DEMO_STORE_ID } from "./constants";
import { env } from "./env";
import { prisma } from "./prisma";

export type RequestStoreContext = {
  storeId: string;
  role?: UserRole;
  userId?: string;
  userEmail?: string;
  clerkUserId?: string;
  clerkOrganizationId?: string | null;
  clerkConfigured: boolean;
  authenticated: boolean;
  source: "demo-fallback" | "clerk-session-store-id" | "user-email" | "single-store-bootstrap";
};

export type PlatformAdminContext = {
  clerkConfigured: boolean;
  authenticated: boolean;
  clerkUserId?: string;
  userEmail?: string;
  source: "demo-fallback" | "clerk-platform-role" | "platform-admin-email" | "single-store-owner";
  scope: "all-stores" | "single-store";
  storeId?: string;
};

type StoreContextFailureReason = "UNAUTHENTICATED" | "STORE_MAPPING_NOT_FOUND" | "FORBIDDEN_ROLE";

type StoreContextResult =
  | { ok: true; context: RequestStoreContext }
  | { ok: false; reason: StoreContextFailureReason; clerkConfigured: true; clerkUserId?: string; clerkOrganizationId?: string | null };

export class StoreAccessError extends Error {
  status: number;
  reason: StoreContextFailureReason;

  constructor(reason: StoreContextFailureReason) {
    super(errorMessageForReason(reason));
    this.name = "StoreAccessError";
    this.reason = reason;
    this.status = reason === "UNAUTHENTICATED" ? 401 : 403;
  }
}

export function isClerkStoreAccessConfigured() {
  return Boolean(env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && env("CLERK_SECRET_KEY"));
}

export async function getRequestStoreContext() {
  const result = await resolveRequestStoreContext();
  return result.ok ? result.context : null;
}

export async function requireRequestStoreContext(allowedRoles?: readonly UserRole[]) {
  const result = await resolveRequestStoreContext();
  if (result.ok) {
    if (allowedRoles?.length && !isRoleAllowed(result.context, allowedRoles)) {
      throw new StoreAccessError("FORBIDDEN_ROLE");
    }
    return result.context;
  }
  throw new StoreAccessError(result.reason);
}

export async function requirePlatformAdminContext(): Promise<PlatformAdminContext> {
  const clerkConfigured = isClerkStoreAccessConfigured();

  if (!clerkConfigured) {
    return {
      clerkConfigured: false,
      authenticated: false,
      source: "demo-fallback",
      scope: "all-stores"
    };
  }

  const authState = await auth();
  const clerkUserId = authState.userId ?? undefined;
  if (!clerkUserId) throw new StoreAccessError("UNAUTHENTICATED");

  const clerkUser = await currentUser();
  const email = normalizeEmail(getEmailFromClaims(authState.sessionClaims) ?? clerkUser?.primaryEmailAddress?.emailAddress);
  const platformRole = getPlatformRoleFromClaims(authState.sessionClaims);

  if (platformRole) {
    return {
      clerkConfigured: true,
      authenticated: true,
      clerkUserId,
      userEmail: email,
      source: "clerk-platform-role",
      scope: "all-stores"
    };
  }

  if (email && getPlatformAdminEmails().has(email)) {
    return {
      clerkConfigured: true,
      authenticated: true,
      clerkUserId,
      userEmail: email,
      source: "platform-admin-email",
      scope: "all-stores"
    };
  }

  if (email && env("DATABASE_URL")) {
    const [user, storeCount] = await prisma.$transaction([
      prisma.user.findUnique({ where: { email }, select: { storeId: true, role: true, email: true } }),
      prisma.store.count()
    ]);

    if (storeCount === 1 && user?.role === "OWNER") {
      return {
        clerkConfigured: true,
        authenticated: true,
        clerkUserId,
        userEmail: user.email,
        source: "single-store-owner",
        scope: "single-store",
        storeId: user.storeId
      };
    }
  }

  throw new StoreAccessError("FORBIDDEN_ROLE");
}

async function resolveRequestStoreContext(): Promise<StoreContextResult> {
  const clerkConfigured = isClerkStoreAccessConfigured();

  if (!clerkConfigured) {
    return {
      ok: true,
      context: {
        storeId: DEMO_STORE_ID,
        clerkConfigured: false,
        authenticated: false,
        source: "demo-fallback"
      }
    };
  }

  const authState = await auth();
  const clerkUserId = authState.userId ?? undefined;
  const clerkOrganizationId = authState.orgId ?? null;

  if (!clerkUserId) {
    return { ok: false, reason: "UNAUTHENTICATED", clerkConfigured: true, clerkOrganizationId };
  }

  const sessionStoreId = getStoreIdFromClaims(authState.sessionClaims);
  const claimEmail = getEmailFromClaims(authState.sessionClaims);
  const clerkUser = await currentUser();
  const email = normalizeEmail(claimEmail ?? clerkUser?.primaryEmailAddress?.emailAddress);

  if (sessionStoreId) {
    const sessionRole = getStoreRoleFromClaims(authState.sessionClaims);
    if (env("DATABASE_URL")) {
      const [user, sessionStore] = await prisma.$transaction([
        email
          ? prisma.user.findUnique({
              where: { email },
              select: {
                id: true,
                storeId: true,
                email: true,
                role: true
              }
            })
          : prisma.user.findFirst({
              where: { id: "__no_email_session_user__" },
              select: {
                id: true,
                storeId: true,
                email: true,
                role: true
              }
            }),
        prisma.store.findUnique({ where: { id: sessionStoreId }, select: { id: true } })
      ]);

      if (sessionStore) {
        return {
          ok: true,
          context: {
            storeId: sessionStoreId,
            role: user?.storeId === sessionStoreId ? user.role : sessionRole,
            userId: user?.storeId === sessionStoreId ? user.id : undefined,
            userEmail: user?.storeId === sessionStoreId ? user.email : email,
            clerkUserId,
            clerkOrganizationId,
            clerkConfigured: true,
            authenticated: true,
            source: "clerk-session-store-id"
          }
        };
      }

      if (user) {
        return {
          ok: true,
          context: {
            storeId: user.storeId,
            role: user.role,
            userId: user.id,
            userEmail: user.email,
            clerkUserId,
            clerkOrganizationId,
            clerkConfigured: true,
            authenticated: true,
            source: "user-email"
          }
        };
      }

      if (email) {
        const bootstrappedUser = await bootstrapSingleStoreUser({
          email,
          name: clerkUser?.fullName || clerkUser?.firstName || email.split("@")[0] || "Store owner"
        });

        if (bootstrappedUser) {
          return {
            ok: true,
            context: {
              storeId: bootstrappedUser.storeId,
              role: bootstrappedUser.role,
              userId: bootstrappedUser.id,
              userEmail: bootstrappedUser.email,
              clerkUserId,
              clerkOrganizationId,
              clerkConfigured: true,
              authenticated: true,
              source: "single-store-bootstrap"
            }
          };
        }
      }
    }

    return {
      ok: true,
      context: {
        storeId: sessionStoreId,
        role: sessionRole,
        userEmail: email,
        clerkUserId,
        clerkOrganizationId,
        clerkConfigured: true,
        authenticated: true,
        source: "clerk-session-store-id"
      }
    };
  }

  if (email && env("DATABASE_URL")) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        storeId: true,
        email: true,
        role: true
      }
    });

    if (user) {
      return {
        ok: true,
        context: {
          storeId: user.storeId,
          role: user.role,
          userId: user.id,
          userEmail: user.email,
          clerkUserId,
          clerkOrganizationId,
          clerkConfigured: true,
          authenticated: true,
          source: "user-email"
        }
      };
    }

    const bootstrappedUser = await bootstrapSingleStoreUser({
      email,
      name: clerkUser?.fullName || clerkUser?.firstName || email.split("@")[0] || "Store owner"
    });

    if (bootstrappedUser) {
      return {
        ok: true,
        context: {
          storeId: bootstrappedUser.storeId,
          role: bootstrappedUser.role,
          userId: bootstrappedUser.id,
          userEmail: bootstrappedUser.email,
          clerkUserId,
          clerkOrganizationId,
          clerkConfigured: true,
          authenticated: true,
          source: "single-store-bootstrap"
        }
      };
  }
}

  return {
    ok: false,
    reason: "STORE_MAPPING_NOT_FOUND",
    clerkConfigured: true,
    clerkUserId,
    clerkOrganizationId
  };
}

function errorMessageForReason(reason: StoreContextFailureReason) {
  if (reason === "UNAUTHENTICATED") return "Authentication is required.";
  if (reason === "FORBIDDEN_ROLE") return "This account does not have permission for this action.";
  return "Store access mapping was not found.";
}

function isRoleAllowed(context: RequestStoreContext, allowedRoles: readonly UserRole[]) {
  if (!context.clerkConfigured) return true;
  return Boolean(context.role && allowedRoles.includes(context.role));
}

function normalizeEmail(value?: string | null) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

async function bootstrapSingleStoreUser(input: { email: string; name: string }) {
  const stores = await prisma.store.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 2
  });

  if (stores.length !== 1) return null;

  return prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      storeId: stores[0].id,
      email: input.email,
      name: input.name,
      role: "OWNER"
    },
    select: {
      id: true,
      storeId: true,
      email: true,
      role: true
    }
  });
}

function getStoreIdFromClaims(claims: unknown) {
  return (
    getStringAtPath(claims, ["storeId"]) ??
    getStringAtPath(claims, ["store_id"]) ??
    getStringAtPath(claims, ["publicMetadata", "storeId"]) ??
    getStringAtPath(claims, ["public_metadata", "storeId"]) ??
    getStringAtPath(claims, ["metadata", "storeId"]) ??
    getStringAtPath(claims, ["org_metadata", "storeId"]) ??
    getStringAtPath(claims, ["organizationMetadata", "storeId"])
  );
}

function getEmailFromClaims(claims: unknown) {
  return (
    getStringAtPath(claims, ["email"]) ??
    getStringAtPath(claims, ["primaryEmailAddress"]) ??
    getStringAtPath(claims, ["primary_email_address"]) ??
    getStringAtPath(claims, ["publicMetadata", "email"]) ??
    getStringAtPath(claims, ["public_metadata", "email"])
  );
}

function getStoreRoleFromClaims(claims: unknown): UserRole | undefined {
  const role =
    getStringAtPath(claims, ["storeRole"]) ??
    getStringAtPath(claims, ["store_role"]) ??
    getStringAtPath(claims, ["role"]) ??
    getStringAtPath(claims, ["publicMetadata", "storeRole"]) ??
    getStringAtPath(claims, ["publicMetadata", "role"]) ??
    getStringAtPath(claims, ["public_metadata", "storeRole"]) ??
    getStringAtPath(claims, ["metadata", "storeRole"]);

  return toUserRole(role);
}

function getPlatformRoleFromClaims(claims: unknown) {
  const role =
    getStringAtPath(claims, ["platformRole"]) ??
    getStringAtPath(claims, ["platform_role"]) ??
    getStringAtPath(claims, ["role"]) ??
    getStringAtPath(claims, ["publicMetadata", "platformRole"]) ??
    getStringAtPath(claims, ["publicMetadata", "role"]) ??
    getStringAtPath(claims, ["public_metadata", "platformRole"]) ??
    getStringAtPath(claims, ["metadata", "platformRole"]);

  const normalized = role?.trim().toUpperCase();
  return normalized === "PLATFORM_ADMIN" || normalized === "ARARE_ADMIN" || normalized === "ADMIN";
}

function toUserRole(value?: string | null): UserRole | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "OWNER" || normalized === "MANAGER" || normalized === "STAFF") return normalized;
  return undefined;
}

function getPlatformAdminEmails() {
  const values = [env("ARARE_PLATFORM_ADMIN_EMAILS"), env("PLATFORM_ADMIN_EMAILS")]
    .filter(Boolean)
    .flatMap((value) => value!.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set(values);
}

function getStringAtPath(value: unknown, path: string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

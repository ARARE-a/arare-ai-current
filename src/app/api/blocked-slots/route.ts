import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  roomId: z.string().nullable().optional(),
  therapistId: z.string().nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().min(1),
  createdBy: z.string().optional()
});

export async function GET(request: NextRequest) {
  try {
    if (!env("DATABASE_URL")) return ok([]);
    void request;
    const { storeId } = await requireRequestStoreContext();
    const slots = await prisma.blockedSlot.findMany({
      where: { storeId },
      orderBy: { startsAt: "asc" }
    });
    return ok(slots);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext();
    if (!env("DATABASE_URL")) return ok({ dryRun: true, payload }, { status: 201 });
    const { storeId: _ignored, ...data } = payload;
    const slot = await prisma.blockedSlot.create({ data: { ...data, storeId } });
    await prisma.auditLog.create({
      data: {
        storeId,
        actorType: "ADMIN",
        actorId: payload.createdBy,
        action: "blocked_slot.created",
        after: payload
      }
    });
    return ok(slot, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

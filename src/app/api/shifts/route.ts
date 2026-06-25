import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  therapistId: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.enum(["SCHEDULED", "CHECKED_IN", "COMPLETED", "CANCELLED"]).default("SCHEDULED")
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const shifts = await prisma.shift.findMany({
      where: { storeId },
      include: { therapist: true },
      distinct: ["therapistId", "startsAt", "endsAt"],
      orderBy: { startsAt: "asc" }
    });
    return ok(shifts);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId: _ignored, ...data } = payload;
    const { storeId } = await requireRequestStoreContext();
    const therapist = await prisma.therapist.findFirst({ where: { id: data.therapistId, storeId }, select: { id: true } });
    if (!therapist) throw new Error("Therapist does not belong to this store");
    const existing = await prisma.shift.findFirst({
      where: {
        storeId,
        therapistId: data.therapistId,
        startsAt: data.startsAt,
        endsAt: data.endsAt
      },
      include: { therapist: true }
    });
    if (existing) {
      const shift = existing.status === data.status ? existing : await prisma.shift.update({ where: { id: existing.id }, data: { status: data.status }, include: { therapist: true } });
      return ok(shift);
    }
    const shift = await prisma.shift.create({ data: { ...data, storeId } });
    return ok(shift, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}


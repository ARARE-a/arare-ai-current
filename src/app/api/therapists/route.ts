import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  displayName: z.string().min(1),
  phone: z.string().optional(),
  lineId: z.string().optional(),
  profile: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).default("ACTIVE"),
  acceptsNomination: z.boolean().default(true),
  nominationFee: z.number().int().min(0).default(0)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const therapists = await prisma.therapist.findMany({
      where: { storeId },
      include: { shifts: { orderBy: { startsAt: "asc" } }, reservations: true },
      orderBy: { displayName: "asc" }
    });
    return ok(therapists);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext();
    const lineId = normalizeOptionalText(payload.lineId);
    if (lineId) {
      const duplicate = await prisma.therapist.findFirst({
        where: {
          storeId,
          lineId,
          displayName: { not: payload.displayName }
        },
        select: { displayName: true }
      });
      if (duplicate) throw new Error(`LINE ID is already registered to ${duplicate.displayName}`);
    }

    const existing = await prisma.therapist.findUnique({
      where: { storeId_displayName: { storeId, displayName: payload.displayName } },
      select: { id: true }
    });
    const { storeId: _ignored, ...therapistInput } = payload;
    const updateData = compact({
      phone: normalizeOptionalText(payload.phone),
      lineId: normalizeOptionalText(payload.lineId),
      profile: normalizeOptionalText(payload.profile),
      nominationFee: payload.nominationFee > 0 ? payload.nominationFee : undefined
    });
    const therapist = await prisma.therapist.upsert({
      where: { storeId_displayName: { storeId, displayName: payload.displayName } },
      update: existing ? updateData : { ...therapistInput, storeId },
      create: { ...therapistInput, storeId, phone: normalizeOptionalText(payload.phone), lineId: normalizeOptionalText(payload.lineId), profile: normalizeOptionalText(payload.profile) }
    });
    return ok(therapist, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

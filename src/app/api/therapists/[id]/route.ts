import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  displayName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  lineId: z.string().nullable().optional(),
  profile: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).optional(),
  acceptsNomination: z.boolean().optional(),
  nominationFee: z.number().int().min(0).optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const current = await prisma.therapist.findUnique({
      where: { id },
      select: { storeId: true }
    });
    if (!current) throw new Error("therapist not found");

    const lineId = normalizeOptionalText(payload.lineId);
    if (lineId) {
      const duplicate = await prisma.therapist.findFirst({
        where: {
          storeId: current.storeId,
          lineId,
          id: { not: id }
        },
        select: { displayName: true }
      });
      if (duplicate) throw new Error(`LINE ID is already registered to ${duplicate.displayName}`);
    }

    const therapist = await prisma.therapist.update({
      where: { id },
      data: compact({
        ...payload,
        phone: normalizeOptionalText(payload.phone),
        lineId,
        profile: normalizeOptionalText(payload.profile)
      })
    });
    return ok(therapist);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const therapist = await prisma.therapist.update({ where: { id }, data: { status: "INACTIVE" } });
    return ok(therapist);
  } catch (error) {
    return fail(error);
  }
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

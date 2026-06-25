import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().min(1),
  reservationId: z.string().optional(),
  phoneNumber: z.string().optional(),
  twilioCallSid: z.string().optional(),
  status: z.enum(["RECEIVED", "TRANSCRIBED", "SUMMARIZED", "ESCALATED", "HOLD_CREATED"]).default("RECEIVED"),
  recordingUrl: z.string().optional(),
  transcript: z.string().optional(),
  aiSummary: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  requiredReview: z.boolean().default(false),
  reviewNotes: z.string().optional()
});

const patchSchema = z.object({
  markReviewed: z.boolean().optional(),
  requiredReview: z.boolean().optional(),
  reviewNotes: z.string().max(500).optional()
});

const ADMIN_REVIEWED_MARKER = "[admin-reviewed]";

export async function GET(request: NextRequest) {
  try {
    if (!env("DATABASE_URL")) return ok([]);
    const { storeId } = await requireRequestStoreContext();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 250) || 250, 1), 500);
    const callLogs = await prisma.callLog.findMany({
      where: { storeId },
      include: { reservation: { include: { customer: true, course: true } } },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return ok(callLogs);
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    if (!env("DATABASE_URL")) return ok({ dryRun: true, payload }, { status: 201 });
    const callLog = await prisma.callLog.create({ data: payload });
    await prisma.auditLog.create({
      data: {
        storeId: payload.storeId,
        reservationId: payload.reservationId,
        actorType: "AI",
        action: "call_log.created",
        after: payload
      }
    });
    return ok(callLog, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return fail(new Error("id is required"), 400);

    const payload = patchSchema.parse(await request.json().catch(() => ({})));
    if (!env("DATABASE_URL")) return ok({ dryRun: true, id, payload });

    const { storeId } = await requireRequestStoreContext();
    const before = await prisma.callLog.findFirstOrThrow({ where: { id, storeId } });
    const adminReviewedNote = `${ADMIN_REVIEWED_MARKER} ${new Date().toISOString()}`;
    const reviewedNote = `管理画面で確認済み (${new Date().toISOString()})`;
    const nextReviewNotes = payload.markReviewed
      ? [before.reviewNotes, adminReviewedNote].filter(Boolean).join("\n")
      : payload.reviewNotes;

    const callLog = await prisma.callLog.update({
      where: { id: before.id },
      data: {
        requiredReview: payload.markReviewed ? false : payload.requiredReview,
        reviewNotes: nextReviewNotes
      }
    });

    await prisma.auditLog.create({
      data: {
        storeId,
        reservationId: callLog.reservationId,
        actorType: "STAFF",
        action: "call_log.reviewed",
        before,
        after: callLog
      }
    });

    return ok(callLog);
  } catch (error) {
    return fail(error);
  }
}

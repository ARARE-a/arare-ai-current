import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sayJa, twiml } from "@/lib/twilio-service";

const ESTIMATED_VOICE_AI_COST_PER_MINUTE_YEN = 25;

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => new FormData());
  const callSid = form.get("CallSid")?.toString();
  const callStatus = form.get("CallStatus")?.toString();
  const durationSeconds = parseDurationSeconds(form.get("CallDuration")?.toString() ?? form.get("Duration")?.toString());
  const handoffData = form.get("ConversationRelayHandoffData")?.toString() ?? form.get("HandoffData")?.toString();

  if (!callSid) {
    return emptyTwiml();
  }

  const reviewNotes = [callStatus ? `Call status: ${callStatus}` : undefined, handoffData ? `Handoff: ${handoffData}` : undefined]
    .filter(Boolean)
    .join("\n");

  await prisma.callLog
    .updateMany({
      where: { twilioCallSid: callSid },
      data: {
        status: handoffData ? "ESCALATED" : "SUMMARIZED",
        durationSeconds: durationSeconds ?? undefined,
        reviewNotes: reviewNotes || undefined,
        requiredReview: Boolean(handoffData)
      }
    })
    .catch(() => ({ count: 0 }));

  await recordUsageMeter(callSid, durationSeconds);

  if (handoffData) {
    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayJa("確認が必要なため、スタッフより折り返しご案内いたします。")}
</Response>`);
  }

  return emptyTwiml();
}

function emptyTwiml() {
  return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response/>`);
}

function parseDurationSeconds(value?: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

async function recordUsageMeter(callSid: string, durationSeconds?: number) {
  if (!durationSeconds) return;

  await prisma.$transaction(async (tx) => {
    const callLog = await tx.callLog.findFirst({
      where: { twilioCallSid: callSid },
      select: {
        id: true,
        storeId: true,
        usageMeterRecordedAt: true
      }
    });

    if (!callLog || callLog.usageMeterRecordedAt) return;

    const now = new Date();
    const period = usagePeriod(now);
    const estimatedCost = Math.ceil((durationSeconds / 60) * ESTIMATED_VOICE_AI_COST_PER_MINUTE_YEN);

    await tx.callLog.update({
      where: { id: callLog.id },
      data: {
        durationSeconds,
        usageMeterRecordedAt: now
      }
    });

    await tx.storeUsageMeter.upsert({
      where: {
        storeId_period: {
          storeId: callLog.storeId,
          period
        }
      },
      update: {
        voiceCallCount: { increment: 1 },
        voiceCallSeconds: { increment: durationSeconds },
        aiSessionCount: { increment: 1 },
        estimatedCost: { increment: estimatedCost }
      },
      create: {
        storeId: callLog.storeId,
        period,
        voiceCallCount: 1,
        voiceCallSeconds: durationSeconds,
        aiSessionCount: 1,
        estimatedCost
      }
    });
  }).catch(() => null);
}

function usagePeriod(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const INCLUDED_VOICE_AI_MINUTES = 300;
const OVERAGE_YEN_PER_MINUTE = 50;
const ESTIMATED_COST_YEN_PER_MINUTE = 25;

export async function GET(request: NextRequest) {
  try {
    void request;
    if (!env("DATABASE_URL")) {
      return ok(emptyUsageResponse(currentPeriod()));
    }

    const { storeId } = await requireRequestStoreContext();
    const period = currentPeriod();
    const meter = await prisma.storeUsageMeter.findUnique({
      where: {
        storeId_period: {
          storeId,
          period
        }
      }
    });

    const usedSeconds = meter?.voiceCallSeconds ?? 0;
    const usedMinutes = Math.ceil(usedSeconds / 60);
    const remainingIncludedMinutes = Math.max(0, INCLUDED_VOICE_AI_MINUTES - usedMinutes);
    const overageMinutes = Math.max(0, usedMinutes - INCLUDED_VOICE_AI_MINUTES);

    return ok({
      period,
      voiceCallCount: meter?.voiceCallCount ?? 0,
      aiSessionCount: meter?.aiSessionCount ?? 0,
      usedSeconds,
      usedMinutes,
      includedMinutes: INCLUDED_VOICE_AI_MINUTES,
      remainingIncludedMinutes,
      overageMinutes,
      overageYenPerMinute: OVERAGE_YEN_PER_MINUTE,
      estimatedCostYen: meter?.estimatedCost ?? 0,
      estimatedCostYenPerMinute: ESTIMATED_COST_YEN_PER_MINUTE,
      estimatedOverageYen: overageMinutes * OVERAGE_YEN_PER_MINUTE
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

function emptyUsageResponse(period: string) {
  return {
    period,
    voiceCallCount: 0,
    aiSessionCount: 0,
    usedSeconds: 0,
    usedMinutes: 0,
    includedMinutes: INCLUDED_VOICE_AI_MINUTES,
    remainingIncludedMinutes: INCLUDED_VOICE_AI_MINUTES,
    overageMinutes: 0,
    overageYenPerMinute: OVERAGE_YEN_PER_MINUTE,
    estimatedCostYen: 0,
    estimatedCostYenPerMinute: ESTIMATED_COST_YEN_PER_MINUTE,
    estimatedOverageYen: 0
  };
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? String(new Date().getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

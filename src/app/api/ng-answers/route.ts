import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  ngWords: z.array(z.string()).default([]),
  ngResponseRules: z.string().nullable().optional(),
  forbiddenAnswers: z.array(z.string()).default([]),
  escalationKeywords: z.array(z.string()).default([]),
  requireHumanApproval: z.boolean().default(true)
});

export async function GET() {
  try {
    const { storeId } = await requireRequestStoreContext();
    const [storeSetting, aiSetting] = await prisma.$transaction([
      prisma.storeSetting.findUnique({
        where: { storeId },
        select: { ngWords: true, ngResponseRules: true, updatedAt: true }
      }),
      prisma.aiSetting.findUnique({
        where: { storeId },
        select: { forbiddenAnswers: true, escalationKeywords: true, requireHumanApproval: true, updatedAt: true }
      })
    ]);

    return ok({
      ngWords: storeSetting?.ngWords ?? [],
      ngResponseRules: storeSetting?.ngResponseRules ?? "",
      forbiddenAnswers: aiSetting?.forbiddenAnswers ?? [],
      escalationKeywords: aiSetting?.escalationKeywords ?? [],
      requireHumanApproval: aiSetting?.requireHumanApproval ?? true,
      updatedAt: latestIso(storeSetting?.updatedAt, aiSetting?.updatedAt)
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    const cleanNgWords = normalizeList(payload.ngWords);
    const cleanForbiddenAnswers = normalizeList(payload.forbiddenAnswers);
    const cleanEscalationKeywords = normalizeList(payload.escalationKeywords);
    const ngResponseRules = normalizeOptionalText(payload.ngResponseRules);

    const [storeSetting, aiSetting] = await prisma.$transaction([
      prisma.storeSetting.upsert({
        where: { storeId },
        update: { ngWords: cleanNgWords, ngResponseRules },
        create: { storeId, ngWords: cleanNgWords, ngResponseRules }
      }),
      prisma.aiSetting.upsert({
        where: { storeId },
        update: {
          forbiddenAnswers: cleanForbiddenAnswers,
          escalationKeywords: cleanEscalationKeywords,
          requireHumanApproval: payload.requireHumanApproval
        },
        create: {
          storeId,
          forbiddenAnswers: cleanForbiddenAnswers,
          escalationKeywords: cleanEscalationKeywords,
          requireHumanApproval: payload.requireHumanApproval
        }
      })
    ]);

    return ok({
      ngWords: storeSetting.ngWords,
      ngResponseRules: storeSetting.ngResponseRules ?? "",
      forbiddenAnswers: aiSetting.forbiddenAnswers,
      escalationKeywords: aiSetting.escalationKeywords,
      requireHumanApproval: aiSetting.requireHumanApproval,
      updatedAt: latestIso(storeSetting.updatedAt, aiSetting.updatedAt)
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

function normalizeList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function latestIso(...dates: Array<Date | undefined>) {
  const latest = dates.filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  return latest?.toISOString() ?? null;
}

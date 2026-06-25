import { env } from "./env";
import { prisma } from "./prisma";

export type ResolvedPhoneRoute = {
  ok: true;
  storeId: string;
  settingId: string;
  aiReceptionPhoneNumber: string;
  normalizedAiReceptionPhoneNumber: string;
  currentStorePhoneNumber?: string | null;
  fallbackPhoneNumber?: string | null;
  voiceRelayWsUrl?: string | null;
  voiceAiEnabled: boolean;
  routingMode: string;
} | {
  ok: false;
  normalizedTo?: string;
  reason: string;
};

export function normalizePhoneNumber(value?: string | null) {
  if (!value) return "";
  const compact = value.trim().replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("81")) return `+${compact}`;
  if (compact.startsWith("0")) return `+81${compact.slice(1)}`;
  return `+${compact}`;
}

export function phoneSearchCandidates(value?: string | null) {
  const normalized = normalizePhoneNumber(value);
  const raw = value?.trim();
  return [...new Set([normalized, raw].filter((item): item is string => Boolean(item)))];
}

export async function resolveStoreByTwilioTo(toNumber?: string | null): Promise<ResolvedPhoneRoute> {
  const normalizedTo = normalizePhoneNumber(toNumber);
  if (!toNumber || !normalizedTo) {
    return { ok: false, reason: "Twilio To number is missing" };
  }

  if (!env("DATABASE_URL")) {
    return { ok: false, normalizedTo, reason: "DATABASE_URL is not configured" };
  }

  const candidates = phoneSearchCandidates(toNumber);
  const setting = await prisma.storePhoneSetting.findFirst({
    where: {
      OR: [
        { normalizedAiReceptionPhoneNumber: { in: candidates } },
        { aiReceptionPhoneNumber: { in: candidates } }
      ]
    }
  });

  if (!setting) {
    return { ok: false, normalizedTo, reason: "AI reception phone number is not registered" };
  }

  return {
    ok: true,
    storeId: setting.storeId,
    settingId: setting.id,
    aiReceptionPhoneNumber: setting.aiReceptionPhoneNumber,
    normalizedAiReceptionPhoneNumber: setting.normalizedAiReceptionPhoneNumber,
    currentStorePhoneNumber: setting.currentStorePhoneNumber,
    fallbackPhoneNumber: setting.fallbackPhoneNumber,
    voiceRelayWsUrl: setting.voiceRelayWsUrl,
    voiceAiEnabled: setting.voiceAiEnabled,
    routingMode: setting.routingMode
  };
}

export async function resolveStoreByCallSid(callSid?: string | null): Promise<ResolvedPhoneRoute> {
  if (!callSid) return { ok: false, reason: "CallSid is missing" };
  if (!env("DATABASE_URL")) return { ok: false, reason: "DATABASE_URL is not configured" };

  const callLog = await prisma.callLog.findFirst({
    where: { twilioCallSid: callSid },
    include: { storePhoneSetting: true },
    orderBy: { createdAt: "desc" }
  });

  if (!callLog) return { ok: false, reason: "CallSid is not registered" };

  if (callLog.storePhoneSetting) {
    return {
      ok: true,
      storeId: callLog.storeId,
      settingId: callLog.storePhoneSetting.id,
      aiReceptionPhoneNumber: callLog.storePhoneSetting.aiReceptionPhoneNumber,
      normalizedAiReceptionPhoneNumber: callLog.storePhoneSetting.normalizedAiReceptionPhoneNumber,
      currentStorePhoneNumber: callLog.storePhoneSetting.currentStorePhoneNumber,
      fallbackPhoneNumber: callLog.storePhoneSetting.fallbackPhoneNumber,
      voiceRelayWsUrl: callLog.storePhoneSetting.voiceRelayWsUrl,
      voiceAiEnabled: callLog.storePhoneSetting.voiceAiEnabled,
      routingMode: callLog.storePhoneSetting.routingMode
    };
  }

  return {
    ok: true,
    storeId: callLog.storeId,
    settingId: "",
    aiReceptionPhoneNumber: callLog.toNumber ?? "",
    normalizedAiReceptionPhoneNumber: normalizePhoneNumber(callLog.toNumber),
    voiceAiEnabled: true,
    routingMode: "ALWAYS_AI"
  };
}

export function serializePhoneSetting(input: {
  id: string;
  storeId: string;
  currentStorePhoneNumber: string | null;
  aiReceptionPhoneNumber: string;
  normalizedAiReceptionPhoneNumber: string;
  twilioPhoneNumberSid: string | null;
  twilioAccountSid: string | null;
  twilioSubaccountSid: string | null;
  voiceWebhookUrl: string | null;
  voiceRelayWsUrl: string | null;
  fallbackPhoneNumber: string | null;
  voiceAiEnabled: boolean;
  routingMode: string;
  recordingEnabled: boolean;
  businessHoursOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...input,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString()
  };
}

export function cleanPhoneSettingData(payload: {
  currentStorePhoneNumber?: string | null;
  aiReceptionPhoneNumber: string;
  twilioPhoneNumberSid?: string | null;
  twilioAccountSid?: string | null;
  twilioSubaccountSid?: string | null;
  voiceWebhookUrl?: string | null;
  voiceRelayWsUrl?: string | null;
  fallbackPhoneNumber?: string | null;
  voiceAiEnabled?: boolean;
  routingMode?: "ALWAYS_AI" | "AFTER_HOURS_AI" | "BUSY_OR_NO_ANSWER_AI" | "MANUAL_ONLY";
  recordingEnabled?: boolean;
  businessHoursOnly?: boolean;
}) {
  const normalizedAiReceptionPhoneNumber = normalizePhoneNumber(payload.aiReceptionPhoneNumber);
  if (!normalizedAiReceptionPhoneNumber) {
    throw new Error("AI reception phone number is required");
  }

  return {
    currentStorePhoneNumber: emptyToNull(payload.currentStorePhoneNumber),
    aiReceptionPhoneNumber: payload.aiReceptionPhoneNumber.trim(),
    normalizedAiReceptionPhoneNumber,
    twilioPhoneNumberSid: emptyToNull(payload.twilioPhoneNumberSid),
    twilioAccountSid: emptyToNull(payload.twilioAccountSid),
    twilioSubaccountSid: emptyToNull(payload.twilioSubaccountSid),
    voiceWebhookUrl: emptyToNull(payload.voiceWebhookUrl),
    voiceRelayWsUrl: emptyToNull(payload.voiceRelayWsUrl),
    fallbackPhoneNumber: emptyToNull(payload.fallbackPhoneNumber),
    voiceAiEnabled: payload.voiceAiEnabled ?? true,
    routingMode: payload.routingMode ?? "ALWAYS_AI",
    recordingEnabled: payload.recordingEnabled ?? false,
    businessHoursOnly: payload.businessHoursOnly ?? false
  };
}

function emptyToNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { cleanPhoneSettingData, serializePhoneSetting } from "@/lib/phone-routing";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const routingModeSchema = z.enum(["ALWAYS_AI", "AFTER_HOURS_AI", "BUSY_OR_NO_ANSWER_AI", "MANUAL_ONLY"]);

const phoneSettingSchema = z.object({
  storeId: z.string().optional(),
  currentStorePhoneNumber: z.string().optional().nullable(),
  aiReceptionPhoneNumber: z.string().min(1),
  twilioPhoneNumberSid: z.string().optional().nullable(),
  twilioAccountSid: z.string().optional().nullable(),
  twilioSubaccountSid: z.string().optional().nullable(),
  voiceWebhookUrl: z.string().optional().nullable(),
  voiceRelayWsUrl: z.string().optional().nullable(),
  fallbackPhoneNumber: z.string().optional().nullable(),
  voiceAiEnabled: z.boolean().default(true),
  routingMode: routingModeSchema.default("ALWAYS_AI"),
  recordingEnabled: z.boolean().default(false),
  businessHoursOnly: z.boolean().default(false)
});

const patchPhoneSettingSchema = phoneSettingSchema.extend({
  id: z.string().min(1)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const settings = await prisma.storePhoneSetting.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" }
    });
    return ok(settings.map(serializePhoneSetting));
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = phoneSettingSchema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    const voiceWebhookUrl = payload.voiceWebhookUrl || `${env("PUBLIC_APP_URL") ?? request.nextUrl.origin}/api/twilio/voice`;
    await ensureStore(storeId);

    const data = cleanPhoneSettingData({ ...payload, voiceWebhookUrl });
    const existing = await prisma.storePhoneSetting.findUnique({
      where: { normalizedAiReceptionPhoneNumber: data.normalizedAiReceptionPhoneNumber }
    });

    if (existing && existing.storeId !== storeId) {
      throw new Error("This AI reception phone number is already assigned to another store");
    }

    const setting = existing
      ? await prisma.storePhoneSetting.update({
          where: { id: existing.id },
          data
        })
      : await prisma.storePhoneSetting.create({
          data: {
            ...data,
            storeId
          }
        });

    await recordPhoneEvent(setting.storeId, setting.id, existing ? "UPDATED" : "CREATED", existing, setting);
    return ok(serializePhoneSetting(setting), { status: existing ? 200 : 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = patchPhoneSettingSchema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    const before = await prisma.storePhoneSetting.findUnique({ where: { id: payload.id } });
    if (!before) throw new Error("StorePhoneSetting was not found");
    if (before.storeId !== storeId) throw new Error("StorePhoneSetting does not belong to this store");

    const data = cleanPhoneSettingData(payload);
    const duplicated = await prisma.storePhoneSetting.findFirst({
      where: {
        normalizedAiReceptionPhoneNumber: data.normalizedAiReceptionPhoneNumber,
        NOT: { id: payload.id }
      }
    });
    if (duplicated) throw new Error("This AI reception phone number is already assigned to another store");

    const setting = await prisma.storePhoneSetting.update({
      where: { id: payload.id },
      data
    });
    await recordPhoneEvent(setting.storeId, setting.id, "UPDATED", before, setting);
    return ok(serializePhoneSetting(setting));
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    if (!id) throw new Error("id is required");

    const before = await prisma.storePhoneSetting.findUnique({ where: { id } });
    if (!before) throw new Error("StorePhoneSetting was not found");
    if (before.storeId !== storeId) throw new Error("StorePhoneSetting does not belong to this store");

    await recordPhoneEvent(before.storeId, before.id, "DELETED", before, null);
    await prisma.storePhoneSetting.delete({ where: { id } });
    return ok({ deleted: true, id });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

async function ensureStore(storeId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error(`Store was not found: ${storeId}`);
}

async function recordPhoneEvent(
  storeId: string,
  storePhoneSettingId: string,
  eventType: string,
  before: unknown,
  after: unknown
) {
  await prisma.storePhoneEvent
    .create({
      data: {
        storeId,
        storePhoneSettingId,
        eventType,
        before: toJson(before),
        after: toJson(after)
      }
    })
    .catch(() => null);
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}


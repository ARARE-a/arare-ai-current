import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { NotificationStatus, Prisma } from "@prisma/client";
import type { ConversationChannel, NotificationType } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const failureStatuses = new Set(["failed", "undelivered"]);
const successfulStatuses = new Set(["accepted", "queued", "sending", "sent", "delivered"]);

type SmsCallbackNotification = {
  id: string;
  storeId: string;
  reservationId: string | null;
  type: NotificationType;
  channel: ConversationChannel;
  targetName: string | null;
  targetPhone: string | null;
  targetLineId: string | null;
  smsTo: string | null;
  smsSid: string | null;
  sentAt: Date | null;
  smsDeliveredAt: Date | null;
  reservation: {
    customer: { name: string; phone: string; lineId: string | null };
    therapist: { displayName: string; phone: string | null; lineId: string | null } | null;
  } | null;
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "twilio-sms-status-callback",
    method: "POST"
  });
}

export async function POST(request: NextRequest) {
  const payload = await readTwilioPayload(request);

  if (shouldValidateTwilioSignature() && !isValidTwilioSignature(request, payload)) {
    return NextResponse.json({ ok: false, error: "invalid_twilio_signature" }, { status: 403 });
  }

  const notificationId = request.nextUrl.searchParams.get("notificationId") ?? getPayloadString(payload, "notificationId", "NotificationId");
  const smsSid = getPayloadString(payload, "MessageSid", "SmsSid", "SmsMessageSid");
  const deliveryStatus = normalizeSmsStatus(getPayloadString(payload, "MessageStatus", "SmsStatus", "Status"));
  const errorCode = getPayloadString(payload, "ErrorCode", "error_code");
  const errorMessage = getPayloadString(payload, "ErrorMessage", "error_message");

  if (!notificationId && !smsSid) {
    return NextResponse.json({ ok: false, ignored: true, reason: "missing_notification_and_sms_sid" });
  }

  const notification = await prisma.notification.findFirst({
    where: notificationId ? { id: notificationId } : { smsSid },
    select: {
      id: true,
      storeId: true,
      reservationId: true,
      type: true,
      channel: true,
      targetName: true,
      targetPhone: true,
      targetLineId: true,
      smsTo: true,
      smsSid: true,
      sentAt: true,
      smsDeliveredAt: true,
      reservation: {
        select: {
          customer: { select: { name: true, phone: true, lineId: true } },
          therapist: { select: { displayName: true, phone: true, lineId: true } }
        }
      }
    }
  });

  if (!notification) {
    return NextResponse.json({
      ok: false,
      ignored: true,
      reason: "notification_not_found",
      notificationId,
      smsSid
    });
  }

  const now = new Date();
  const normalizedStatus = deliveryStatus || "unknown";
  const failed = failureStatuses.has(normalizedStatus);
  const delivered = normalizedStatus === "delivered";
  const statusPatch = failed
    ? {
        status: NotificationStatus.FAILED,
        smsErrorCode: errorCode,
        smsErrorMessage: errorMessage || `Twilio delivery status: ${normalizedStatus}`
      }
    : successfulStatuses.has(normalizedStatus)
      ? {
          status: NotificationStatus.SENT,
          smsErrorCode: null,
          smsErrorMessage: null
        }
      : {};

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: {
      ...statusPatch,
      smsSid: notification.smsSid ?? smsSid,
      smsDeliveryStatus: normalizedStatus,
      smsDeliveryCheckedAt: now,
      smsDeliveredAt: delivered ? now : notification.smsDeliveredAt,
      smsDeliveryRaw: payload as Prisma.InputJsonValue
    },
    select: {
      id: true,
      storeId: true,
      reservationId: true,
      status: true,
      smsSid: true,
      smsDeliveryStatus: true,
      smsDeliveryCheckedAt: true,
      smsDeliveredAt: true,
      smsErrorCode: true,
      smsErrorMessage: true
    }
  });

  await upsertNotificationLogFromSmsCallback({
    notification,
    smsSid: updated.smsSid,
    normalizedStatus,
    failed,
    errorCode,
    errorMessage,
    payload,
    receivedAt: now
  });

  await prisma.auditLog.create({
    data: {
      storeId: updated.storeId,
      reservationId: updated.reservationId,
      actorType: "SYSTEM",
      action: "notification.sms_status_callback",
      after: {
        notificationId: updated.id,
        smsSid: updated.smsSid,
        smsDeliveryStatus: updated.smsDeliveryStatus,
        smsDeliveryCheckedAt: updated.smsDeliveryCheckedAt?.toISOString() ?? null,
        smsDeliveredAt: updated.smsDeliveredAt?.toISOString() ?? null,
        smsErrorCode: updated.smsErrorCode,
        smsErrorMessage: updated.smsErrorMessage
      }
    }
  });

  return NextResponse.json({
    ok: true,
    notificationId: updated.id,
    smsSid: updated.smsSid,
    smsDeliveryStatus: updated.smsDeliveryStatus,
    smsDeliveredAt: updated.smsDeliveredAt?.toISOString() ?? null
  });
}

async function upsertNotificationLogFromSmsCallback(input: {
  notification: SmsCallbackNotification;
  smsSid: string | null;
  normalizedStatus: string;
  failed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  payload: Record<string, string | null>;
  receivedAt: Date;
}) {
  const existing = await prisma.notificationLog.findFirst({
    where: {
      storeId: input.notification.storeId,
      OR: [
        { notificationId: input.notification.id },
        ...(input.smsSid ? [{ providerMessageId: input.smsSid }] : [])
      ]
    },
    orderBy: { createdAt: "desc" }
  });
  const recipient = resolveSmsCallbackRecipient(input.notification);
  const logStatus = input.failed
    ? NotificationStatus.FAILED
    : successfulStatuses.has(input.normalizedStatus)
      ? NotificationStatus.SENT
      : existing?.status ?? NotificationStatus.PENDING;
  const sentAt = logStatus === NotificationStatus.SENT
    ? input.notification.sentAt ?? input.receivedAt
    : existing?.sentAt ?? input.notification.sentAt;
  const data = {
    notificationId: input.notification.id,
    reservationId: input.notification.reservationId,
    type: input.notification.type,
    channel: input.notification.channel,
    status: logStatus,
    recipientName: recipient.name,
    recipientPhone: recipient.phone,
    recipientLineId: recipient.lineId,
    provider: "twilio",
    providerMessageId: input.smsSid,
    errorCode: input.failed ? input.errorCode : null,
    errorMessage: input.failed ? input.errorMessage || `Twilio delivery status: ${input.normalizedStatus}` : null,
    payload: toJsonPayload({
      ...input.payload,
      normalizedStatus: input.normalizedStatus,
      receivedAt: input.receivedAt.toISOString()
    }),
    sentAt
  };

  if (existing) {
    await prisma.notificationLog.update({
      where: { id: existing.id },
      data
    });
    return;
  }

  const dedupeKey = `twilio-callback:${input.smsSid ?? input.notification.id}`;
  try {
    await prisma.notificationLog.create({
      data: {
        storeId: input.notification.storeId,
        dedupeKey,
        ...data
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const duplicate = await prisma.notificationLog.findUnique({
      where: {
        storeId_dedupeKey: {
          storeId: input.notification.storeId,
          dedupeKey
        }
      },
      select: { id: true }
    });
    if (duplicate) {
      await prisma.notificationLog.update({
        where: { id: duplicate.id },
        data
      });
    }
  }
}

function resolveSmsCallbackRecipient(notification: SmsCallbackNotification) {
  const therapistNotification = notification.type === "THERAPIST_BOOKING" || notification.type === "THERAPIST_SHIFT";
  const customer = notification.reservation?.customer;
  const therapist = notification.reservation?.therapist;

  return {
    name: notification.targetName ?? (therapistNotification ? therapist?.displayName : customer?.name) ?? null,
    phone: notification.targetPhone ?? notification.smsTo ?? (therapistNotification ? therapist?.phone : customer?.phone) ?? null,
    lineId: notification.targetLineId ?? (therapistNotification ? therapist?.lineId : customer?.lineId) ?? null
  };
}

async function readTwilioPayload(request: NextRequest): Promise<Record<string, string | null>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return normalizePayloadObject(body);
  }

  const formData = await request.formData();
  const payload: Record<string, string | null> = {};
  for (const [key, value] of formData.entries()) {
    payload[key] = typeof value === "string" ? value : value.name;
  }
  return payload;
}

function normalizePayloadObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce<Record<string, string | null>>((acc, [key, item]) => {
    acc[key] = item === null || item === undefined ? null : String(item);
    return acc;
  }, {});
}

function getPayloadString(payload: Record<string, string | null>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeSmsStatus(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, "_") ?? null;
}

function shouldValidateTwilioSignature() {
  return env("TWILIO_VALIDATE_CALLBACK_SIGNATURE") === "true";
}

function isValidTwilioSignature(request: NextRequest, payload: Record<string, string | null>) {
  const authToken = env("TWILIO_AUTH_TOKEN");
  const received = request.headers.get("x-twilio-signature");
  if (!authToken || !received) return false;

  const publicUrl = (env("PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_URL"))?.trim().replace(/\/+$/, "");
  const url = publicUrl ? new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, publicUrl).toString() : request.url;
  const signedBody = Object.keys(payload)
    .sort()
    .map((key) => `${key}${payload[key] ?? ""}`)
    .join("");
  const expected = createHmac("sha1", authToken).update(`${url}${signedBody}`).digest("base64");

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

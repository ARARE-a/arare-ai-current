import { ConversationChannel, NotificationStatus, NotificationType } from "@prisma/client";
import { env } from "./env";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NotificationLog } from "@prisma/client";
import { pushLineMessage } from "./line-service";
import { prisma } from "./prisma";

type NotificationForDelivery = Prisma.NotificationGetPayload<{
  include: {
    reservation: {
      include: {
        customer: true;
        course: true;
        therapist: true;
        room: true;
        store: true;
      };
    };
    store: true;
  };
}>;

type NotificationLogRecord = NotificationLog;
type DeliveryProvider = "twilio" | "line" | "internal";

type NotificationDeliveryTarget = {
  provider: DeliveryProvider;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientLineId?: string | null;
};

const pendingLogRetryAfterMs = 5 * 60 * 1000;

export async function queueNotification(input: {
  storeId: string;
  reservationId?: string;
  type: NotificationType;
  channel: ConversationChannel;
  body: string;
  scheduledAt?: Date;
}) {
  return prisma.notification.create({
    data: {
      storeId: input.storeId,
      reservationId: input.reservationId,
      type: input.type,
      channel: input.channel,
      body: input.body,
      scheduledAt: input.scheduledAt
    }
  });
}

export async function sendNotification(notificationId: string) {
  const notification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
    include: {
      reservation: {
        include: {
          customer: true,
          course: true,
          therapist: true,
          room: true,
          store: true
        }
      },
      store: true
    }
  });

  const target = resolveNotificationDeliveryTarget(notification);
  const deliveryLog = await beginNotificationDeliveryLog(notification, target);
  if (!deliveryLog.shouldSend) {
    return markDuplicateNotificationSuppressed(notification, deliveryLog.log, target);
  }

  if (!notification.reservation) {
    const error = new Error("Reservation is not linked");
    await markNotificationLogFailed(deliveryLog.log.id, error, { reason: "reservation_not_linked" });
    return markNotificationFailed(notification, error, target);
  }

  let attemptedSmsDelivery: { targetPhone: string; customerPhone: string | null; smsTo: string } | null = null;

  try {
    if (notification.channel === ConversationChannel.LINE) {
      const lineId = target.recipientLineId;
      if (!lineId) throw new Error("LINE ID is not linked");

      const result = await pushLineMessage(lineId, [{ type: "text", text: notification.body }]);
      if (!("ok" in result)) throw new Error(result.reason);
      if (!result.ok) throw new Error(`LINE push failed: ${result.status} ${result.body}`);

      await markNotificationLogSent(deliveryLog.log.id, {
        provider: "line",
        payload: {
          lineStatus: result.status,
          responseBody: truncateForLog(result.body)
        }
      });

      return prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), smsErrorCode: null, smsErrorMessage: null }
      });
    }

    if (notification.channel === ConversationChannel.ADMIN || notification.channel === ConversationChannel.WEB_CHAT) {
      await markNotificationLogSent(deliveryLog.log.id, {
        provider: "internal",
        payload: {
          channel: notification.channel,
          reason: "internal_notification"
        }
      });

      return prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), smsErrorCode: null, smsErrorMessage: null }
      });
    }

    const phone = target.recipientPhone;
    if (!phone) throw new Error("Phone number is not linked");

    const smsTo = normalizeSmsRecipient(phone);
    attemptedSmsDelivery = {
      targetPhone: phone,
      customerPhone: notification.reservation.customer.phone,
      smsTo
    };
    const smsResult = await sendTwilioSms({
      notificationId: notification.id,
      storeId: notification.storeId,
      to: smsTo,
      body: sanitizeSmsBody(notification.body)
    });

    await markNotificationLogSent(deliveryLog.log.id, {
      provider: "twilio",
      providerMessageId: typeof smsResult?.sid === "string" ? smsResult.sid : null,
      payload: summarizeTwilioSmsResponse(smsResult)
    });

    return prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        targetPhone: phone,
        customerPhone: notification.reservation.customer.phone,
        smsTo,
        smsSid: typeof smsResult?.sid === "string" ? smsResult.sid : null,
        smsDeliveryStatus: typeof smsResult?.status === "string" ? smsResult.status : "accepted",
        smsDeliveryCheckedAt: null,
        smsDeliveredAt: null,
        smsDeliveryRaw: summarizeTwilioSmsResponse(smsResult),
        smsErrorCode: null,
        smsErrorMessage: null
      }
    });
  } catch (error) {
    await markNotificationLogFailed(deliveryLog.log.id, error, {
      attemptedSmsDelivery,
      channel: notification.channel
    });

    await prisma.auditLog.create({
      data: {
        storeId: notification.storeId,
        reservationId: notification.reservationId,
        actorType: "SYSTEM",
        action: "notification.delivery_failed",
        after: {
          notificationId: notification.id,
          channel: notification.channel,
          code: notificationErrorCode(error),
          message: notificationErrorMessage(error)
        }
      }
    });

    return markNotificationFailed(notification, error, target, attemptedSmsDelivery);
  }
}

export async function recordNotificationDeliveryLog(
  notificationId: string,
  input: {
    provider?: DeliveryProvider;
    providerMessageId?: string | null;
    payload?: Record<string, unknown>;
  } = {}
) {
  const notification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
    include: {
      reservation: {
        include: {
          customer: true,
          course: true,
          therapist: true,
          room: true,
          store: true
        }
      },
      store: true
    }
  });

  const target = resolveNotificationDeliveryTarget(notification);
  const deliveryLog = await beginNotificationDeliveryLog(notification, target);
  if (!deliveryLog.shouldSend) return deliveryLog.log;

  return markNotificationLogSent(deliveryLog.log.id, {
    provider: input.provider ?? target.provider,
    providerMessageId: input.providerMessageId ?? null,
    payload: buildNotificationLogPayload(notification, target, {
      recordedAlreadyDelivered: true,
      ...(input.payload ?? {})
    })
  });
}

export async function recordDeliveredNotificationLogs(input: {
  storeId?: string;
  reservationId?: string;
  notificationIds?: string[];
}) {
  const notificationIds = input.notificationIds ?? [];
  const notifications = await prisma.notification.findMany({
    where: {
      status: NotificationStatus.SENT,
      ...(input.storeId ? { storeId: input.storeId } : {}),
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      ...(notificationIds.length > 0 ? { id: { in: notificationIds } } : {}),
      logs: { none: {} }
    },
    select: { id: true }
  });

  const results = [];
  for (const notification of notifications) {
    results.push(
      await recordNotificationDeliveryLog(notification.id, {
        payload: { source: "already_delivered_notification" }
      })
    );
  }
  return results;
}

export async function recordQueuedNotificationLogs(input: {
  storeId?: string;
  reservationId?: string;
  notificationIds?: string[];
}) {
  const notificationIds = input.notificationIds ?? [];
  const notifications = await prisma.notification.findMany({
    where: {
      ...(input.storeId ? { storeId: input.storeId } : {}),
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      ...(notificationIds.length > 0 ? { id: { in: notificationIds } } : {}),
      logs: { none: {} }
    },
    include: {
      reservation: {
        include: {
          customer: true,
          course: true,
          therapist: true,
          room: true,
          store: true
        }
      },
      store: true
    }
  });

  const results = [];
  for (const notification of notifications) {
    if (notification.status === NotificationStatus.SENT) {
      results.push(
        await recordNotificationDeliveryLog(notification.id, {
          payload: { source: "already_delivered_notification" }
        })
      );
      continue;
    }

    const target = resolveNotificationDeliveryTarget(notification);
    const deliveryLog = await beginNotificationDeliveryLog(notification, target);
    results.push(deliveryLog.log);
  }
  return results;
}

async function beginNotificationDeliveryLog(notification: NotificationForDelivery, target: NotificationDeliveryTarget) {
  const dedupeKey = buildNotificationDedupeKey(notification, target);
  const existing = await prisma.notificationLog.findUnique({
    where: {
      storeId_dedupeKey: {
        storeId: notification.storeId,
        dedupeKey
      }
    }
  });

  if (existing) {
    if (!canReuseNotificationLogForRetry(existing, notification.id)) {
      return { shouldSend: false as const, log: existing };
    }

    const log = await prisma.notificationLog.update({
      where: { id: existing.id },
      data: {
        notificationId: notification.id,
        reservationId: notification.reservationId,
        type: notification.type,
        channel: notification.channel,
        status: NotificationStatus.PENDING,
        recipientName: target.recipientName,
        recipientPhone: target.recipientPhone,
        recipientLineId: target.recipientLineId,
        provider: target.provider,
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        payload: buildNotificationLogPayload(notification, target, { reused: true }),
        sentAt: null
      }
    });
    return { shouldSend: true as const, log };
  }

  try {
    const log = await prisma.notificationLog.create({
      data: {
        storeId: notification.storeId,
        notificationId: notification.id,
        reservationId: notification.reservationId,
        type: notification.type,
        channel: notification.channel,
        status: NotificationStatus.PENDING,
        recipientName: target.recipientName,
        recipientPhone: target.recipientPhone,
        recipientLineId: target.recipientLineId,
        provider: target.provider,
        dedupeKey,
        payload: buildNotificationLogPayload(notification, target)
      }
    });
    return { shouldSend: true as const, log };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const log = await prisma.notificationLog.findUniqueOrThrow({
      where: {
        storeId_dedupeKey: {
          storeId: notification.storeId,
          dedupeKey
        }
      }
    });
    return { shouldSend: false as const, log };
  }
}

function canReuseNotificationLogForRetry(log: NotificationLogRecord, notificationId: string) {
  if (log.status === NotificationStatus.FAILED) return true;
  if (log.notificationId !== notificationId) return false;
  if (log.status !== NotificationStatus.PENDING || log.providerMessageId) return false;
  return Date.now() - log.createdAt.getTime() > pendingLogRetryAfterMs;
}

async function markDuplicateNotificationSuppressed(
  notification: NotificationForDelivery,
  existingLog: NotificationLogRecord,
  target: NotificationDeliveryTarget
) {
  const alreadySent = existingLog.status === NotificationStatus.SENT;
  const duplicateMessage = alreadySent
    ? null
    : "Duplicate notification suppressed by NotificationLog dedupe key";

  return prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: alreadySent ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: alreadySent ? (existingLog.sentAt ?? new Date()) : null,
      targetName: notification.targetName ?? target.recipientName,
      targetPhone: notification.targetPhone ?? target.recipientPhone,
      targetLineId: notification.targetLineId ?? target.recipientLineId,
      ...(target.provider === "twilio"
        ? {
            smsSid: existingLog.providerMessageId ?? notification.smsSid,
            smsErrorCode: alreadySent ? null : "DUPLICATE_NOTIFICATION",
            smsErrorMessage: duplicateMessage
          }
        : {
            smsErrorCode: alreadySent ? null : "DUPLICATE_NOTIFICATION",
            smsErrorMessage: duplicateMessage
          })
    }
  });
}

async function markNotificationLogSent(
  logId: string,
  input: {
    provider: DeliveryProvider;
    providerMessageId?: string | null;
    payload?: Prisma.InputJsonValue;
  }
) {
  return prisma.notificationLog.update({
    where: { id: logId },
    data: {
      status: NotificationStatus.SENT,
      provider: input.provider,
      providerMessageId: input.providerMessageId ?? null,
      errorCode: null,
      errorMessage: null,
      payload: input.payload,
      sentAt: new Date()
    }
  });
}

async function markNotificationLogFailed(logId: string, error: unknown, payload?: Record<string, unknown>) {
  return prisma.notificationLog.update({
    where: { id: logId },
    data: {
      status: NotificationStatus.FAILED,
      errorCode: notificationErrorCode(error),
      errorMessage: notificationErrorMessage(error),
      payload: toJsonPayload({
        ...(payload ?? {}),
        errorCode: notificationErrorCode(error),
        errorMessage: notificationErrorMessage(error)
      }),
      sentAt: null
    }
  });
}

async function markNotificationFailed(
  notification: NotificationForDelivery,
  error: unknown,
  target: NotificationDeliveryTarget,
  attemptedSmsDelivery?: { targetPhone: string; customerPhone: string | null; smsTo: string } | null
) {
  return prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: NotificationStatus.FAILED,
      sentAt: null,
      targetName: notification.targetName ?? target.recipientName,
      targetPhone: notification.targetPhone ?? target.recipientPhone,
      targetLineId: notification.targetLineId ?? target.recipientLineId,
      ...(attemptedSmsDelivery
        ? {
            targetPhone: attemptedSmsDelivery.targetPhone,
            customerPhone: attemptedSmsDelivery.customerPhone,
            smsTo: attemptedSmsDelivery.smsTo,
            smsSid: null
          }
        : {}),
      smsErrorCode: notificationErrorCode(error),
      smsErrorMessage: notificationErrorMessage(error)
    }
  });
}

function resolveNotificationDeliveryTarget(notification: NotificationForDelivery): NotificationDeliveryTarget {
  const reservation = notification.reservation;
  const customer = reservation?.customer;
  const therapist = reservation?.therapist;
  const therapistNotification =
    notification.type === NotificationType.THERAPIST_BOOKING || notification.type === NotificationType.THERAPIST_SHIFT;
  const recipientName = notification.targetName ?? (therapistNotification ? therapist?.displayName : customer?.name) ?? null;

  if (notification.channel === ConversationChannel.LINE) {
    return {
      provider: "line",
      recipientName,
      recipientLineId: notification.targetLineId ?? (therapistNotification ? therapist?.lineId : customer?.lineId) ?? null
    };
  }

  if (notification.channel === ConversationChannel.PHONE) {
    return {
      provider: "twilio",
      recipientName,
      recipientPhone: notification.targetPhone ?? (therapistNotification ? therapist?.phone : customer?.phone) ?? null
    };
  }

  return {
    provider: "internal",
    recipientName,
    recipientPhone: notification.targetPhone ?? (therapistNotification ? therapist?.phone : customer?.phone) ?? null,
    recipientLineId: notification.targetLineId ?? (therapistNotification ? therapist?.lineId : customer?.lineId) ?? null
  };
}

function buildNotificationDedupeKey(notification: NotificationForDelivery, target: NotificationDeliveryTarget) {
  const bodyHash = hashText(notification.body);
  const recipient = target.recipientLineId
    ? `line:${target.recipientLineId}`
    : target.recipientPhone
      ? `phone:${normalizeSmsRecipient(target.recipientPhone)}`
      : target.recipientName
        ? `name:${target.recipientName}`
        : "recipient:unknown";
  const raw = JSON.stringify({
    reservationId: notification.reservationId ?? "no-reservation",
    type: notification.type,
    channel: notification.channel,
    provider: target.provider,
    recipient,
    scheduledAt: notification.scheduledAt?.toISOString() ?? null,
    bodyHash
  });
  return `notification:${hashText(raw).slice(0, 40)}`;
}

function buildNotificationLogPayload(
  notification: NotificationForDelivery,
  target: NotificationDeliveryTarget,
  extra?: Record<string, unknown>
) {
  return toJsonPayload({
    notificationId: notification.id,
    reservationId: notification.reservationId,
    type: notification.type,
    channel: notification.channel,
    provider: target.provider,
    recipientName: target.recipientName ?? null,
    recipientPhone: target.recipientPhone ?? null,
    recipientLineId: target.recipientLineId ?? null,
    scheduledAt: notification.scheduledAt?.toISOString() ?? null,
    bodyHash: hashText(notification.body),
    ...(extra ?? {})
  });
}

function notificationErrorCode(error: unknown) {
  const code = (error as { code?: string | number | null } | null)?.code;
  return code === undefined || code === null ? null : String(code);
}

function notificationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function truncateForLog(value: string, maxLength = 1000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function sendPendingNotifications(input: {
  storeId: string;
  limit?: number;
  now?: Date;
  reservationId?: string;
  reservationIds?: string[];
}) {
  const reservationFilter = new Set<string>();
  if (input.reservationId) reservationFilter.add(input.reservationId);
  for (const id of input.reservationIds ?? []) reservationFilter.add(id);

  const filteredReservationIds = Array.from(reservationFilter);
  const notifications = await prisma.notification.findMany({
    where: {
      storeId: input.storeId,
      status: NotificationStatus.PENDING,
      ...(filteredReservationIds.length > 0 ? { reservationId: { in: filteredReservationIds } } : {}),
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: input.now ?? new Date() } }]
    },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? 20
  });

  const results = [];
  for (const notification of notifications) {
    results.push(await sendNotification(notification.id));
  }
  return results;
}

export async function sendTwilioSms(input: { notificationId?: string; storeId?: string; to: string; body: string }) {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const apiKey = env("TWILIO_API_KEY");
  const apiSecret = env("TWILIO_API_SECRET");
  const storePhoneSetting = input.storeId
    ? await prisma.storePhoneSetting.findFirst({
        where: { storeId: input.storeId },
        orderBy: { updatedAt: "desc" },
        select: { aiReceptionPhoneNumber: true }
      })
    : null;
  const from = normalizeSmsSender(env("TWILIO_SMS_FROM") || storePhoneSetting?.aiReceptionPhoneNumber || env("TWILIO_PHONE_NUMBER"));

  if (!accountSid || !from || (!authToken && !(apiKey && apiSecret))) {
    throw new Error("Twilio SMS env vars are not configured");
  }
  const authConfig = buildTwilioRestAuthConfig({ accountSid, authToken, apiKey, apiSecret });

  const to = normalizeSmsRecipient(input.to);
  const requestBody = new URLSearchParams({
    From: from,
    To: to,
    Body: input.body
  });
  const statusCallback = buildSmsStatusCallbackUrl(input.notificationId);
  if (statusCallback) {
    requestBody.set("StatusCallback", statusCallback);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: authConfig.authorization,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: requestBody
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message ?? `Twilio SMS failed: ${response.status}`) as Error & { code?: string | number };
    error.code = payload.code ?? response.status;
    throw error;
  }

  return response.json();
}

function buildSmsStatusCallbackUrl(notificationId?: string) {
  const publicUrl = (env("PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_URL"))?.trim().replace(/\/+$/, "");
  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) return null;

  const url = new URL("/api/twilio/sms/status", publicUrl);
  if (notificationId) url.searchParams.set("notificationId", notificationId);
  return url.toString();
}

function summarizeTwilioSmsResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  return {
    sid: stringOrNull(payload.sid),
    status: stringOrNull(payload.status),
    direction: stringOrNull(payload.direction),
    errorCode: stringOrNull(payload.error_code ?? payload.errorCode),
    errorMessage: stringOrNull(payload.error_message ?? payload.errorMessage),
    dateCreated: stringOrNull(payload.date_created ?? payload.dateCreated),
    dateUpdated: stringOrNull(payload.date_updated ?? payload.dateUpdated)
  };
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function buildTwilioRestAuthConfig(input: { accountSid: string; authToken?: string; apiKey?: string; apiSecret?: string }) {
  const accountSid = input.accountSid.trim();
  const authToken = (input.authToken ?? "").trim();
  const apiKey = (input.apiKey ?? "").trim();
  const apiSecret = (input.apiSecret ?? "").trim();
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    const error = new Error("TWILIO_ACCOUNT_SID must start with AC and be 34 characters.") as Error & { code?: string };
    error.code = "TWILIO_ACCOUNT_SID_INVALID_FORMAT";
    throw error;
  }
  if (apiKey || apiSecret) {
    if (!/^SK[0-9a-fA-F]{32}$/.test(apiKey)) {
      const error = new Error("TWILIO_API_KEY must start with SK and be 34 characters.") as Error & { code?: string };
      error.code = "TWILIO_API_KEY_INVALID_FORMAT";
      throw error;
    }
    if (apiSecret.length < 20 || /\s/.test(apiSecret)) {
      const error = new Error("TWILIO_API_SECRET is missing or invalid.") as Error & { code?: string };
      error.code = "TWILIO_API_SECRET_INVALID_FORMAT";
      throw error;
    }
    return { mode: "api_key", authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` };
  }
  if (/^THAA/i.test(authToken) || authToken.length > 80) {
    const error = new Error(
      "TWILIO_AUTH_TOKEN is not a Twilio REST Auth Token. Set the Auth Token from Twilio Console, or use an API Key SID/Secret implementation."
    ) as Error & { code?: string };
    error.code = "TWILIO_AUTH_TOKEN_INVALID_FORMAT";
    throw error;
  }
  if (authToken.length < 20) {
    const error = new Error("TWILIO_AUTH_TOKEN is too short for Twilio REST API authentication.") as Error & { code?: string };
    error.code = "TWILIO_AUTH_TOKEN_INVALID_FORMAT";
    throw error;
  }
  return { mode: "auth_token", authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
}

export function buildReservationSmsBody(input: {
  startsAt: Date;
  courseName: string;
  customerName?: string | null;
  storeName?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  coursePrice?: number | null;
  therapistName?: string | null;
  nominated?: boolean | null;
  nominationFee?: number | null;
  options?: Array<{ name: string; price?: number | null }>;
  locationName?: string | null;
  note?: string | null;
}) {
  return buildCustomerReservationMessage({
    ...input,
    heading: "ご予約ありがとうございます。"
  });
}

export function buildReservationCancellationSmsBody(input: {
  startsAt: Date;
  endsAt?: Date | null;
  courseName: string;
  customerName?: string | null;
  storeName?: string | null;
  storePhone?: string | null;
  therapistName?: string | null;
  nominated?: boolean | null;
  locationName?: string | null;
}) {
  const storeName = input.storeName?.trim() || "";
  const customerName = input.customerName?.trim() || "";
  const therapistName = input.nominated ? withSanSuffix(input.therapistName) : "フリー";
  const locationName = formatMansionName(input.locationName);
  const storePhone = formatDisplayPhoneNumber(input.storePhone);
  const timeRange = input.endsAt
    ? `${formatReservationDate(input.startsAt)}-${formatTimeOnly(input.endsAt)}`
    : formatReservationDate(input.startsAt);

  return [
    storeName,
    storeName ? "" : null,
    customerName ? `${customerName}様` : null,
    "",
    "ご予約のキャンセルを承りました。",
    "",
    "【日時】",
    timeRange,
    "【コース】",
    input.courseName,
    "【担当】",
    therapistName,
    "【マンション名】",
    locationName,
    "",
    storePhone ? `TEL:${storePhone}` : null,
    "",
    "またのご予約をお待ちしております。"
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildReservationConfirmationMessage(input: {
  storeName?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  customerName?: string | null;
  startsAt: Date;
  courseName: string;
  coursePrice?: number | null;
  therapistName?: string | null;
  nominated?: boolean | null;
  nominationFee?: number | null;
  options?: Array<{ name: string; price?: number | null }>;
  locationName?: string | null;
  note?: string | null;
}) {
  return buildCustomerReservationMessage({
    ...input,
    heading: "ご予約ありがとうございます。"
  });
}

export function buildReservationReminderSmsBody(input: {
  startsAt: Date;
  courseName: string;
  customerName?: string | null;
  timing: "previous-day" | "same-day";
}) {
  const name = input.customerName ? `${input.customerName}様\n` : "";
  const timingText = input.timing === "previous-day" ? "明日" : "本日";
  return `${name}${timingText}のご予約確認です。\n${formatSmsDate(input.startsAt)} / ${input.courseName}\nご来店をお待ちしております。`;
}

type CustomerReservationMessageInput = {
  startsAt: Date;
  courseName: string;
  customerName?: string | null;
  storeName?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  coursePrice?: number | null;
  therapistName?: string | null;
  nominated?: boolean | null;
  nominationFee?: number | null;
  options?: Array<{ name: string; price?: number | null }>;
  locationName?: string | null;
  heading: string;
  note?: string | null;
};

function buildCustomerReservationMessage(input: CustomerReservationMessageInput) {
  const coursePrice = nullableNumber(input.coursePrice);
  const nominationFee = input.nominated ? nullableNumber(input.nominationFee) : 0;
  const options = input.options ?? [];
  const optionsTotal = options.reduce((sum, option) => sum + (nullableNumber(option.price) ?? 0), 0);
  const total = coursePrice === null || nominationFee === null ? null : coursePrice + nominationFee + optionsTotal;
  const optionLines = options.length
    ? options.map((option) => `${option.name || "オプション"} ${formatPrice(nullableNumber(option.price))}`)
    : ["店内検討"];
  const storeName = input.storeName?.trim() || "";
  const customerName = input.customerName?.trim() || "";
  const bookingType = input.nominated ? "指名" : "フリー";
  const therapistName = input.nominated ? withSanSuffix(input.therapistName) : "フリー";
  const locationName = formatMansionName(input.locationName);
  const storeAddress = input.storeAddress?.trim() || "予約確定後に店舗よりご案内";
  const storePhone = formatDisplayPhoneNumber(input.storePhone);

  return [
    storeName,
    storeName ? "" : null,
    customerName ? `${customerName}様` : null,
    "",
    input.heading,
    input.note ?? null,
    "",
    "【日時】",
    formatReservationDate(input.startsAt),
    "【コース】",
    input.courseName,
    "【料金】",
    formatPrice(coursePrice),
    "【予約種別】",
    bookingType,
    "【担当】",
    therapistName,
    "【指名料】",
    input.nominated ? formatPrice(nominationFee) : "なし",
    "【オプション】",
    ...optionLines,
    "【合計】",
    formatPrice(total),
    "",
    "【マンション名】",
    locationName,
    "",
    "【住所】",
    storeAddress,
    "",
    "到着されましたらお電話にてご連絡お願い致します。",
    "",
    "※お時間丁度のご案内になります。お早めに到着された場合待ち時間が発生します。",
    "",
    `TEL:${storePhone || "予約確定後に店舗よりご案内"}`,
    "",
    "お気をつけてお越しください。"
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nullableNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function withSanSuffix(value?: string | null) {
  const text = value?.trim() || "";
  if (!text) return "未定";
  return /さん$/u.test(text) ? text : `${text}さん`;
}


function formatDisplayPhoneNumber(value?: string | null) {
  const raw = value?.trim() || "";
  const digits = raw.replace(/\D/g, "");
  const domestic = digits.startsWith("81") ? `0${digits.slice(2)}` : digits;
  if (/^0\d{9,10}$/.test(domestic)) {
    if (domestic.length === 11) return domestic.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
    return domestic.replace(/^(\d{2,4})(\d{2,4})(\d{4})$/, "$1-$2-$3");
  }
  return raw;
}

function normalizeSmsSender(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+81${digits.slice(1)}`;
  if (digits.startsWith("81")) return `+${digits}`;
  return trimmed;
}

function numberOrZero(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMansionName(value?: string | null) {
  const text = value?.trim() || "未設定";
  return text.replace(/\s*(?:[0-9０-９]{2,4}|[0-9０-９]{2,4}号室)$/u, "").trim() || text;
}
export function sanitizeSmsBody(body: string) {
  return body
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

export function normalizeSmsRecipient(phone: string) {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+81${digits.slice(1)}`;
  if (digits.startsWith("81")) return `+${digits}`;
  return `+${digits}`;
}

function formatSmsDate(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatReservationDate(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}月${value("day")}日 ${value("hour")}:${value("minute")}`;
}

function formatTimeOnly(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("hour")}:${value("minute")}`;
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return "未確定";
  return `${value.toLocaleString("ja-JP")}円`;
}




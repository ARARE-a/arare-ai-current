#!/usr/bin/env node

/**
 * Post-migration verification for owner-4 notification logging.
 *
 * Run after Supabase has migration 202606110001_prd_core_models applied:
 *   npx tsx scripts/verify-notification-log-after-migration.mjs
 *
 * This script does not send real Twilio SMS or LINE messages. It verifies:
 * - sendNotification creates and updates NotificationLog for an internal ADMIN notification.
 * - duplicate sendNotification attempts are suppressed by the NotificationLog dedupe key.
 * - the Twilio SMS status callback route reflects a delivered callback into NotificationLog.
 * - a LINE push failure is recorded in NotificationLog without calling the LINE API.
 */

import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma.ts";
import { sendNotification } from "../src/lib/notification-service.ts";

const runId = `notification-log-verify-${Date.now()}`;
let storeId = null;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured. Point it at the DB that already has the PRD core migration applied.");
  }

  await assertNotificationLogTableExists();

  const fixture = await createFixture();
  storeId = fixture.store.id;

  const sendResult = await verifySendNotificationCreatesLog(fixture);
  const dedupeResult = await verifyNotificationDedupe(fixture);
  const callbackResult = await verifySmsCallbackCreatesLog(fixture);
  const lineFailureResult = await verifyLinePushFailureLog(fixture);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        checked: {
          sendNotificationNotificationLog: sendResult,
          dedupeKeySuppression: dedupeResult,
          twilioStatusCallbackNotificationLog: callbackResult,
          linePushFailureNotificationLog: lineFailureResult
        }
      },
      null,
      2
    )
  );
}

async function assertNotificationLogTableExists() {
  try {
    await prisma.notificationLog.count();
  } catch (error) {
    throw new Error(
      [
        "NotificationLog is not queryable. The likely cause is that migration 202606110001_prd_core_models is not applied to this DB.",
        formatPrismaError(error)
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function createFixture() {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 90 * 60 * 1000);

  const store = await prisma.store.create({
    data: {
      name: runId,
      phone: "03-0000-0000",
      address: "verification fixture"
    }
  });

  const customer = await prisma.customer.create({
    data: {
      storeId: store.id,
      name: "Notification Log Verify",
      phone: "090-0000-0001"
    }
  });

  const course = await prisma.course.create({
    data: {
      storeId: store.id,
      name: `Verify Course ${runId}`,
      durationMin: 90,
      price: 10000
    }
  });

  const reservation = await prisma.reservation.create({
    data: {
      storeId: store.id,
      customerId: customer.id,
      courseId: course.id,
      startsAt,
      endsAt,
      status: "CONFIRMED",
      nominated: false,
      firstVisit: true,
      source: "ADMIN",
      confirmationText: "NotificationLog verification fixture"
    }
  });

  return { store, customer, course, reservation };
}

async function verifySendNotificationCreatesLog(fixture) {
  const notification = await prisma.notification.create({
    data: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CONFIRMED",
      channel: "ADMIN",
      body: `Internal notification log verification ${runId}`
    }
  });

  const updated = await sendNotification(notification.id);
  assertEqual(updated.status, "SENT", "sendNotification should mark the ADMIN notification SENT");

  const log = await prisma.notificationLog.findFirst({
    where: { notificationId: notification.id },
    orderBy: { createdAt: "desc" }
  });
  assert(log, "sendNotification should create a NotificationLog row");
  assertEqual(log.status, "SENT", "NotificationLog status should be SENT");
  assertEqual(log.provider, "internal", "NotificationLog provider should be internal");
  assertEqual(log.reservationId, fixture.reservation.id, "NotificationLog reservationId should match");

  return {
    notificationId: notification.id,
    notificationLogId: log.id,
    status: log.status,
    provider: log.provider
  };
}

async function verifyNotificationDedupe(fixture) {
  const duplicateBody = `Duplicate notification verification ${runId}`;
  const first = await prisma.notification.create({
    data: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CHANGED",
      channel: "ADMIN",
      body: duplicateBody
    }
  });
  await sendNotification(first.id);

  const before = await prisma.notificationLog.count({
    where: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CHANGED",
      channel: "ADMIN",
      provider: "internal"
    }
  });

  const second = await prisma.notification.create({
    data: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CHANGED",
      channel: "ADMIN",
      body: duplicateBody
    }
  });
  const updatedSecond = await sendNotification(second.id);

  const after = await prisma.notificationLog.count({
    where: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CHANGED",
      channel: "ADMIN",
      provider: "internal"
    }
  });

  assertEqual(updatedSecond.status, "SENT", "Duplicate notification should be suppressed without failing the user-visible notification");
  assertEqual(after, before, "Duplicate notification should not create an additional NotificationLog row");

  return {
    firstNotificationId: first.id,
    duplicateNotificationId: second.id,
    logCountBeforeDuplicate: before,
    logCountAfterDuplicate: after
  };
}

async function verifySmsCallbackCreatesLog(fixture) {
  const smsSid = `SM${"1".repeat(32)}`;
  const smsTo = "+819000000001";
  const notification = await prisma.notification.create({
    data: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CONFIRMED",
      channel: "PHONE",
      status: "SENT",
      sentAt: new Date(),
      targetName: fixture.customer.name,
      targetPhone: fixture.customer.phone,
      customerPhone: fixture.customer.phone,
      smsTo,
      smsSid,
      smsDeliveryStatus: "queued",
      body: `SMS callback notification log verification ${runId}`
    }
  });

  process.env.TWILIO_VALIDATE_CALLBACK_SIGNATURE = "false";
  const { POST } = await import("../src/app/api/twilio/sms/status/route.ts");
  const form = new URLSearchParams({
    MessageSid: smsSid,
    SmsSid: smsSid,
    MessageStatus: "delivered",
    To: smsTo,
    From: "+81300000000"
  });
  const request = new NextRequest(`http://localhost/api/twilio/sms/status?notificationId=${notification.id}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const response = await POST(request);
  const json = await response.json();
  assert(response.ok, `SMS callback route should return ok. Response: ${JSON.stringify(json)}`);

  const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
  assertEqual(updated.smsDeliveryStatus, "delivered", "Notification smsDeliveryStatus should become delivered");
  assert(updated.smsDeliveredAt, "Notification smsDeliveredAt should be set");

  const log = await prisma.notificationLog.findFirst({
    where: { notificationId: notification.id },
    orderBy: { createdAt: "desc" }
  });
  assert(log, "SMS callback should create or update a NotificationLog row");
  assertEqual(log.status, "SENT", "SMS callback NotificationLog status should be SENT");
  assertEqual(log.provider, "twilio", "SMS callback NotificationLog provider should be twilio");
  assertEqual(log.providerMessageId, smsSid, "SMS callback NotificationLog providerMessageId should match MessageSid");

  return {
    notificationId: notification.id,
    notificationLogId: log.id,
    smsSid,
    smsDeliveryStatus: updated.smsDeliveryStatus,
    smsDeliveredAt: updated.smsDeliveredAt?.toISOString() ?? null
  };
}

async function verifyLinePushFailureLog(fixture) {
  const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const notification = await prisma.notification.create({
    data: {
      storeId: fixture.store.id,
      reservationId: fixture.reservation.id,
      type: "RESERVATION_CONFIRMED",
      channel: "LINE",
      targetName: fixture.customer.name,
      targetLineId: `line-failure-${runId}`,
      body: `LINE failure notification log verification ${runId}`
    }
  });

  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  try {
    const updated = await sendNotification(notification.id);
    assertEqual(updated.status, "FAILED", "LINE push failure should mark the notification FAILED");
    assert(
      updated.smsErrorMessage?.includes("LINE_CHANNEL_ACCESS_TOKEN is not configured"),
      "LINE push failure should save the failure reason on the notification"
    );
  } finally {
    if (originalToken === undefined) {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    } else {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken;
    }
  }

  const log = await prisma.notificationLog.findFirst({
    where: { notificationId: notification.id },
    orderBy: { createdAt: "desc" }
  });
  assert(log, "LINE push failure should create a NotificationLog row");
  assertEqual(log.status, "FAILED", "LINE push failure NotificationLog status should be FAILED");
  assertEqual(log.provider, "line", "LINE push failure NotificationLog provider should be line");
  assert(
    log.errorMessage?.includes("LINE_CHANNEL_ACCESS_TOKEN is not configured"),
    "LINE push failure NotificationLog should include the failure reason"
  );

  return {
    notificationId: notification.id,
    notificationLogId: log.id,
    status: log.status,
    provider: log.provider,
    errorMessage: log.errorMessage
  };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, got ${actual}`);
  }
}

function formatPrismaError(error) {
  if (!error || typeof error !== "object") return String(error);
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : String(error);
  return [code ? `code=${code}` : null, message].filter(Boolean).join(" ");
}

async function cleanup() {
  if (!storeId) return;
  try {
    await prisma.store.delete({ where: { id: storeId } });
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          cleanupFailed: true,
          storeId,
          error: formatPrismaError(error)
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          runId,
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

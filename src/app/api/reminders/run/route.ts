import { addDays } from "date-fns";
import { NextRequest } from "next/server";
import { NotificationType } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { buildReservationReminderSmsBody, sendPendingNotifications } from "@/lib/notification-service";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
      return fail(new Error("invalid cron token"), 401);
    }
    const searchParams = new URL(request.url).searchParams;
    const explicitStoreId = searchParams.get("storeId");
    const timing = searchParams.get("timing") === "same-day" ? "same-day" : "previous-day";
    const notificationType =
      timing === "same-day" ? NotificationType.REMINDER_SAME_DAY : NotificationType.REMINDER_PREVIOUS_DAY;
    const targetStoreIds = explicitStoreId
      ? [explicitStoreId]
      : (await prisma.store.findMany({ select: { id: true } })).map((store) => store.id);

    const results = [];
    for (const storeId of targetStoreIds) {
      const queued = await queueReminderNotificationsForStore(storeId, timing, notificationType);
      const sent = await sendPendingNotifications({ storeId, limit: 50 });
      results.push({
        storeId,
        queued,
        attempted: sent.length,
        sent: sent.filter((item) => item.status === "SENT").length,
        results: sent
      });
    }

    return ok({
      storeCount: results.length,
      queued: results.reduce((sum, item) => sum + item.queued, 0),
      sent: results.reduce((sum, item) => sum + item.sent, 0),
      results
    });
  } catch (error) {
    return fail(error, 500);
  }
}

async function queueReminderNotificationsForStore(
  storeId: string,
  timing: "same-day" | "previous-day",
  notificationType: NotificationType
) {
  const targetDay = startOfJstDay(new Date(), timing === "same-day" ? 0 : 1);
  const dayAfter = addDays(targetDay, 1);
  const reservations = await prisma.reservation.findMany({
    where: {
      storeId,
      status: "CONFIRMED",
      startsAt: { gte: targetDay, lt: dayAfter }
    },
    include: { customer: true, course: true }
  });

  let queued = 0;
  for (const reservation of reservations) {
    const existing = await prisma.notification.findFirst({
      where: {
        storeId: reservation.storeId,
        reservationId: reservation.id,
        type: notificationType
      }
    });

    if (existing) continue;

    await prisma.notification.create({
      data: {
        storeId: reservation.storeId,
        reservationId: reservation.id,
        type: notificationType,
        channel: reservation.source,
        body: buildReservationReminderSmsBody({
          startsAt: reservation.startsAt,
          courseName: reservation.course.name,
          customerName: reservation.customer.name,
          timing
        })
      }
    });
    queued += 1;
  }

  return queued;
}

function startOfJstDay(date: Date, addDaysCount: number) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return new Date(Date.UTC(year, month - 1, day + addDaysCount, -9, 0, 0, 0));
}

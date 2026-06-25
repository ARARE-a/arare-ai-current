import { NextRequest } from "next/server";
import { NotificationStatus, NotificationType } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { sendNotification, sendPendingNotifications } from "@/lib/notification-service";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext } from "@/lib/store-access";

const OPERATIONAL_PENDING_WINDOW_MS = 72 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const legacyPendingCutoff = new Date(Date.now() - OPERATIONAL_PENDING_WINDOW_MS);
    const notifications = await prisma.notification.findMany({
      where: {
        storeId,
        NOT: {
          type: NotificationType.THERAPIST_BOOKING,
          status: NotificationStatus.PENDING,
          createdAt: { lt: legacyPendingCutoff }
        }
      },
      include: { reservation: { include: { customer: true, course: true } } },
      orderBy: { createdAt: "desc" }
    });
    return ok(notifications);
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const payload = await request.json().catch(() => ({}));

    if (payload.notificationId) {
      const owner = await prisma.notification.findFirstOrThrow({
        where: { id: payload.notificationId, storeId },
        select: { id: true }
      });
      const notification = await sendNotification(owner.id);
      const notifications = [notification];
      return ok({ ...summarizeNotificationAttempts(notifications), notifications });
    }

    const reservationId = typeof payload.reservationId === "string" && payload.reservationId.trim()
      ? payload.reservationId.trim()
      : null;
    const reservationIdCandidates = Array.isArray(payload.reservationIds) ? payload.reservationIds : [];
    const reservationIds = reservationIdCandidates
      .filter((candidate: unknown): candidate is string => typeof candidate === "string" && candidate.trim() !== "")
      .map((candidate: string) => candidate.trim());

    const notifications = await sendPendingNotifications({
      storeId,
      reservationId: reservationId ?? undefined,
      reservationIds,
      limit: Number(payload.limit ?? 20)
    });
    return ok({ ...summarizeNotificationAttempts(notifications), notifications });
  } catch (error) {
    return fail(error, 500);
  }
}

function summarizeNotificationAttempts(notifications: Array<{ status: string }>) {
  const sent = notifications.filter((notification) => notification.status === "SENT").length;
  const failed = notifications.filter((notification) => notification.status === "FAILED").length;
  const pending = notifications.filter((notification) => notification.status === "PENDING").length;

  return {
    attempted: notifications.length,
    sent,
    failed,
    pending
  };
}

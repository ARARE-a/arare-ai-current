import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get("reservationId")?.trim();
    const notificationId = searchParams.get("notificationId")?.trim();
    const status = searchParams.get("status")?.trim();
    const limit = Math.min(Number(searchParams.get("limit") ?? 100) || 100, 300);

    const logs = await prisma.notificationLog.findMany({
      where: {
        storeId,
        reservationId: reservationId || undefined,
        notificationId: notificationId || undefined,
        status: status === "PENDING" || status === "SENT" || status === "FAILED" ? status : undefined
      },
      include: {
        notification: {
          select: {
            body: true,
            targetName: true,
            targetPhone: true,
            targetLineId: true,
            smsSid: true,
            smsDeliveryStatus: true,
            smsErrorCode: true,
            smsErrorMessage: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return ok(
      logs.map(({ notification, ...log }) => ({
        ...log,
        body: notification?.body ?? null,
        notificationTargetName: notification?.targetName ?? null,
        notificationTargetPhone: notification?.targetPhone ?? null,
        notificationTargetLineId: notification?.targetLineId ?? null,
        smsSid: notification?.smsSid ?? null,
        smsDeliveryStatus: notification?.smsDeliveryStatus ?? null,
        smsErrorCode: notification?.smsErrorCode ?? null,
        smsErrorMessage: notification?.smsErrorMessage ?? null
      }))
    );
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

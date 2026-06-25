import { ReservationStatus } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { DEMO_STORE_ID } from "@/lib/constants";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET() {
  try {
    if (!env("DATABASE_URL")) {
      return ok(emptyAdminState("DATABASE_URL未設定"));
    }

    const storeId = await resolveDashboardStoreId();
    const today = jstDayStart(new Date());
    const tomorrow = addDays(today, 1);
    const futureWindowEnd = addDays(today, 31);
    const now = new Date();
    const activeReservationStatuses = [ReservationStatus.TENTATIVE, ReservationStatus.CONFIRMED];

    const [
      reservations,
      futureReservations,
      customers,
      therapists,
      courses,
      conversations,
      notifications,
      notificationLogs,
      rooms,
      callLogs,
      roomOccupancies,
      store,
      phoneSetting,
      latestHomepageImportLog,
      homepageImportCount,
      auditLogs
    ] = await prisma.$transaction([
      prisma.reservation.findMany({
        where: {
          storeId: storeId,
          startsAt: { gte: today, lt: tomorrow },
          status: { in: activeReservationStatuses },
          course: { isActive: true }
        },
        include: reservationDashboardInclude(),
        orderBy: { startsAt: "asc" }
      }),
      prisma.reservation.findMany({
        where: {
          storeId: storeId,
          startsAt: { gte: tomorrow, lt: futureWindowEnd },
          status: { in: activeReservationStatuses },
          course: { isActive: true }
        },
        include: reservationDashboardInclude(),
        orderBy: { startsAt: "asc" },
        take: 80
      }),
      prisma.customer.findMany({ where: { storeId: storeId }, orderBy: { updatedAt: "desc" }, take: 120 }),
      prisma.therapist.findMany({
        where: { storeId: storeId, status: "ACTIVE" },
        include: {
          shifts: {
            where: { startsAt: { lt: tomorrow }, endsAt: { gte: today } },
            orderBy: { startsAt: "asc" }
          }
        },
        orderBy: { displayName: "asc" }
      }),
      prisma.course.findMany({ where: { storeId: storeId, isActive: true }, orderBy: { durationMin: "asc" } }),
      prisma.conversation.findMany({
        where: {
          storeId: storeId,
          id: { not: { startsWith: "phone-CA_REGRESSION_" } }
        },
        include: { messages: { orderBy: { createdAt: "desc" }, take: 12 } },
        orderBy: { updatedAt: "desc" },
        take: 40
      }),
      prisma.notification.findMany({
        where: {
          storeId: storeId,
          OR: [{ callSid: null }, { callSid: { not: { startsWith: "CA_REGRESSION_" } } }]
        },
        include: { reservation: { include: { customer: true, course: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.notificationLog.findMany({
        where: { storeId: storeId },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      prisma.room.findMany({ where: { storeId: storeId, isActive: true }, orderBy: { name: "asc" } }),
      prisma.callLog.findMany({
        where: { storeId: storeId, twilioCallSid: { not: { startsWith: "CA_REGRESSION_" } } },
        orderBy: { updatedAt: "desc" },
        take: 20
      }),
      prisma.reservation.findMany({
        where: {
          storeId: storeId,
          status: { in: activeReservationStatuses },
          startsAt: { lte: now },
          endsAt: { gte: now },
          course: { isActive: true },
          room: { isActive: true }
        },
        include: reservationDashboardInclude(),
        orderBy: { startsAt: "asc" }
      }),
      prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, phone: true, address: true, openTime: true, closeTime: true, updatedAt: true }
      }),
      prisma.storePhoneSetting.findFirst({
        where: { storeId: storeId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, voiceWebhookUrl: true, voiceRelayWsUrl: true, updatedAt: true }
      }),
      prisma.auditLog.findFirst({
        where: { storeId: storeId, action: "store.homepage_imported" },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, actorType: true, actorId: true, before: true, after: true, createdAt: true }
      }),
      prisma.auditLog.count({ where: { storeId: storeId, action: "store.homepage_imported" } }),
      prisma.auditLog.findMany({
        where: { storeId: storeId },
        include: { reservation: { include: { customer: true, course: true } } },
        orderBy: { createdAt: "desc" },
        take: 30
      })
    ]);

    return ok({
      reservations: reservations.map((item) => reservationView(item)),
      futureReservations: futureReservations.map((item) => reservationView(item)),
      customers: customers.map((item) => ({
        id: item.id,
        name: safeDisplayText(item.name, "旧テスト顧客"),
        phone: item.phone,
        lineId: item.lineId ?? "-",
        visits: item.visitCount,
        memo: safeDisplayText(item.memo ?? "", ""),
        ng: item.isNg
      })),
      therapists: therapists.map((item) => {
        const therapistReservations = activeReservationsForTherapist([...reservations, ...futureReservations], item.id);
        return {
          id: item.id,
          name: item.displayName,
          shift: item.shifts[0] ? `${timeText(item.shifts[0].startsAt)} - ${timeText(item.shifts[0].endsAt)}` : "未登録",
          bookings: therapistReservations.length,
          utilization: therapistUtilization(item.shifts, therapistReservations),
          status: therapistStatus(item),
          nominationFee: item.nominationFee,
          profile: item.profile ?? ""
        };
      }),
      courses: courses.map((item) => ({ id: item.id, name: item.name, duration: item.durationMin, price: item.price })),
      conversations: conversations.map((item) => {
        const messages = [...item.messages].reverse();
        return {
          id: item.id,
          channel: channelLabel(item.channel),
          rawChannel: item.channel,
          name: safeDisplayText(messages[0]?.content.slice(0, 16) || channelLabel(item.channel), "旧テスト文字化け履歴"),
          time: timeText(item.updatedAt),
          status: conversationStatus(item.workflowState),
          body: safeDisplayText(item.summary ?? messages.map((message) => message.content).join("\n"), "旧テスト文字化け履歴（内容復元不可）"),
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            body: safeDisplayText(message.content, "旧テスト文字化け履歴（内容復元不可）"),
            time: timeText(message.createdAt)
          }))
        };
      }),
      notifications: notifications.map((item) => ({
        id: item.id,
        time: timeText(item.createdAt),
        createdAt: item.createdAt.toISOString(),
        scheduledAt: item.scheduledAt?.toISOString() ?? null,
        sentAt: item.sentAt?.toISOString() ?? null,
        body: safeDisplayText(item.body, "旧テスト文字化け通知（内容復元不可）"),
        type: item.type,
        typeText: notificationTypeLabel(item.type),
        channel: channelLabel(item.channel),
        rawChannel: item.channel,
        status: item.status,
        statusText: notificationStatusLabel(item.status),
        tone: notificationTone(item.status, item.type),
        reservationId: item.reservationId,
        targetName: item.targetName ? safeDisplayText(item.targetName, "旧テスト顧客") : item.reservation?.customer.name ? safeDisplayText(item.reservation.customer.name, "旧テスト顧客") : null,
        targetPhone: item.targetPhone,
        smsTo: item.smsTo,
        smsSid: item.smsSid,
        smsDeliveryStatus: item.smsDeliveryStatus,
        smsDeliveryCheckedAt: item.smsDeliveryCheckedAt?.toISOString() ?? null,
        smsDeliveredAt: item.smsDeliveredAt?.toISOString() ?? null,
        smsErrorCode: item.smsErrorCode,
        smsErrorMessage: item.smsErrorMessage,
        reservation: item.reservation
          ? {
              customer: { name: safeDisplayText(item.reservation.customer.name, "旧テスト顧客") },
              course: { name: safeDisplayText(item.reservation.course.name, "旧テストコース") },
              date: dateText(item.reservation.startsAt),
              time: timeText(item.reservation.startsAt)
            }
          : null
      })),
      notificationLogs: notificationLogs.map((item) => ({
        id: item.id,
        notificationId: item.notificationId,
        reservationId: item.reservationId,
        time: timeText(item.createdAt),
        createdAt: item.createdAt.toISOString(),
        sentAt: item.sentAt?.toISOString() ?? null,
        type: item.type,
        typeText: notificationTypeLabel(item.type),
        channel: item.channel,
        channelText: channelLabel(item.channel),
        status: item.status,
        statusText: notificationStatusLabel(item.status),
        recipientName: item.recipientName,
        recipientPhone: item.recipientPhone,
        provider: item.provider,
        providerMessageId: item.providerMessageId,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage
      })),
      rooms: rooms.map((item) => {
        const current = roomOccupancies.find((reservation) => reservation.roomId === item.id);
        return {
          id: item.id,
          name: item.name,
          isActive: item.isActive,
          state: current ? "利用中" : "空き",
          currentReservationId: current?.id ?? null,
          currentCustomer: current?.customer.name ?? null,
          currentTherapist: current?.therapist?.displayName ?? null,
          until: current ? timeText(current.endsAt) : null
        };
      }),
      callLogs: callLogs.map((item) => ({
        id: item.id,
        reservationId: item.reservationId,
        time: timeText(item.updatedAt),
        phoneNumber: item.phoneNumber ?? "-",
        status: item.status,
        requiredReview: item.requiredReview,
        reviewNotes: safeDisplayText(item.reviewNotes ?? "", ""),
        summary: safeDisplayText(item.aiSummary ?? item.reviewNotes ?? item.transcript ?? "", "内容未取得。折り返し確認してください。")
      })),
      auditLogs: auditLogs.map((item) => ({
        id: item.id,
        time: timeText(item.createdAt),
        createdAt: item.createdAt.toISOString(),
        action: item.action,
        actionText: auditActionLabel(item.action),
        actorType: item.actorType,
        actorId: item.actorId,
        reservationId: item.reservationId,
        reservation: item.reservation
          ? {
              customer: { name: safeDisplayText(item.reservation.customer.name, "旧テスト顧客") },
              course: { name: safeDisplayText(item.reservation.course.name, "旧テストコース") },
              date: dateText(item.reservation.startsAt),
              time: timeText(item.reservation.startsAt)
            }
          : null
      })),
      storeSyncEvidence: {
        store: {
          id: store?.id ?? storeId,
          name: store?.name ?? null,
          phone: store?.phone ?? null,
          address: store?.address ?? null,
          openTime: store?.openTime ?? null,
          closeTime: store?.closeTime ?? null,
          updatedAt: store?.updatedAt.toISOString() ?? null
        },
        homepageImport: {
          latest: latestHomepageImportLog
            ? {
                id: latestHomepageImportLog.id,
                action: latestHomepageImportLog.action,
                actorType: latestHomepageImportLog.actorType,
                actorId: latestHomepageImportLog.actorId,
                before: latestHomepageImportLog.before,
                after: latestHomepageImportLog.after,
                createdAt: latestHomepageImportLog.createdAt.toISOString()
              }
            : null,
          count: homepageImportCount
        },
        phoneSetting: {
          id: phoneSetting?.id ?? null,
          voiceWebhookUrl: phoneSetting?.voiceWebhookUrl ?? null,
          voiceRelayWsUrl: phoneSetting?.voiceRelayWsUrl ?? null,
          updatedAt: phoneSetting?.updatedAt.toISOString() ?? null
        }
      },
      databaseConfigured: true
    });
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      return ok(emptyAdminState("DB接続エラー"));
    }

    return fail(error, 500);
  }
}

async function resolveDashboardStoreId() {
  try {
    return (await requireRequestStoreContext()).storeId;
  } catch (error) {
    if (error instanceof StoreAccessError && error.reason === "UNAUTHENTICATED") {
      return DEMO_STORE_ID;
    }
    throw error;
  }
}

function emptyAdminState(reason: string) {
  return {
    reservations: [],
    futureReservations: [],
    customers: [],
    therapists: [],
    courses: [],
    conversations: [],
    notifications: [],
    notificationLogs: [],
    auditLogs: [],
    rooms: [],
    callLogs: [],
    storeSyncEvidence: emptyStoreSyncEvidence(),
    databaseConfigured: false,
    databaseStatus: reason
  };
}

function isDatabaseConnectionError(error: unknown) {
  const message = error instanceof Error ? `${error.name}\n${error.message}\n${error.stack ?? ""}` : String(error);
  return [
    "Can't reach database server",
    "ECIRCUITBREAKER",
    "too many authentication failures",
    "PrismaClientInitializationError",
    "Error querying the database"
  ].some((pattern) => message.includes(pattern));
}

function activeReservationsForTherapist(
  reservations: Array<{ therapistId: string | null; startsAt: Date; endsAt: Date; status: string }>,
  therapistId: string
) {
  return reservations.filter((item) => item.therapistId === therapistId && item.status !== "CANCELLED" && item.status !== "NO_SHOW");
}

function therapistUtilization(shifts: Array<{ startsAt: Date; endsAt: Date }>, reservations: Array<{ startsAt: Date; endsAt: Date }>) {
  const shiftMinutes = shifts.reduce((sum, item) => sum + minutesBetween(item.startsAt, item.endsAt), 0);
  if (!shiftMinutes) return 0;
  const reservationMinutes = reservations.reduce((sum, item) => sum + minutesBetween(item.startsAt, item.endsAt), 0);
  return Math.min(100, Math.round((reservationMinutes / shiftMinutes) * 100));
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function therapistStatus(item: { status: string; shifts: Array<{ startsAt: Date; endsAt: Date }> }) {
  if (item.status !== "ACTIVE") return "休み";
  const now = new Date();
  if (item.shifts.some((shift) => shift.startsAt <= now && shift.endsAt >= now)) return "出勤中";
  return item.shifts.length ? "出勤予定" : "休み";
}

function conversationStatus(workflowState?: string | null) {
  if (!workflowState) return "未対応";
  if (["CONFIRMED", "INFO_PROVIDED", "RESERVATION_CREATED", "SHIFT_RECORDED", "ROOM_EXIT_RECORDED"].includes(workflowState)) return "対応済み";
  if (["ESCALATED", "EXIT_REVIEW_REQUIRED"].includes(workflowState)) return "要確認";
  return "進行中";
}

function notificationTone(status: string, type: string) {
  if (status === "FAILED") return "danger";
  if (status === "PENDING") return "warn";
  if (type === "THERAPIST_BOOKING" || type === "THERAPIST_SHIFT") return "info";
  return "success";
}

function timeText(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function dateText(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

function jstDayStart(date: Date) {
  const parts = jstParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, -9, 0, 0, 0));
}

function jstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function emptyStoreSyncEvidence(storeId = "unconfigured") {
  return {
    store: { id: storeId, name: null, phone: null, address: null, openTime: null, closeTime: null, updatedAt: null },
    homepageImport: { latest: null, count: 0 },
    phoneSetting: { id: null, voiceWebhookUrl: null, voiceRelayWsUrl: null, updatedAt: null }
  };
}

function reservationDashboardInclude() {
  return {
    customer: true,
    therapist: true,
    room: true,
    course: true,
    holds: {
      where: { approvedAt: null, rejectedAt: null },
      orderBy: { createdAt: "desc" as const },
      take: 1
    },
    notifications: {
      orderBy: { createdAt: "desc" as const },
      take: 6
    }
  };
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    TENTATIVE: "仮予約",
    CONFIRMED: "確定",
    VISITED: "来店済み",
    CANCELLED: "キャンセル",
    NO_SHOW: "無断キャンセル"
  };
  return labels[status] ?? status;
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = { PHONE: "電話/SMS", LINE: "LINE", WEB_CHAT: "Web Chat", ADMIN: "管理画面" };
  return labels[channel] ?? channel;
}

function notificationStatusLabel(status: string) {
  const labels: Record<string, string> = { PENDING: "未送信", SENT: "送信済み", FAILED: "送信失敗" };
  return labels[status] ?? status;
}

function notificationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    RESERVATION_CONFIRMED: "予約確定",
    REMINDER_PREVIOUS_DAY: "前日リマインド",
    REMINDER_SAME_DAY: "当日リマインド",
    RESERVATION_CHANGED: "予約変更",
    RESERVATION_CANCELLED: "予約キャンセル",
    THANK_YOU: "お礼",
    REVISIT_PROMOTION: "再来促進",
    THERAPIST_SHIFT: "セラピスト出勤",
    THERAPIST_BOOKING: "セラピスト予約通知"
  };
  return labels[type] ?? type;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "reservation.approval_guard_passed": "確定前ガード通過",
    "reservation.approved": "予約確定",
    "reservation.created": "予約作成",
    "reservation.updated": "予約変更",
    "reservation.cancelled": "予約取消",
    "notification.delivery_failed": "通知送信失敗",
    "notification.sms_status_callback": "SMS到達更新",
    "phone_ai.reservation_created": "電話AI仮予約作成",
    "store.homepage_imported": "HP取込"
  };
  return labels[action] ?? action;
}

type ReservationDashboardNotification = {
  id: string;
  type: string;
  channel: string;
  status: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  smsDeliveryStatus: string | null;
  smsErrorCode: string | null;
  smsErrorMessage: string | null;
  createdAt: Date;
};

function reservationView(item: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  room: { name: string } | null;
  customer: { name: string; phone: string | null };
  course: { name: string; price: number };
  therapist: { displayName: string } | null;
  status: string;
  source: string;
  holds?: Array<{ id: string; expiresAt: Date; approvedAt: Date | null; rejectedAt: Date | null; createdAt: Date }>;
  notifications?: ReservationDashboardNotification[];
}) {
  const activeHold = item.holds?.[0] ?? null;
  const approvalNotification = selectReservationApprovalNotification(item.notifications);
  const holdMinutesLeft = activeHold ? Math.ceil((activeHold.expiresAt.getTime() - Date.now()) / 60000) : null;
  const approvalState = item.status === "TENTATIVE"
    ? !activeHold
      ? "missing_hold"
      : activeHold.expiresAt <= new Date()
        ? "expired"
        : holdMinutesLeft !== null && holdMinutesLeft <= 10
          ? "warning"
          : "active"
    : "none";

  return {
    id: item.id,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    date: dateText(item.startsAt),
    time: timeText(item.startsAt),
    end: timeText(item.endsAt),
    room: item.room?.name ?? "未割当",
    customer: item.customer.name,
    phone: item.customer.phone ?? "-",
    course: item.course.name,
    therapist: item.therapist?.displayName ?? "未割当",
    rawStatus: item.status,
    status: statusLabel(item.status),
    rawSource: item.source,
    source: channelLabel(item.source),
    amount: item.course.price,
    approval: {
      holdId: activeHold?.id ?? null,
      expiresAt: activeHold?.expiresAt.toISOString() ?? null,
      minutesLeft: holdMinutesLeft,
      state: approvalState,
      notificationId: approvalNotification?.id ?? null,
      notificationType: approvalNotification ? notificationTypeLabel(approvalNotification.type) : null,
      notificationStatus: approvalNotification?.status ?? null,
      notificationStatusText: approvalNotification ? notificationStatusLabel(approvalNotification.status) : null,
      smsDeliveryStatus: approvalNotification?.smsDeliveryStatus ?? null,
      smsErrorCode: approvalNotification?.smsErrorCode ?? null,
      smsErrorMessage: approvalNotification?.smsErrorMessage ?? null,
      sentAt: approvalNotification?.sentAt?.toISOString() ?? null
    }
  };
}

function selectReservationApprovalNotification(notifications?: ReservationDashboardNotification[]) {
  if (!notifications?.length) return null;

  const isSmsFailure = (notification: { status: string; smsDeliveryStatus: string | null; smsErrorCode: string | null }) =>
    notification.status === "FAILED" ||
    notification.smsDeliveryStatus === "failed" ||
    notification.smsDeliveryStatus === "undelivered" ||
    Boolean(notification.smsErrorCode);
  const isSmsSuccess = (notification: { status: string; smsDeliveryStatus: string | null; smsErrorCode: string | null }) =>
    !notification.smsErrorCode &&
    (notification.status === "SENT" || notification.smsDeliveryStatus === "sent" || notification.smsDeliveryStatus === "delivered");
  const isReservationConfirmation = (notification: { type: string }) =>
    notification.type === "RESERVATION_CONFIRMED";
  const latestActionable = (items: ReservationDashboardNotification[]) => {
    const failed = items.find(isSmsFailure);
    const successful = items.find(isSmsSuccess);
    if (successful && (!failed || successful.createdAt >= failed.createdAt)) return successful;
    return failed ?? successful ?? null;
  };

  const confirmationNotifications = notifications.filter(isReservationConfirmation);

  return (
    latestActionable(confirmationNotifications) ??
    latestActionable(notifications) ??
    notifications.find((notification) => notification.type === "RESERVATION_CHANGED") ??
    notifications[0]
  );
}

function safeDisplayText(value: string, fallback: string) {
  if (!value) return fallback;
  if (looksCorruptedText(value)) return fallback;
  return value;
}

function looksCorruptedText(value: string) {
  return /[ãçå]|縺|繝|\?{3,}/.test(value);
}


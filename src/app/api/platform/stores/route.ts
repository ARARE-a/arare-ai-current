import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePlatformAdminContext, StoreAccessError, type PlatformAdminContext } from "@/lib/store-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ready" | "warning" | "missing" | "unverified";

type Check = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  owner: string;
  idealState: string;
  requiredAction: string;
  blocksSubmission: boolean;
};

const owners: Record<string, string> = {
  store_profile: "担当F 管理画面/DB同期",
  homepage_import: "担当F 管理画面/DB同期",
  courses: "担当D 予約エンジン",
  therapists: "担当B セラピスト/LINE",
  therapist_line_ids: "担当B セラピスト/LINE",
  rooms: "担当D 予約エンジン",
  line_webhook: "担当C LINE Webhook",
  phone_ai: "担当A 電話AI状態管理",
  twilio_env: "担当H 実電話検証",
  sms: "担当E SMS/通知",
  clerk: "担当G 権限/QA"
};

const ideals: Record<string, string> = {
  store_profile: "店舗名、電話番号、住所、営業時間が登録され、電話AI/SMS/管理画面が同じ店舗情報を参照する",
  homepage_import: "HP取込または手動登録の監査ログが残り、店舗情報の出所を追える",
  courses: "有効なコースと料金が1件以上あり、予約AIとSMS本文へ反映できる",
  therapists: "有効なセラピストが1名以上登録され、予約判定と出勤に使える",
  therapist_line_ids: "全セラピストのLINE IDが登録され、出勤/退室が本人に紐付く",
  rooms: "有効ルームが1室以上あり、予約判定と退室後の空き反映に使える",
  line_webhook: "LINE Developersから本番Webhookへ実イベントが届き、DBと画面に反映される",
  phone_ai: "Twilio番号がConversationRelay互換の音声サーバーへ接続され、店舗別DBで空き判定する",
  twilio_env: "Twilio API環境が本番で有効で、発信/着信/SMSの証跡を追える",
  sms: "予約受付・変更・確定後にSMSが送信され、Twilio到達callbackのdelivered/failedがDBと管理画面に残る",
  clerk: "ARARE管理者、店舗オーナー、スタッフ、セラピストの権限別ログインが分離される"
};

const actions: Record<CheckStatus, string> = {
  ready: "理想状態に近いです。本番提出前は実イベント証跡を確認してください。",
  warning: "運用前に修正または追加確認が必要です。",
  missing: "未設定です。担当が設定を完了するまで提出禁止です。",
  unverified: "環境は見えますが、本番動作証跡が未確認です。実テスト完了まで提出禁止です。"
};

const customerReservationSmsTypes = new Set(["RESERVATION_CONFIRMED", "RESERVATION_CHANGED"]);

function buildCheck(key: string, label: string, status: CheckStatus, detail: string): Check {
  return {
    key,
    label,
    status,
    detail,
    owner: owners[key] ?? "担当G QA",
    idealState: ideals[key] ?? "理想状態の定義が必要です",
    requiredAction: actions[status],
    blocksSubmission: status !== "ready"
  };
}

function checkStatus(condition: boolean, warning = false): CheckStatus {
  if (condition) return "ready";
  return warning ? "warning" : "missing";
}

function statusWeight(status: CheckStatus) {
  if (status === "ready") return 1;
  if (status === "warning" || status === "unverified") return 0.5;
  return 0;
}

function summarizeOwnerProgress(checks: Check[]) {
  return Object.values(
    checks.reduce<Record<string, { owner: string; total: number; ready: number; blocked: number }>>((acc, check) => {
      acc[check.owner] ??= { owner: check.owner, total: 0, ready: 0, blocked: 0 };
      acc[check.owner].total += 1;
      if (check.status === "ready") acc[check.owner].ready += 1;
      if (check.blocksSubmission) acc[check.owner].blocked += 1;
      return acc;
    }, {})
  ).map((owner) => ({
    ...owner,
    progress: owner.total > 0 ? Math.round((owner.ready / owner.total) * 100) : 0,
    status: owner.blocked > 0 ? "blocked" : "ready"
  }));
}

function toIso(date?: Date | null) {
  return date ? date.toISOString() : null;
}

export async function GET() {
  try {
    const adminContext = await requirePlatformAdminContext();
    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + 14);

    const stores = await prisma.store.findMany({
      where: adminContext.scope === "single-store" && adminContext.storeId ? { id: adminContext.storeId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    const mappedStores = await Promise.all(stores.map((store) => buildStoreReadiness(store, now, future, adminContext)));

    return NextResponse.json({
      generatedAt: now.toISOString(),
      environment: buildEnvironment(),
      summary: {
        storeCount: mappedStores.length,
        readyStores: mappedStores.filter((store) => store.readinessScore >= 90 && store.submissionGate.blockingCount === 0).length,
        warningStores: mappedStores.filter((store) => store.readinessScore >= 60 && store.submissionGate.blockingCount > 0).length,
        blockedStores: mappedStores.filter((store) => store.readinessScore < 60 || store.submissionGate.blockingCount > 0).length,
        totalFailedNotifications: mappedStores.reduce((sum, store) => sum + store.metrics.failedNotifications, 0),
        totalTherapistsMissingLine: mappedStores.reduce(
          (sum, store) => sum + Math.max(0, store.metrics.activeTherapists - store.metrics.therapistsWithLine),
          0
        )
      },
      ownerProgress: summarizeOwnerProgress(mappedStores.flatMap((store) => store.checks)),
      stores: mappedStores
    });
  } catch (error) {
    if (error instanceof StoreAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("platform stores api failed", error);
    return NextResponse.json(buildPlatformFallbackState(error), { status: 200 });
  }
}

async function buildStoreReadiness(store: Awaited<ReturnType<typeof prisma.store.findMany>>[number], now: Date, future: Date, adminContext: PlatformAdminContext) {
  const [latestStoreProfileEvidence, callLogs, conversations, courses, notifications, phoneSettings, reservations, rooms, shifts, therapists, users] =
    await prisma.$transaction([
      prisma.auditLog.findFirst({
        where: { storeId: store.id, action: { in: ["store.homepage_imported", "store.manual_profile_updated"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, actorType: true, createdAt: true }
      }),
      prisma.callLog.findMany({
        where: { storeId: store.id, twilioCallSid: { not: { startsWith: "CA_REGRESSION_" } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, twilioCallSid: true, phoneNumber: true, toNumber: true, status: true, requiredReview: true, confidence: true, createdAt: true, updatedAt: true }
      }),
      prisma.conversation.findMany({
        where: { storeId: store.id, channel: "LINE" },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          channel: true,
          externalUserId: true,
          workflowState: true,
          updatedAt: true,
          messages: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true, role: true, content: true, createdAt: true } }
        }
      }),
      prisma.course.findMany({ where: { storeId: store.id }, orderBy: { durationMin: "asc" }, select: { id: true, name: true, isActive: true, durationMin: true, price: true } }),
      prisma.notification.findMany({
        where: { storeId: store.id, OR: [{ callSid: null }, { callSid: { not: { startsWith: "CA_REGRESSION_" } } }] },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          reservationId: true,
          type: true,
          channel: true,
          status: true,
          targetPhone: true,
          customerPhone: true,
          smsTo: true,
          smsSid: true,
          smsDeliveryStatus: true,
          smsDeliveryCheckedAt: true,
          smsDeliveredAt: true,
          smsErrorCode: true,
          smsErrorMessage: true,
          body: true,
          createdAt: true,
          sentAt: true
        }
      }),
      prisma.storePhoneSetting.findMany({
        where: { storeId: store.id },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          aiReceptionPhoneNumber: true,
          normalizedAiReceptionPhoneNumber: true,
          voiceWebhookUrl: true,
          voiceRelayWsUrl: true,
          voiceAiEnabled: true,
          routingMode: true,
          updatedAt: true
        }
      }),
      prisma.reservation.findMany({ where: { storeId: store.id, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 50, select: { id: true, source: true, status: true, startsAt: true, createdAt: true } }),
      prisma.room.findMany({ where: { storeId: store.id }, orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
      prisma.shift.findMany({
        where: { storeId: store.id, startsAt: { gte: now, lte: future } },
        orderBy: { startsAt: "asc" },
        take: 30,
        select: { id: true, startsAt: true, endsAt: true, status: true, therapist: { select: { displayName: true } } }
      }),
      prisma.therapist.findMany({
        where: { storeId: store.id },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true, status: true, lineId: true, profile: true, acceptsNomination: true, nominationFee: true }
      }),
      prisma.user.findMany({ where: { storeId: store.id }, select: { id: true, name: true, email: true, role: true } })
    ]);

  const env = buildEnvironment();
  const activeCourses = courses.filter((course) => course.isActive);
  const activeTherapists = therapists.filter((therapist) => therapist.status === "ACTIVE");
  const therapistsWithLine = activeTherapists.filter((therapist) => Boolean(therapist.lineId));
  const activeRooms = rooms.filter((room) => room.isActive);
  const failedNotifications = notifications.filter((notification) => notification.status === "FAILED");
  const pendingNotifications = notifications.filter((notification) => notification.status === "PENDING");
  const customerReservationSmsNotifications = notifications.filter(
    (notification) =>
      notification.channel === "PHONE" &&
      isCustomerReservationSmsType(notification.type) &&
      hasSmsAttemptEvidence(notification),
  );
  const latestCustomerReservationSmsAttempts = latestSmsAttemptByDeliveryKey(customerReservationSmsNotifications);
  const sentSmsNotifications = customerReservationSmsNotifications.filter((notification) => notification.smsSid && notification.status === "SENT");
  const deliveredSmsNotifications = customerReservationSmsNotifications.filter((notification) => isDeliveredSmsNotification(notification));
  const latestDeliveredSmsAt = latestSmsAttemptAt(deliveredSmsNotifications);
  const activeSmsProblemNotifications = latestCustomerReservationSmsAttempts.filter(
    (notification) => isProblemSmsNotification(notification) && isSmsAttemptAfterLatestDelivered(notification, latestDeliveredSmsAt)
  );
  const activeFailedSmsNotifications = activeSmsProblemNotifications.filter((notification) => !isPendingSmsDeliveryNotification(notification));
  const pendingSmsDeliveryNotifications = activeSmsProblemNotifications.filter((notification) => isPendingSmsDeliveryNotification(notification));
  const activeSmsProblemIds = new Set(activeSmsProblemNotifications.map((notification) => notification.id));
  const historicalFailedSmsNotifications = customerReservationSmsNotifications.filter(
    (notification) => isProblemSmsNotification(notification) && !activeSmsProblemIds.has(notification.id)
  );
  const smsNotificationIds = new Set(customerReservationSmsNotifications.map((notification) => notification.id));
  const nonSmsFailedNotifications = failedNotifications.filter((notification) => !smsNotificationIds.has(notification.id));
  const requiredClerkRoles = ["OWNER", "MANAGER", "STAFF"] as const;
  const presentClerkRoles = new Set(users.map((user) => user.role));
  const missingClerkRoles = requiredClerkRoles.filter((role) => !presentClerkRoles.has(role));
  const hasPlatformAdminAccess = adminContext.scope === "all-stores" || adminContext.source === "single-store-owner";
  const hasLineWebhookEvidence = conversations.some((conversation) => Boolean(conversation.externalUserId?.startsWith("U")) && conversation.messages.length > 0);
  const latestHomepageImport = latestStoreProfileEvidence?.action === "store.homepage_imported" ? latestStoreProfileEvidence : null;
  const latestManualProfileUpdate = latestStoreProfileEvidence?.action === "store.manual_profile_updated" ? latestStoreProfileEvidence : null;
  const latestLineConversation = conversations[0] ?? null;
  const latestCallLog = callLogs[0] ?? null;
  const latestPhoneSetting = phoneSettings[0] ?? null;
  const reviewCallLogs = callLogs.filter((log) => log.requiredReview);
  const latestResolvedCallLogAt = latestCallLogAttemptAt(callLogs.filter((log) => isResolvedPhoneAiCallLog(log)));
  const activeReviewCallLogs = reviewCallLogs.filter((log) => isCallLogAfterLatestResolved(log, latestResolvedCallLogAt));

  const checks = [
    buildCheck("store_profile", "店舗基本情報", checkStatus(Boolean(store.name && store.phone && store.address && store.openTime && store.closeTime)), store.phone && store.address ? `${store.phone} / ${store.address}` : "電話番号または住所が不足"),
    buildCheck("homepage_import", "HP/店舗情報取込", latestHomepageImport || latestManualProfileUpdate ? "ready" : "missing", latestHomepageImport ? `HP取込: ${latestHomepageImport.createdAt.toISOString()}` : latestManualProfileUpdate ? `手動更新: ${latestManualProfileUpdate.createdAt.toISOString()}` : "取込証跡なし"),
    buildCheck("courses", "コース/料金", checkStatus(activeCourses.length > 0), `${activeCourses.length}件`),
    buildCheck("therapists", "セラピスト", checkStatus(activeTherapists.length > 0), `${activeTherapists.length}名`),
    buildCheck("therapist_line_ids", "セラピストLINE ID", activeTherapists.length > 0 && therapistsWithLine.length === activeTherapists.length ? "ready" : activeTherapists.length > 0 && therapistsWithLine.length > 0 ? "warning" : "missing", `${therapistsWithLine.length}/${activeTherapists.length}名 登録済み`),
    buildCheck("rooms", "部屋", checkStatus(activeRooms.length > 0), `${activeRooms.length}室`),
    buildCheck("line_webhook", "LINE Webhook環境", env.lineEnvReady && hasLineWebhookEvidence ? "ready" : env.lineEnvReady ? "unverified" : "missing", env.lineEnvReady && hasLineWebhookEvidence ? "実LINE受信がDBに反映済み" : env.lineEnvReady ? "環境変数あり。実LINE受信証跡は未確認" : "LINE環境変数不足"),
    buildCheck("phone_ai", "電話AI番号/Relay", checkStatus(Boolean(latestPhoneSetting?.aiReceptionPhoneNumber && latestPhoneSetting?.voiceWebhookUrl && latestPhoneSetting?.voiceRelayWsUrl && latestPhoneSetting?.voiceAiEnabled)), latestPhoneSetting?.aiReceptionPhoneNumber ? `${latestPhoneSetting.aiReceptionPhoneNumber} / ${latestPhoneSetting.routingMode}` : "電話AI設定なし"),
    buildCheck("twilio_env", "Twilio API環境", env.twilioEnvReady && latestCallLog ? "ready" : env.twilioEnvReady ? "unverified" : "missing", env.twilioEnvReady && latestCallLog ? `本番通話証跡あり: ${latestCallLog.twilioCallSid ?? latestCallLog.phoneNumber ?? "call log"}` : env.twilioEnvReady ? "環境変数あり。実通話証跡は未確認" : "Twilio環境変数不足"),
    buildCheck(
      "sms",
      "SMS送信/到達callback",
      activeSmsProblemNotifications.length > 0
        ? "warning"
        : env.smsEnvReady && deliveredSmsNotifications.length > 0
          ? "ready"
          : env.smsEnvReady
            ? "unverified"
            : "missing",
      activeSmsProblemNotifications.length > 0
        ? `現在も未解消の予約SMS失敗または未到達 ${activeSmsProblemNotifications.length}件`
        : env.smsEnvReady && deliveredSmsNotifications.length > 0
          ? `本番SMS到達callback確認済み ${deliveredSmsNotifications.length}件 / 受付済み ${sentSmsNotifications.length}件 / 解消済み過去問題 ${historicalFailedSmsNotifications.length}件`
          : env.smsEnvReady && sentSmsNotifications.length > 0
            ? `Twilio受付済み ${sentSmsNotifications.length}件。到達callback未確認 ${pendingSmsDeliveryNotifications.length}件`
            : env.smsEnvReady
              ? "SMS環境あり。送信・到達callback証跡は未確認"
              : "SMS送信環境不足"
    ),
    buildCheck(
      "clerk",
      "Clerkログイン/権限",
      !env.clerkEnvReady ? "missing" : hasPlatformAdminAccess && missingClerkRoles.length === 0 ? "ready" : users.length > 0 ? "warning" : "missing",
      !env.clerkEnvReady
        ? "Clerk環境変数不足"
        : hasPlatformAdminAccess && missingClerkRoles.length === 0
          ? `Platform権限: ${adminContext.source} / OWNER/MANAGER/STAFF 権限DBあり（${users.length}ユーザー）`
          : `不足: ${[!hasPlatformAdminAccess ? "PLATFORM_ADMIN" : null, ...missingClerkRoles].filter(Boolean).join(", ")}`
    )
  ];

  const blockers = checks.filter((check) => check.blocksSubmission);
  const readyWeight = checks.reduce((total, check) => total + statusWeight(check.status), 0);

  return {
    id: store.id,
    name: store.name,
    phone: store.phone,
    address: store.address,
    openTime: store.openTime,
    closeTime: store.closeTime,
    updatedAt: toIso(store.updatedAt),
    readinessScore: Math.round((readyWeight / checks.length) * 100),
    submissionGate: {
      status: blockers.length === 0 ? "submit_allowed" : "submit_blocked",
      label: blockers.length === 0 ? "提出可能" : "提出不可",
      blockingCount: blockers.length,
      rule: "理想状態未達、未確認、未設定、要注意が1つでもある場合は提出不可",
      blockers: blockers.map((check) => ({ key: check.key, label: check.label, owner: check.owner, status: check.status, detail: check.detail, requiredAction: check.requiredAction }))
    },
    ownerProgress: summarizeOwnerProgress(checks),
    checks,
    metrics: {
      activeCourses: activeCourses.length,
      activeTherapists: activeTherapists.length,
      therapistsWithLine: therapistsWithLine.length,
      activeRooms: activeRooms.length,
      futureReservations: reservations.length,
      pendingNotifications: pendingNotifications.length,
      failedNotifications: activeSmsProblemNotifications.length,
      historicalFailedNotifications: historicalFailedSmsNotifications.length + nonSmsFailedNotifications.length,
      sentSmsNotifications: sentSmsNotifications.length,
      deliveredSmsNotifications: deliveredSmsNotifications.length,
      pendingSmsDeliveryNotifications: pendingSmsDeliveryNotifications.length,
      lineConversations: conversations.length,
      reviewCallLogs: activeReviewCallLogs.length
    },
    latest: {
      homepageImportAt: toIso(latestHomepageImport?.createdAt),
      manualProfileUpdateAt: toIso(latestManualProfileUpdate?.createdAt),
      lineConversationAt: toIso(latestLineConversation?.updatedAt),
      callLogAt: toIso(latestCallLog?.createdAt),
      phoneSettingUpdatedAt: toIso(latestPhoneSetting?.updatedAt)
    },
    phoneSetting: latestPhoneSetting
      ? {
          aiReceptionPhoneNumber: latestPhoneSetting.aiReceptionPhoneNumber,
          voiceWebhookUrl: latestPhoneSetting.voiceWebhookUrl,
          voiceRelayWsUrl: latestPhoneSetting.voiceRelayWsUrl,
          voiceAiEnabled: latestPhoneSetting.voiceAiEnabled,
          routingMode: latestPhoneSetting.routingMode
        }
      : null,
    therapists: therapists.map((therapist) => ({
      displayName: therapist.displayName,
      status: therapist.status,
      hasLineId: Boolean(therapist.lineId),
      hasProfile: Boolean(therapist.profile),
      acceptsNomination: therapist.acceptsNomination,
      nominationFee: therapist.nominationFee
    })),
    upcomingShifts: shifts.map((shift) => ({ id: shift.id, therapistName: shift.therapist.displayName, startsAt: toIso(shift.startsAt), endsAt: toIso(shift.endsAt), status: shift.status })),
    latestLineEvents: conversations.slice(0, 6).flatMap((conversation) =>
      conversation.messages.map((message) => ({ conversationId: conversation.id, externalUserId: conversation.externalUserId, workflowState: conversation.workflowState, role: message.role, content: message.content, createdAt: toIso(message.createdAt) }))
    ),
    recentIssues: [
      ...activeSmsProblemNotifications.slice(0, 5).map((notification) => ({ type: "SMS/通知失敗", detail: `${notification.type} / ${notification.smsDeliveryStatus ?? notification.smsErrorCode ?? "error unknown"}`, createdAt: toIso(notification.createdAt) })),
      ...activeReviewCallLogs.slice(0, 5).map((callLog) => ({ type: "電話AI要確認", detail: `${callLog.phoneNumber ?? "番号不明"} / confidence ${callLog.confidence ?? "未記録"}`, createdAt: toIso(callLog.createdAt) }))
    ]
  };
}

function latestSmsAttemptByDeliveryKey<T extends {
  id: string;
  reservationId: string | null;
  type: string;
  smsTo: string | null;
  targetPhone: string | null;
  customerPhone: string | null;
  createdAt: Date;
  sentAt: Date | null;
}>(notifications: T[]) {
  const latestByKey = new Map<string, T>();

  for (const notification of notifications) {
    const key = [
      notification.reservationId ?? "no-reservation",
      notification.type,
      normalizePhoneKey(notification.smsTo ?? notification.targetPhone ?? notification.customerPhone ?? "unknown-target")
    ].join(":");
    const current = latestByKey.get(key);
    const currentAt = current ? current.sentAt ?? current.createdAt : null;
    const notificationAt = notification.sentAt ?? notification.createdAt;

    if (!currentAt || notificationAt >= currentAt) {
      latestByKey.set(key, notification);
    }
  }

  return Array.from(latestByKey.values());
}

function normalizePhoneKey(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function isCustomerReservationSmsType(type: string) {
  return customerReservationSmsTypes.has(type);
}

function hasSmsAttemptEvidence(notification: {
  smsSid?: string | null;
  smsErrorCode?: string | null;
  smsErrorMessage?: string | null;
  smsDeliveryStatus?: string | null;
  smsDeliveryCheckedAt?: Date | null;
  smsDeliveredAt?: Date | null;
  targetPhone?: string | null;
  customerPhone?: string | null;
  smsTo?: string | null;
}) {
  return Boolean(
    notification.smsSid ||
      notification.smsErrorCode ||
      notification.smsErrorMessage ||
      notification.smsDeliveryStatus ||
      notification.smsDeliveryCheckedAt ||
      notification.smsDeliveredAt ||
      notification.targetPhone ||
      notification.customerPhone ||
      notification.smsTo
  );
}

function smsAttemptAt(notification: { smsDeliveredAt?: Date | null; sentAt?: Date | null; createdAt: Date }) {
  return notification.smsDeliveredAt ?? notification.sentAt ?? notification.createdAt;
}

function latestSmsAttemptAt(notifications: { smsDeliveredAt?: Date | null; sentAt?: Date | null; createdAt: Date }[]) {
  return notifications.reduce<Date | null>((latest, notification) => {
    const attemptedAt = smsAttemptAt(notification);
    return !latest || attemptedAt > latest ? attemptedAt : latest;
  }, null);
}

function isSmsAttemptAfterLatestDelivered(
  notification: { smsDeliveredAt?: Date | null; sentAt?: Date | null; createdAt: Date },
  latestDeliveredAt: Date | null
) {
  if (!latestDeliveredAt) return true;
  return smsAttemptAt(notification) > latestDeliveredAt;
}

function isProblemSmsNotification(notification: {
  status?: string | null;
  smsSid?: string | null;
  smsDeliveryStatus?: string | null;
  smsDeliveredAt?: Date | null;
}) {
  return notification.status === "FAILED" || isFailedSmsDeliveryStatus(notification.smsDeliveryStatus) || isPendingSmsDeliveryNotification(notification);
}

function isResolvedPhoneAiCallLog(callLog: { status?: string | null; requiredReview: boolean }) {
  return !callLog.requiredReview && (callLog.status === "SUMMARIZED" || callLog.status === "HOLD_CREATED");
}

function latestCallLogAttemptAt(callLogs: { createdAt: Date; updatedAt?: Date | null }[]) {
  return callLogs.reduce<Date | null>((latest, callLog) => {
    const attemptedAt = callLog.updatedAt ?? callLog.createdAt;
    return !latest || attemptedAt > latest ? attemptedAt : latest;
  }, null);
}

function isCallLogAfterLatestResolved(callLog: { createdAt: Date; updatedAt?: Date | null }, latestResolvedAt: Date | null) {
  if (!latestResolvedAt) return true;
  return (callLog.updatedAt ?? callLog.createdAt) > latestResolvedAt;
}

function isFailedSmsDeliveryStatus(status?: string | null) {
  const normalized = status?.trim().toLowerCase();
  return normalized === "failed" || normalized === "undelivered";
}

function isDeliveredSmsNotification(notification: { smsDeliveryStatus?: string | null; smsDeliveredAt?: Date | null }) {
  return notification.smsDeliveryStatus?.trim().toLowerCase() === "delivered" || Boolean(notification.smsDeliveredAt);
}

function isPendingSmsDeliveryNotification(notification: {
  smsSid?: string | null;
  status?: string | null;
  smsDeliveryStatus?: string | null;
  smsDeliveredAt?: Date | null;
}) {
  if (!notification.smsSid || notification.status !== "SENT") return false;
  if (isDeliveredSmsNotification(notification) || isFailedSmsDeliveryStatus(notification.smsDeliveryStatus)) return false;
  return true;
}

function buildEnvironment() {
  return {
    lineWebhookPath: "/api/line/webhook",
    lineEnvReady: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
    clerkEnvReady: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY),
    twilioEnvReady: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    smsEnvReady: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_SMS_FROM || process.env.TWILIO_PHONE_NUMBER)),
    secretsAreMasked: true
  };
}

function buildPlatformFallbackState(error: unknown) {
  const now = new Date();
  const message = error instanceof Error ? error.message : "unknown error";
  const environment = buildEnvironment();
  const checks = [
    buildCheck("store_profile", "店舗基本情報", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("homepage_import", "HP/店舗情報取込", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("courses", "コース/料金", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("therapists", "セラピスト", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("therapist_line_ids", "セラピストLINE ID", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("rooms", "部屋", "unverified", "DB接続エラーのため取得できませんでした"),
    buildCheck("line_webhook", "LINE Webhook環境", environment.lineEnvReady ? "unverified" : "missing", environment.lineEnvReady ? "環境変数あり。DB証跡は未確認" : "LINE環境変数不足"),
    buildCheck("phone_ai", "電話AI番号/Relay", environment.twilioEnvReady ? "unverified" : "missing", environment.twilioEnvReady ? "Twilio環境あり。DB証跡は未確認" : "Twilio環境変数不足"),
    buildCheck("twilio_env", "Twilio API環境", environment.twilioEnvReady ? "unverified" : "missing", environment.twilioEnvReady ? "環境変数あり。実通話証跡は未確認" : "Twilio環境変数不足"),
    buildCheck("sms", "SMS送信", environment.smsEnvReady ? "unverified" : "missing", environment.smsEnvReady ? "SMS環境あり。送信証跡は未確認" : "SMS送信環境不足"),
    buildCheck("clerk", "Clerkログイン/権限", environment.clerkEnvReady ? "unverified" : "missing", environment.clerkEnvReady ? "Clerk環境あり。権限確認は未確認" : "Clerk環境変数不足")
  ];

  return {
    generatedAt: now.toISOString(),
    environment,
    summary: { storeCount: 0, readyStores: 0, warningStores: 0, blockedStores: 1, totalFailedNotifications: 0, totalTherapistsMissingLine: 0 },
    ownerProgress: summarizeOwnerProgress(checks),
    stores: [
      {
        id: "unavailable",
        name: "DB取得失敗",
        phone: null,
        address: null,
        openTime: null,
        closeTime: null,
        updatedAt: null,
        readinessScore: 0,
        submissionGate: {
          status: "submit_blocked",
          label: "提出不可",
          blockingCount: checks.length,
          rule: "DB接続エラー中は証跡確認ができないため提出不可",
          blockers: checks.map((check) => ({ key: check.key, label: check.label, owner: check.owner, status: check.status, detail: check.detail, requiredAction: `Platform APIのDB接続を復旧してください。原因: ${message.slice(0, 120)}` }))
        },
        ownerProgress: summarizeOwnerProgress(checks),
        checks,
        metrics: { activeCourses: 0, activeTherapists: 0, therapistsWithLine: 0, activeRooms: 0, futureReservations: 0, pendingNotifications: 0, failedNotifications: 0, historicalFailedNotifications: 0, sentSmsNotifications: 0, deliveredSmsNotifications: 0, pendingSmsDeliveryNotifications: 0, lineConversations: 0, reviewCallLogs: 0 },
        latest: { homepageImportAt: null, manualProfileUpdateAt: null, lineConversationAt: null, callLogAt: null, phoneSettingUpdatedAt: null },
        phoneSetting: null,
        therapists: [],
        upcomingShifts: [],
        latestLineEvents: [],
        recentIssues: [{ type: "Platform API接続エラー", detail: message, createdAt: now.toISOString() }]
      }
    ]
  };
}

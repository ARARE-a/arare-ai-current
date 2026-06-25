import { fail, ok } from "@/lib/api";
import { assertProductionReady, env, featureFlags } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET() {
  try {
    const flags = featureFlags();
    const productionChecklist = productionChecks();

    if (!env("DATABASE_URL")) {
      const items = storeChecklist(false, false, false, false, false, false, false, false);
      const phoneAi = phoneAiSummary(false);
      const notifications = notificationSummary(flags.twilio);
      const demoItems = buildDemoItems({
        flags,
        phoneAi,
        notifications
      });

      return ok({
        ready: false,
        demoReady: false,
        databaseConfigured: false,
        items,
        demoItems,
        optionalItems: buildOptionalItems(flags),
        productionItems: buildProductionItems(flags),
        phoneAi,
        notifications,
        productionChecklist
      });
    }

    const { storeId } = await requireRequestStoreContext();
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    const courses = await prisma.course.count({ where: { storeId, isActive: true } });
    const rooms = await prisma.room.count({ where: { storeId, isActive: true } });
    const therapists = await prisma.therapist.count({ where: { storeId, status: "ACTIVE" } });
    const settings = await prisma.storeSetting.findUnique({ where: { storeId } });
    const phoneSettings = await prisma.storePhoneSetting.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" }
    });
    const callLogCount = await prisma.callLog.count({ where: { storeId } });
    const latestCallLog = await prisma.callLog.findFirst({
      where: { storeId },
      orderBy: { createdAt: "desc" }
    });
    const notificationCounts = await prisma.notification.groupBy({
      by: ["status"],
      where: { storeId },
      _count: { _all: true }
    });
    const latestNotification = await prisma.notification.findFirst({
      where: { storeId },
      orderBy: { createdAt: "desc" }
    });

    const activePhoneSettings = phoneSettings.filter((item) => item.voiceAiEnabled);
    const routedPhoneSettings = activePhoneSettings.filter((item) => item.routingMode !== "MANUAL_ONLY");
    const voiceWebhookConfigured = routedPhoneSettings.some((item) => Boolean(item.voiceWebhookUrl));
    const phoneAi = phoneAiSummary(true, {
      activeRouteCount: routedPhoneSettings.length,
      totalRouteCount: phoneSettings.length,
      voiceWebhookConfigured,
      callLogCount,
      latestCallStatus: latestCallLog?.status ?? null,
      latestCallAt: latestCallLog?.createdAt.toISOString() ?? null,
      latestSummary: latestCallLog?.aiSummary ?? null
    });
    const notifications = notificationSummary(flags.twilio, {
      counts: notificationCounts.map((item) => ({ status: item.status, count: item._count._all })),
      latestStatus: latestNotification?.status ?? null,
      latestAt: latestNotification?.createdAt.toISOString() ?? null
    });
    const items = storeChecklist(
      Boolean(store?.name && store?.phone),
      Boolean(store?.openTime && store?.closeTime),
      courses > 0,
      rooms > 0,
      therapists > 0,
      settings?.reservationLeadTimeMin !== null && settings?.reservationLeadTimeMin !== undefined,
      Boolean(settings?.cancelDeadlineHours),
      Boolean(settings?.ngWords?.length)
    );
    const demoItems = buildDemoItems({ flags, phoneAi, notifications });

    return ok({
      ready: items.every((item) => item.done),
      demoReady: demoItems.every((item) => item.state === "ready"),
      databaseConfigured: true,
      items,
      demoItems,
      optionalItems: buildOptionalItems(flags),
      productionItems: buildProductionItems(flags, { phoneAi, notifications }),
      phoneAi,
      notifications,
      productionChecklist
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

function storeChecklist(
  store: boolean,
  businessHours: boolean,
  courses: boolean,
  rooms: boolean,
  therapists: boolean,
  reservationRules: boolean,
  cancelRules: boolean,
  ngWords: boolean
) {
  return [
    { key: "store", label: "店舗名・電話番号", done: store },
    { key: "businessHours", label: "営業時間", done: businessHours },
    { key: "courses", label: "コース・料金", done: courses },
    { key: "rooms", label: "部屋数", done: rooms },
    { key: "therapists", label: "出勤可能セラピスト", done: therapists },
    { key: "reservationRules", label: "予約リードタイム", done: reservationRules },
    { key: "cancelRules", label: "キャンセル期限", done: cancelRules },
    { key: "ngWords", label: "NGワード", done: ngWords },
    { key: "env", label: "デモ必須環境変数", done: Boolean(env("DATABASE_URL") && env("OPENAI_API_KEY") && featureFlags().twilio) }
  ];
}

function buildDemoItems(input: {
  flags: ReturnType<typeof featureFlags>;
  phoneAi: ReturnType<typeof phoneAiSummary>;
  notifications: ReturnType<typeof notificationSummary>;
}) {
  return [
    {
      key: "database",
      label: "DB / PostgreSQL",
      state: input.flags.database ? "ready" : "blocked",
      detail: input.flags.database ? "予約・顧客・店舗設定・ログを参照できます。" : "DATABASE_URL が未設定です。"
    },
    {
      key: "openai",
      label: "OpenAI",
      state: input.flags.openai ? "ready" : "blocked",
      detail: input.flags.openai ? "予約情報抽出と電話AI要約に使えます。" : "OPENAI_API_KEY が未設定です。"
    },
    {
      key: "twilio",
      label: "Twilio",
      state: input.flags.twilio ? "ready" : "blocked",
      detail: input.flags.twilio ? "電話AIとSMS送信の資格情報があります。" : "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER を設定してください。"
    },
    {
      key: "phoneRoute",
      label: "電話AIルート",
      state: input.phoneAi.routeReady ? "ready" : "blocked",
      detail: input.phoneAi.routeReady
        ? `${input.phoneAi.activeRouteCount}件のAI受付番号が /api/twilio/voice に接続できます。`
        : "AI受付番号、ルーティング、Voice Webhookのいずれかが未設定です。"
    },
    {
      key: "phoneLog",
      label: "電話AIログ",
      state: input.phoneAi.logReady ? "ready" : "pending",
      detail: input.phoneAi.callLogCount > 0
        ? `${input.phoneAi.callLogCount}件の通話ログがあります。最新: ${input.phoneAi.latestCallStatus ?? "ステータス不明"}`
        : "デモ用ログは未作成です。運用画面の「通話ログ作成」で確認できます。"
    },
    {
      key: "sms",
      label: "SMS通知",
      state: input.notifications.smsReady ? "ready" : "blocked",
      detail: input.notifications.smsReady
        ? `SMS送信準備済み。通知 ${input.notifications.total}件 / 失敗 ${input.notifications.failed}件。`
        : "Twilio SMSの環境変数が未設定です。"
    }
  ] as const;
}

function buildOptionalItems(flags: ReturnType<typeof featureFlags>) {
  return [
    {
      key: "line",
      label: "LINE",
      state: flags.line ? "ready" : "pending",
      detail: flags.line ? "LINE webhookの秘密鍵とアクセストークンは設定済みです。" : "LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN は未設定の可能性があります。営業デモでは後続タスクとして扱います。"
    },
    {
      key: "clerk",
      label: "Clerk",
      state: flags.clerk ? "ready" : "pending",
      detail: flags.clerk ? "Clerkの公開キーと秘密キーは設定済みです。" : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY は未設定の可能性があります。本番認証前に設定します。"
    }
  ] as const;
}

function buildProductionItems(
  flags: ReturnType<typeof featureFlags>,
  input?: { phoneAi: ReturnType<typeof phoneAiSummary>; notifications: ReturnType<typeof notificationSummary> }
) {
  const publicAppUrl = env("PUBLIC_APP_URL");
  const phoneAiReady = Boolean(input?.phoneAi.routeReady);
  const smsReady = Boolean(input?.notifications.smsReady);

  return [
    {
      key: "productionUrl",
      label: "本番URL",
      state: publicAppUrl ? "ready" : "blocked",
      detail: publicAppUrl ? `公開URL: ${publicAppUrl}` : "PUBLIC_APP_URL が未設定です。Twilio Webhookと確認スクリプトに必要です。"
    },
    {
      key: "realOpsTest",
      label: "実運用テスト",
      state: flags.database && flags.openai && flags.twilio && phoneAiReady && smsReady ? "ready" : "pending",
      detail: "予約作成、電話AI着信、SMS通知、キャンセル、エスカレーションを本番URLで1周確認してください。"
    },
    {
      key: "line",
      label: "LINE本番連携",
      state: flags.line ? "ready" : "pending",
      detail: flags.line ? "LINE webhookを検証できます。" : "未設定でもデモ可。本番運用前にLINE Developers側のWebhook URLとenvを設定してください。"
    },
    {
      key: "clerk",
      label: "Clerk認証",
      state: flags.clerk ? "ready" : "pending",
      detail: flags.clerk ? "Clerk認証を検証できます。" : "未設定でもデモ可。本番で管理画面を保護する前に設定してください。"
    }
  ] as const;
}

function phoneAiSummary(
  databaseConfigured: boolean,
  input?: {
    activeRouteCount: number;
    totalRouteCount: number;
    voiceWebhookConfigured: boolean;
    callLogCount: number;
    latestCallStatus: string | null;
    latestCallAt: string | null;
    latestSummary: string | null;
  }
) {
  const activeRouteCount = input?.activeRouteCount ?? 0;
  const totalRouteCount = input?.totalRouteCount ?? 0;
  const voiceWebhookConfigured = input?.voiceWebhookConfigured ?? false;
  const callLogCount = input?.callLogCount ?? 0;

  return {
    routeReady: databaseConfigured && activeRouteCount > 0 && voiceWebhookConfigured,
    logReady: databaseConfigured && callLogCount > 0,
    activeRouteCount,
    totalRouteCount,
    voiceWebhookConfigured,
    callLogCount,
    latestCallStatus: input?.latestCallStatus ?? null,
    latestCallAt: input?.latestCallAt ?? null,
    latestSummary: input?.latestSummary ?? null
  };
}

function notificationSummary(
  twilioReady: boolean,
  input?: {
    counts: Array<{ status: string; count: number }>;
    latestStatus: string | null;
    latestAt: string | null;
  }
) {
  const totals = { pending: 0, sent: 0, failed: 0 };
  for (const item of input?.counts ?? []) {
    if (item.status === "PENDING") totals.pending = item.count;
    if (item.status === "SENT") totals.sent = item.count;
    if (item.status === "FAILED") totals.failed = item.count;
  }

  return {
    smsReady: twilioReady,
    twilioReady,
    pending: totals.pending,
    sent: totals.sent,
    failed: totals.failed,
    total: totals.pending + totals.sent + totals.failed,
    latestStatus: input?.latestStatus ?? null,
    latestAt: input?.latestAt ?? null
  };
}

function productionChecks() {
  const base = assertProductionReady();
  const notes: Record<string, { label: string; group: string; requiredForDemo: boolean; note: string }> = {
    DATABASE_URL: { label: "DB / PostgreSQL", group: "database", requiredForDemo: true, note: "予約・顧客・ログ確認に必須です。" },
    OPENAI_API_KEY: { label: "OpenAI", group: "openai", requiredForDemo: true, note: "予約抽出とAI要約に必須です。" },
    TWILIO_ACCOUNT_SID: { label: "Twilio Account SID", group: "twilio", requiredForDemo: true, note: "電話AIとSMSに必須です。" },
    TWILIO_AUTH_TOKEN: { label: "Twilio Auth Token", group: "twilio", requiredForDemo: true, note: "電話AIとSMSに必須です。" },
    TWILIO_PHONE_NUMBER: { label: "Twilio Phone Number", group: "twilio", requiredForDemo: true, note: "発着信とSMSに必須です。" },
    LINE_CHANNEL_SECRET: { label: "LINE Channel Secret", group: "line", requiredForDemo: false, note: "LINE本番連携時に設定します。" },
    LINE_CHANNEL_ACCESS_TOKEN: { label: "LINE Channel Access Token", group: "line", requiredForDemo: false, note: "LINE本番連携時に設定します。" },
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { label: "Clerk Publishable Key", group: "clerk", requiredForDemo: false, note: "本番認証前に設定します。" },
    CLERK_SECRET_KEY: { label: "Clerk Secret Key", group: "clerk", requiredForDemo: false, note: "本番認証前に設定します。" }
  };

  return [
    ...base.map((item) => ({ ...item, ...notes[item.name] })),
    {
      name: "PUBLIC_APP_URL",
      configured: Boolean(env("PUBLIC_APP_URL")),
      label: "本番URL",
      group: "production",
      requiredForDemo: true,
      note: "Twilio Webhookと本番確認スクリプトに必要です。"
    }
  ];
}

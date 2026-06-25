"use client";

import Link from "next/link";
import { RoleNav, ScreenGuide } from "../components/UsabilityChrome";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarCheck,
  Headphones,
  MessageCircle,
  UserRound,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { userFacingError } from "@/lib/ui-errors";

type AdminStatePayload = {
  reservations: AdminReservation[];
  customers: AdminCustomer[];
  therapists: AdminTherapist[];
  notifications: AdminNotificationRecord[];
  conversations: unknown[];
};

type AdminNotificationRecord = {
  id: string;
  status: string;
  channel: string;
  rawChannel?: string | null;
  type: string;
  body: string;
  time?: string;
  createdAt: string;
  sentAt?: string | null;
  reservationId?: string | null;
  targetName?: string | null;
  targetPhone?: string | null;
  smsTo?: string | null;
  smsDeliveryStatus?: string | null;
  smsErrorCode?: string | null;
  smsErrorMessage?: string | null;
};

type AdminReservation = {
  id: string;
  time: string;
  end: string;
  room: string;
  customer: string;
  phone: string;
  course: string;
  therapist: string;
  status: string;
  source: string;
  amount: number;
};

type AdminCustomer = {
  id: string;
  name: string;
  phone: string;
  lineId: string;
  visits: number;
  memo: string;
  ng: boolean;
};

type AdminTherapist = {
  id: string;
  name: string;
  shift: string;
  status: string;
  utilization: number;
  bookings: number;
};

const workflowStatus = {
  hold: new Set(["保留", "TENTATIVE"]),
  confirmed: new Set(["確定", "CONFIRMED"]),
  cancelled: "キャンセル",
  completed: new Set(["来店済み", "VISITED"])
} as const;

const CURRENT_OPERATIONS_CUTOVER = Date.parse("2026-06-09T18:30:00.000Z");
const OPERATIONAL_REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const OPERATIONAL_RESEND_WINDOW_MS = 72 * 60 * 60 * 1000;
const resendableNotificationTypes = new Set(["RESERVATION_CONFIRMED", "RESERVATION_CHANGED", "RESERVATION_CANCELLED", "REMINDER_PREVIOUS_DAY", "REMINDER_SAME_DAY"]);

export default function LandingHubPage() {
  const [state, setState] = useState<AdminStatePayload | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationRecord[]>([]);
  const [message, setMessage] = useState("データを読込中");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/state", { cache: "no-store" });
      const stateResult = await response.json() as { data?: AdminStatePayload; error?: string };
      if (!response.ok) throw new Error(stateResult.error || "全体ハブのデータ取得に失敗しました");
      const nextState = stateResult.data ?? null;
      setState(nextState);
      setNotifications(nextState?.notifications ?? []);
      setMessage("最新データを同期しました");
    } catch (error) {
      setMessage(userFacingError(error, "全体ハブのデータ取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => {
    const reservations = state?.reservations ?? [];
    const holds = reservations.filter((item) => workflowStatus.hold.has(item.status)).length;
    const confirmed = reservations.filter((item) => workflowStatus.confirmed.has(item.status)).length;
    const completed = reservations.filter((item) => workflowStatus.completed.has(item.status)).length;
    const latestSuccessfulNotificationAt = latestSuccessfulNotificationTimestamp(notifications);
    const pending = notifications.filter(needsHumanReviewNotification).length;
    const failed = notifications.filter((item) => needsResendNotification(item, latestSuccessfulNotificationAt)).length;
    const therapistCount = state?.therapists.length ?? 0;
    const customerCount = state?.customers.length ?? 0;

    return {
      reservations: reservations.length,
      holds,
      confirmed,
      completed,
      pending,
      failed,
      therapistCount,
      customerCount
    };
  }, [state, notifications]);

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] px-3 py-4 pb-28 text-[#101828] md:p-6 md:pb-6">
      <div className="arare-stack mx-auto flex min-h-screen max-w-7xl flex-col gap-6">
        <header className="rounded-xl border border-[#d9e1ea] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-[#007a6c]">ARARE AI / Reservation MVP</p>
              <h1 className="mt-1 text-2xl font-black">AI予約受付MVP 役割別ハブ</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                店舗、セラピスト、顧客の3視点を分離し、AI予約→確定→通知送信までの導線を同じルールで遷移できるように統合します。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#ecfdf5] px-3 py-2 text-xs font-black text-[#065f46]">{loading ? "同期中" : "準備完了"}</span>
              <button
                onClick={load}
                className="rounded-md border border-[#d9e1ea] px-3 py-2 text-sm font-black hover:border-[#00a99d]"
              >
                再読込
              </button>
            </div>
          </div>
          <p className="mt-3 rounded-md border border-dashed border-[#dbe5ee] bg-[#f8fbfc] px-3 py-2 text-sm font-black text-slate-700">{message}</p>
        </header>

        <RoleNav active="home" />

        <ScreenGuide
          eyebrow="Start here"
          title="今日の予約運用は、上から見れば次の操作がわかる"
          description="迷ったらこのハブから始めます。保留があれば店舗、予約入口を試すならWeb Chat、障害やSMS確認は運用に進むだけです。"
          primaryAction={{ href: "/store-v2", label: "保留予約を確認する" }}
          secondaryAction={{ href: "/chat", label: "AI受付を試す" }}
          steps={[
            { title: "入口を確認", body: "Web/電話でAIが受付した内容をハブで把握します。", href: "/chat", actionLabel: "チャットへ" },
            { title: "店舗で確定", body: "保留予約があれば店舗画面で確定し、通知を送ります。", href: "/store-v2", actionLabel: "店舗へ" },
            { title: "運用で監視", body: "SMS、電話AI、環境設定の詰まりを運用画面で確認します。", href: "/ops", actionLabel: "運用へ" }
          ]}
        />

        <DemoFlowPanel />

        <section className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ShortcutCard
            title="店舗運用"
            icon={<CalendarCheck size={18} />}
            description="保留確認・確定・通知送信"
            href="/store-v2"
            metric="役割: 店舗"
          />
          <ShortcutCard
            title="セラピスト"
            icon={<UsersRound size={18} />}
            description="本日の担当一覧・来店準備を確認"
            href="/therapist"
            metric="役割: セラピスト"
          />
          <ShortcutCard
            title="顧客"
            icon={<UserRound size={18} />}
            description="予約一覧・顧客ステータスの確認"
            href="/customer"
            metric="役割: 顧客"
          />
          <ShortcutCard
            title="Web予約チャット"
            icon={<MessageCircle size={18} />}
            description="LINE/WEBの自動受付導線"
            href="/chat"
            metric="予約入口"
          />
          <ShortcutCard
            title="電話AI"
            icon={<Headphones size={18} />}
            description="電話AIの通話ログと受付状況を確認"
            href="/phone-ai"
            metric="通話ログ"
          />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatBlock
            title="保留予約"
            value={`${summary.holds}件`}
            detail={`今日合計 ${summary.reservations} 件`}
            tone="warn"
            icon={<CalendarClock size={19} />}
          />
          <StatBlock
            title="確定/来店"
            value={`${summary.confirmed}/${summary.completed}件`}
            detail="顧客確定と来店済み"
            tone="success"
            icon={<CalendarCheck size={19} />}
          />
          <StatBlock
            title="通知送信"
            value={`${summary.pending}保留 / ${summary.failed}失敗`}
            detail="現在の未対応通知"
            tone={summary.failed > 0 ? "danger" : "neutral"}
            icon={<Bell size={19} />}
          />
          <StatBlock
            title="セラピスト"
            value={`${summary.therapistCount}名`}
            detail="当日対応可視化"
            tone="neutral"
            icon={<UsersRound size={19} />}
          />
          <StatBlock
            title="顧客"
            value={`${summary.customerCount}名`}
            detail="本日の来店前提で運用"
            tone="neutral"
            icon={<UserRound size={19} />}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="本日の自動フロー">
            <ol className="space-y-2 text-sm leading-6 text-slate-700">
              <li className="rounded-md border border-[#dbe5ee] bg-white p-3">
                1. Web/電話/SNSでAIが予約を受ける
              </li>
              <li className="rounded-md border border-[#dbe5ee] bg-white p-3">
                2. AIは保留/確定の判定を作成し、予約と通知を仮保存
              </li>
              <li className="rounded-md border border-[#dbe5ee] bg-white p-3">
                3. 店舗側が保留予約を確認して確定、または保留のままにする
              </li>
              <li className="rounded-md border border-[#dbe5ee] bg-white p-3">
                4. 確定時に顧客・セラピスト・SMSの通知を即時送信（Pendingキュー）
              </li>
            </ol>
            <Link
              href="/store-v2"
              className="mt-3 inline-flex h-11 items-center justify-center rounded-md bg-[#008b83] px-4 text-sm font-black text-white"
            >
              店舗画面で確定フローへ進む
            </Link>
          </Panel>

          <Panel title="運用上のリンク整合性">
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <strong className="text-slate-800">/store</strong> → 予約確定、通知送信、SMS再送
              </li>
              <li>
                <strong className="text-slate-800">/therapist</strong> → 本日担当者別の予約タスク
              </li>
              <li>
                <strong className="text-slate-800">/customer</strong> → 顧客単位で予約状況を確認
              </li>
              <li>
                <strong className="text-slate-800">/chat</strong> → AI受付UI（予約入口）
              </li>
              <li>
                <strong className="text-slate-800">/phone-ai</strong> → 電話AI設定 / ログ確認、<strong className="text-slate-800">/ops</strong> → 管理者向け監視
              </li>
            </ul>
          </Panel>
        </section>

        <section className="rounded-lg border border-[#d9e1ea] bg-white p-4">
          <div className="text-sm font-black text-slate-800">最新通知サマリ（保留/失敗重視）</div>
          <div className="mt-3 space-y-2">
            {(state?.notifications ?? [])
              .slice(0, 8)
              .map((notification) => (
                <div key={notification.id} className="rounded-md border border-[#e5ebf2] bg-[#f8fbfc] p-3 text-sm">
                  <div className="font-black text-slate-700">{notification.time}</div>
                  <div className="text-slate-600">{notification.body}</div>
                </div>
              ))}
            {(state?.notifications?.length ?? 0) === 0 ? <div className="rounded-md border border-dashed border-[#d9e1ea] bg-[#f8fbfc] p-3 text-sm text-slate-500">通知データはまだありません。</div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function isLegacyNotificationFailure(item: AdminNotificationRecord) {
  const text = [item.type, item.body, item.smsErrorCode, item.smsErrorMessage, item.targetName, item.targetPhone, item.smsTo].filter(Boolean).join(" ");
  const createdAtMs = notificationTimestamp(item);

  if (createdAtMs && createdAtMs < CURRENT_OPERATIONS_CUTOVER) {
    return true;
  }

  const oldFailureKeywords = [
    "TEST_SUPPRESSED",
    "TWILIO_AUTH_TOKEN_INVALID_FORMAT",
    "Twilio SMS env vars are not configured",
    "未登録LINE ID",
    "旧テスト",
    "Codex ",
    "tanto2 ",
    "Authentication",
    "Authenticate",
    "SYSTEM: Corrected ambiguous phone time",
    "????????",
    "00000000",
  ];

  return oldFailureKeywords.some((keyword) => text.includes(keyword));
}

function needsHumanReviewNotification(item: AdminNotificationRecord) {
  const channel = item.rawChannel ?? item.channel;
  return (
    item.status === "PENDING" &&
    channel === "LINE" &&
    ["RESERVATION_CHANGED", "RESERVATION_CANCELLED"].includes(item.type ?? "") &&
    !isLegacyNotificationFailure(item) &&
    isWithinOperationalWindow(item, OPERATIONAL_REVIEW_WINDOW_MS)
  );
}

function needsResendNotification(item: AdminNotificationRecord, latestSuccessfulNotificationAt: number) {
  const failed = item.status === "FAILED" || item.smsDeliveryStatus === "failed" || item.smsDeliveryStatus === "undelivered";
  if (!failed) return false;
  if (!resendableNotificationTypes.has(item.type ?? "")) return false;
  if (isLegacyNotificationFailure(item)) return false;
  if (!isWithinOperationalWindow(item, OPERATIONAL_RESEND_WINDOW_MS)) return false;

  const createdAtMs = notificationTimestamp(item);
  if (latestSuccessfulNotificationAt && createdAtMs && createdAtMs <= latestSuccessfulNotificationAt) {
    return false;
  }

  return Boolean(item.targetPhone || item.smsTo || item.reservationId);
}

function DemoFlowPanel() {
  const steps = [
    {
      number: "1",
      title: "ホーム",
      detail: "要対応、予約、空室、出勤の数字を確認",
      href: "/"
    },
    {
      number: "2",
      title: "店舗ダッシュボード",
      detail: "店舗名、本日の予約、空室、出勤を確認",
      href: "/store-v2"
    },
    {
      number: "3",
      title: "電話AIログ",
      detail: "未対応0件と通話要約を確認",
      href: "/phone-ai#call-logs"
    },
    {
      number: "4",
      title: "予約確定",
      detail: "今後のみで仮予約を確定",
      href: "/reservations"
    },
    {
      number: "5",
      title: "通知ログ",
      detail: "送信済みと失敗0件を確認",
      href: "/notification-logs"
    }
  ];

  return (
    <section className="rounded-xl border border-[#d9e1ea] bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#007a6c]">Demo Route</p>
          <h2 className="mt-1 text-xl font-black">デモ進行</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            店舗に見せる時は、この順番でAI受付から確定、通知確認まで説明します。
          </p>
        </div>
        <Link
          href="/reservations"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#008b83] px-4 text-sm font-black text-white"
        >
          予約確定へ
          <ArrowRight size={16} />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {steps.map((step) => (
          <Link
            key={step.number}
            href={step.href}
            className="group flex min-h-[90px] flex-col rounded-lg border border-[#d9e1ea] bg-[#f8fbfc] p-3 transition hover:border-[#00a99d] hover:bg-[#f1fffc]"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#e6f7f4] text-sm font-black text-[#007a6c]">
                {step.number}
              </span>
              <span className="min-w-0 text-sm font-black leading-tight text-slate-900">{step.title}</span>
            </div>
            <span className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{step.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function latestSuccessfulNotificationTimestamp(items: AdminNotificationRecord[]) {
  return items.reduce((latest, item) => {
    const deliveryStatus = item.smsDeliveryStatus ?? "";
    const successful = item.status === "SENT" || deliveryStatus === "sent" || deliveryStatus === "delivered";
    if (!successful) return latest;
    const timestamp = notificationTimestamp(item);
    return timestamp && timestamp > latest ? timestamp : latest;
  }, 0);
}

function isWithinOperationalWindow(item: AdminNotificationRecord, windowMs: number) {
  const createdAtMs = notificationTimestamp(item);
  if (!createdAtMs) return false;
  return Date.now() - createdAtMs <= windowMs;
}

function notificationTimestamp(item: AdminNotificationRecord) {
  const source = item.createdAt ?? item.sentAt ?? "";
  const value = source ? Date.parse(source) : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function ShortcutCard({
  title,
  description,
  icon,
  href,
  metric
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  metric: string;
}) {
  return (
    <Link
      href={href}
      className="arare-card flex h-full flex-col rounded-xl border border-[#d9e1ea] bg-white px-3 py-3 transition hover:border-[#00a99d] hover:bg-[#f4fffd] md:px-4 md:py-4"
    >
      <div className="flex flex-col gap-2 text-sm font-black text-[#0f172a] sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#e9f6f3] text-[#007a6c]">{icon}</span>
          <span className="min-w-0 leading-tight">{title}</span>
        </span>
        <span className="text-[11px] text-slate-500 md:text-xs">{metric}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 md:text-sm">{description}</p>
    </Link>
  );
}

function StatBlock({
  title,
  value,
  detail,
  tone,
  icon
}: {
  title: string;
  value: string;
  detail: string;
  tone: "neutral" | "success" | "warn" | "danger";
  icon: React.ReactNode;
}) {
  const toneClass = {
    neutral: "bg-[#f8fbfc] border-[#d9e1ea] text-slate-900",
    success: "bg-[#ecfdf5] border-[#a7f3d0] text-emerald-700",
    warn: "bg-[#fffbeb] border-[#fde68a] text-amber-700",
    danger: "bg-[#fef2f2] border-[#fecaca] text-red-700"
  };
  return (
    <div className={`arare-metric rounded-lg border ${toneClass[tone]} p-4`}>
      <div className="flex items-center justify-between text-xs font-black uppercase tracking-wide">
        <span>{title}</span>
        <span>{icon}</span>
      </div>
      <div className="mt-1 text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs">{detail}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="arare-panel rounded-lg border border-[#d9e1ea] bg-white p-4">
      <div className="mb-3 text-sm font-black">{title}</div>
      {children}
    </section>
  );
}


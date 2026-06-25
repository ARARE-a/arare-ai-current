"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, Bell, Building2, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, ChevronDown, ClipboardList, DoorOpen, Home, ListChecks, LogOut, Menu, MessageCircle, Phone, RefreshCw, Send, Settings, ShieldCheck, UserCircle, UsersRound } from "lucide-react";
import { userFacingError } from "@/lib/ui-errors";

type DashboardState = {
  reservations?: ReservationItem[];
  futureReservations?: ReservationItem[];
  conversations?: ConversationItem[];
  therapists?: TherapistItem[];
  rooms?: RoomItem[];
  callLogs?: CallLogItem[];
  notifications?: NotificationItem[];
  notificationLogs?: NotificationLogItem[];
  auditLogs?: AuditLogItem[];
  storeSyncEvidence?: StoreSyncEvidence;
  databaseConfigured?: boolean;
  databaseStatus?: string;
};

type StoreSyncEvidence = {
  store?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    openTime?: string | null;
    closeTime?: string | null;
    updatedAt?: string | null;
  } | null;
  homepageImport?: { latest?: unknown | null; count?: number | null } | null;
  phoneSetting?: {
    id?: string | null;
    voiceWebhookUrl?: string | null;
    voiceRelayWsUrl?: string | null;
    updatedAt?: string | null;
  } | null;
};

type ReservationItem = {
  id: string;
  date?: string;
  startsAt?: string;
  time?: string;
  end?: string;
  room?: string;
  customer?: string;
  phone?: string;
  course?: string;
  therapist?: string;
  rawStatus?: string;
  status?: string;
  rawSource?: string;
  source?: string;
  amount?: number;
  approval?: ReservationApproval;
};

type ReservationApproval = {
  holdId?: string | null;
  expiresAt?: string | null;
  minutesLeft?: number | null;
  state?: "active" | "warning" | "expired" | "missing_hold" | "none" | string;
  notificationId?: string | null;
  notificationType?: string | null;
  notificationStatus?: string | null;
  notificationStatusText?: string | null;
  smsDeliveryStatus?: string | null;
  smsErrorCode?: string | null;
  smsErrorMessage?: string | null;
  sentAt?: string | null;
};

type NotificationItem = {
  id: string;
  time?: string;
  createdAt?: string;
  sentAt?: string | null;
  status?: string;
  statusText?: string;
  type?: string;
  typeText?: string;
  channel?: string;
  rawChannel?: string;
  body?: string;
  reservationId?: string | null;
  targetName?: string | null;
  targetPhone?: string | null;
  smsTo?: string | null;
  smsSid?: string | null;
  smsDeliveryStatus?: string | null;
  smsDeliveryCheckedAt?: string | null;
  smsDeliveredAt?: string | null;
  smsErrorCode?: string | null;
  smsErrorMessage?: string | null;
};

type NotificationLogItem = {
  id: string;
  notificationId?: string | null;
  reservationId?: string | null;
  time?: string;
  createdAt?: string;
  sentAt?: string | null;
  type?: string;
  typeText?: string;
  channel?: string;
  channelText?: string;
  status?: string;
  statusText?: string;
  recipientName?: string | null;
  recipientPhone?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type AuditLogItem = {
  id: string;
  time?: string;
  createdAt?: string;
  action?: string;
  actionText?: string;
  actorType?: string;
  actorId?: string | null;
  reservationId?: string | null;
  reservation?: {
    customer?: { name?: string | null } | null;
    course?: { name?: string | null } | null;
    date?: string;
    time?: string;
  } | null;
};

type ConversationItem = {
  id: string;
  time?: string;
  name?: string;
  channel?: string;
  rawChannel?: string;
  status?: string;
  body?: string;
  messages?: { id: string; role: string; body: string; time?: string }[];
};

type TherapistItem = { id: string; name?: string; shift?: string; status?: string; bookings?: number; utilization?: number; profile?: string };
type RoomItem = { id: string; name?: string; state?: string; currentCustomer?: string | null; currentTherapist?: string | null; until?: string | null };
type ConversationTab = "LINE" | "PHONE" | "WEB_CHAT";
type ReadinessState = "ok" | "warn" | "block";
type ReadinessItem = { label: string; detail: string; state: ReadinessState; href?: string; actionLabel?: string };

const CURRENT_OPERATIONS_CUTOVER = Date.parse("2026-06-09T18:30:00.000Z");
const OPERATIONAL_REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const OPERATIONAL_RESEND_WINDOW_MS = 72 * 60 * 60 * 1000;
const resendableNotificationTypes = new Set(["RESERVATION_CONFIRMED", "RESERVATION_CHANGED", "RESERVATION_CANCELLED", "REMINDER_PREVIOUS_DAY", "REMINDER_SAME_DAY"]);
type CallLogItem = { id: string; reservationId?: string | null; time?: string; phoneNumber?: string; status?: string; requiredReview?: boolean; reviewNotes?: string; summary?: string };

const holdStatuses = new Set(["TENTATIVE", "PENDING", "PENDING_CONFIRMATION", "HOLD", "仮予約"]);
const confirmedStatuses = new Set(["CONFIRMED", "VISITED", "確定", "来店済み"]);

export default function StorePage() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("店舗作業台を読み込み中");
  const [lastUpdated, setLastUpdated] = useState("未更新");

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/admin/state", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "管理画面データの取得に失敗しました");
      const nextState = payload.data ?? null;
      setState(nextState);
      setMessage(nextState?.databaseConfigured === false ? `DB要確認: ${nextState.databaseStatus ?? "接続設定を確認してください"}` : "最新情報を反映しました");
      setLastUpdated(new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    } catch (error) {
      setMessage(userFacingError(error, "管理画面データの取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const todayReservations = state?.reservations ?? [];
  const futureReservations = state?.futureReservations ?? [];
  const conversations = state?.conversations ?? [];
  const therapists = state?.therapists ?? [];
  const rooms = state?.rooms ?? [];
  const callLogs = state?.callLogs ?? [];
  const notifications = state?.notifications ?? [];
  const notificationLogs = state?.notificationLogs ?? [];
  const auditLogs = state?.auditLogs ?? [];
  const storeEvidence = state?.storeSyncEvidence;
  const storeName = storeEvidence?.store?.name || "店舗未設定";
  const storeId = storeEvidence?.store?.id || "未取得";
  const databaseReady = Boolean(state && state.databaseConfigured !== false);

  const todayActions = useMemo(() => todayReservations.filter((item) => holdStatuses.has(item.rawStatus ?? "") || holdStatuses.has(item.status ?? "")), [todayReservations]);
  const confirmedToday = useMemo(() => todayReservations.filter((item) => confirmedStatuses.has(item.rawStatus ?? "") || confirmedStatuses.has(item.status ?? "")), [todayReservations]);
  const failedNotifications = useMemo(() => notifications.filter((item) => item.status === "FAILED"), [notifications]);
  const pendingNotifications = useMemo(() => notifications.filter((item) => item.status === "PENDING"), [notifications]);
  const latestSuccessfulNotificationAt = useMemo(() => latestSuccessfulNotificationTimestamp(notifications), [notifications]);
  const manualReviewNotifications = useMemo(() => pendingNotifications.filter(needsHumanReviewNotification), [pendingNotifications]);
  const resendNotifications = useMemo(() => failedNotifications.filter((item) => needsResendNotification(item, latestSuccessfulNotificationAt)), [failedNotifications, latestSuccessfulNotificationAt]);
  const unresolvedCallLogs = useMemo(() => callLogs.filter(needsCallReview), [callLogs]);
  const urgentActionCount = todayActions.length + manualReviewNotifications.length + resendNotifications.length + unresolvedCallLogs.length;
  const dashboardConversations = useMemo(() => conversations.filter((item) => !isTherapistLineConversation(item)), [conversations]);
  const availableRooms = useMemo(() => rooms.filter((item) => item.state === "空き"), [rooms]);
  const onDuty = useMemo(() => therapists.filter((item) => item.status === "出勤中" || item.status === "出勤予定"), [therapists]);
  const readinessItems = useMemo(
    () =>
      buildDashboardReadinessItems({
        databaseConfigured: databaseReady,
        storeEvidence,
        pendingApprovals: todayActions.length,
        failedNotifications: failedNotifications.length,
        manualReviewNotifications: manualReviewNotifications.length,
        unresolvedCallLogs: unresolvedCallLogs.length,
        conversations: dashboardConversations.length,
        callLogs: callLogs.length,
        approvalEvidenceCount: auditLogs.filter(isApprovalAuditLog).length,
        notificationLogCount: notificationLogs.length
      }),
    [databaseReady, storeEvidence, todayActions.length, failedNotifications.length, manualReviewNotifications.length, unresolvedCallLogs.length, dashboardConversations.length, callLogs.length, auditLogs, notificationLogs.length]
  );

  async function approveReservation(id: string) {
    await runAction(id, async () => {
      const response = await fetch(`/api/reservations/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!response.ok) throw new Error(await response.text());
      setMessage("予約を確定しました。通知状態を再取得します");
    });
  }

  async function cancelReservation(id: string) {
    await runAction(id, async () => {
      const response = await fetch(`/api/reservations/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      setMessage("予約をキャンセルしました");
    });
  }

  async function sendNotification(notificationId?: string, reservationId?: string) {
    await runAction(notificationId ?? reservationId ?? "notifications", async () => {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationId ? { notificationId } : reservationId ? { reservationId } : { limit: 20 })
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage("通知送信を実行しました");
    });
  }

  async function runAction(id: string, callback: () => Promise<void>) {
    setBusyId(id);
    try {
      await callback();
      await load(false);
    } catch (error) {
      setMessage(userFacingError(error, "操作に失敗しました"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#eef4f7] text-slate-950">
      <div className="hidden h-full min-h-0 lg:grid lg:grid-cols-[var(--arare-sidebar-width)_minmax(0,1fr)_372px] lg:grid-rows-[var(--arare-topbar-height)_minmax(0,1fr)]">
        <DesktopSidebar storeName={storeName} storeId={storeId} />
        <DashboardTopbar
          loading={loading}
          lastUpdated={lastUpdated}
          message={message}
          databaseReady={databaseReady}
          storeName={storeName}
          alertCount={manualReviewNotifications.length + resendNotifications.length + unresolvedCallLogs.length}
          onReload={() => void load(false)}
        />

        <section className="min-h-0 overflow-hidden p-3">
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_22%_22%] gap-3">
            <div className="grid min-h-0 grid-cols-[1.18fr_0.95fr] gap-3">
              <DashboardCalendar reservations={todayReservations} rooms={rooms} />
              <div id="today-reservations" className="min-h-0 scroll-mt-4">
                <TodayDashboardTable reservations={todayReservations} onApprove={approveReservation} onCancel={cancelReservation} onNotify={sendNotification} busyId={busyId} />
              </div>
            </div>

            <div className="grid min-h-0 grid-cols-[1fr_1.1fr_0.78fr] gap-3">
              <TodaySummaryPanel reservations={todayReservations} urgentActionCount={urgentActionCount} availableRooms={availableRooms.length} onDuty={onDuty.length} />
              <SalesTrendPanel reservations={todayReservations} />
              <SalesMixPanel reservations={todayReservations} />
            </div>

            <div className="grid min-h-0 grid-cols-[1.05fr_0.95fr_0.95fr] gap-3">
              <TherapistCompactPanel therapists={therapists} />
              <div id="notification-evidence" className="min-h-0 scroll-mt-4">
                <OperationalEvidencePanel actionNotifications={[...resendNotifications, ...manualReviewNotifications]} reviewCallLogs={unresolvedCallLogs} notificationLogs={notificationLogs} auditLogs={auditLogs} onSend={sendNotification} busyId={busyId} />
              </div>
              <CommandGuardPanel items={readinessItems} />
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-hidden p-3 pl-0">
          <ConversationRail conversations={dashboardConversations} unresolved={manualReviewNotifications.length + resendNotifications.length} />
        </aside>
      </div>

      <div className="grid h-full min-h-0 grid-rows-[54px_84px_minmax(0,1fr)_64px] gap-2 p-2 lg:hidden">
        <MobileTopbar loading={loading} storeName={storeName} onReload={() => void load(false)} />
        <MobileMetricStrip
          urgentActionCount={urgentActionCount}
          aiActionCount={manualReviewNotifications.length + resendNotifications.length + unresolvedCallLogs.length}
          notificationActionCount={manualReviewNotifications.length + resendNotifications.length}
          callLogActionCount={unresolvedCallLogs.length}
          reservationActionCount={todayActions.length}
          reservations={todayReservations.length}
          availableRooms={availableRooms.length}
          onDuty={onDuty.length}
        />
        <MobileDashboardBody
          reservations={todayReservations}
          conversations={dashboardConversations.slice(0, 5)}
          notifications={[...resendNotifications, ...manualReviewNotifications]}
          reviewCallLogs={unresolvedCallLogs}
          therapists={therapists}
          rooms={rooms}
          onApprove={approveReservation}
          onCancel={cancelReservation}
          onNotify={sendNotification}
          busyId={busyId}
        />
        <MobileBottomNav />
      </div>
    </main>
  );
}

const dashboardNavItems = [
  { href: "/", label: "全体ハブ", icon: <Home size={17} /> },
  { href: "/platform", label: "ARARE管理", icon: <BarChart3 size={17} /> },
  { href: "/setup", label: "導入", icon: <Settings size={17} /> },
  { href: "/permissions", label: "権限管理", icon: <ShieldCheck size={17} /> },
  { href: "/store-v2", label: "ダッシュボード", icon: <Home size={17} />, active: true },
  { href: "/knowledge", label: "管理UI", icon: <ClipboardList size={17} /> },
  { href: "/therapist", label: "セラピスト", icon: <UsersRound size={17} /> },
  { href: "/customer", label: "顧客管理", icon: <UserCircle size={17} /> },
  { href: "/chat", label: "Web Chat", icon: <MessageCircle size={17} /> },
  { href: "/ops", label: "運用", icon: <ListChecks size={17} /> },
  { href: "/phone-ai", label: "電話AI", icon: <Phone size={17} /> }
];

function DesktopSidebar({ storeName, storeId }: { storeName: string; storeId: string }) {
  return (
    <aside className="row-span-2 flex min-h-0 flex-col overflow-hidden bg-[#081d2f] text-white">
      <div className="px-6 py-5">
        <div className="text-2xl font-black tracking-wide">ARARE <span className="text-[#00b8a9]">AI</span></div>
        <div className="mt-1 text-xs font-bold text-white/75">AI予約受付</div>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-hidden px-3">
        {dashboardNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black transition ${
              item.active ? "bg-[#008b83] text-white" : "text-white/86 hover:bg-white/10"
            }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="m-3 rounded-lg border border-white/15 bg-white/5 p-3">
        <div className="truncate text-sm font-black">{storeName}</div>
        <div className="mt-1 truncate text-xs font-bold text-white/70">店舗ID: {storeId}</div>
        <button className="mt-3 h-9 w-full rounded-md border border-white/15 bg-white/10 text-xs font-black text-white">店舗切替</button>
      </div>
    </aside>
  );
}

function DashboardTopbar({ loading, lastUpdated, message, databaseReady, storeName, alertCount, onReload }: { loading: boolean; lastUpdated: string; message: string; databaseReady: boolean; storeName: string; alertCount: number; onReload: () => void }) {
  return (
    <header className="col-span-2 flex min-w-0 items-center justify-between border-b border-[#dde6ed] bg-white px-5">
      <div className="flex min-w-0 items-center gap-4">
        <button className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#dfe7ee] bg-white">
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-lg font-black">ダッシュボード</div>
          <div className="truncate text-xs font-bold text-slate-500">{message} / 最終更新 {lastUpdated}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dfe7ee] bg-white px-4 text-sm font-black">
          <span className="max-w-32 truncate">{storeName}</span> <ChevronDown size={15} />
        </button>
        <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dfe7ee] bg-white px-4 text-sm font-black">
          <span className={`h-2.5 w-2.5 rounded-full ${databaseReady ? "bg-emerald-500" : "bg-rose-500"}`} />
          {databaseReady ? "営業中" : "DB要確認"}
        </span>
        <button onClick={onReload} className="grid h-10 w-10 place-items-center rounded-lg border border-[#dfe7ee] bg-white" title="再読込">
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
        </button>
        <button className="relative grid h-10 w-10 place-items-center rounded-lg border border-[#dfe7ee] bg-white" title="通知">
          <Bell size={20} />
          {alertCount > 0 ? <span className="absolute right-1 top-1 rounded-full bg-red-600 px-1 text-[10px] font-black text-white">{alertCount}</span> : null}
        </button>
        <button onClick={() => void signOutFromClerk()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#082033] px-3 text-sm font-black text-white" title="ログアウト">
          <UserCircle size={18} /> マネージャー <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}

function DashboardPanel({ title, icon, action, children, className = "" }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-h-0 overflow-hidden rounded-lg border border-[#dbe5ec] bg-white shadow-sm ${className}`}>
      <div className="flex h-10 items-center justify-between border-b border-[#edf2f6] px-3">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-black">{icon}{title}</h2>
        {action}
      </div>
      <div className="h-[calc(100%-2.5rem)] min-h-0 overflow-hidden p-3">{children}</div>
    </section>
  );
}

function DashboardCalendar({ reservations, rooms }: { reservations: ReservationItem[]; rooms: RoomItem[] }) {
  const roomNames = calendarRoomNames(reservations, rooms);
  const slots = calendarSlots(reservations);

  return (
    <DashboardPanel
      title="予約カレンダー"
      icon={<CalendarDays size={16} />}
      action={<Pill text={new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date())} />}
    >
      <div className="grid h-full min-h-0 overflow-hidden rounded-lg border border-[#dfe8ef]" style={{ gridTemplateColumns: `58px repeat(${roomNames.length}, minmax(0,1fr))`, gridTemplateRows: `28px repeat(${slots.length}, minmax(0,1fr))` }}>
        <div className="bg-[#f7fafc] px-2 py-1 text-[11px] font-black text-slate-500">時間</div>
        {roomNames.map((room) => (
          <div key={room} className="truncate border-l border-[#dfe8ef] bg-[#f7fafc] px-2 py-1 text-center text-[11px] font-black text-slate-700">{room}</div>
        ))}
        {slots.map((slot) => (
          <CompactCalendarRow key={slot} slot={slot} rooms={roomNames} reservations={reservations} />
        ))}
      </div>
    </DashboardPanel>
  );
}

function CompactCalendarRow({ slot, rooms, reservations }: { slot: string; rooms: string[]; reservations: ReservationItem[] }) {
  return (
    <>
      <div className="border-t border-[#dfe8ef] bg-white px-2 py-1 text-[11px] font-black text-slate-500">{slot}</div>
      {rooms.map((room) => {
        const items = reservations.filter((reservation) => reservation.room === room && reservationSlotLabel(reservation) === slot);
        return (
          <div key={`${slot}-${room}`} className="min-h-0 border-l border-t border-[#dfe8ef] bg-white p-1">
            {items.slice(0, 2).map((reservation) => (
              <div key={reservation.id} className={`mb-1 min-h-0 rounded-md border px-1.5 py-0.5 text-[10px] font-black leading-4 ${reservationCalendarClass(reservation)}`}>
                <div className="truncate">{reservation.time} - {reservation.end}</div>
                <div className="truncate">{reservation.customer ?? "顧客名なし"}</div>
              </div>
            ))}
            {items.length > 2 ? <div className="text-[10px] font-black text-slate-500">+{items.length - 2}件</div> : null}
          </div>
        );
      })}
    </>
  );
}

function TodayDashboardTable({ reservations, onApprove, onCancel, onNotify, busyId }: { reservations: ReservationItem[]; onApprove: (id: string) => Promise<void>; onCancel: (id: string) => Promise<void>; onNotify: (notificationId?: string, reservationId?: string) => Promise<void>; busyId: string | null }) {
  const confirmed = reservations.filter(isConfirmedReservation);
  const tentative = reservations.filter(isHoldReservation);
  const cancelled = reservations.filter(isCancelledReservation);

  return (
    <DashboardPanel
      title="本日の予約"
      icon={<CalendarCheck size={16} />}
      action={<span className="text-xs font-black text-slate-400">全{reservations.length}件</span>}
    >
      <div className="grid h-full min-h-0 grid-rows-[62px_24px_minmax(0,1fr)] gap-2">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="確定" value={confirmed.length} tone="green" />
          <MiniStat label="仮予約" value={tentative.length} tone="amber" />
          <MiniStat label="取消" value={cancelled.length} tone="red" />
        </div>
        <div className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,0.85fr)_72px_86px] items-center rounded bg-[#f7fafc] px-2 text-[10px] font-black text-slate-500">
          <span>時間</span><span>顧客</span><span>担当</span><span>期限</span><span className="text-right">操作</span>
        </div>
        <div className="min-h-0 space-y-1 overflow-y-auto pr-1">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="grid min-h-11 grid-cols-[52px_minmax(0,1fr)_minmax(0,0.85fr)_72px_86px] items-center rounded-md border border-[#edf2f6] px-2 py-1 text-xs font-bold">
              <span className="font-black">{reservation.time}</span>
              <span className="min-w-0">
                <span className="block truncate font-black">{reservation.customer ?? "顧客名なし"}</span>
                <span className="block truncate text-[10px] text-slate-500">{reservation.course ?? "未設定"}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-black">{reservation.therapist ?? "未割当"}</span>
                <span className="block truncate text-[10px] text-slate-500">{reservation.room ?? "部屋未割当"}</span>
              </span>
              <ApprovalSlaCell reservation={reservation} />
              <ApprovalActionCell reservation={reservation} busyId={busyId} onApprove={onApprove} onNotify={onNotify} />
            </div>
          ))}
          {reservations.length === 0 ? <Empty text="本日の予約はありません。" /> : null}
        </div>
      </div>
    </DashboardPanel>
  );
}

function ApprovalSlaCell({ reservation }: { reservation: ReservationItem }) {
  const smsIssue = reservationSmsIssue(reservation);
  if (!isHoldReservation(reservation)) {
    return (
      <span className="min-w-0">
        <Pill text={reservation.status ?? reservation.rawStatus ?? "未確認"} tone={smsIssue ? "red" : reservationPillTone(reservation)} />
        {smsIssue ? <span className="mt-0.5 block truncate text-[10px] font-black text-red-700">{smsIssue.title}</span> : null}
      </span>
    );
  }

  const approval = reservationApprovalMeta(reservation);
  const notification = reservationNotificationMeta(reservation);

  return (
    <span className="min-w-0">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${approval.className}`}>{approval.label}</span>
      <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-500">{notification.label}</span>
    </span>
  );
}

function ApprovalActionCell({
  reservation,
  busyId,
  onApprove,
  onNotify
}: {
  reservation: ReservationItem;
  busyId: string | null;
  onApprove: (id: string) => Promise<void>;
  onNotify: (notificationId?: string, reservationId?: string) => Promise<void>;
}) {
  const smsIssue = reservationSmsIssue(reservation);
  const notificationId = reservation.approval?.notificationId ?? undefined;
  const notifyBusyId = notificationId ?? reservation.id;
  const notifyBusy = busyId === notifyBusyId;

  if (!isHoldReservation(reservation)) {
    return (
      <span className="flex min-w-0 justify-end gap-1">
        {smsIssue ? (
          <button
            disabled={notifyBusy}
            onClick={() => void onNotify(notificationId, reservation.id)}
            className="rounded border border-red-200 bg-red-50 px-1.5 py-1 text-[10px] font-black text-red-700 disabled:opacity-50"
          >
            {notifyBusy ? "送信中" : "再送"}
          </button>
        ) : null}
        <Pill text={reservation.source ?? "反映済み"} tone={smsIssue ? "red" : "green"} />
      </span>
    );
  }

  const notification = reservationNotificationMeta(reservation);
  const approveBusy = busyId === reservation.id;

  return (
    <span className="flex min-w-0 justify-end gap-1">
      {notification.actionLabel ? (
        <button
          disabled={notifyBusy || approveBusy}
          onClick={() => void onNotify(notificationId, reservation.id)}
          className={`rounded border px-1.5 py-1 text-[10px] font-black ${notification.buttonClassName}`}
        >
          {notifyBusy ? "送信中" : notification.actionLabel}
        </button>
      ) : null}
      <button disabled={approveBusy || notifyBusy} onClick={() => void onApprove(reservation.id)} className="rounded bg-[#008b83] px-2 py-1 text-[10px] font-black text-white disabled:opacity-50">
        {approveBusy ? "処理中" : "確定"}
      </button>
    </span>
  );
}

function TodaySummaryPanel({ reservations, urgentActionCount, availableRooms, onDuty }: { reservations: ReservationItem[]; urgentActionCount: number; availableRooms: number; onDuty: number }) {
  const confirmedSales = reservations.filter(isConfirmedReservation).reduce((sum, reservation) => sum + (reservation.amount ?? 0), 0);
  const tentativeSales = reservations.filter(isHoldReservation).reduce((sum, reservation) => sum + (reservation.amount ?? 0), 0);
  return (
    <DashboardPanel title="本日のサマリー" icon={<BarChart3 size={16} />} action={<span className="text-xs font-bold text-slate-400">更新: 現在</span>}>
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-1.5">
        <SummaryTile label="確定売上" value={formatYen(confirmedSales)} caption="確定のみ" />
        <SummaryTile label="仮予約見込み" value={formatYen(tentativeSales)} caption={`${reservations.length}件中 ${reservations.filter(isHoldReservation).length}件`} danger={urgentActionCount > 0} />
        <SummaryTile label="空き" value={`${availableRooms}室`} caption="ルーム" />
        <SummaryTile label="出勤" value={`${onDuty}名`} caption="予定含む" />
      </div>
    </DashboardPanel>
  );
}

function SummaryTile({ label, value, caption, danger }: { label: string; value: string; caption: string; danger?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border p-1.5 ${danger ? "border-red-200 bg-red-50" : "border-[#e2eaf1] bg-[#f8fbfc]"}`}>
      <div className="truncate text-[10px] font-black text-slate-500">{label}</div>
      <div className={`truncate text-sm font-black ${danger ? "text-red-700" : "text-[#008b83]"}`}>{value}</div>
      <div className="truncate text-[9px] font-bold text-slate-500">{caption}</div>
    </div>
  );
}

function SalesTrendPanel({ reservations }: { reservations: ReservationItem[] }) {
  const confirmedSales = reservations.filter(isConfirmedReservation).reduce((sum, reservation) => sum + (reservation.amount ?? 0), 0);
  const tentativeSales = reservations.filter(isHoldReservation).reduce((sum, reservation) => sum + (reservation.amount ?? 0), 0);
  const totalPotential = Math.max(1, confirmedSales + tentativeSales);
  const confirmedPercent = Math.round((confirmedSales / totalPotential) * 100);
  const tentativePercent = Math.round((tentativeSales / totalPotential) * 100);

  return (
    <DashboardPanel title="売上ステータス" icon={<BarChart3 size={16} />} action={<span className="rounded-md border border-[#dfe7ee] px-2 py-1 text-xs font-black">本日</span>}>
      <div className="grid h-full grid-cols-[120px_1fr] gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-500">確定売上</div>
          <div className="mt-1 truncate text-lg font-black text-[#008b83] xl:text-xl">{formatYen(confirmedSales)}</div>
          <div className="mt-2 text-xs font-bold text-slate-500">見込み</div>
          <div className="truncate text-sm font-black text-amber-700">{formatYen(tentativeSales)}</div>
        </div>
        <div className="flex min-h-0 flex-col justify-center gap-3 rounded-lg bg-[#f8fbfc] p-3">
          <ProgressRow label="確定" value={confirmedPercent} tone="green" />
          <ProgressRow label="仮予約" value={tentativePercent} tone="amber" />
          <p className="text-[10px] font-bold text-slate-500">仮予約は売上に含めず、見込みとして分離表示します。</p>
        </div>
      </div>
    </DashboardPanel>
  );
}

function SalesMixPanel({ reservations }: { reservations: ReservationItem[] }) {
  const rows = courseMixRows(reservations);
  return (
    <DashboardPanel title="売上構成" icon={<BarChart3 size={16} />}>
      <div className="h-full min-h-0 space-y-2 overflow-hidden">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0">{row.percent}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#008b83]" style={{ width: `${row.percent}%` }} />
            </div>
          </div>
        ))}
        {rows.length === 0 ? <Empty text="本日の売上構成はまだありません。" /> : null}
      </div>
    </DashboardPanel>
  );
}

function ProgressRow({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" }) {
  const color = tone === "green" ? "bg-[#008b83]" : "bg-amber-500";
  return (
    <div>
      <div className="flex justify-between text-xs font-black text-slate-600"><span>{label}</span><span>{value}%</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function TherapistCompactPanel({ therapists }: { therapists: TherapistItem[] }) {
  return (
    <DashboardPanel title="セラピスト稼働状況" icon={<UsersRound size={16} />} action={<Link href="/therapist" className="text-xs font-black text-[#008b83]">一覧へ</Link>}>
      <div className="grid h-full grid-rows-[24px_minmax(0,1fr)] gap-1">
        <div className="grid grid-cols-[1fr_68px_42px_52px] rounded bg-[#f7fafc] px-2 text-[10px] font-black text-slate-500">
          <span className="truncate">担当</span><span className="truncate">出勤</span><span>予約</span><span>状態</span>
        </div>
        <div className="min-h-0 space-y-1 overflow-hidden">
          {therapists.slice(0, 4).map((therapist) => (
            <div key={therapist.id} className="grid h-8 grid-cols-[1fr_68px_42px_52px] items-center rounded border border-[#edf2f6] px-2 text-xs font-bold">
              <span className="truncate">{therapist.name}</span>
              <span className="truncate">{therapist.shift}</span>
              <span>{therapist.bookings ?? 0}件</span>
              <Pill text={therapist.status ?? "未確認"} tone={therapist.status === "出勤中" ? "green" : "gray"} />
            </div>
          ))}
          {therapists.length === 0 ? <Empty text="セラピスト情報が未登録です。" /> : null}
        </div>
      </div>
    </DashboardPanel>
  );
}

function OperationalEvidencePanel({
  actionNotifications,
  reviewCallLogs,
  notificationLogs,
  auditLogs,
  onSend,
  busyId
}: {
  actionNotifications: NotificationItem[];
  reviewCallLogs: CallLogItem[];
  notificationLogs: NotificationLogItem[];
  auditLogs: AuditLogItem[];
  onSend: (notificationId?: string, reservationId?: string) => Promise<void>;
  busyId: string | null;
}) {
  const approvalLogs = auditLogs.filter(isApprovalAuditLog).slice(0, 2);
  const visibleReviewCallLogs = reviewCallLogs.slice(0, 2);
  const visibleNotificationLogs = notificationLogs.slice(0, Math.max(0, 3 - approvalLogs.length - visibleReviewCallLogs.length));
  const visibleActionNotifications = actionNotifications.slice(0, 2);
  const empty = visibleActionNotifications.length === 0 && visibleReviewCallLogs.length === 0 && visibleNotificationLogs.length === 0 && approvalLogs.length === 0;

  return (
    <DashboardPanel
      title="取りこぼし監視"
      icon={<ClipboardList size={16} />}
      action={<div className="flex gap-2 text-xs font-black"><Link href="/notification-logs" className="text-[#008b83]">通知</Link><Link href="/ops" className="text-[#008b83]">監査</Link></div>}
    >
      <div className="h-full min-h-0 space-y-1 overflow-hidden">
        {visibleReviewCallLogs.map((callLog) => (
          <Link key={callLog.id} href="/phone-ai#call-logs" className="grid h-9 grid-cols-[42px_1fr_auto] items-center gap-2 rounded border border-red-100 bg-red-50 px-2 text-xs">
            <span className="font-black text-red-700">{callLog.time}</span>
            <span className="min-w-0">
              <span className="block truncate font-black">電話AI要確認</span>
              <span className="block truncate text-[10px] font-bold text-red-700">{callLog.phoneNumber ?? "番号なし"} / {callLog.summary || callLog.reviewNotes || "予約未作成の可能性"}</span>
            </span>
            <Pill text="確認" tone="red" />
          </Link>
        ))}
        {visibleActionNotifications.map((notification) => (
          <div key={notification.id} className="grid h-9 grid-cols-[42px_1fr_auto] items-center gap-2 rounded border border-[#edf2f6] px-2 text-xs">
            <span className="font-black text-slate-500">{notification.time}</span>
            <span className="truncate font-bold">{notification.typeText ?? notification.type}</span>
            {notification.status === "FAILED" ? (
              <button disabled={busyId === notification.id} onClick={() => void onSend(notification.id)} className="rounded bg-red-50 px-2 py-1 text-[10px] font-black text-red-700">再送</button>
            ) : (
              <Pill text={notification.statusText ?? notification.status ?? "未確認"} tone={notification.status === "PENDING" ? "amber" : "green"} />
            )}
          </div>
        ))}
        {approvalLogs.map((log) => (
          <div key={log.id} className="grid h-9 grid-cols-[42px_1fr_auto] items-center gap-2 rounded border border-emerald-100 bg-emerald-50 px-2 text-xs">
            <span className="font-black text-emerald-700">{log.time}</span>
            <span className="min-w-0">
              <span className="block truncate font-black">{log.actionText ?? log.action}</span>
              <span className="block truncate text-[10px] font-bold text-emerald-700">{auditReservationLabel(log)}</span>
            </span>
            <Pill text={auditActorLabel(log.actorType)} tone="green" />
          </div>
        ))}
        {visibleNotificationLogs.map((log) => (
          <div key={log.id} className="grid h-9 grid-cols-[42px_1fr_auto] items-center gap-2 rounded border border-[#edf2f6] px-2 text-xs">
            <span className="font-black text-slate-500">{log.time}</span>
            <span className="min-w-0">
              <span className="block truncate font-black">{log.typeText ?? log.type}</span>
              <span className="block truncate text-[10px] font-bold text-slate-500">{log.recipientName ?? log.recipientPhone ?? log.channelText ?? "-"}</span>
            </span>
            <Pill text={log.statusText ?? log.status ?? "未確認"} tone={notificationLogTone(log.status)} />
          </div>
        ))}
        {empty ? <Empty text="承認・通知証跡はまだありません。" /> : null}
      </div>
    </DashboardPanel>
  );
}

function CommandGuardPanel({ items }: { items: ReadinessItem[] }) {
  const blocked = items.filter((item) => item.state === "block").length;
  const warnings = items.filter((item) => item.state === "warn").length;
  const statusText = blocked > 0 ? "提出不可" : warnings > 0 ? "要確認" : "運用可";
  const statusTone: "red" | "amber" | "green" = blocked > 0 ? "red" : warnings > 0 ? "amber" : "green";
  const actions = quickActions();

  return (
    <DashboardPanel
      title="提出ガード"
      icon={<ShieldCheck size={16} />}
      action={<Pill text={statusText} tone={statusTone} />}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_44px] gap-2">
        <div className="min-h-0 space-y-1 overflow-hidden">
          {items.slice(0, 7).map((item) => (
            <CommandGuardRow key={item.label} item={item} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {actions.slice(0, 4).map((action) => (
            <Link key={`${action.href}-${action.label}`} href={action.href} className="grid min-h-0 place-items-center rounded-lg border border-[#e2eaf1] bg-[#f8fbfc] p-1 text-center text-[9px] font-black leading-tight text-slate-700">
              <span className="text-[#082033]">{action.icon}</span>
              <span className="truncate">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}

function CommandGuardRow({ item }: { item: ReadinessItem }) {
  const className = `grid h-6 grid-cols-[16px_68px_minmax(0,1fr)_34px] items-center gap-1.5 rounded border border-[#edf2f6] px-2 text-[11px] transition ${item.href ? "hover:border-[#008b83] hover:bg-[#f4fbfa]" : ""}`;
  const content = (
    <>
      <span className={readinessIconClass(item.state)}>{item.state === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span>
      <span className="truncate font-black">{item.label}</span>
      <span className="truncate font-bold text-slate-500">{item.detail}</span>
      <span className="truncate text-right text-[10px] font-black text-[#008b83]">{item.actionLabel ?? ""}</span>
    </>
  );

  if (item.href) {
    return <Link href={item.href} className={className} title={`${item.label}: ${item.detail}`}>{content}</Link>;
  }

  return <div className={className}>{content}</div>;
}

function quickActions() {
  const actions = [
    { href: "/reservations", label: "予約作成", icon: <CalendarPlus size={19} /> },
    { href: "/customer", label: "顧客", icon: <UserCircle size={19} /> },
    { href: "/therapist", label: "担当", icon: <UsersRound size={19} /> },
    { href: "/setup", label: "コース", icon: <ClipboardList size={19} /> },
    { href: "/setup", label: "部屋", icon: <DoorOpen size={19} /> },
    { href: "/phone-ai", label: "電話", icon: <Phone size={19} /> },
    { href: "/platform", label: "判定", icon: <ShieldCheck size={19} /> },
    { href: "/ops", label: "運用", icon: <BarChart3 size={19} /> }
  ];

  return actions;
}

function ConversationRail({ conversations, unresolved }: { conversations: ConversationItem[]; unresolved: number }) {
  const [activeTab, setActiveTab] = useState<ConversationTab>("LINE");
  const tabs: Array<{ key: ConversationTab; label: string }> = [
    { key: "LINE", label: "LINE" },
    { key: "PHONE", label: "電話" },
    { key: "WEB_CHAT", label: "Web" }
  ];
  const filteredConversations = conversations.filter((conversation) => conversationMatchesTab(conversation, activeTab));

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[#dbe5ec] bg-white shadow-sm">
      <div className="border-b border-[#edf2f6] p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black">AI受付・会話ログ</h2>
          <span className={`text-sm font-black ${unresolved > 0 ? "text-amber-700" : "text-emerald-700"}`}>未対応 {unresolved}件</span>
        </div>
        <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border border-[#dfe8ef] text-center text-xs font-black">
          {tabs.map((tab, index) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`${index ? "border-l border-[#dfe8ef]" : ""} px-2 py-2 transition ${active ? "bg-[#008b83] text-white" : "bg-[#f8fbfc] text-slate-600 hover:bg-[#eef8f6] hover:text-[#008b83]"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-3">
        {filteredConversations.slice(0, 6).map((conversation) => (
          <div key={conversation.id} className="rounded-lg border border-[#e2eaf1] bg-[#f8fbfc] p-3">
            <div className="flex justify-between gap-2 text-xs font-black text-slate-500">
              <span>{conversation.channel}</span>
              <span>{conversation.time}</span>
            </div>
            <div className="mt-1 truncate text-sm font-black">{conversation.name}</div>
            <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-600">{conversation.body}</p>
          </div>
        ))}
        {filteredConversations.length === 0 ? <Empty text={`${tabs.find((tab) => tab.key === activeTab)?.label ?? "AI受付"}ログはまだありません。`} /> : null}
      </div>
    </section>
  );
}

function conversationMatchesTab(conversation: ConversationItem, tab: ConversationTab) {
  const rawChannel = String(conversation.rawChannel ?? "").toUpperCase();
  const channelLabel = String(conversation.channel ?? "");
  if (tab === "LINE") return rawChannel === "LINE" || channelLabel.includes("LINE");
  if (tab === "PHONE") return rawChannel === "PHONE" || channelLabel.includes("電話") || channelLabel.includes("SMS");
  return rawChannel === "WEB_CHAT" || rawChannel === "WEB" || /web|チャット/i.test(channelLabel);
}

function conversationDetailHref(conversation: ConversationItem) {
  const rawChannel = String(conversation.rawChannel ?? "").toUpperCase();
  const channelLabel = String(conversation.channel ?? "");
  if (rawChannel === "PHONE" || channelLabel.includes("電話") || channelLabel.includes("SMS")) return "/phone-ai#call-logs";
  if (rawChannel === "LINE" || channelLabel.includes("LINE")) return "/notification-logs";
  return "/chat";
}

function MobileTopbar({ loading, storeName, onReload }: { loading: boolean; storeName: string; onReload: () => void }) {
  return (
    <header className="flex items-center justify-between rounded-lg border border-[#dbe5ec] bg-white px-3 shadow-sm">
      <div className="min-w-0">
        <div className="truncate text-sm font-black tracking-wide">ARARE <span className="text-[#008b83]">AI</span></div>
        <div className="truncate text-lg font-black">ダッシュボード</div>
        <div className="truncate text-[11px] font-bold text-slate-500">{storeName}</div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/reservations" className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#008b83] px-3 text-xs font-black text-white">
          <CalendarPlus size={15} />
          予約作成
        </Link>
        <button onClick={onReload} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dfe7ee] bg-white">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
        <button onClick={() => void signOutFromClerk()} className="grid h-9 w-9 place-items-center rounded-lg bg-[#082033] text-white">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

function MobileMetricStrip({
  urgentActionCount,
  aiActionCount,
  notificationActionCount,
  callLogActionCount,
  reservationActionCount,
  reservations,
  availableRooms,
  onDuty
}: {
  urgentActionCount: number;
  aiActionCount: number;
  notificationActionCount: number;
  callLogActionCount: number;
  reservationActionCount: number;
  reservations: number;
  availableRooms: number;
  onDuty: number;
}) {
  const urgentHref = callLogActionCount > 0 ? "/phone-ai#call-logs" : notificationActionCount > 0 ? "/notification-logs" : reservationActionCount > 0 ? "/reservations" : "/store-v2";

  return (
    <section className="grid min-h-0 grid-cols-4 gap-2">
      <MobileMetric label="要対応" value={urgentActionCount} caption={`AI ${aiActionCount} / 仮予約 ${reservationActionCount}`} danger={urgentActionCount > 0} href={urgentHref} />
      <MobileMetric label="予約" value={reservations} href="/reservations" />
      <MobileMetric label="空室" value={availableRooms} href="/reservations" />
      <MobileMetric label="出勤" value={onDuty} href="/therapist" />
    </section>
  );
}

function MobileMetric({ label, value, caption, danger, href }: { label: string; value: number; caption?: string; danger?: boolean; href?: string }) {
  const className = `block rounded-lg border p-2 text-left transition active:scale-[0.99] ${danger ? "border-red-200 bg-red-50" : "border-[#dbe5ec] bg-white"}`;
  const content = (
    <>
      <div className="text-[11px] font-black text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-black leading-none ${danger ? "text-red-700" : "text-slate-950"}`}>{value}</div>
      {caption ? <div className={`mt-1 truncate text-[9px] font-black ${danger ? "text-red-700" : "text-slate-500"}`}>{caption}</div> : null}
    </>
  );

  if (href) {
    return <Link href={href} className={className}>{content}</Link>;
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

function MobileDashboardBody({ reservations, conversations, notifications, reviewCallLogs, therapists, rooms, onApprove, onCancel, onNotify, busyId }: { reservations: ReservationItem[]; conversations: ConversationItem[]; notifications: NotificationItem[]; reviewCallLogs: CallLogItem[]; therapists: TherapistItem[]; rooms: RoomItem[]; onApprove: (id: string) => Promise<void>; onCancel: (id: string) => Promise<void>; onNotify: (notificationId?: string, reservationId?: string) => Promise<void>; busyId: string | null }) {
  const visibleReviewCallLogs = reviewCallLogs.slice(0, 3);
  const remainingCallLogActions = Math.max(0, reviewCallLogs.length - visibleReviewCallLogs.length);

  return (
    <section className="grid min-h-0 grid-rows-[0.86fr_1.06fr_0.76fr] gap-2 overflow-hidden">
      <MobilePanel title="本日の予約" action={`${reservations.length}件`}>
        <div className="h-full min-h-0 space-y-1 overflow-y-auto pr-1">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="rounded-lg border border-[#edf2f6] bg-[#f8fbfc] p-2">
              <Link href="/reservations" className="block">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-black">{reservation.time} {reservation.customer ?? "顧客名なし"}</div>
                  <Pill text={reservation.status ?? reservation.rawStatus ?? "未確認"} tone={reservationPillTone(reservation)} />
                </div>
                <div className="mt-1 truncate text-xs font-bold text-slate-500">{reservation.course ?? "未設定"} / {reservation.room ?? "未割当"}</div>
                <div className="mt-1 text-[10px] font-black text-[#008b83]">タップして予約確認</div>
              </Link>
              <ReservationSmsIssueNotice reservation={reservation} compact />
              {holdStatuses.has(reservation.rawStatus ?? "") || holdStatuses.has(reservation.status ?? "") ? (
                <div className="mt-1 flex gap-1">
                  <button disabled={busyId === reservation.id} onClick={() => void onApprove(reservation.id)} className="rounded bg-[#008b83] px-2 py-1 text-[11px] font-black text-white">確定する</button>
                  <button disabled={busyId === reservation.id} onClick={() => void onNotify(undefined, reservation.id)} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-black">通知</button>
                  <button disabled={busyId === reservation.id} onClick={() => void onCancel(reservation.id)} className="rounded bg-red-50 px-2 py-1 text-[11px] font-black text-red-700">取消</button>
                </div>
              ) : null}
            </div>
          ))}
          {reservations.length === 0 ? <Empty text="本日の予約はありません。" /> : null}
        </div>
      </MobilePanel>

      <MobilePanel title="AI受付・会話ログ" action={`AI未対応 電話${reviewCallLogs.length} / 通知${notifications.length}`}>
        <div className="h-full min-h-0 space-y-1 overflow-y-auto pr-1">
          {notifications.length > 0 ? (
            <Link href="/notification-logs" className="block rounded-lg border border-amber-100 bg-amber-50 p-2">
              <div className="flex justify-between gap-2 text-[11px] font-black text-amber-700"><span>通知要確認</span><span>{notifications.length}件</span></div>
              <p className="line-clamp-1 text-xs font-bold text-amber-700">未送信・失敗通知があります。タップして通知履歴へ移動</p>
            </Link>
          ) : null}
          {visibleReviewCallLogs.map((callLog) => (
            <Link key={callLog.id} href="/phone-ai#call-logs" className="block rounded-lg border border-red-100 bg-red-50 p-2">
              <div className="flex justify-between gap-2 text-[11px] font-black text-red-700"><span>電話AI要確認</span><span>{callLog.time}</span></div>
              <div className="truncate text-sm font-black">{callLog.phoneNumber ?? "番号なし"}</div>
              <p className="line-clamp-1 text-xs font-bold text-red-700">{callLog.summary || callLog.reviewNotes || "予約未作成の可能性があります"}</p>
              <div className="mt-1 text-[10px] font-black text-red-700">タップして通話ログ確認</div>
            </Link>
          ))}
          {remainingCallLogActions > 0 ? (
            <Link href={reviewCallLogs.length > visibleReviewCallLogs.length ? "/phone-ai#call-logs" : "/notification-logs"} className="block rounded-lg border border-red-100 bg-red-50 p-2 text-xs font-black text-red-700">
              ほか {remainingCallLogActions}件の電話AI未対応があります。タップして一覧確認
            </Link>
          ) : null}
          {conversations.slice(0, 4).map((conversation) => (
            <Link key={conversation.id} href={conversationDetailHref(conversation)} className="block rounded-lg border border-[#edf2f6] bg-[#f8fbfc] p-2">
              <div className="flex justify-between gap-2 text-[11px] font-black text-slate-500"><span>{conversation.channel}</span><span>{conversation.time}</span></div>
              <div className="truncate text-sm font-black">{conversation.name}</div>
              <p className="line-clamp-1 text-xs font-bold text-slate-600">{conversation.body}</p>
              <div className="mt-1 text-[10px] font-black text-[#008b83]">タップして詳細確認</div>
            </Link>
          ))}
          {conversations.length === 0 ? <Empty text="AI受付ログはまだありません。" /> : null}
        </div>
      </MobilePanel>

      <div className="grid min-h-0 grid-cols-2 gap-2 overflow-hidden">
        <MobilePanel title="ルーム" action={`${rooms.length}室`}>
          <div className="h-full min-h-0 space-y-1 overflow-y-auto pr-1">
            {rooms.slice(0, 3).map((room) => <RoomMini key={room.id} room={room} />)}
          </div>
        </MobilePanel>
        <MobilePanel title="出勤" action={`${therapists.length}名`}>
          <div className="h-full min-h-0 space-y-1 overflow-y-auto pr-1">
            {therapists.slice(0, 3).map((therapist) => (
              <Link key={therapist.id} href="/therapist" className="block rounded-lg border border-[#edf2f6] bg-[#f8fbfc] p-2">
                <div className="truncate text-xs font-black">{therapist.name}</div>
                <div className="truncate text-[11px] font-bold text-slate-500">{therapist.shift}</div>
              </Link>
            ))}
          </div>
        </MobilePanel>
      </div>
    </section>
  );
}

function MobilePanel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="min-h-0 overflow-hidden rounded-lg border border-[#dbe5ec] bg-white shadow-sm">
      <div className="flex h-9 items-center justify-between border-b border-[#edf2f6] px-3">
        <h2 className="truncate text-sm font-black">{title}</h2>
        {action ? <span className="text-xs font-black text-[#008b83]">{action}</span> : null}
      </div>
      <div className="h-[calc(100%-2.25rem)] min-h-0 overflow-hidden p-2">{children}</div>
    </section>
  );
}

function RoomMini({ room }: { room: RoomItem }) {
  const busy = room.state !== "空き";
  return (
    <Link href="/reservations" className={`block rounded-lg border p-2 ${busy ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <div className="truncate text-xs font-black">{room.name}</div>
      <div className="truncate text-[11px] font-bold text-slate-500">{room.state ?? "未確認"}{room.until ? ` / ${room.until}まで` : ""}</div>
    </Link>
  );
}

function MobileBottomNav() {
  const items = [
    { href: "/", label: "ホーム", icon: <Home size={17} /> },
    { href: "/store-v2", label: "店舗", icon: <Home size={17} />, active: true },
    { href: "/phone-ai#call-logs", label: "電話", icon: <Phone size={17} /> },
    { href: "/notification-logs", label: "通知", icon: <Bell size={17} /> },
    { href: "/reservations", label: "予約", icon: <CalendarCheck size={17} /> }
  ];
  return (
    <nav className="grid min-h-0 grid-cols-5 gap-1 rounded-lg border border-[#dbe5ec] bg-white p-1 shadow-sm">
      {items.map((item) => (
        <Link key={`mobile-home-${item.href}`} href={item.href} className={`grid place-items-center rounded-md px-1 py-1 text-[10px] font-black ${item.active ? "bg-[#008b83] text-white" : "bg-[#f8fbfc] text-slate-700"}`}>
          {item.icon}
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

async function signOutFromClerk() {
  const clerk = (window as Window & { Clerk?: { signOut?: (options?: { redirectUrl?: string }) => Promise<void> } }).Clerk;
  if (clerk?.signOut) {
    await clerk.signOut({ redirectUrl: "/sign-in" });
    return;
  }
  window.location.href = "/sign-in";
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: "red" | "blue" | "green" | "white" }) {
  const color = tone === "red" ? "border-red-200 bg-red-50 text-red-600" : tone === "blue" ? "border-sky-200 bg-sky-50 text-sky-700" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[#dce5ec] bg-white text-slate-700";
  return <article className={`arare-metric rounded-[26px] border p-5 shadow-sm ${color}`}><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-full bg-white/80">{icon}</div><div><div className="text-sm font-black">{label}</div><div className="mt-1 text-4xl font-black text-slate-950">{value}</div><div className="text-sm font-bold text-slate-500">{detail}</div></div></div></article>;
}

function Panel({ id, title, badge, icon, action, tone = "white", children }: { id?: string; title: string; badge?: number; icon?: React.ReactNode; action?: React.ReactNode; tone?: "white" | "red"; children: React.ReactNode }) {
  return <section id={id} className={`arare-panel scroll-mt-5 rounded-[28px] border bg-white p-4 shadow-sm md:p-5 ${tone === "red" ? "border-red-200" : "border-[#d8e1e8]"}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-black">{icon}{title}{badge ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-sm text-white">{badge}</span> : null}</h2>{action}</div>{children}</section>;
}

function ReservationCalendarPanel({ reservations, rooms }: { reservations: ReservationItem[]; rooms: RoomItem[] }) {
  const roomNames = calendarRoomNames(reservations, rooms);
  const slots = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

  return (
    <section className="rounded-[28px] border border-[#d8e1e8] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black"><CalendarClock size={18} />予約カレンダー</h2>
        <Pill text={new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date())} />
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[680px] overflow-hidden rounded-2xl border border-[#dfe8ef]" style={{ gridTemplateColumns: `72px repeat(${roomNames.length}, minmax(116px, 1fr))` }}>
          <div className="bg-[#f7fafc] px-2 py-2 text-xs font-black text-slate-500">時間</div>
          {roomNames.map((room) => (
            <div key={room} className="border-l border-[#dfe8ef] bg-[#f7fafc] px-2 py-2 text-center text-xs font-black text-slate-700">{room}</div>
          ))}
          {slots.map((slot) => (
            <CalendarRow key={slot} slot={slot} rooms={roomNames} reservations={reservations} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill text="確定" tone="green" />
        <Pill text="仮予約" tone="amber" />
        <Pill text="キャンセル" tone="red" />
      </div>
    </section>
  );
}

function CalendarRow({ slot, rooms, reservations }: { slot: string; rooms: string[]; reservations: ReservationItem[] }) {
  return (
    <>
      <div className="min-h-[48px] border-t border-[#dfe8ef] bg-white px-2 py-2 text-xs font-black text-slate-500">{slot}</div>
      {rooms.map((room) => {
        const items = reservations.filter((reservation) => reservation.room === room && reservationHour(reservation) === Number(slot.slice(0, 2)));
        return (
          <div key={`${slot}-${room}`} className="min-h-[48px] border-l border-t border-[#dfe8ef] bg-white p-1.5">
            {items.slice(0, 2).map((reservation) => (
              <div key={reservation.id} className={`mb-1 rounded-lg border px-2 py-1 text-[11px] font-black leading-4 ${reservationCalendarClass(reservation)}`}>
                <div>{reservation.time ?? slot} - {reservation.end ?? ""}</div>
                <div className="truncate">{reservation.customer ?? "顧客名なし"}</div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function TodayReservationPanel({ reservations }: { reservations: ReservationItem[] }) {
  const confirmed = reservations.filter((reservation) => confirmedStatuses.has(reservation.rawStatus ?? "") || confirmedStatuses.has(reservation.status ?? ""));
  const tentative = reservations.filter((reservation) => holdStatuses.has(reservation.rawStatus ?? "") || holdStatuses.has(reservation.status ?? ""));
  const cancelled = reservations.filter((reservation) => reservation.rawStatus === "CANCELLED" || reservation.status === "キャンセル");

  return (
    <section className="rounded-[28px] border border-[#d8e1e8] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black"><CalendarCheck size={18} />本日の予約</h2>
        <Pill text={`${reservations.length}件`} tone="green" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="確定" value={confirmed.length} tone="green" />
        <MiniStat label="仮予約" value={tentative.length} tone="amber" />
        <MiniStat label="取消" value={cancelled.length} tone="red" />
      </div>
      <div className="mt-4 space-y-2">
        {reservations.slice(0, 8).map((reservation) => (
          <div key={reservation.id} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black">{reservation.time} {reservation.customer ?? "顧客名なし"}</div>
              <Pill text={reservation.status ?? reservation.rawStatus ?? "未確認"} tone={reservationPillTone(reservation)} />
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500">{reservation.course ?? "コース未設定"} / {reservation.therapist ?? "未割当"} / {reservation.room ?? "未割当"}</p>
            <ReservationSmsIssueNotice reservation={reservation} compact />
          </div>
        ))}
        {reservations.length === 0 ? <Empty text="本日の予約はありません。" /> : null}
      </div>
    </section>
  );
}

function AiReceptionPanel({ conversations, notifications }: { conversations: ConversationItem[]; notifications: NotificationItem[] }) {
  const unresolved = notifications.filter((notification) => notification.status === "PENDING" || notification.status === "FAILED").length;

  return (
    <section className="rounded-[28px] border border-[#d8e1e8] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black"><MessageCircle size={18} />AI受付・会話ログ</h2>
        <Pill text={`未対応 ${unresolved}件`} tone={unresolved ? "amber" : "green"} />
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-[#dfe8ef] text-center text-xs font-black">
        <div className="bg-[#008b83] px-2 py-2 text-white">LINE</div>
        <div className="border-l border-[#dfe8ef] bg-[#f8fbfc] px-2 py-2 text-slate-600">電話</div>
        <div className="border-l border-[#dfe8ef] bg-[#f8fbfc] px-2 py-2 text-slate-600">Web</div>
      </div>
      <div className="mt-4 space-y-2">
        {conversations.slice(0, 6).map((conversation) => (
          <div key={conversation.id} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3">
            <div className="flex justify-between gap-2 text-xs font-black text-slate-500">
              <span>{conversation.channel}</span>
              <span>{conversation.time}</span>
            </div>
            <div className="mt-1 text-sm font-black">{conversation.name}</div>
            <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-600">{conversation.body}</p>
          </div>
        ))}
        {conversations.length === 0 ? <Empty text="AI受付ログはまだありません。" /> : null}
      </div>
    </section>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" }) {
  const className = tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700";
  return <div className={`rounded-2xl border p-3 text-center ${className}`}><p className="text-xs font-black">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>;
}

function QuickActionPanel() {
  const actions = [
    { href: "/reservations", label: "予約作成", icon: <CalendarPlus size={22} /> },
    { href: "/customer", label: "顧客検索", icon: <UsersRound size={22} /> },
    { href: "/therapist", label: "セラピスト", icon: <UserIcon /> },
    { href: "/setup", label: "コース管理", icon: <ClipboardList size={22} /> },
    { href: "/phone-ai", label: "電話AI", icon: <Phone size={22} /> },
    { href: "/permissions", label: "権限管理", icon: <ShieldCheck size={22} /> },
    { href: "/platform", label: "提出判定", icon: <BarChart3 size={22} /> },
    { href: "/setup", label: "店舗設定", icon: <Settings size={22} /> }
  ];

  return (
    <section className="rounded-[28px] border border-[#d8e1e8] bg-white p-4 shadow-sm md:p-5">
      <h2 className="text-xl font-black">クイックアクション</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {actions.map((action) => (
          <Link key={`${action.href}-${action.label}`} href={action.href} className="grid min-h-[84px] place-items-center rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3 text-center text-xs font-black text-slate-700 transition hover:border-[#008b83] hover:bg-[#effdf9]">
            <span className="text-[#082033]">{action.icon}</span>
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function UserIcon() {
  return <UsersRound size={22} />;
}

function calendarRoomNames(reservations: ReservationItem[], rooms: RoomItem[]) {
  const names = rooms.map((room) => room.name).filter((name): name is string => Boolean(name));
  const fallback = reservations.map((reservation) => reservation.room).filter((name): name is string => Boolean(name && name !== "未割当"));
  const unique = Array.from(new Set([...names, ...fallback]));
  return unique.length ? unique.slice(0, 4) : ["ルームA", "ルームB", "ルームC", "ルームD"];
}

function calendarSlots(reservations: ReservationItem[]) {
  const defaults = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
  const reservationSlots = reservations.map(reservationSlotLabel).filter((slot): slot is string => Boolean(slot));
  return Array.from(new Set([...defaults, ...reservationSlots])).sort((left, right) => timeValue(left) - timeValue(right));
}

function reservationSlotLabel(reservation: ReservationItem) {
  if (reservation.startsAt) {
    const date = new Date(reservation.startsAt);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    }
  }

  const match = reservation.time?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function timeValue(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function reservationHour(reservation: ReservationItem) {
  if (reservation.startsAt) {
    const date = new Date(reservation.startsAt);
    if (!Number.isNaN(date.getTime())) {
      return Number(new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(date));
    }
  }

  const match = reservation.time?.match(/^(\d{1,2}):/);
  return match ? Number(match[1]) : -1;
}

function reservationCalendarClass(reservation: ReservationItem) {
  const status = reservation.rawStatus ?? reservation.status ?? "";
  if (status === "CANCELLED" || status === "キャンセル") return "border-red-200 bg-red-50 text-red-700";
  if (holdStatuses.has(status)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function reservationPillTone(reservation: ReservationItem): "gray" | "green" | "red" | "amber" {
  const status = reservation.rawStatus ?? reservation.status ?? "";
  if (status === "CANCELLED" || status === "キャンセル") return "red";
  if (holdStatuses.has(status)) return "amber";
  if (confirmedStatuses.has(status)) return "green";
  return "gray";
}

function isHoldReservation(reservation: ReservationItem) {
  return holdStatuses.has(reservation.rawStatus ?? "") || holdStatuses.has(reservation.status ?? "");
}

function isConfirmedReservation(reservation: ReservationItem) {
  return confirmedStatuses.has(reservation.rawStatus ?? "") || confirmedStatuses.has(reservation.status ?? "");
}

function isCancelledReservation(reservation: ReservationItem) {
  return reservation.rawStatus === "CANCELLED" || reservation.status === "キャンセル";
}

function reservationApprovalMeta(reservation: ReservationItem) {
  const approval = reservation.approval;
  if (!approval?.holdId) {
    return { label: "holdなし", className: "bg-red-100 text-red-700" };
  }

  if (approval.state === "expired") {
    return { label: "期限切れ", className: "bg-red-100 text-red-700" };
  }

  if (approval.state === "warning") {
    return { label: approval.minutesLeft !== null && approval.minutesLeft !== undefined ? `残り${Math.max(0, approval.minutesLeft)}分` : "期限注意", className: "bg-amber-100 text-amber-700" };
  }

  if (approval.minutesLeft !== null && approval.minutesLeft !== undefined) {
    return { label: `残り${Math.max(0, approval.minutesLeft)}分`, className: "bg-emerald-100 text-emerald-700" };
  }

  return { label: formatApprovalDeadline(approval.expiresAt), className: "bg-slate-100 text-slate-600" };
}

function reservationNotificationMeta(reservation: ReservationItem) {
  const approval = reservation.approval;
  if (!approval?.notificationId) {
    return {
      label: "通知未作成",
      actionLabel: "通知",
      buttonClassName: "border-amber-200 bg-amber-50 text-amber-700"
    };
  }

  const smsIssue = reservationSmsIssue(reservation);
  if (smsIssue) {
    return {
      label: smsIssue.title,
      actionLabel: "再送",
      buttonClassName: "border-red-200 bg-red-50 text-red-700"
    };
  }

  if (approval.notificationStatus === "FAILED") {
    return {
      label: approval.smsErrorCode ? `失敗 ${approval.smsErrorCode}` : "通知失敗",
      actionLabel: "再送",
      buttonClassName: "border-red-200 bg-red-50 text-red-700"
    };
  }

  if (approval.notificationStatus === "PENDING") {
    return {
      label: "通知待ち",
      actionLabel: "送信",
      buttonClassName: "border-amber-200 bg-amber-50 text-amber-700"
    };
  }

  if (approval.notificationStatus === "SENT") {
    const delivery = approval.smsDeliveryStatus ? ` / ${approvalSmsDeliveryLabel(approval.smsDeliveryStatus)}` : "";
    return {
      label: `通知済み${delivery}`,
      actionLabel: null,
      buttonClassName: "border-slate-200 bg-white text-slate-600"
    };
  }

  return {
    label: approval.notificationStatusText ?? "通知未確認",
    actionLabel: "通知",
    buttonClassName: "border-slate-200 bg-white text-slate-600"
  };
}

function reservationSmsIssue(reservation: ReservationItem) {
  const approval = reservation.approval;
  if (!approval?.notificationId) return null;

  const deliveryStatus = approval.smsDeliveryStatus ?? "";
  const failed =
    approval.notificationStatus === "FAILED" ||
    deliveryStatus === "undelivered" ||
    deliveryStatus === "failed" ||
    Boolean(approval.smsErrorCode);
  if (!failed) return null;

  const titleBase = deliveryStatus === "undelivered" ? "SMS未到達" : deliveryStatus === "failed" ? "SMS到達失敗" : "通知失敗";
  const code = approval.smsErrorCode ? ` ${approval.smsErrorCode}` : "";
  return {
    title: `${titleBase}${code}`,
    detail: approval.smsErrorMessage || "SMSが届いていない可能性があります。電話またはLINE確認も併用してください。"
  };
}

function approvalSmsDeliveryLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: "受付済み",
    queued: "待機中",
    sending: "送信中",
    sent: "送信済み",
    delivered: "到達",
    undelivered: "未到達",
    failed: "到達失敗",
    unknown: "未確認"
  };
  return labels[status] ?? status;
}

function ReservationSmsIssueNotice({ reservation, compact = false }: { reservation: ReservationItem; compact?: boolean }) {
  const issue = reservationSmsIssue(reservation);
  if (!issue) return null;

  return (
    <div className={`mt-2 rounded-xl border border-red-200 bg-red-50 ${compact ? "px-2 py-1" : "p-3"} text-red-700`}>
      <div className={compact ? "text-[11px] font-black" : "text-sm font-black"}>{issue.title}</div>
      <div className={compact ? "line-clamp-1 text-[10px] font-bold" : "mt-1 text-xs font-bold"}>{issue.detail}</div>
    </div>
  );
}

function formatApprovalDeadline(value?: string | null) {
  if (!value) return "期限未取得";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限未取得";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function formatYen(value: number) {
  return `¥${value.toLocaleString("ja-JP")}`;
}

function courseMixRows(reservations: ReservationItem[]) {
  const totals = new Map<string, number>();
  for (const reservation of reservations) {
    const label = reservation.course ?? "コース未設定";
    totals.set(label, (totals.get(label) ?? 0) + (reservation.amount ?? 0));
  }

  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  if (!total) return [];

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, value]) => ({
      label,
      percent: Math.round((value / total) * 100)
    }));
}

function buildDashboardReadinessItems(input: {
  databaseConfigured: boolean;
  storeEvidence?: StoreSyncEvidence;
  pendingApprovals: number;
  failedNotifications: number;
  manualReviewNotifications: number;
  unresolvedCallLogs: number;
  conversations: number;
  callLogs: number;
  approvalEvidenceCount: number;
  notificationLogCount: number;
}): ReadinessItem[] {
  const store = input.storeEvidence?.store;
  const phoneSetting = input.storeEvidence?.phoneSetting;
  const hasStoreBasics = Boolean(store?.name && store?.phone && store?.address && store?.openTime && store?.closeTime);
  const hasPhoneRelay = Boolean(phoneSetting?.voiceWebhookUrl && phoneSetting?.voiceRelayWsUrl);
  const hasReceptionEvidence = input.conversations > 0 || input.callLogs > 0;

  return [
    {
      label: "DB",
      detail: input.databaseConfigured ? "接続中" : "接続エラー",
      state: input.databaseConfigured ? "ok" : "block",
      href: "/platform",
      actionLabel: input.databaseConfigured ? "確認" : "確認"
    },
    {
      label: "店舗情報",
      detail: hasStoreBasics ? "基本情報あり" : "店舗名/電話/住所/営業時間を確認",
      state: hasStoreBasics ? "ok" : "block",
      href: "/setup",
      actionLabel: hasStoreBasics ? "確認" : "修正"
    },
    {
      label: "電話AI",
      detail: hasPhoneRelay ? "Webhook/Relay設定あり" : "Webhook/Relay未設定",
      state: hasPhoneRelay ? "ok" : "block",
      href: "/phone-ai",
      actionLabel: hasPhoneRelay ? "確認" : "修正"
    },
    {
      label: "受付ログ",
      detail: input.unresolvedCallLogs > 0 ? `電話AI要確認 ${input.unresolvedCallLogs}件` : hasReceptionEvidence ? "会話/通話履歴あり" : "本番実到達は未確認",
      state: input.unresolvedCallLogs > 0 ? "block" : hasReceptionEvidence ? "ok" : "warn",
      href: "/phone-ai",
      actionLabel: input.unresolvedCallLogs > 0 ? "対応" : "確認"
    },
    {
      label: "通知",
      detail: input.failedNotifications > 0 ? `失敗 ${input.failedNotifications}件` : input.manualReviewNotifications > 0 ? `未対応 ${input.manualReviewNotifications}件` : "要対応なし",
      state: input.failedNotifications > 0 ? "block" : input.manualReviewNotifications > 0 ? "warn" : "ok",
      href: "/notification-logs",
      actionLabel: input.failedNotifications > 0 || input.manualReviewNotifications > 0 ? "対応" : "確認"
    },
    {
      label: "通知証跡",
      detail: input.notificationLogCount > 0 ? `実行ログ ${input.notificationLogCount}件` : "実送信ログ未確認",
      state: input.notificationLogCount > 0 ? "ok" : "warn",
      href: "/notification-logs",
      actionLabel: "確認"
    },
    {
      label: "承認証跡",
      detail: input.approvalEvidenceCount > 0 ? `承認ログ ${input.approvalEvidenceCount}件` : "確定操作未確認",
      state: input.approvalEvidenceCount > 0 ? "ok" : "warn",
      href: "/ops",
      actionLabel: "監査"
    },
    {
      label: "承認待ち",
      detail: input.pendingApprovals > 0 ? `仮予約 ${input.pendingApprovals}件` : "なし",
      state: input.pendingApprovals > 0 ? "warn" : "ok",
      href: "/store-v2",
      actionLabel: input.pendingApprovals > 0 ? "対応" : "確認"
    }
  ];
}

function readinessIconClass(state: ReadinessState) {
  if (state === "ok") return "text-emerald-600";
  if (state === "warn") return "text-amber-600";
  return "text-red-600";
}

function isApprovalAuditLog(item: AuditLogItem) {
  return item.action === "reservation.approval_guard_passed" || item.action === "reservation.approved";
}

function auditReservationLabel(item: AuditLogItem) {
  const reservation = item.reservation;
  if (!reservation) return item.reservationId ? `予約: ${item.reservationId.slice(0, 8)}...` : "予約紐付けなし";
  const customer = reservation.customer?.name ?? "顧客名なし";
  const time = [reservation.date, reservation.time].filter(Boolean).join(" ");
  return `${customer} / ${time || "日時未取得"}`;
}

function auditActorLabel(actorType?: string) {
  const labels: Record<string, string> = {
    ADMIN: "店舗",
    AI: "AI",
    SYSTEM: "自動",
    CUSTOMER: "顧客",
    THERAPIST: "担当"
  };
  return labels[actorType ?? ""] ?? actorType ?? "不明";
}

function notificationLogTone(status?: string): "gray" | "green" | "red" | "amber" {
  if (status === "SENT") return "green";
  if (status === "FAILED") return "red";
  if (status === "PENDING") return "amber";
  return "gray";
}

function ReservationCard({ reservation, busy, onApprove, onCancel, onNotify }: { reservation: ReservationItem; busy: boolean; onApprove: () => void; onCancel: () => void; onNotify: () => void }) {
  const smsIssue = reservationSmsIssue(reservation);

  return (
    <article className="mb-3 overflow-hidden rounded-[24px] border border-[#dce5ec] bg-white">
      <div className="flex items-center justify-between border-b border-[#edf1f4] px-4 py-3">
        <div className="flex gap-2">
          <Pill text={reservation.source ?? reservation.rawSource ?? "予約"} tone="green" />
          <Pill text={smsIssue ? smsIssue.title : reservation.status ?? reservation.rawStatus ?? "未確認"} tone={smsIssue ? "red" : reservationPillTone(reservation)} />
        </div>
        <div className="text-sm font-black text-slate-500">{reservation.date} {reservation.time}</div>
      </div>
      <div className="p-4">
        <h3 className="text-2xl font-black">{reservation.customer ?? "顧客名なし"} 様</h3>
        <p className="mt-1 text-sm font-bold text-slate-500">{reservation.phone ?? "電話番号なし"}</p>
        <ReservationSmsIssueNotice reservation={reservation} />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Info label="時間" value={`${reservation.time ?? "--:--"} - ${reservation.end ?? "--:--"}`} />
          <Info label="コース" value={reservation.course ?? "未設定"} />
          <Info label="担当" value={reservation.therapist ?? "未割当"} />
          <Info label="部屋" value={reservation.room ?? "未割当"} />
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <button disabled={busy} onClick={onApprove} className="min-h-11 rounded-2xl bg-[#008b83] text-sm font-black text-white">確定</button>
          <button disabled={busy} onClick={onNotify} className={`min-h-11 rounded-2xl border text-sm font-black ${smsIssue ? "border-red-200 bg-red-50 text-red-700" : "border-[#d9e1ea]"}`}>{smsIssue ? "SMS再送" : "通知送信"}</button>
          <button disabled={busy} onClick={onCancel} className="min-h-11 rounded-2xl border border-red-200 text-sm font-black text-red-600">キャンセル</button>
        </div>
      </div>
    </article>
  );
}

function NotificationCard({ item, busy, onSend }: { item: NotificationItem; busy: boolean; onSend?: () => void }) {
  const deliveryLabel = smsDeliveryLabel(item);
  const deliveryTone = smsDeliveryTone(item.smsDeliveryStatus);

  return <div className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="flex items-center justify-between gap-2"><div className="font-black">{item.typeText ?? item.type}</div><Pill text={item.statusText ?? item.status ?? "未確認"} tone={item.status === "FAILED" ? "red" : "amber"} /></div><p className="mt-2 line-clamp-3 text-sm font-bold text-slate-600">{item.body}</p>{deliveryLabel ? <div className="mt-2"><Pill text={deliveryLabel} tone={deliveryTone} /></div> : null}<div className="mt-2 text-xs text-slate-500">{item.smsErrorMessage || item.smsSid || item.time}</div>{onSend ? <button disabled={busy} onClick={onSend} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-2xl bg-[#008b83] px-4 text-sm font-black text-white"><Send size={16} />再送</button> : <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">店舗で内容確認</div>}</div>;
}

function RoomRow({ room }: { room: RoomItem }) {
  const busy = room.state !== "空き";
  return <div className={`rounded-2xl border p-3 ${busy ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="flex items-center justify-between"><div className="font-black">{room.name}</div><Pill text={room.state ?? "未確認"} tone={busy ? "amber" : "green"} /></div>{busy ? <div className="mt-1 text-sm font-bold text-slate-600">{room.currentCustomer ?? "顧客不明"} / {room.currentTherapist ?? "担当不明"} / {room.until ?? "終了未定"}まで</div> : null}</div>;
}

function TherapistRow({ therapist }: { therapist: TherapistItem }) {
  return <div className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="flex items-center justify-between"><div className="font-black">{therapist.name}</div><Pill text={therapist.status ?? "未確認"} /></div><div className="mt-1 text-sm font-bold text-slate-600">{therapist.shift ?? "未登録"} / 予約 {therapist.bookings ?? 0}件 / 稼働 {therapist.utilization ?? 0}%</div>{therapist.profile ? <p className="mt-1 text-xs font-bold text-slate-500">{therapist.profile}</p> : null}</div>;
}

function isLegacyNotificationFailure(item: { type?: string | null; body?: string | null; smsErrorCode?: string | null; smsErrorMessage?: string | null; createdAt?: string | null; targetName?: string | null; targetPhone?: string | null; smsTo?: string | null }) {
  const text = [item.type, item.body, item.smsErrorCode, item.smsErrorMessage, item.targetName, item.targetPhone, item.smsTo].filter(Boolean).join(" ");
  const createdAtMs = item.createdAt ? Date.parse(item.createdAt) : null;

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

function needsHumanReviewNotification(item: NotificationItem) {
  return (
    item.status === "PENDING" &&
    (item.rawChannel ?? item.channel) === "LINE" &&
    ["RESERVATION_CHANGED", "RESERVATION_CANCELLED"].includes(item.type ?? "") &&
    !isLegacyNotificationFailure(item) &&
    isWithinOperationalWindow(item, OPERATIONAL_REVIEW_WINDOW_MS)
  );
}

function needsResendNotification(item: NotificationItem, latestSuccessfulNotificationAt: number) {
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

function needsCallReview(item: CallLogItem) {
  const status = item.status ?? "";
  const reviewNotes = item.reviewNotes ?? "";
  if (reviewNotes.includes("[admin-reviewed]") || reviewNotes.includes("管理画面で確認済み") || reviewNotes.includes("邂｡逅・判")) return false;
  if (item.requiredReview) return true;
  if (status === "ESCALATED" || status === "RECEIVED" || status === "TRANSCRIBED") return true;
  if (!item.reservationId && status !== "HOLD_CREATED" && status !== "SUMMARIZED") return true;
  return false;
}

function latestSuccessfulNotificationTimestamp(items: NotificationItem[]) {
  return items.reduce((latest, item) => {
    const deliveryStatus = item.smsDeliveryStatus ?? "";
    const successful = item.status === "SENT" || deliveryStatus === "sent" || deliveryStatus === "delivered";
    if (!successful) return latest;
    const timestamp = notificationTimestamp(item);
    return timestamp && timestamp > latest ? timestamp : latest;
  }, 0);
}

function isWithinOperationalWindow(item: NotificationItem, windowMs: number) {
  const createdAtMs = notificationTimestamp(item);
  if (!createdAtMs) return false;
  return Date.now() - createdAtMs <= windowMs;
}

function notificationTimestamp(item: NotificationItem) {
  const source = item.createdAt ?? item.sentAt ?? "";
  const value = source ? Date.parse(source) : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function smsDeliveryLabel(item: NotificationItem) {
  if (!item.smsSid && !item.smsDeliveryStatus) return null;
  const labels: Record<string, string> = {
    accepted: "SMS受付済み",
    queued: "SMS待機中",
    sending: "SMS送信中",
    sent: "SMS送信済み",
    delivered: "SMS到達確認済み",
    undelivered: "SMS未到達",
    failed: "SMS到達失敗",
    unknown: "SMS到達未確認"
  };
  const status = item.smsDeliveryStatus ?? "unknown";
  const label = labels[status] ?? `SMS ${status}`;
  if (status === "delivered" && item.smsDeliveredAt) return `${label} ${formatShortDateTime(item.smsDeliveredAt)}`;
  if (item.smsDeliveryCheckedAt) return `${label} ${formatShortDateTime(item.smsDeliveryCheckedAt)}`;
  return label;
}

function smsDeliveryTone(status?: string | null): "gray" | "green" | "red" | "amber" {
  if (status === "delivered") return "green";
  if (status === "failed" || status === "undelivered") return "red";
  if (status) return "amber";
  return "gray";
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function isTherapistLineConversation(item: ConversationItem) {
  const text = [item.name, item.body].filter(Boolean).join(" ");
  return ["出勤", "退出", "退室", "空き反映", "セラピスト"].some((keyword) => text.includes(keyword));
}

function HistoryList({ items, empty }: { items: ConversationItem[]; empty: string }) {
  return <div className="space-y-2">{items.slice(0, 8).map((item) => <div key={item.id} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="flex justify-between text-xs font-black text-slate-500"><span>{item.channel}</span><span>{item.time}</span></div><div className="mt-1 font-black">{item.name}</div><p className="mt-1 line-clamp-3 text-sm font-bold text-slate-600">{item.body}</p></div>)}{items.length === 0 ? <Empty text={empty} /> : null}</div>;
}

function CallLogList({ items }: { items: CallLogItem[] }) {
  return <div className="space-y-2">{items.slice(0, 8).map((item) => <div key={item.id} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="flex justify-between text-xs font-black text-slate-500"><span>{item.phoneNumber}</span><span>{item.time}</span></div><div className="mt-1 font-black">{item.status}</div><p className="mt-1 line-clamp-3 text-sm font-bold text-slate-600">{item.summary}</p></div>)}{items.length === 0 ? <Empty text="電話AI履歴はまだありません。" /> : null}</div>;
}

function CompactReservation({ reservation }: { reservation: ReservationItem }) {
  return <div className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="flex items-center justify-between"><div className="font-black">{reservation.date} {reservation.time}〜{reservation.end}</div><Pill text={reservation.status ?? "未確認"} /></div><div className="mt-2 text-sm font-bold text-slate-600">{reservation.customer} 様 / {reservation.course}</div><div className="text-sm font-bold text-slate-500">担当: {reservation.therapist} / 部屋: {reservation.room}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3"><div className="text-xs font-black text-slate-500">{label}</div><div className="mt-1 font-black">{value}</div></div>;
}

function Pill({ text, tone = "gray" }: { text: string; tone?: "gray" | "green" | "red" | "amber" }) {
  const color = tone === "green" ? "bg-emerald-100 text-emerald-700" : tone === "red" ? "bg-red-100 text-red-700" : tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${color}`}>{text}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-[#d8e1e8] bg-[#f8fbfc] px-4 py-3 text-sm font-bold text-slate-400">{text}</div>;
}

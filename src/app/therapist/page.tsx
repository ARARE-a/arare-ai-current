"use client";

import Link from "next/link";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { CalendarClock, MessageCircle, RefreshCw, Save, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { userFacingError } from "@/lib/ui-errors";

type TherapistPagePayload = {
  reservations: ReservationItem[];
  notifications: NotificationItem[];
  conversations: ConversationItem[];
  therapists: TherapistShiftItem[];
  shifts: ShiftItem[];
};

type ReservationItem = {
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

type TherapistShiftItem = {
  id: string;
  name: string;
  shift: string;
  bookings: number;
  utilization: number;
  status: string;
  nominationFee: number;
};

type ShiftItem = {
  id: string;
  therapistId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  therapist?: { displayName?: string | null } | null;
};

type NotificationItem = {
  id: string;
  status: string;
  type: string;
  channel: string;
  reservationId?: string | null;
  createdAt: string;
  targetName?: string | null;
  body: string;
};

type TherapistBucket = {
  therapist: string;
  reservations: ReservationItem[];
};

type ConversationItem = {
  id: string;
  time: string;
  name: string;
  channel: string;
  status: string;
  body: string;
};

export default function TherapistPage() {
  const [state, setState] = useState<TherapistPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingShift, setSavingShift] = useState(false);
  const [message, setMessage] = useState("セラピスト画面を準備中");
  const [shiftForm, setShiftForm] = useState({
    therapistId: "",
    startsAt: defaultShiftStart(),
    endsAt: defaultShiftEnd()
  });

  async function load() {
    setLoading(true);
    try {
      const [stateResult, notificationResult, shiftResult] = await Promise.all([
        fetch("/api/admin/state").then((response) => response.json() as Promise<{ data: TherapistPagePayload }>),
        fetch("/api/notifications").then((response) => response.json() as Promise<{ data: NotificationItem[] }>),
        fetch("/api/shifts").then((response) => response.json() as Promise<{ data: ShiftItem[] }>)
      ]);
      const nextState: TherapistPagePayload = {
        reservations: stateResult.data?.reservations ?? [],
        conversations: stateResult.data?.conversations ?? [],
        therapists: stateResult.data?.therapists ?? [],
        notifications: notificationResult.data ?? [],
        shifts: shiftResult.data ?? []
      };
      setState(nextState);
      setShiftForm((current) => ({
        ...current,
        therapistId: current.therapistId || nextState.therapists[0]?.id || ""
      }));
      setMessage("セラピスト画面を更新しました");
    } catch (error) {
      setMessage(userFacingError(error, "セラピストデータの取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  async function saveShift() {
    if (!shiftForm.therapistId) {
      setMessage("シフト登録にはセラピスト選択が必要です");
      return;
    }
    if (!shiftForm.startsAt || !shiftForm.endsAt) {
      setMessage("シフト登録には開始日時と終了日時が必要です");
      return;
    }
    const startsAt = new Date(shiftForm.startsAt);
    const endsAt = new Date(shiftForm.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setMessage("シフト終了は開始より後にしてください");
      return;
    }

    setSavingShift(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          therapistId: shiftForm.therapistId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          status: "SCHEDULED"
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || "シフト登録に失敗しました");
      setMessage("シフトを登録しました。予約作成画面の空き判定に反映されます");
      await load();
    } catch (error) {
      setMessage(userFacingError(error, "シフト登録に失敗しました"));
    } finally {
      setSavingShift(false);
    }
  }

  const reservations = state?.reservations ?? [];

  const buckets = useMemo<TherapistBucket[]>(() => {
    const map = new Map<string, ReservationItem[]>();
    for (const reservation of reservations) {
      const therapist = reservation.therapist || "未割り当て";
      const current = map.get(therapist) ?? [];
      current.push(reservation);
      map.set(therapist, current);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([therapist, reservations]) => ({ therapist, reservations }));
  }, [reservations]);

  const pendingByTarget = useMemo(() => {
    return (state?.notifications ?? []).filter((item) => item.status === "PENDING");
  }, [state?.notifications]);
  const pendingTherapistBookings = useMemo(() => {
    return pendingByTarget.filter((item) => item.type === "THERAPIST_BOOKING" && isCurrentOperationalPending(item));
  }, [pendingByTarget]);
  const conversations = useMemo(() => state?.conversations ?? [], [state]);
  const therapists = useMemo(() => state?.therapists ?? [], [state?.therapists]);
  const upcomingShifts = useMemo(() => {
    const now = Date.now();
    return (state?.shifts ?? [])
      .filter((shift) => new Date(shift.endsAt).getTime() >= now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 8);
  }, [state?.shifts]);
  const onDutyTherapists = useMemo(() => therapists.length, [therapists]);
  const activeShiftTherapists = useMemo(() => therapists.filter((therapist) => therapist.status !== "休み").length, [therapists]);

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] px-3 py-4 pb-28 text-[#101828] md:p-6 md:pb-6">
      <div className="arare-stack mx-auto flex max-w-7xl flex-col gap-5">
        <header className="rounded-xl border border-[#d9e1ea] bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-[#007a6c]">セラピスト画面 / 担当別タスク</div>
              <h1 className="mt-1 text-2xl font-black">担当別タスク：本日分の来店準備を確認</h1>
              <p className="mt-2 text-sm text-slate-600">各セラピストに割り当てられた予約を担当者ごとに並べ、連絡漏れを先に潰します。</p>
            </div>
            <button
              onClick={load}
              className="flex items-center gap-2 rounded-md border border-[#d9e1ea] px-3 py-2 text-sm font-black"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              再読込
            </button>
          </div>
          <div className="mt-3 text-sm font-black text-slate-700">{message}</div>
            <RoleNav active="therapist" />
        </header>

        <ScreenGuide
          eyebrow="Therapist action lane"
          title="担当タスクは「担当者で絞る → 来店準備 → 送信待ち通知」で回す"
          description="店舗確定と同じデータを前提に、セラピスト単位で今日のタスクを潰していく画面です。"
          primaryAction={{ href: "/therapist", label: "担当別タスクを見る" }}
          secondaryAction={{ href: "/store-v2", label: "店舗の確定画面へ" }}
          steps={[
            { title: "担当を確認", body: "担当者名または「未割り当て」でカードを分けて先頭を優先します。" },
            { title: "来店準備", body: "時間・部屋・コースを1画面で確認し、直前対応をしやすくします。" },
            { title: "連絡漏れ確認", body: "未送信通知があれば店舗側で再送し、通知遅延を防ぎます。", href: "/store-v2", actionLabel: "店舗側で再送" }
          ]}
        />

        <section className="grid gap-4 md:grid-cols-4">
          <KPI
            label="出勤セラピスト"
            value={`${activeShiftTherapists}名`}
          />
          <KPI label="登録セラピスト" value={`${onDutyTherapists}名`} />
          <KPI
            label="保留通知（セラピスト向け）"
            value={`${pendingTherapistBookings.length}`}
          />
          <KPI
            label="本日予約"
            value={`${reservations.length}件`}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card title="シフトを登録して予約可能にする" icon={<CalendarClock size={16} />}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">セラピスト</span>
                <select
                  value={shiftForm.therapistId}
                  onChange={(event) => setShiftForm({ ...shiftForm, therapistId: event.target.value })}
                  className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold"
                >
                  {therapists.map((therapist) => (
                    <option key={therapist.id} value={therapist.id}>
                      {therapist.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">開始</span>
                <input
                  type="datetime-local"
                  value={shiftForm.startsAt}
                  onChange={(event) => setShiftForm({ ...shiftForm, startsAt: event.target.value })}
                  className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-slate-500">終了</span>
                <input
                  type="datetime-local"
                  value={shiftForm.endsAt}
                  onChange={(event) => setShiftForm({ ...shiftForm, endsAt: event.target.value })}
                  className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveShift()}
                disabled={savingShift || !therapists.length}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#008b83] px-4 text-sm font-black text-white disabled:opacity-55"
              >
                <Save size={16} />
                シフトを保存
              </button>
              <Link href="/reservations" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cbd8e3] bg-white px-4 text-sm font-black text-slate-800">
                予約作成へ戻る
              </Link>
            </div>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
              保存したシフトは予約作成の空き判定に使われます。対象時間に出勤シフトと空き部屋がある場合だけ予約を作成できます。
            </p>
          </Card>

          <Card title="登録済みシフト" icon={<CalendarClock size={16} />}>
            <div className="grid gap-2 md:grid-cols-2">
              {upcomingShifts.length === 0 ? <Empty text="今後のシフトはまだありません。" /> : null}
              {upcomingShifts.map((shift) => (
                <div key={shift.id} className="rounded-md border border-[#d9e1ea] bg-white p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black">{shift.therapist?.displayName ?? "担当名なし"}</span>
                    <span className="rounded-full border border-[#dce6ef] px-2 py-1 text-xs">{shift.status}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    {formatShiftDateTime(shift.startsAt)} - {formatShiftTime(shift.endsAt)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            {buckets.length === 0 ? (
              <Card title="担当予約はありません">
                <Empty text="本日の予約データが見つかりません。" />
              </Card>
            ) : null}
            {buckets.map((bucket) => (
              <Card key={bucket.therapist} title={`${bucket.therapist} の本日タスク`}>
                <div className="space-y-2">
                  {bucket.reservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="rounded-md border border-[#e2ebf2] bg-white px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black">{reservation.time}〜{reservation.end}</span>
                        <span className="rounded-full border border-[#d9e1ea] px-2 py-1 text-xs">{reservation.status}</span>
                      </div>
                      <div className="mt-1 text-slate-700">{reservation.customer} / {reservation.course} / {reservation.room}</div>
                      <div className="mt-1 text-xs text-slate-500">{reservation.phone} / source: {reservation.source}</div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            <Card title="セラピスト向け未送信通知" icon={<MessageCircle size={16} />}>
              <div className="space-y-2">
                {pendingTherapistBookings.length === 0 ? <Empty text="直近の未送信通知はありません。" /> : null}
                {pendingTherapistBookings.map((notification) => (
                    <div key={notification.id} className="rounded-md border border-[#d9e1ea] bg-white p-2 text-sm">
                      <div className="font-black">{notification.targetName || "担当名なし"}</div>
                      <div className="text-slate-600">{notification.body}</div>
                      <div className="mt-1 text-xs text-slate-500">{notification.createdAt}</div>
                    </div>
                  ))}
              </div>
            </Card>

            <Card title="最新チャネル履歴" icon={<MessageCircle size={16} />}>
              <div className="space-y-2">
                {conversations.length === 0 ? <Empty text="会話履歴はまだありません。" /> : null}
                {conversations.slice(0, 4).map((conversation) => (
                  <div key={conversation.id} className="rounded-md border border-[#d9e1ea] bg-white p-2 text-sm">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-black text-slate-700">{conversation.channel}</span>
                      <span>{conversation.time}</span>
                    </div>
                    <div className="mt-1 font-black text-slate-700">{conversation.name}</div>
                    <p className="mt-1 text-slate-600">{conversation.body}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="セラピスト情報" icon={<UserRound size={16} />}>
              <p className="text-sm text-slate-600">
                この画面は店舗側確定フローと同じデータを参照し、担当者別に予約を時系列で表示します。連絡先を持つタスクはセラピスト通知と紐づけて運用確認ができます。
              </p>
              <div className="mt-3 space-y-2">
                {therapists.length === 0 ? <Empty text="本日のシフト情報はまだありません。" /> : null}
                {therapists.map((therapist) => (
                  <div key={therapist.id} className="rounded-md border border-[#d9e1ea] bg-white p-2 text-sm">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black">{therapist.name}</span>
                      <span className="rounded-full border border-[#dce6ef] px-2 py-1">{therapist.status}</span>
                    </div>
                    <div className="mt-1 text-slate-600">
                      {therapist.shift} / 予約 {therapist.bookings}件 / 稼働率 {therapist.utilization}%
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/store-v2" className="mt-3 inline-block rounded-md bg-[#008b83] px-3 py-2 text-sm font-black text-white">
                <CalendarClock size={15} className="mr-2 inline" />
                店舗で確定操作を見る
              </Link>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="arare-metric rounded-lg border border-[#d9e1ea] bg-white p-4">
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-800">{value}</div>
    </div>
  );
}

function Card({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="arare-panel rounded-lg border border-[#d9e1ea] bg-[#f9fcfe] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="arare-empty rounded-md bg-slate-50 border border-dashed border-[#d8e2ea] px-3 py-2 text-sm text-slate-500">{text}</div>;
}

function isCurrentOperationalPending(item: NotificationItem) {
  const createdAt = new Date(item.createdAt).getTime();
  if (Number.isNaN(createdAt)) return true;
  const ageMs = Date.now() - createdAt;
  return ageMs <= 72 * 60 * 60 * 1000;
}

function defaultShiftStart() {
  const date = new Date();
  date.setHours(date.getHours() >= 20 ? date.getHours() + 1 : 20, 0, 0, 0);
  return toDatetimeLocal(date);
}

function defaultShiftEnd() {
  const date = new Date();
  date.setHours(date.getHours() >= 20 ? date.getHours() + 6 : 25, 0, 0, 0);
  return toDatetimeLocal(date);
}

function toDatetimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatShiftDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatShiftTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}



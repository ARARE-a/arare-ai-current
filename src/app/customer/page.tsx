"use client";

import Link from "next/link";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { CalendarClock, RefreshCw, Search, UserRound, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { userFacingError } from "@/lib/ui-errors";

type CustomerPagePayload = {
  reservations: ReservationItem[];
  customers: CustomerItem[];
  conversations: ConversationItem[];
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

type CustomerItem = {
  id: string;
  name: string;
  phone: string;
  lineId: string;
  visits: number;
  memo: string;
  ng: boolean;
};

type CustomerWithTimeline = CustomerItem & {
  lastReservation?: ReservationItem | null;
  todayReservations: ReservationItem[];
};

type ConversationItem = {
  id: string;
  time: string;
  name: string;
  channel: string;
  status: string;
  body: string;
};

export default function CustomerPage() {
  const [state, setState] = useState<CustomerPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("顧客画面を準備中");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/state");
      const payload = await response.json() as { data: CustomerPagePayload };
      setState(payload.data ?? null);
      setMessage("顧客画面を更新しました");
    } catch (error) {
      setMessage(userFacingError(error, "顧客データの取得に失敗しました"));
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

  const customers = useMemo(() => {
    if (!state) return [] as CustomerWithTimeline[];

    const byPhone = new Map<string, ReservationItem[]>();
    for (const reservation of state.reservations) {
      const current = byPhone.get(reservation.phone) ?? [];
      current.push(reservation);
      byPhone.set(reservation.phone, current);
    }

    return state.customers
      .map((customer) => {
        const timeline = byPhone.get(customer.phone) ?? [];
        const lastReservation = timeline.at(-1) ?? null;
        return {
          ...customer,
          lastReservation,
          todayReservations: timeline
        };
      })
      .filter((customer) => {
        if (!query.trim()) return true;
        const needle = query.toLowerCase();
        return (
          customer.name.toLowerCase().includes(needle) ||
          customer.phone.includes(needle) ||
          customer.memo.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const aTime = a.todayReservations.at(-1)?.time ?? "";
        const bTime = b.todayReservations.at(-1)?.time ?? "";
        if (!aTime && !bTime) return 0;
        if (!aTime) return 1;
        if (!bTime) return -1;
        return aTime.localeCompare(bTime);
      });
  }, [state, query]);

  const totalReservations = state?.reservations.length ?? 0;
  const conversations = state?.conversations ?? [];

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] px-3 py-4 pb-28 text-[#101828] md:p-6 md:pb-6">
      <div className="arare-stack mx-auto flex max-w-7xl flex-col gap-5">
        <header className="rounded-xl border border-[#d9e1ea] bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-[#007a6c]">顧客画面 / 履歴確認</div>
              <h1 className="mt-1 text-2xl font-black">顧客ごとの履歴・予約時系列を確認</h1>
              <p className="mt-2 text-sm text-slate-600">
                ここは編集ではなく確認専用。顧客単位で予約履歴・LINE/チャット履歴を見て、必要なら Web Chat へ戻します。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="flex items-center gap-2 rounded-md border border-[#d9e1ea] px-3 py-2 text-sm font-black"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                再読込
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-[#dbe5ee] bg-[#f8fbfc] p-2 text-sm font-black text-slate-700">{message}</div>

          <RoleNav active="customer" />
        </header>

        <ScreenGuide
          eyebrow="Customer action lane"
          title="顧客履歴確認は「検索 → 当日/過去履歴 → 予約入口」"
          description="顧客のNG、訪問回数、会話履歴を先に把握して、予約変更・受付追加は Web Chat から行います。"
          primaryAction={{ href: "/chat", label: "顧客の予約入口へ" }}
          secondaryAction={{ href: "/store-v2", label: "店舗で確定処理" }}
          steps={[
            { title: "顧客を探す", body: "名前、電話番号、メモで絞り込みます。" },
            { title: "状態を見る", body: "訪問回数、NG、当日予約を時系列で確認します。" },
            { title: "予約入口へ", body: "変更・追加受け付けは Web Chat、確定・取引確定は店舗で見る導線に分離します。", href: "/chat", actionLabel: "予約入口へ" }
          ]}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="arare-metric rounded-lg border border-[#d9e1ea] bg-white p-4">
            <div className="text-xs font-black text-slate-500">顧客総数</div>
            <div className="mt-1 text-3xl font-black">{state?.customers.length ?? 0}名</div>
          </div>
          <div className="arare-metric rounded-lg border border-[#d9e1ea] bg-white p-4">
            <div className="text-xs font-black text-slate-500">本日予約件数</div>
            <div className="mt-1 text-3xl font-black">{totalReservations}件</div>
          </div>
          <label className="arare-metric rounded-lg border border-[#d9e1ea] bg-white p-4 text-sm font-black">
            <span className="inline-flex items-center gap-2 text-slate-700">
              <Search size={16} />
              顧客検索
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前 / 電話番号 / メモ"
              className="mt-2 h-11 w-full rounded-md border border-[#d9e1ea] px-3"
            />
          </label>
        </div>

        <section className="grid gap-4 xl:grid-cols-[1fr_1.05fr]">
          <div className="space-y-3">
            <Card title="顧客一覧" icon={<UserRound size={16} />}>
              {customers.length === 0 ? <Empty text="表示対象の顧客がありません。" /> : null}
              {customers.map((customer) => (
                <div key={customer.id} className="rounded-md border border-[#d9e1ea] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div>
                      <div className="font-black">{customer.name}</div>
                      <div className="text-slate-600">{customer.phone} / LINE:{customer.lineId}</div>
                      <div className="text-xs text-slate-500">訪問回数 {customer.visits}回 / NG: {customer.ng ? "あり" : "なし"}</div>
                    </div>
                    <span className="rounded-full border border-[#dbe5ee] px-2 py-1 text-xs">
                      {customer.lastReservation ? `最終:${customer.lastReservation.time}` : "本日なし"}
                    </span>
                  </div>
                  {customer.memo ? <p className="mt-2 text-sm text-slate-600">memo: {customer.memo}</p> : null}
                </div>
              ))}
            </Card>
          </div>

          <div className="space-y-3">
            <Card title="本日予約ストリーム" icon={<CalendarClock size={16} />}>
              {!state?.reservations.length ? <Empty text="本日の予約履歴がありません。" /> : null}
              <div className="space-y-2 max-h-[650px] overflow-y-auto">
                {state?.reservations.map((reservation) => (
                  <div key={reservation.id} className="rounded-md border border-[#d9e1ea] bg-white p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-black">
                        {reservation.time}〜{reservation.end} / {reservation.customer}
                      </div>
                      <span className="rounded-full border px-2 py-1 text-xs">{reservation.status}</span>
                    </div>
                    <div className="mt-1 text-slate-700">{reservation.course} / {reservation.therapist} / {reservation.room}</div>
                    <div className="mt-1 text-xs text-slate-500">source: {reservation.source}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="顧客会話ストリーム" icon={<MessageCircle size={16} />}>
              {conversations.length === 0 ? <Empty text="会話履歴はまだありません。" /> : null}
              <div className="space-y-2 max-h-[350px] overflow-y-auto">
                {conversations.slice(0, 8).map((conversation) => (
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

            <Card title="顧客向け導線" icon={<MessageCircle size={16} />}>
              <p className="text-sm text-slate-600">
                顧客は予約確定や変更依頼は、まず Webチャットから到達する想定です。AI側との整合を保つため、こちらの画面は「確認」と「履歴表示」に集中させ、確定は店舗画面で実施します。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/chat" className="rounded-md bg-[#008b83] px-3 py-2 text-sm font-black text-white">
                  Web Chat へ
                </Link>
                <Link href="/store-v2" className="rounded-md border border-[#d9e1ea] px-3 py-2 text-sm font-black">
                  店舗に戻る
                </Link>
              </div>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="arare-panel rounded-lg border border-[#d9e1ea] bg-[#f9fcfe] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-black">
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



"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, ReceiptText } from "lucide-react";
import {
  AdminPanel,
  AdminShell,
  DataTable,
  EmptyState,
  Field,
  RefreshButton,
  SelectField,
  StatusPill,
  TableCell,
  TableHeader,
  adminUserFacingError,
  formatDateTime,
  formatYen
} from "@/components/AdminUi";

type ApiResult<T> = { data?: T; error?: string };
type SalesSummary = {
  total: number;
  daily: number;
  monthly: number;
  reservationCount: number;
  nominationRate: number;
  repeatRate: number;
  utilizationRate: number;
  byTherapist: Array<{ name: string; amount: number; count: number }>;
  byCourse: Array<{ name: string; amount: number; count: number }>;
};
type Reservation = {
  id: string;
  startsAt: string;
  status: "TENTATIVE" | "CONFIRMED" | "VISITED" | "CANCELLED" | "NO_SHOW";
  nominated: boolean;
  customer: { name: string; phone: string; visitCount?: number };
  course: { id: string; name: string; price: number };
  therapist?: { id: string; displayName: string; nominationFee?: number } | null;
  room?: { name: string } | null;
};

export default function SalesPage() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [period, setPeriod] = useState("MONTH");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("売上情報を読み込み中");
  const [loading, setLoading] = useState(false);

  async function requestJson<T>(url: string) {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "売上情報を取得しました") {
    setLoading(true);
    try {
      const [salesData, reservationData] = await Promise.all([requestJson<SalesSummary>("/api/sales"), requestJson<Reservation[]>("/api/reservations")]);
      setSummary(salesData ?? null);
      setReservations((reservationData ?? []).filter((item) => item.status === "CONFIRMED" || item.status === "VISITED"));
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "売上情報の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    return reservations.filter((item) => {
      const date = new Date(item.startsAt);
      const inPeriod =
        period === "ALL" ||
        (period === "TODAY" && sameJstDay(date, now)) ||
        (period === "MONTH" && sameJstMonth(date, now));
      const inQuery = !q || [item.customer.name, item.customer.phone, item.course.name, item.therapist?.displayName ?? "", item.room?.name ?? ""].join("\n").toLowerCase().includes(q);
      return inPeriod && inQuery;
    });
  }, [reservations, period, query]);

  const filteredTotal = useMemo(() => filtered.reduce((sum, item) => sum + amountFor(item), 0), [filtered]);

  return (
    <AdminShell
      active="sales"
      title="売上一覧"
      subtitle="確定・来店済み予約を売上一覧として確認します。集計は既存 `/api/sales`、明細表示は既存予約データを参照します。"
      message={message}
      metrics={[
        { label: "本日", value: formatYen(summary?.daily ?? 0), tone: "green" },
        { label: "今月", value: formatYen(summary?.monthly ?? 0) },
        { label: "総売上", value: formatYen(summary?.total ?? 0) },
        { label: "表示明細", value: `${filtered.length}件`, caption: formatYen(filteredTotal) }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <AdminPanel
          title="売上明細"
          icon={<ReceiptText size={20} />}
          action={
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="期間"
                value={period}
                onChange={setPeriod}
                options={[
                  { label: "今月", value: "MONTH" },
                  { label: "今日", value: "TODAY" },
                  { label: "すべて", value: "ALL" }
                ]}
              />
            </div>
          }
        >
          <div className="mb-3 max-w-xl">
            <Field label="検索" value={query} onChange={setQuery} placeholder="顧客名、電話番号、コース、担当で検索" />
          </div>
          {filtered.length === 0 ? (
            <EmptyState text="表示対象の売上明細はありません。" />
          ) : (
            <DataTable>
              <table className="min-w-[860px] w-full border-collapse">
                <TableHeader>
                  <tr>
                    <th className="px-3 py-3 text-left">日時</th>
                    <th className="px-3 py-3 text-left">顧客</th>
                    <th className="px-3 py-3 text-left">コース</th>
                    <th className="px-3 py-3 text-left">担当/部屋</th>
                    <th className="px-3 py-3 text-left">状態</th>
                    <th className="px-3 py-3 text-right">金額</th>
                  </tr>
                </TableHeader>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <TableCell>{formatDateTime(item.startsAt)}</TableCell>
                      <TableCell>
                        <div className="font-black text-slate-900">{item.customer.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.customer.phone}</div>
                      </TableCell>
                      <TableCell>{item.course.name}</TableCell>
                      <TableCell>
                        <div>{item.therapist?.displayName ?? "未割当"}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.room?.name ?? "部屋未割当"}</div>
                      </TableCell>
                      <TableCell>
                        <StatusPill text={item.status === "VISITED" ? "来店済み" : "確定"} tone="green" />
                      </TableCell>
                      <TableCell className="text-right font-black text-slate-950">{formatYen(amountFor(item))}</TableCell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </AdminPanel>

        <div className="grid gap-4">
          <AdminPanel title="担当別売上" icon={<BarChart3 size={20} />}>
            <SummaryList items={summary?.byTherapist ?? []} />
          </AdminPanel>
          <AdminPanel title="コース別売上" icon={<BarChart3 size={20} />}>
            <SummaryList items={summary?.byCourse ?? []} />
          </AdminPanel>
          <AdminPanel title="運用指標" icon={<BarChart3 size={20} />}>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricMini label="指名率" value={`${summary?.nominationRate ?? 0}%`} />
              <MetricMini label="リピート率" value={`${summary?.repeatRate ?? 0}%`} />
              <MetricMini label="稼働率" value={`${summary?.utilizationRate ?? 0}%`} />
            </div>
          </AdminPanel>
        </div>
      </section>
    </AdminShell>
  );
}

function SummaryList({ items }: { items: Array<{ name: string; amount: number; count: number }> }) {
  if (!items.length) return <EmptyState text="集計対象がありません。" />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.name} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] p-3">
          <div>
            <div className="font-black text-slate-900">{item.name}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">{item.count}件</div>
          </div>
          <div className="text-right font-black text-slate-950">{formatYen(item.amount)}</div>
        </div>
      ))}
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] p-3">
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function amountFor(item: Reservation) {
  return item.course.price + (item.nominated ? item.therapist?.nominationFee ?? 0 : 0);
}

function sameJstDay(left: Date, right: Date) {
  return jstKey(left) === jstKey(right);
}

function sameJstMonth(left: Date, right: Date) {
  return jstMonthKey(left) === jstMonthKey(right);
}

function jstKey(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function jstMonthKey(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(date);
}

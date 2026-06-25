"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
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
  formatDateTime
} from "@/components/AdminUi";

type ApiResult<T> = { data?: T; error?: string };
type NotificationSendResult = { attempted?: number; sent?: number; failed?: number; pending?: number };
type NotificationLog = {
  id: string;
  notificationId?: string | null;
  reservationId?: string | null;
  type: string;
  channel: string;
  status: "PENDING" | "SENT" | "FAILED";
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientLineId?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  dedupeKey?: string | null;
  body?: string | null;
  notificationTargetName?: string | null;
  notificationTargetPhone?: string | null;
  notificationTargetLineId?: string | null;
  smsSid?: string | null;
  smsDeliveryStatus?: string | null;
  smsErrorCode?: string | null;
  smsErrorMessage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
};

const statusOptions = [
  { label: "すべて", value: "ALL" },
  { label: "未送信", value: "PENDING" },
  { label: "送信済み", value: "SENT" },
  { label: "送信失敗", value: "FAILED" }
];

export default function NotificationLogsPage() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [status, setStatus] = useState("ALL");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("通知履歴を読み込み中");
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});

  async function requestJson<T>(url: string) {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "通知履歴を取得しました") {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (status !== "ALL") params.set("status", status);
      const data = await requestJson<NotificationLog[]>(`/api/notification-logs?${params.toString()}`);
      setLogs(data ?? []);
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "通知履歴の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function sendLogNotification(item: NotificationLog) {
    if (!item.notificationId) {
      setMessage("通知IDがないため送信できません");
      return;
    }

    setSendingId(item.notificationId);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: item.notificationId })
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResult<NotificationSendResult>;
      if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);

      const result = payload.data ?? {};
      const summary = `送信処理を実行しました（送信済み ${result.sent ?? 0} / 失敗 ${result.failed ?? 0} / 未送信 ${result.pending ?? 0}）`;
      await load(summary);
    } catch (error) {
      setMessage(adminUserFacingError(error, "通知送信に失敗しました"));
      await load("通知送信に失敗しました。履歴を再取得しました");
    } finally {
      setSendingId(null);
    }
  }

  function toggleLogBody(id: string) {
    setExpandedLogIds((current) => ({ ...current, [id]: !current[id] }));
  }

  useEffect(() => {
    void load();
  }, [status]);

  const latestSentAt = useMemo(() => latestSentLogTimestamp(logs), [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const baseLogs =
      status === "ALL" && !q
        ? logs.filter((item) => isDefaultVisibleLog(item, latestSentAt))
        : logs;
    if (!q) return baseLogs;
    return baseLogs.filter((item) =>
      [
        item.id,
        item.notificationId ?? "",
        item.reservationId ?? "",
        item.type,
        item.channel,
        item.status,
        item.recipientName ?? "",
        item.recipientPhone ?? "",
        item.recipientLineId ?? "",
        item.provider ?? "",
        item.providerMessageId ?? "",
        item.errorCode ?? "",
        item.errorMessage ?? "",
        item.body ?? "",
        item.smsSid ?? "",
        item.smsDeliveryStatus ?? "",
        item.smsErrorCode ?? "",
        item.smsErrorMessage ?? ""
      ]
        .join("\n")
        .toLowerCase()
        .includes(q)
    );
  }, [latestSentAt, logs, query, status]);
  const hiddenPastActionCount = useMemo(
    () => (status === "ALL" && !query.trim() ? logs.filter((item) => !isDefaultVisibleLog(item, latestSentAt)).length : 0),
    [latestSentAt, logs, query, status]
  );
  const visibleSentCount = filtered.filter((item) => item.status === "SENT").length;
  const visiblePendingCount = filtered.filter((item) => item.status === "PENDING").length;
  const visibleFailedCount = filtered.filter((item) => item.status === "FAILED").length;

  return (
    <AdminShell
      active="notification-logs"
      title="通知履歴"
      subtitle="予約確定・変更・リマインド・セラピスト通知などの送信ログを確認し、未送信や失敗通知を再送できます。"
      message={message}
      metrics={[
        { label: "表示中", value: `${filtered.length}件` },
        { label: "送信済み", value: `${visibleSentCount}件`, tone: "green" },
        { label: "未送信", value: `${visiblePendingCount}件`, tone: visiblePendingCount > 0 ? "amber" : "slate" },
        { label: "失敗", value: `${visibleFailedCount}件`, tone: visibleFailedCount > 0 ? "red" : "slate" }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <AdminPanel
        title="通知ログ一覧"
        icon={<Bell size={20} />}
        action={
          <div className="flex flex-wrap gap-2">
            <SelectField label="状態" value={status} onChange={setStatus} options={statusOptions} />
          </div>
        }
      >
        <div className="mb-3 max-w-xl">
          <Field label="検索" value={query} onChange={setQuery} placeholder="顧客名、電話番号、provider ID、エラー内容で検索" />
        </div>
        {hiddenPastActionCount > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
            過去の未送信・失敗ログ {hiddenPastActionCount}件を通常表示から非表示にしています。確認する場合は状態を「未送信」または「送信失敗」に切り替えてください。
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <EmptyState text="条件に一致する通知履歴はありません。" />
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {filtered.map((item) => (
                <article key={item.id} className="rounded-2xl border border-[#dfe8ee] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-500">{formatDateTime(item.createdAt)}</div>
                      <h3 className="mt-1 truncate text-base font-black text-slate-950">{typeLabel(item.type)}</h3>
                      <div className="mt-1 text-xs font-bold text-slate-500">{channelLabel(item.channel)}</div>
                    </div>
                    <StatusPill text={statusLabel(item.status)} tone={statusTone(item.status)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700">
                    <div className="rounded-xl bg-[#f8fbfc] p-3">
                      <span className="text-xs text-slate-500">宛先</span>
                      <div className="mt-1 break-words text-base text-slate-950">{item.recipientName || "宛先名なし"}</div>
                      <div className="mt-0.5 break-words text-xs text-slate-500">{item.recipientPhone || item.recipientLineId || "-"}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-[#f8fbfc] p-3">
                        <span className="text-xs text-slate-500">予約ID</span>
                        <div className="mt-1 font-black text-slate-900">{shortId(item.reservationId)}</div>
                      </div>
                      <div className="rounded-xl bg-[#f8fbfc] p-3">
                        <span className="text-xs text-slate-500">通知ID</span>
                        <div className="mt-1 font-black text-slate-900">{shortId(item.notificationId)}</div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#e5edf3] p-3">
                      <span className="text-xs text-slate-500">Provider</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{item.provider || "-"}</span>
                        <span className="min-w-0 break-all text-xs text-slate-500">{shortProviderId(item.providerMessageId || item.dedupeKey)}</span>
                      </div>
                    </div>
                    {item.errorCode || item.errorMessage ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                        <div className="text-xs font-black">{item.errorCode || "error"}</div>
                        <div className="mt-1 break-words text-xs">{item.errorMessage}</div>
                      </div>
                    ) : null}
                    <NotificationBodyDetails
                      item={item}
                      expanded={Boolean(expandedLogIds[item.id])}
                      onToggle={() => toggleLogBody(item.id)}
                    />
                    <NotificationSendAction item={item} sendingId={sendingId} onSend={sendLogNotification} />
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <DataTable>
                <table className="min-w-[980px] w-full border-collapse">
                  <TableHeader>
                    <tr>
                      <th className="px-3 py-3 text-left">作成/送信</th>
                      <th className="px-3 py-3 text-left">種別</th>
                      <th className="px-3 py-3 text-left">宛先</th>
                      <th className="px-3 py-3 text-left">状態</th>
                      <th className="px-3 py-3 text-left">Provider</th>
                      <th className="px-3 py-3 text-left">エラー</th>
                      <th className="px-3 py-3 text-left">紐付け</th>
                      <th className="px-3 py-3 text-left">操作</th>
                    </tr>
                  </TableHeader>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id}>
                        <TableCell>
                          <div className="font-black text-slate-900">{formatDateTime(item.createdAt)}</div>
                          <div className="mt-1 text-xs text-slate-500">送信 {formatDateTime(item.sentAt)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-black text-slate-900">{typeLabel(item.type)}</div>
                          <div className="mt-1 text-xs text-slate-500">{channelLabel(item.channel)}</div>
                        </TableCell>
                        <TableCell>
                          <div>{item.recipientName || "宛先名なし"}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.recipientPhone || item.recipientLineId || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <StatusPill text={statusLabel(item.status)} tone={statusTone(item.status)} />
                        </TableCell>
                        <TableCell>
                          <div>{item.provider || "-"}</div>
                          <div className="mt-1 max-w-[220px] truncate text-xs text-slate-500">{item.providerMessageId || item.dedupeKey || "-"}</div>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {item.errorCode || item.errorMessage ? (
                            <div>
                              <div className="font-black text-red-700">{item.errorCode || "error"}</div>
                              <div className="mt-1 line-clamp-2 text-xs text-red-700">{item.errorMessage}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px] truncate text-xs">通知: {item.notificationId || "-"}</div>
                          <div className="mt-1 max-w-[180px] truncate text-xs">予約: {item.reservationId || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <NotificationBodyDetails
                            item={item}
                            expanded={Boolean(expandedLogIds[item.id])}
                            onToggle={() => toggleLogBody(item.id)}
                            compact
                          />
                          <NotificationSendAction item={item} sendingId={sendingId} onSend={sendLogNotification} compact />
                        </TableCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTable>
            </div>
          </>
        )}
      </AdminPanel>
    </AdminShell>
  );
}

function statusLabel(status: NotificationLog["status"]) {
  if (status === "SENT") return "送信済み";
  if (status === "FAILED") return "送信失敗";
  return "未送信";
}

function statusTone(status: NotificationLog["status"]) {
  if (status === "SENT") return "green";
  if (status === "FAILED") return "red";
  return "amber";
}

function isOldFailureLog(item: NotificationLog) {
  if (item.status !== "FAILED") return false;
  const createdAt = new Date(item.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > 12 * 60 * 60 * 1000;
}

function isDefaultVisibleLog(item: NotificationLog, latestSentAt: number) {
  if (item.status === "SENT") return true;

  const createdAt = notificationLogTimestamp(item);
  if (latestSentAt && createdAt && createdAt <= latestSentAt) return false;

  if (item.status === "FAILED" && isOldFailureLog(item)) return false;

  return true;
}

function latestSentLogTimestamp(items: NotificationLog[]) {
  return items.reduce((latest, item) => {
    if (item.status !== "SENT") return latest;
    const timestamp = notificationLogTimestamp(item);
    return timestamp && timestamp > latest ? timestamp : latest;
  }, 0);
}

function notificationLogTimestamp(item: NotificationLog) {
  const value = Date.parse(item.createdAt ?? "");
  return Number.isNaN(value) ? 0 : value;
}

function NotificationBodyDetails({
  item,
  expanded,
  onToggle,
  compact = false
}: {
  item: NotificationLog;
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const hasBody = Boolean(item.body?.trim());
  const target = item.notificationTargetPhone || item.notificationTargetLineId || item.recipientPhone || item.recipientLineId || "-";
  const providerId = item.providerMessageId || item.smsSid || item.dedupeKey || "-";
  const deliveryStatus = item.smsDeliveryStatus || item.status;
  const errorCode = item.errorCode || item.smsErrorCode;
  const errorMessage = item.errorMessage || item.smsErrorMessage;

  return (
    <div className={compact ? "mb-2" : ""}>
      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex min-h-10 items-center justify-center rounded-xl border border-[#dfe8ee] bg-white px-4 text-sm font-black text-slate-800 ${
          compact ? "mb-2 px-3 text-xs" : "w-full"
        }`}
      >
        {expanded ? "本文を隠す" : hasBody ? "本文を表示" : "本文なしを確認"}
      </button>
      {expanded ? (
        <div className="mt-2 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] p-3 text-xs font-bold leading-5 text-slate-700">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-2 py-1 text-slate-600">宛先: {target}</span>
            <span className="rounded-full bg-white px-2 py-1 text-slate-600">状態: {deliveryStatus}</span>
          </div>
          <div className="mt-3 text-xs font-black text-slate-500">送信本文</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs font-bold leading-5 text-slate-900">
            {item.body?.trim() || "本文が通知レコードから取得できませんでした。古いログ、または通知ID未紐付けの可能性があります。"}
          </pre>
          <div className="mt-3 break-all text-slate-500">Provider ID: {providerId}</div>
          {errorCode || errorMessage ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
              <div className="font-black">{errorCode || "error"}</div>
              <div className="mt-1 break-words">{errorMessage || "-"}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NotificationSendAction({
  item,
  sendingId,
  onSend,
  compact = false
}: {
  item: NotificationLog;
  sendingId: string | null;
  onSend: (item: NotificationLog) => Promise<void>;
  compact?: boolean;
}) {
  const canSend = Boolean(item.notificationId && item.status !== "SENT");
  if (!canSend) {
    return compact ? <span className="text-xs font-bold text-slate-400">-</span> : null;
  }

  const busy = sendingId === item.notificationId;
  const label = busy ? "送信中" : item.status === "FAILED" ? "再送" : "送信";

  return (
    <button
      disabled={busy}
      onClick={() => void onSend(item)}
      className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-black disabled:opacity-50 ${
        item.status === "FAILED" ? "border border-red-200 bg-red-50 text-red-700" : "bg-[#008b83] text-white"
      } ${compact ? "px-3 text-xs" : "w-full"}`}
    >
      {label}
    </button>
  );
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = { PHONE: "電話/SMS", LINE: "LINE", WEB_CHAT: "Webチャット", ADMIN: "管理画面" };
  return labels[channel] ?? channel;
}

function typeLabel(type: string) {
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

function shortId(value?: string | null) {
  if (!value) return "-";
  if (value.length <= 10) return value;
  return `...${value.slice(-8)}`;
}

function shortProviderId(value?: string | null) {
  if (!value) return "-";
  if (value.length <= 26) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

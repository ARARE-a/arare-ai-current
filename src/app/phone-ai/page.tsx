"use client";

import Link from "next/link";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { CheckCircle2, Copy, MessageCircle, PhoneCall, RefreshCw, Save } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { userFacingError } from "@/lib/ui-errors";

type ApiResult<T> = { data?: T; error?: string };

type CallLogItem = {
  id: string;
  phoneNumber?: string | null;
  reservationId?: string | null;
  twilioCallSid?: string | null;
  requiredReview?: boolean;
  reviewNotes?: string | null;
  durationSeconds?: number | null;
  status: string;
  aiSummary?: string | null;
  createdAt: string;
};

type RoutingMode = "ALWAYS_AI" | "AFTER_HOURS_AI" | "BUSY_OR_NO_ANSWER_AI" | "MANUAL_ONLY";

type StorePhoneSetting = {
  id: string;
  storeId: string;
  currentStorePhoneNumber: string | null;
  aiReceptionPhoneNumber: string;
  twilioPhoneNumberSid: string | null;
  twilioAccountSid: string | null;
  twilioSubaccountSid: string | null;
  voiceWebhookUrl: string | null;
  voiceRelayWsUrl: string | null;
  fallbackPhoneNumber: string | null;
  voiceAiEnabled: boolean;
  routingMode: RoutingMode;
  recordingEnabled: boolean;
  businessHoursOnly: boolean;
};

type StoreUsageSummary = {
  period: string;
  voiceCallCount: number;
  aiSessionCount: number;
  usedSeconds: number;
  usedMinutes: number;
  includedMinutes: number;
  remainingIncludedMinutes: number;
  overageMinutes: number;
  overageYenPerMinute: number;
  estimatedCostYen: number;
  estimatedCostYenPerMinute: number;
  estimatedOverageYen: number;
};

type FormState = {
  id?: string;
  currentStorePhoneNumber: string;
  aiReceptionPhoneNumber: string;
  twilioPhoneNumberSid: string;
  twilioAccountSid: string;
  twilioSubaccountSid: string;
  voiceWebhookUrl: string;
  voiceRelayWsUrl: string;
  fallbackPhoneNumber: string;
  voiceAiEnabled: boolean;
  routingMode: RoutingMode;
  recordingEnabled: boolean;
  businessHoursOnly: boolean;
};

type SettingCardProps = {
  setting: StorePhoneSetting;
  onEdit: (setting: StorePhoneSetting) => void;
  onDelete: (setting: StorePhoneSetting) => void;
};

const DEFAULT_WEBHOOK_URL = process.env.NEXT_PUBLIC_VOICE_WEBHOOK_URL ?? "";
const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_VOICE_RELAY_WS_URL ?? "";
const OPERATIONAL_CALL_REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const ADMIN_REVIEWED_MARKER = "[admin-reviewed]";

const EMPTY_FORM: FormState = {
  currentStorePhoneNumber: "",
  aiReceptionPhoneNumber: "",
  twilioPhoneNumberSid: "",
  twilioAccountSid: "",
  twilioSubaccountSid:  "",
  voiceWebhookUrl: "",
  voiceRelayWsUrl: "",
  fallbackPhoneNumber: "",
  voiceAiEnabled: true,
  routingMode: "ALWAYS_AI",
  recordingEnabled: false,
  businessHoursOnly: false
};

const ROUTING_OPTIONS = [
  { value: "ALWAYS_AI", label: "常時AI対応" },
  { value: "AFTER_HOURS_AI", label: "営業時間外のみAI" },
  { value: "BUSY_OR_NO_ANSWER_AI", label: "不在/応答なし時にAI" },
  { value: "MANUAL_ONLY", label: "手動受けのみ" }
] as const satisfies readonly { value: RoutingMode; label: string }[];

export default function PhoneAiSettingsPage() {
  const [settings, setSettings] = useState<StorePhoneSetting[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("電話AI設定を準備中です");
  const [callLogs, setCallLogs] = useState<CallLogItem[]>([]);
  const [usage, setUsage] = useState<StoreUsageSummary | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const webhookUrl = useMemo(() => form.voiceWebhookUrl || DEFAULT_WEBHOOK_URL, [form.voiceWebhookUrl]);
  const relayUrl = useMemo(() => form.voiceRelayWsUrl || DEFAULT_WS_URL, [form.voiceRelayWsUrl]);
  const reviewableCallLogs = useMemo(() => callLogs.filter(isReviewableCallLog), [callLogs]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  async function fetchJson<T>(url: string): Promise<ApiResult<T>> {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) {
      throw new Error(payload.error || `API error ${response.status}`);
    }
    return payload;
  }

  async function refresh() {
    setLoading(true);
    setMessage("設定を再取得しています");
    try {
      const [payload, calls, usagePayload] = await Promise.all([
        fetchJson<StorePhoneSetting[]>("/api/store-phone-settings"),
        fetchJson<CallLogItem[]>("/api/call-logs"),
        fetchJson<StoreUsageSummary>("/api/store-usage")
      ]);
      setSettings(payload.data ?? []);
      setCallLogs(calls.data ?? []);
      setUsage(usagePayload.data ?? null);
      setMessage("電話AI設定を読み込みました");
    } catch (error) {
      setMessage(userFacingError(error, "電話AI設定の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/store-phone-settings", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = (await response.json()) as ApiResult<StorePhoneSetting>;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || `保存に失敗しました (${response.status})`);
      }
      setMessage(form.id ? "設定を更新しました" : "設定を保存しました");
      setForm(EMPTY_FORM);
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "電話AI設定の保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(setting: StorePhoneSetting) {
    if (!confirm(`設定 ${setting.aiReceptionPhoneNumber} を削除しますか？`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/store-phone-settings?id=${setting.id}`, { method: "DELETE" });
      const payload = (await response.json()) as ApiResult<{ deleted: boolean }>;
      if (!response.ok) {
        throw new Error(payload.error || `削除に失敗しました (${response.status})`);
      }
      setMessage("設定を削除しました");
      if (form.id === setting.id) {
        setForm(EMPTY_FORM);
      }
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "電話AI設定の削除に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  function edit(setting: StorePhoneSetting) {
    setForm({
      id: setting.id,
      currentStorePhoneNumber: setting.currentStorePhoneNumber ?? "",
      aiReceptionPhoneNumber: setting.aiReceptionPhoneNumber,
      twilioPhoneNumberSid: setting.twilioPhoneNumberSid ?? "",
      twilioAccountSid: setting.twilioAccountSid ?? "",
      twilioSubaccountSid: setting.twilioSubaccountSid ?? "",
      voiceWebhookUrl: setting.voiceWebhookUrl ?? "",
      voiceRelayWsUrl: setting.voiceRelayWsUrl ?? "",
      fallbackPhoneNumber: setting.fallbackPhoneNumber ?? "",
      voiceAiEnabled: setting.voiceAiEnabled,
      routingMode: setting.routingMode,
      recordingEnabled: setting.recordingEnabled,
      businessHoursOnly: setting.businessHoursOnly
    });
    setMessage("フォームへ反映しました");
  }

  async function copyWebhook() {
    await navigator.clipboard.writeText(webhookUrl);
    setMessage("Webhook URLをコピーしました");
  }

  async function markCallLogReviewed(callLog: CallLogItem) {
    setReviewingId(callLog.id);
    try {
      const response = await fetch(`/api/call-logs?id=${encodeURIComponent(callLog.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markReviewed: true })
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResult<CallLogItem>;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || `確認済み更新に失敗しました (${response.status})`);
      }
      setMessage("通話ログを確認済みにしました");
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "通話ログの確認済み更新に失敗しました"));
    } finally {
      setReviewingId(null);
    }
  }

  function callStatusClass(status: string) {
    if (status === "ESCALATED" || status === "HOLD_CREATED") return "bg-amber-100 text-amber-700 border-amber-200";
    if (status === "SUMMARIZED") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  }

  function callStatusLabel(status: string) {
    const labels: Record<string, string> = {
      SUMMARIZED: "要約済み",
      RECEIVED: "受信のみ",
      TRANSCRIBED: "文字起こし済み",
      ESCALATED: "店舗確認",
      HOLD_CREATED: "仮予約作成",
      COMPLETED: "完了"
    };
    return labels[status] ?? status;
  }

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] px-3 py-4 pb-40 text-[#101828] md:p-6 md:pb-6">
      <div className="arare-stack mx-auto max-w-7xl space-y-5">
        <header className="rounded-xl border border-[#d9e1ea] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#e6f8f3] text-[#008b7d]">
                <PhoneCall size={22} />
              </div>
              <div>
                <p className="text-sm font-black text-[#007a6c]">電話AI / 通話品質</p>
                <h1 className="text-2xl font-black">電話AI運用（品質監視）</h1>
                <p className="text-sm text-slate-600">受信ルートとモード、通話品質ログを同時に確認して、音声受付品質を維持します。</p>
              </div>
            </div>
            <CheckCircle2 size={22} className="text-emerald-600" />
          </div>
          <RoleNav active="phone-ai" />
          <div className="mt-3 rounded-md border border-[#dbe5ee] bg-[#f8fbfc] p-2 text-sm font-bold text-slate-700">{message}</div>
        </header>

        <ScreenGuide
          eyebrow="Phone AI action lane"
          title="電話AIは「受信番号 → ルート設定 → 保存 → 通話品質ログ確認」の4ステップ"
          description="品質監視が第一目的。保存したら運用監視に戻って、通話ログとWebhook状態が即時反映されるか確認します。"
          primaryAction={{ href: "/phone-ai", label: "電話AI設定を確認" }}
          secondaryAction={{ href: "/ops", label: "運用状態を見る" }}
          steps={[
            { title: "番号を見る", body: "登録済み設定でAI受付番号と店舗番号を確認します。" },
            { title: "ルートを選ぶ", body: "常時AI、営業時間外、不在時AIなど運用に合うモードを選びます。" },
            { title: "保存して監視", body: "保存後は運用画面で通話ログとWebhookを確認します。", href: "/ops", actionLabel: "運用へ" }
          ]}
        />

        <section className="grid gap-3 rounded-xl border border-[#dce6ef] bg-white p-4 md:grid-cols-4">
          <div>
            <div className="text-xs font-black text-slate-500">今月のAI受付枠</div>
            <div className="mt-1 text-2xl font-black text-[#101828]">{usage?.includedMinutes ?? 300}分</div>
            <div className="text-xs font-bold text-slate-500">{usage?.period ?? "今月"} / 必要時だけON</div>
          </div>
          <div>
            <div className="text-xs font-black text-slate-500">使用</div>
            <div className="mt-1 text-2xl font-black text-[#101828]">{usage?.usedMinutes ?? 0}分</div>
            <div className="text-xs font-bold text-slate-500">AI通話 {usage?.voiceCallCount ?? 0}件</div>
          </div>
          <div>
            <div className="text-xs font-black text-slate-500">残り</div>
            <div className="mt-1 text-2xl font-black text-emerald-700">{usage?.remainingIncludedMinutes ?? 300}分</div>
            <div className="text-xs font-bold text-slate-500">営業時間外/不在時AIで消費を抑制</div>
          </div>
          <div>
            <div className="text-xs font-black text-slate-500">超過</div>
            <div className="mt-1 text-2xl font-black text-[#101828]">{usage?.overageMinutes ?? 0}分</div>
            <div className="text-xs font-bold text-slate-500">{usage?.overageYenPerMinute ?? 50}円/分</div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="order-2 space-y-4 xl:order-1">
            <div className="arare-panel rounded-xl border border-[#dce6ef] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black">登録済み設定</h2>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="rounded-md border border-[#d9e1ea] px-3 py-2 text-sm font-black"
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    再読込
                  </span>
                </button>
              </div>
              {settings.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#d8e2ea] bg-[#f8fbfc] p-3 text-sm text-slate-500">
                  設定はまだありません。
                </div>
              ) : null}
              <div className="space-y-3">
                {settings.map((setting) => (
                  <SettingCard key={setting.id} setting={setting} onEdit={edit} onDelete={remove} />
                ))}
              </div>
            </div>
            <div id="call-logs" className="arare-panel scroll-mt-4 rounded-xl border border-[#dce6ef] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black">最近の通話ログ（監視）</h2>
                  <p className={`text-xs font-black ${reviewableCallLogs.length ? "text-red-700" : "text-emerald-700"}`}>
                    未対応 {reviewableCallLogs.length}件 / 表示中{callLogs.length}件
                  </p>
                </div>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="rounded-md border border-[#d9e1ea] px-3 py-1 text-xs font-black"
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                    再読込
                  </span>
                </button>
              </div>
              {callLogs.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#d8e2ea] bg-[#f8fbfc] p-3 text-sm text-slate-500">
                  通話ログはまだありません。
                </div>
              ) : null}
              {reviewableCallLogs.length > 0 ? (
                <div className="mb-3 rounded-md border border-red-100 bg-red-50 p-3">
                  <div className="text-sm font-black text-red-700">未対応ログ</div>
                  <div className="mt-2 space-y-2">
                    {reviewableCallLogs.slice(0, 4).map((callLog) => (
                      <div key={`review-${callLog.id}`} className="rounded-md border border-red-100 bg-white p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-black text-red-700">{callLog.phoneNumber || "番号なし"}</span>
                          <span className="rounded-full bg-red-100 px-2 py-1 font-black text-red-700">{callReviewReason(callLog)}</span>
                        </div>
                        <div className="mt-1 font-bold text-slate-500">{callLog.createdAt}</div>
                        <p className="mt-1 line-clamp-2 font-bold text-red-700">{callLog.aiSummary || callLog.reviewNotes || "内容未取得。折り返し確認してください。"}</p>
                        <button
                          type="button"
                          onClick={() => void markCallLogReviewed(callLog)}
                          disabled={reviewingId === callLog.id}
                          className="mt-2 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-black text-emerald-700 disabled:opacity-60"
                        >
                          <CheckCircle2 size={14} />
                          {reviewingId === callLog.id ? "更新中" : "確認済みにする"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 pb-32 md:pb-0">
                {callLogs.slice(0, 6).map((callLog) => (
                  <div key={callLog.id} className="rounded-md border border-[#dce6ef] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <span className="rounded-full border border-[#d9e1ea] px-2 py-1 font-bold">{callLog.phoneNumber || "-"}</span>
                      <span className={`rounded-full border px-2 py-1 font-black ${callStatusClass(callLog.status)}`}>
                        {callStatusLabel(callLog.status)}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs font-bold text-slate-500">
                      <span>{formatCallLogDate(callLog.createdAt)}</span>
                      {callLog.durationSeconds ? <span>通話: {formatDuration(callLog.durationSeconds)}</span> : null}
                      {callLog.reservationId ? <span>予約ID: {callLog.reservationId.slice(0, 8)}</span> : null}
                      {callLog.requiredReview ? <span className="text-red-700">要確認: {callReviewReason(callLog)}</span> : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm font-bold leading-6 text-slate-700">
                      {callLog.aiSummary || callLog.reviewNotes || "内容未取得。折り返し確認してください。"}
                    </p>
                    {(callLog.aiSummary || callLog.reviewNotes) ? (
                      <details className="mt-2 rounded-md bg-[#f8fbfc] px-3 py-2 text-sm">
                        <summary className="cursor-pointer text-xs font-black text-[#008b83]">詳細を見る</summary>
                        {callLog.twilioCallSid ? <p className="mt-2 text-xs font-bold text-slate-500">CallSid: {callLog.twilioCallSid}</p> : null}
                        {callLog.aiSummary ? <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-700">{callLog.aiSummary}</p> : null}
                        {callLog.reviewNotes ? <p className="mt-2 whitespace-pre-wrap text-xs font-bold text-slate-500">{formatReviewNotes(callLog.reviewNotes)}</p> : null}
                      </details>
                    ) : null}
                    {isReviewableCallLog(callLog) ? (
                      <button
                        type="button"
                        onClick={() => void markCallLogReviewed(callLog)}
                        disabled={reviewingId === callLog.id}
                        className="mt-2 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle2 size={14} />
                        {reviewingId === callLog.id ? "更新中" : "確認済みにする"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="arare-panel hidden rounded-xl border border-[#dce6ef] bg-[#111827] p-5 text-white md:block">
              <div className="mb-2 font-black">運用ノート</div>
              <p className="text-sm leading-7 text-slate-200">
                電話AIの設定は、店舗予約の品質に直結します。Twilio SID/WEBHOOK/ルーティングモードを変更したら、まず店舗画面（/store-v2）と運用画面（/ops）で予約フローを再確認してください。
              </p>
              <Link href="/ops" className="mt-3 inline-flex items-center gap-2 rounded-md bg-[#009b8f] px-3 py-2 text-sm font-black text-white">
                <MessageCircle size={16} />
                運用監視へ戻る
              </Link>
            </div>
          </div>

          <form onSubmit={save} className="arare-panel order-1 rounded-xl border border-[#dce6ef] bg-white p-5 xl:order-2">
            <h2 className="text-lg font-black">{form.id ? "設定を更新" : "新規設定を追加"}</h2>
            <p className="mt-1 text-sm text-slate-600">対象店舗: <span className="font-black">ログイン中の店舗</span></p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <TextField
                label="店舗電話番号"
                value={form.currentStorePhoneNumber}
                onChange={(value) => setForm((current) => ({ ...current, currentStorePhoneNumber: value }))}
                placeholder="03-0000-0000"
              />
              <TextField
                required
                label="AI受信電話番号"
                value={form.aiReceptionPhoneNumber}
                onChange={(value) => setForm((current) => ({ ...current, aiReceptionPhoneNumber: value }))}
                placeholder="+8190..."
              />
              <TextField
                label="Twilio Phone SID"
                value={form.twilioPhoneNumberSid}
                onChange={(value) => setForm((current) => ({ ...current, twilioPhoneNumberSid: value }))}
              />
              <TextField
                label="Twilio Account SID"
                value={form.twilioAccountSid}
                onChange={(value) => setForm((current) => ({ ...current, twilioAccountSid: value }))}
              />
              <TextField
                label="Twilio Subaccount SID"
                value={form.twilioSubaccountSid}
                onChange={(value) => setForm((current) => ({ ...current, twilioSubaccountSid: value }))}
              />
              <div className="h-20 md:hidden" aria-hidden="true" />
              <TextField
                label="不在時フォールバック番号"
                value={form.fallbackPhoneNumber}
                onChange={(value) => setForm((current) => ({ ...current, fallbackPhoneNumber: value }))}
                placeholder="090-0000-0000"
              />
              <TextField
                className="md:col-span-2"
                label="Webhook URL"
                value={form.voiceWebhookUrl}
                onChange={(value) => setForm((current) => ({ ...current, voiceWebhookUrl: value }))}
                placeholder="https://.../api/twilio/voice"
              />
              <TextField
                className="md:col-span-2"
                label="Conversation Relay URL"
                value={form.voiceRelayWsUrl}
                onChange={(value) => setForm((current) => ({ ...current, voiceRelayWsUrl: value }))}
                placeholder="wss://.../conversation-relay"
              />
              <label className="md:col-span-2 block text-sm font-black text-slate-700">
                ルーティングモード
                <select
                  value={form.routingMode}
                  onChange={(event) => setForm((current) => ({ ...current, routingMode: event.target.value as RoutingMode }))}
                  className="mt-1 h-11 w-full rounded-md border border-[#d9e1ea] px-3"
                >
                  {ROUTING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm font-black text-slate-700">
                <input
                  type="checkbox"
                  checked={form.voiceAiEnabled}
                  onChange={(event) => setForm((current) => ({ ...current, voiceAiEnabled: event.target.checked }))}
                />
                AI受付を有効化
              </label>
              <label className="flex items-center gap-2 text-sm font-black text-slate-700">
                <input
                  type="checkbox"
                  checked={form.recordingEnabled}
                  onChange={(event) => setForm((current) => ({ ...current, recordingEnabled: event.target.checked }))}
                />
                録音を有効化
              </label>
              <label className="flex items-center gap-2 text-sm font-black text-slate-700">
                <input
                  type="checkbox"
                  checked={form.businessHoursOnly}
                  onChange={(event) => setForm((current) => ({ ...current, businessHoursOnly: event.target.checked }))}
                />
                営業時間外のみAI
              </label>
            </div>

            <div className="mt-4 rounded-md border border-[#dce6ef] bg-[#f8fbfc] p-3">
              <div className="text-xs font-black text-slate-500">接続先URL</div>
              <div className="mt-1 text-sm text-slate-800 break-all">Webhook: {webhookUrl}</div>
              <div className="mt-1 text-sm text-slate-800 break-all">Relay: {relayUrl}</div>
              <button
                type="button"
                onClick={copyWebhook}
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-[#111] px-3 py-2 text-xs font-black text-white"
              >
                <Copy size={14} />
                Webhookをコピー
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-[#009b8f] px-4 py-2 text-sm font-black text-white disabled:bg-slate-300"
              >
                <Save size={16} />
                {saving ? "保存中..." : form.id ? "更新" : "保存"}
              </button>
              <button
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
                className="rounded-md border border-[#d9e1ea] px-4 py-2 text-sm font-black"
              >
                入力をクリア
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function SettingCard({ setting, onEdit, onDelete }: SettingCardProps) {
  return (
    <div className="rounded-md border border-[#dce6ef] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black">AI受付: {setting.aiReceptionPhoneNumber}</div>
          <div className="text-sm text-slate-600">店舗電話: {setting.currentStorePhoneNumber || "未登録"}</div>
          <div className="text-xs text-slate-500">
            ルーティング: {ROUTING_OPTIONS.find((option) => option.value === setting.routingMode)?.label ?? setting.routingMode}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onEdit(setting)} className="rounded-md border border-[#d9e1ea] px-2 py-1 text-xs font-black">
            編集
          </button>
          <button
            type="button"
            onClick={() => onDelete(setting)}
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-black text-red-700"
          >
            削除
          </button>
        </div>
      </div>
      <div className="mt-2 text-sm text-slate-700">Webhook: {setting.voiceWebhookUrl ?? "-"}</div>
      <div className="text-sm text-slate-700">Relay: {setting.voiceRelayWsUrl ?? "-"}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={className ? `${className} block text-sm font-black text-slate-700` : "block text-sm font-black text-slate-700"}>
      <span>{label}</span>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-md border border-[#d9e1ea] px-3"
        placeholder={placeholder}
      />
    </label>
  );
}

function isReviewableCallLog(callLog: CallLogItem) {
  if (isAdminReviewedCallLog(callLog)) return false;
  if (!isWithinOperationalCallReviewWindow(callLog)) return false;
  return Boolean(callLog.requiredReview) || ["RECEIVED", "TRANSCRIBED", "ESCALATED"].includes(callLog.status);
}

function callReviewReason(callLog: CallLogItem) {
  if (callLog.requiredReview) return "要確認";
  if (callLog.status === "RECEIVED") return "受信のみ";
  if (callLog.status === "TRANSCRIBED") return "文字起こし止まり";
  if (callLog.status === "ESCALATED") return "店舗確認";
  return "確認必要";
}

function formatCallLogDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}秒`;
  return `${minutes}分${String(rest).padStart(2, "0")}秒`;
}

function isAdminReviewedCallLog(callLog: CallLogItem) {
  const notes = callLog.reviewNotes ?? "";
  return notes.includes(ADMIN_REVIEWED_MARKER) || notes.includes("管理画面で確認済み") || notes.includes("邂｡逅・判");
}

function isWithinOperationalCallReviewWindow(callLog: CallLogItem) {
  const timestamp = Date.parse(callLog.createdAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= OPERATIONAL_CALL_REVIEW_WINDOW_MS;
}

function formatReviewNotes(notes: string) {
  return notes
    .split("\n")
    .map((line) => line.includes(ADMIN_REVIEWED_MARKER) ? `管理画面で確認済み (${line.replace(ADMIN_REVIEWED_MARKER, "").trim()})` : line)
    .join("\n");
}



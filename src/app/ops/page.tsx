"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { userFacingError } from "@/lib/ui-errors";
import {
  Bell,
  Bot,
  CheckCircle2,
  Database,
  Headphones,
  KeyRound,
  Link2,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Ban
} from "lucide-react";

type ApiResult<T> = { data?: T; error?: string };

type ReadinessState = "ready" | "pending" | "blocked";

type ProductionCheck = {
  name: string;
  configured: boolean;
  label?: string;
  requiredForDemo?: boolean;
  note?: string;
};

type Health = {
  status: string;
  features: Record<string, boolean>;
  services?: { key: string; configured: boolean; label: string; requiredForDemo?: boolean }[];
  productionChecklist?: ProductionCheck[];
  publicAppUrl?: string | null;
};

type SetupChecklist = {
  ready: boolean;
  demoReady?: boolean;
  databaseConfigured?: boolean;
  items?: { key: string; label: string; done: boolean }[];
  demoItems?: ReadinessItem[];
  optionalItems?: ReadinessItem[];
  productionItems?: ReadinessItem[];
  phoneAi?: {
    routeReady: boolean;
    logReady: boolean;
    activeRouteCount: number;
    totalRouteCount: number;
    voiceWebhookConfigured: boolean;
    callLogCount: number;
    latestCallStatus?: string | null;
    latestCallAt?: string | null;
    latestSummary?: string | null;
  };
  notifications?: {
    smsReady: boolean;
    twilioReady: boolean;
    pending: number;
    sent: number;
    failed: number;
    total: number;
    latestStatus?: string | null;
    latestAt?: string | null;
  };
  productionChecklist?: ProductionCheck[];
};

type ReadinessItem = {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
};

type Checklist = { key: string; label: string; done: boolean };

type AuditLog = { id: string; action: string; actorType: string; createdAt: string };
type CallLog = { id: string; phoneNumber?: string; status: string; aiSummary?: string; createdAt: string };
type Escalation = { id: string; reason: string; status: string; summary: string; createdAt: string };
type BlockedSlot = { id: string; startsAt: string; endsAt: string; reason: string };

const featureLabels: Record<string, string> = {
  database: "DB",
  openai: "OpenAI",
  twilio: "Twilio",
  line: "LINE",
  clerk: "Clerk"
};

export default function OpsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [setup, setSetup] = useState<SetupChecklist | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [message, setMessage] = useState("運用状態を確認中");
  const [loading, setLoading] = useState(false);

  const demoReady = Boolean(setup?.demoReady);
  const features = health?.features ?? {};
  const missingEnv = useMemo(() => (health?.productionChecklist ?? []).filter((item) => !item.configured), [health]);

  const demoItems = useMemo(() => {
    if (setup?.demoItems?.length) return setup.demoItems;
    const items: ReadinessItem[] = [
      featureItem("database", "PostgreSQL", features.database, "DB接続", "DATABASE_URL"),
      featureItem("openai", "OpenAI", features.openai, "AI応答", "OPENAI_API_KEY"),
      featureItem("twilio", "Twilio", features.twilio, "電話/SMS", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN"),
      featureItem("phoneRoute", "電話ルート", Boolean(setup?.phoneAi?.routeReady), "AI経由のルート", "Twilio Webhook紐付け"),
      featureItem("phoneLog", "通話ログ", Boolean(setup?.phoneAi?.logReady), "運用ログ", "会話保存の可否")
    ];
    return items;
  }, [setup, features]);

  const optionalItems = useMemo(() => {
    if (setup?.optionalItems?.length) return setup.optionalItems;
    return [
      featureItem("line", "LINE", Boolean(features.line), "LINE連携", "LINE_WEBHOOK設定"),
      featureItem("clerk", "Clerk", Boolean(features.clerk), "認証", "Clerkキー")
    ];
  }, [setup, features]);

  const productionItems = useMemo(() => {
    if (setup?.productionItems?.length) return setup.productionItems;
    const hasUrl = Boolean(health?.publicAppUrl);
    const items: ReadinessItem[] = [
      featureItem("productionUrl", "本番URL", hasUrl, `公開URL: ${health?.publicAppUrl ?? "-"}`, "公開URLを確認"),
      featureItem("demo", "本番デモ起動", demoReady, "DB/OpenAI/Twilioの同時確認", "各環境変数の整合"),
      featureItem("clerk", "Clerk認証", Boolean(features.clerk), "本番/ローカルでの認証", "Clerkキー")
    ];
    return items;
  }, [setup, health, demoReady, features]);

  const readiness = useMemo<ReadinessItem[]>(() => {
    if (setup?.items?.length) {
      return setup.items.map((item) => ({
        key: item.key,
        label: item.label,
        state: item.done ? "ready" : "blocked",
        detail: item.done ? "設定済み" : "未設定または要確認"
      }));
    }

    return defaultChecklistFromFeatures(features);
  }, [setup?.items, features]);

  async function getJson<T>(url: string): Promise<ApiResult<T>> {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) {
      throw new Error(payload.error || `API error ${response.status}`);
    }
    return payload;
  }

  async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload;
  }

  async function refresh() {
    setLoading(true);
    setMessage("運用情報を再読込しています");
    try {
      const [healthResult, setupResult, auditResult, callResult, escalationResult, blockedResult] = await Promise.all([
        getJson<Health>("/api/health"),
        getJson<SetupChecklist>("/api/setup/checklist"),
        getJson<AuditLog[]>("/api/audit-logs"),
        getJson<CallLog[]>("/api/call-logs"),
        getJson<Escalation[]>("/api/escalations"),
        getJson<BlockedSlot[]>("/api/blocked-slots")
      ]);
      setHealth(healthResult.data ?? null);
      setSetup(setupResult.data ?? null);
      setAuditLogs(auditResult.data ?? []);
      setCallLogs(callResult.data ?? []);
      setEscalations(escalationResult.data ?? []);
      setBlockedSlots(blockedResult.data ?? []);
      setMessage("運用情報を取得しました");
    } catch (error) {
      setMessage(userFacingError(error, "運用情報の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function createBlockedSlot() {
    const now = new Date();
    const startsAt = new Date(now);
    startsAt.setHours(21, 0, 0, 0);
    const endsAt = new Date(now);
    endsAt.setHours(22, 0, 0, 0);
    try {
      await postJson("/api/blocked-slots", {
        startsAt,
        endsAt,
        reason: "スタッフ休憩時間",
        createdBy: "ops"
      });
      setMessage("21:00~22:00の営業時間ブロックを登録しました");
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "ブロック追加に失敗しました"));
    }
  }

  async function createEscalation() {
    try {
      await postJson("/api/escalations", {
        reason: "SPECIAL_REQUEST",
        summary: "チャネル連携確認: 自動対応の要約が不完全なケースを追加で確認します。",
        assignedTo: "manager"
      });
      setMessage("エスカレーションを作成しました");
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "エスカレーション作成に失敗しました"));
    }
  }

  async function createCallLog() {
    try {
      await postJson("/api/call-logs", {
        phoneNumber: "090-0000-0000",
        status: "SIMULATED",
        transcript: "サンプル着信。要件確認とルーティング判定を通過。",
        aiSummary: "営業時間内の案内フローを通過。再接続不要。",
        confidence: 0.82,
        requiredReview: false
      });
      setMessage("サンプル通話ログを作成しました");
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "通話ログ作成に失敗しました"));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] px-3 py-4 pb-28 text-[#101828] md:p-6 md:pb-6">
      <div className="arare-stack mx-auto max-w-7xl space-y-5">
        <RoleNav active="ops" />

        <header className="rounded-lg border border-[#d9e1ea] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
              <div className="text-sm font-black text-[#009b8f]">ARARE AI / Operations</div>
              <h1 className="mt-1 text-2xl font-black">障害監視（運用）ダッシュボード</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">DB / OpenAI / Twilio / Clerk / SMS / 電話AIを同一画面で監視し、デモ品質と本番前提の運用状態を判断します。</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatePill state={demoReady ? "ready" : "pending"} label={demoReady ? "全体準備完了" : "セットアップ中"} />
              <button
                onClick={refresh}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[#009b8f] px-4 text-sm font-black text-white"
              >
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                再読込
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-[#d9e1ea] bg-[#f8fbfc] p-2 text-sm font-bold text-slate-700">{message}</div>
        </header>

        <ScreenGuide
          eyebrow="Operations action lane"
          title="障害監視は「準備度 → 失敗数 → 監査ログ」の順で判断"
          description="デモ運用の稼働可否を最短で判断するため、先に失敗の有無を見て、次に監査・通話ログで切り分けます。"
          primaryAction={{ href: "/ops", label: "運用状態を再確認" }}
          secondaryAction={{ href: "/phone-ai", label: "電話AI設定へ" }}
          steps={[
            { title: "準備度を見る", body: "上段のカードでDB、OpenAI、Twilio、Clerkを確認します。" },
            { title: "失敗を探す", body: "SMS失敗、電話AI未接続、未設定envだけ赤く表示します。" },
            { title: "ログで追う", body: "監査ログ、通話ログ、エスカレーションから詰まりを確認します。", href: "/phone-ai", actionLabel: "電話設定へ" }
          ]}
        />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="デモ準備度" value={`${demoItems.filter((item) => item.state === "ready").length}/${demoItems.length}`} detail="店舗/AI/電話/SMS" state={demoReady ? "ready" : "pending"} />
          <SummaryTile label="環境変数" value={`${missingEnv.length}件未設定`} detail="productionChecklist" state={missingEnv.length === 0 ? "ready" : "blocked"} />
          <SummaryTile label="電話AI経路" value={`${setup?.phoneAi?.activeRouteCount ?? 0}/${setup?.phoneAi?.totalRouteCount ?? 0}`} detail="Webhook / Relay" state={(setup?.phoneAi?.routeReady ?? false) ? "ready" : "pending"} />
          <SummaryTile label="SMS送信" value={`${setup?.notifications?.sent ?? 0}件`} detail={`保留 ${setup?.notifications?.pending ?? 0} / 失敗 ${setup?.notifications?.failed ?? 0}`} state={(setup?.notifications?.failed ?? 0) > 0 ? "blocked" : "ready"} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Panel title="デモ起動チェック" icon={<ShieldCheck size={20} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              {demoItems.map((item) => <ReadinessCard key={item.key} item={item} icon={iconFor(item.key)} />)}
            </div>
          </Panel>
          <Panel title="運用アクション" icon={<Sparkles size={20} />}>
            <ActionItem onClick={createBlockedSlot} icon={<Ban size={18} />} title="営業時間ブロック" description="21:00〜22:00の固定ブロック枠を追加" />
            <ActionItem onClick={createEscalation} icon={<Headphones size={18} />} title="手動エスカレーション" description="要確認の運用メモを追加" />
            <ActionItem onClick={createCallLog} icon={<Phone size={18} />} title="テスト通話ログ" description="運用画面の受け口確認用のサンプルを作成" />
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="電話AI / 通話" icon={<Phone size={20} />}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="ルート準備" value={(setup?.phoneAi?.routeReady ? "準備完了" : "要確認")} state={setup?.phoneAi?.routeReady ? "ready" : "blocked"} />
              <Metric label="Webhook" value={(setup?.phoneAi?.voiceWebhookConfigured ? "登録済み" : "未登録")} state={setup?.phoneAi?.voiceWebhookConfigured ? "ready" : "blocked"} />
              <Metric label="通話ログ数" value={`${setup?.phoneAi?.callLogCount ?? callLogs.length}`} state={setup?.phoneAi?.logReady ? "ready" : "pending"} />
            </div>
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              最新: {setup?.phoneAi?.latestCallStatus ?? "未受信"}
              {setup?.phoneAi?.latestCallAt ? <span> / {time(setup.phoneAi.latestCallAt)}</span> : null}
              {setup?.phoneAi?.latestSummary ? <div className="mt-1 text-slate-700">{setup.phoneAi.latestSummary}</div> : null}
            </div>
          </Panel>

          <Panel title="SMS送信 / 通知" icon={<Bell size={20} />}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="SMS Ready" value={setup?.notifications?.smsReady ? "可" : "不可"} state={setup?.notifications?.smsReady ? "ready" : "blocked"} />
              <Metric label="配信済" value={`${setup?.notifications?.sent ?? 0}`} state="ready" />
              <Metric label="待機" value={`${setup?.notifications?.pending ?? 0}`} state={(setup?.notifications?.pending ?? 0) > 0 ? "pending" : "ready"} />
              <Metric label="失敗" value={`${setup?.notifications?.failed ?? 0}`} state={(setup?.notifications?.failed ?? 0) > 0 ? "blocked" : "ready"} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              SMS/Twilioの状態が「失敗」時は `/ops` で再確認し、TwilioアカウントとLINE/webhookの状態を確認してから再送してください。
            </p>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="外部連携の確認" icon={<Link2 size={20} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              {productionItems.map((item) => <ReadinessCard key={item.key} item={item} icon={iconFor(item.key)} />)}
            </div>
          </Panel>

          <Panel title="必須チェック / 任意チェック" icon={<Database size={20} />}>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-[#e5ebf2] bg-[#f8fbfc] p-3">
                <div className="mb-2 text-sm font-black">必須</div>
                {readiness.map((item) => (
                  <CompactStatus key={`r-${item.key}`} item={item} icon={iconFor(item.key)} />
                ))}
              </div>
              <div className="rounded-md border border-[#e5ebf2] bg-[#f8fbfc] p-3">
                <div className="mb-2 text-sm font-black">任意</div>
                {optionalItems.map((item) => <CompactStatus key={`o-${item.key}`} item={item} icon={iconFor(item.key)} />)}
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="認証・監査ログ" icon={<KeyRound size={20} />}>
            <div className="space-y-2">
              {missingEnv.length === 0 ? (
                <div className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-2 py-1 text-sm font-black text-emerald-700">
                  <CheckCircle2 size={16} />
                  必要環境変数はすべて揃っています
                </div>
              ) : (
                <div className="space-y-2">
                  {missingEnv.map((item) => (
                    <div key={item.name} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-sm text-amber-800">
                      <div className="font-black">{item.label ?? item.name}</div>
                      <div className="text-sm">{item.note ?? "未設定です。"} </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-md border border-[#e5ebf2] bg-white px-3 py-2 text-sm text-slate-600">
                Clerk有効: {features.clerk ? "有効" : "未設定（デモではローカル開発時に代替実行）"}
              </div>
              <DataList title="監査ログ" items={auditLogs.map((item) => `${time(item.createdAt)} ${item.actorType} ${item.action}`)} />
            </div>
          </Panel>

          <Panel title="通話ログ / エスカレーション" icon={<Headphones size={20} />}>
            <div className="space-y-2">
              <DataList title="通話ログ（最新12件）" items={callLogs.map((item) => `${time(item.createdAt)} ${item.phoneNumber ?? "-"} ${item.status} ${item.aiSummary ?? ""}`)} />
              <DataList title="エスカレーション" items={escalations.map((item) => `${time(item.createdAt)} ${item.status} ${item.reason}: ${item.summary}`)} />
              <DataList
                title="営業時間ブロック"
                items={blockedSlots.map((item) => `${time(item.startsAt)} - ${time(item.endsAt)} / ${item.reason}`)}
              />
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function defaultChecklistFromFeatures(features: Record<string, boolean>): ReadinessItem[] {
  return [
    featureItem("database", "DB接続", Boolean(features.database), "接続済み", "未接続または未設定"),
    featureItem("openai", "OpenAI", Boolean(features.openai), "設定済み", "未設定または要確認"),
    featureItem("twilio", "Twilio", Boolean(features.twilio), "設定済み", "未設定または要確認"),
    featureItem("line", "LINE", Boolean(features.line), "設定済み", "未設定または要確認"),
    featureItem("clerk", "Clerk", Boolean(features.clerk), "設定済み", "未設定または要確認")
  ];
}

function featureItem(key: string, label: string, ok: boolean, readyDetail: string, blockedDetail: string): ReadinessItem {
  return { key, label, state: ok ? "ready" : "blocked", detail: ok ? readyDetail : blockedDetail };
}

function iconFor(key: string): ReactNode {
  const icons: Record<string, ReactNode> = {
    database: <Database size={18} />,
    openai: <Bot size={18} />,
    twilio: <Phone size={18} />,
    line: <MessageCircle size={18} />,
    clerk: <KeyRound size={18} />,
    phoneRoute: <Phone size={18} />,
    phoneLog: <Headphones size={18} />,
    productionUrl: <Link2 size={18} />,
    sms: <Send size={18} />,
    demo: <ShieldCheck size={18} />,
  };
  return icons[key] ?? <ShieldCheck size={18} />;
}

function SummaryTile({ label, value, detail, state }: { label: string; value: string; detail: string; state: ReadinessState }) {
  const classes = stateClasses(state);
  return (
    <div className={`arare-metric rounded-md border px-4 py-3 ${classes.surface}`}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-black ${classes.text}`}>{value}</div>
      <div className="mt-1 text-xs font-bold text-slate-500">{detail}</div>
    </div>
  );
}

function ReadinessCard({ item, icon }: { item: ReadinessItem; icon: ReactNode }) {
  const classes = stateClasses(item.state);
  return (
    <div className={`rounded-lg border p-3 ${classes.surface}`}>
      <div className="mb-2 flex items-center justify-between gap-2 text-sm font-black">
        <span className="inline-flex items-center gap-2">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${classes.icon}`}>{icon}</span>
          {item.label}
        </span>
        <StatePill state={item.state} />
      </div>
      <p className="text-sm text-slate-600">{item.detail}</p>
    </div>
  );
}

function CompactStatus({ item, icon }: { item: ReadinessItem; icon: ReactNode }) {
  const classes = stateClasses(item.state);
  return (
    <div className={`rounded-md border px-3 py-2 ${classes.surface} mb-2`}>
      <div className="flex items-center justify-between text-sm font-black">
        <span className="inline-flex items-center gap-2">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${classes.icon}`}>{icon}</span>
          {item.label}
        </span>
        <StatePill state={item.state} />
      </div>
      <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
    </div>
  );
}

function Metric({ label, value, state }: { label: string; value: string; state: ReadinessState }) {
  const classes = stateClasses(state);
  return (
    <div className={`arare-metric rounded-md border px-3 py-3 ${classes.surface}`}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black ${classes.text}`}>{value}</div>
    </div>
  );
}

function ActionItem({ title, description, icon, onClick }: { title: string; description: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-2 w-full rounded-md border border-[#d9e1ea] bg-white p-3 text-left hover:border-[#009b8f] hover:bg-[#f4fffd]"
    >
      <div className="mb-1 inline-flex items-center gap-2 font-black">
        {icon}
        {title}
      </div>
      <div className="text-sm text-slate-600">{description}</div>
    </button>
  );
}

function DataList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-black text-slate-700">{title}</div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d9e1ea] px-3 py-2 text-sm text-slate-500">{title}はまだありません</div>
        ) : null}
        {items.slice(0, 8).map((item, index) => (
          <div key={`${item}-${index}`} className="rounded-md border border-[#e5ebf2] bg-[#f8fbfc] px-3 py-2 text-sm text-slate-700">{item}</div>
        ))}
      </div>
    </div>
  );
}

function StatePill({ state, label }: { state: ReadinessState; label?: string }) {
  const text = label ?? (state === "ready" ? "確認済み" : state === "pending" ? "要確認" : "提出不可");
  const classes = stateClasses(state);
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${classes.pill}`}>{text}</span>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="arare-panel rounded-lg border border-[#d9e1ea] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function stateClasses(state: ReadinessState) {
  if (state === "ready") {
    return {
      surface: "border-emerald-200 bg-emerald-50",
      icon: "bg-white text-emerald-700",
      pill: "bg-emerald-600 text-white",
      text: "text-emerald-700"
    };
  }
  if (state === "blocked") {
    return {
      surface: "border-red-200 bg-red-50",
      icon: "bg-white text-red-700",
      pill: "bg-red-600 text-white",
      text: "text-red-700"
    };
  }
  return {
    surface: "border-amber-200 bg-amber-50",
    icon: "bg-white text-amber-700",
    pill: "bg-amber-600 text-white",
    text: "text-amber-700"
  };
}

function time(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}



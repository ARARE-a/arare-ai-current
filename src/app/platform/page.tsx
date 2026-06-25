"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { RoleNav, ScreenGuide } from "@/components/UsabilityChrome";
import { userFacingError } from "@/lib/ui-errors";

type CheckStatus = "ready" | "warning" | "missing" | "unverified";

type PlatformCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  owner: string;
  idealState: string;
  requiredAction: string;
  blocksSubmission: boolean;
};

type OwnerProgress = { owner: string; total: number; ready: number; blocked: number; progress?: number; status?: "ready" | "blocked" | string };

type PlatformStore = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  openTime: string;
  closeTime: string;
  updatedAt: string | null;
  readinessScore: number;
  submissionGate: {
    status: "submit_allowed" | "submit_blocked";
    label: string;
    blockingCount: number;
    rule: string;
    blockers: {
      key: string;
      label: string;
      owner: string;
      status: CheckStatus;
      detail: string;
      requiredAction: string;
    }[];
  };
  ownerProgress: OwnerProgress[];
  checks: PlatformCheck[];
  metrics: {
    activeCourses: number;
    activeTherapists: number;
    therapistsWithLine: number;
    activeRooms: number;
    futureReservations: number;
    pendingNotifications: number;
    failedNotifications: number;
    historicalFailedNotifications?: number;
    sentSmsNotifications: number;
    deliveredSmsNotifications?: number;
    pendingSmsDeliveryNotifications?: number;
    lineConversations: number;
    reviewCallLogs: number;
  };
  latest: {
    homepageImportAt: string | null;
    manualProfileUpdateAt: string | null;
    lineConversationAt: string | null;
    callLogAt: string | null;
    phoneSettingUpdatedAt: string | null;
  };
  therapists: {
    displayName: string;
    status: string;
    hasLineId: boolean;
    hasProfile: boolean;
    acceptsNomination: boolean;
    nominationFee: number;
  }[];
  latestLineEvents: {
    conversationId: string;
    externalUserId: string | null;
    workflowState: string;
    role: string;
    content: string;
    createdAt: string | null;
  }[];
  recentIssues: { type: string; detail: string; createdAt: string | null }[];
};

type PlatformState = {
  generatedAt: string;
  environment: {
    lineWebhookPath: string;
    lineEnvReady: boolean;
    clerkEnvReady: boolean;
    twilioEnvReady: boolean;
    smsEnvReady: boolean;
    secretsAreMasked: boolean;
  };
  summary: {
    storeCount: number;
    readyStores: number;
    warningStores: number;
    blockedStores: number;
    totalFailedNotifications: number;
    totalTherapistsMissingLine: number;
  };
  ownerProgress?: OwnerProgress[];
  stores: PlatformStore[];
};

const statusLabel: Record<CheckStatus, string> = {
  ready: "確認済み",
  warning: "要注意",
  missing: "未設定",
  unverified: "未確認"
};

const statusClass: Record<CheckStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  missing: "border-rose-200 bg-rose-50 text-rose-900",
  unverified: "border-sky-200 bg-sky-50 text-sky-900"
};

function formatDate(value: string | null) {
  if (!value) return "未記録";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function scoreTone(score: number) {
  if (score >= 90) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (score >= 60) return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function shortText(value: string, max = 140) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function storeAttention(store: PlatformStore) {
  if (
    store.submissionGate.status === "submit_blocked" ||
    store.submissionGate.blockingCount > 0 ||
    store.checks.some((check) => check.blocksSubmission)
  ) {
    return {
      label: "提出不可",
      description: "提出ブロック項目があります",
      className: "border-rose-200 bg-rose-50 text-rose-900"
    };
  }

  if (store.checks.some((check) => check.status === "unverified")) {
    return {
      label: "未確認あり",
      description: "外部サービスや本番反映の確認が必要です",
      className: "border-sky-200 bg-sky-50 text-sky-900"
    };
  }

  if (store.readinessScore < 90 || store.checks.some((check) => check.status === "warning" || check.status === "missing")) {
    return {
      label: "要注意",
      description: "提出前に内容確認が必要です",
      className: "border-amber-200 bg-amber-50 text-amber-900"
    };
  }

  return {
    label: "確認済み",
    description: "画面上の判定ではブロックなし",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900"
  };
}

export default function PlatformPage() {
  const [state, setState] = useState<PlatformState | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch("/api/platform/stores", { cache: "no-store" })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`platform api failed: ${response.status} ${text.slice(0, 160)}`);
        }
        if (!contentType.includes("application/json")) {
          throw new Error("platform api returned non-json response. ログイン状態を確認してください。");
        }
        return response.json() as Promise<PlatformState>;
      })
      .then((data) => {
        if (!alive) return;

        setState(data);
        setSelectedStoreId((current) => {
          if (current && data.stores.some((store) => store.id === current)) return current;
          return data.stores[0]?.id ?? null;
        });
      })
      .catch((reason) => {
        if (alive) setError(userFacingError(reason, "管理APIの取得に失敗しました"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const selectedStore = useMemo(() => {
    if (!state?.stores.length) return null;
    return state.stores.find((store) => store.id === selectedStoreId) ?? state.stores[0] ?? null;
  }, [selectedStoreId, state?.stores]);

  const blockedChecks = useMemo(() => selectedStore?.checks.filter((check) => check.blocksSubmission) ?? [], [selectedStore]);

  return (
    <main className="arare-page min-h-screen bg-[#eef5f8] px-4 py-6 pb-28 text-slate-950 md:px-8">
      <div className="arare-stack mx-auto max-w-7xl space-y-6">
        <header className="rounded-[28px] border border-[#d8e5ee] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#008b83]">ARARE AI / PLATFORM CONTROL</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">ARARE AI 管理コンソール</h1>
              <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
                複数店舗の導入状況、LINE接続、電話AI、SMS、Clerk、通知失敗を監視します。店舗側の日常運用画面とは分けて、提出前の確認項目を整理します。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="min-h-12 rounded-2xl border border-[#cbd8e3] bg-white px-5 text-sm font-black text-slate-700 shadow-sm hover:bg-[#f8fbfc]"
            >
              再読み込み
            </button>
          </div>
        </header>

        <RoleNav active="platform" />

        <ScreenGuide
          eyebrow="Platform action lane"
          title="ARARE側は、店舗を選ぶ - 接続を見る - 壊れた項目を直す"
          description="LINEは現場を動かす入口、Platformは全店舗を俯瞰する司令塔です。理想状態に届いていない店舗は、スコアと不足項目で止めます。"
          primaryAction={{ href: "/setup", label: "店舗導入設定へ" }}
          secondaryAction={{ href: "/store-v2", label: "店舗画面を見る" }}
          steps={[
            { title: "導入状況を見る", body: "店舗情報、コース、セラピスト、部屋、HP取込証跡を確認します。" },
            { title: "接続状態を見る", body: "LINE、Twilio、SMS、Clerkの未設定と未確認を分けて確認します。" },
            { title: "障害を潰す", body: "通知失敗、LINE ID不足、要確認通話を担当ごとに修正します。" }
          ]}
        />

        {loading ? <Notice tone="blue" title="管理APIを読み込み中" body="店舗状況と接続状態を取得しています。" /> : null}
        {error ? <Notice tone="red" title="管理APIの取得に失敗しました" body={error} /> : null}

        {state ? (
          <>
            <section className="grid gap-3 md:grid-cols-5">
              <Metric label="店舗数" value={state.summary.storeCount} caption={`API返却 ${state.stores.length} 件`} />
              <Metric label="90点以上" value={state.summary.readyStores} caption="画面上の高スコア店舗" />
              <Metric label="要注意" value={state.summary.warningStores} caption="60-89点" danger={state.summary.warningStores > 0} />
              <Metric label="提出不可" value={state.summary.blockedStores} caption="60点未満またはブロックあり" danger={state.summary.blockedStores > 0} />
              <Metric label="LINE ID不足" value={state.summary.totalTherapistsMissingLine} caption="全店舗合計" danger={state.summary.totalTherapistsMissingLine > 0} />
            </section>

            <OwnerProgressBoard items={state.ownerProgress ?? []} />

            <Notice
              tone="blue"
              title="確認範囲の注意"
              body="この画面は /api/platform/stores の返却値を表示します。本番LINE、SMS、電話着信など外部サービスの実到達は、別途本番環境での確認が必要です。"
            />

            <section className="rounded-[28px] border border-[#d8e5ee] bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">全体環境</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <EnvCard label="LINE環境" ready={state.environment.lineEnvReady} detail="LINE Channel Secret / Access Token" />
                <EnvCard label="Twilio環境" ready={state.environment.twilioEnvReady} detail="Account SID / Auth Token" />
                <EnvCard label="SMS環境" ready={state.environment.smsEnvReady} detail="SMS送信元番号" />
                <EnvCard label="Clerk環境" ready={state.environment.clerkEnvReady} detail="Publishable / Secret Key" />
              </div>
            </section>

            <section className="rounded-[28px] border border-[#d8e5ee] bg-white p-5 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[1fr_260px] lg:items-start">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-[#008b83]">LINE PRODUCTION CHECK</p>
                  <h2 className="mt-2 text-xl font-black">LINE本番接続の合格条件</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    コードだけでは合格にしません。LINE Developersから本番Webhookへ実イベントが届き、DBと店舗画面に反映された証跡が必要です。
                  </p>
                </div>
                <div className="rounded-2xl border border-[#dbe7ee] bg-[#f8fbfc] p-4 text-sm font-black text-slate-700">
                  <p className="text-xs text-slate-500">Webhook URL</p>
                  <p className="mt-1 break-all">https://arare-ai-three.vercel.app/api/line/webhook</p>
                </div>
              </div>
            </section>

            <StoreSelector stores={state.stores} selectedStoreId={selectedStore?.id ?? selectedStoreId} onSelect={setSelectedStoreId} />

            {selectedStore ? (
              <StoreControl store={selectedStore} blockedChecks={blockedChecks} />
            ) : (
              <Notice tone="red" title="店舗がありません" body="管理対象の店舗データが見つかりません。" />
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}

function StoreSelector({
  stores,
  selectedStoreId,
  onSelect
}: {
  stores: PlatformStore[];
  selectedStoreId: string | null;
  onSelect: (storeId: string) => void;
}) {
  if (stores.length === 0) return null;

  return (
    <section className="arare-panel rounded-[28px] border border-[#d8e5ee] bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#008b83]">STORE SELECTOR</p>
          <h2 className="mt-2 text-xl font-black">表示する店舗を選択</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            /api/platform/stores が返した最大100店舗から、確認したい店舗を選べます。下の詳細、チェック項目、LINE履歴は選択店舗に連動します。
          </p>
        </div>
        <label className="min-w-full text-sm font-black text-slate-700 lg:min-w-[360px]">
          店舗
          <select
            value={selectedStoreId ?? ""}
            onChange={(event) => onSelect(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-[#cbd8e3] bg-white px-4 text-sm font-black text-slate-800 shadow-sm outline-none focus:border-[#008b83] focus:ring-4 focus:ring-[#008b83]/10"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name} / {store.readinessScore}点 / {storeAttention(store).label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StatusLegend />

      <div className="mt-4 grid max-h-[360px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-4">
        {stores.map((store) => {
          const attention = storeAttention(store);
          const selected = store.id === selectedStoreId;

          return (
            <button
              key={store.id}
              type="button"
              onClick={() => onSelect(store.id)}
              className={`rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
                selected ? "border-[#008b83] bg-[#eefdfa] ring-4 ring-[#008b83]/10" : "border-[#dbe7ee] bg-[#f8fbfc]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 text-sm font-black text-slate-900">{store.name}</p>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${attention.className}`}>{attention.label}</span>
              </div>
              <p className="mt-2 text-xs font-bold text-slate-500">{store.phone ?? "電話番号未設定"}</p>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs font-black text-slate-600">
                <span>スコア {store.readinessScore}</span>
                <span>ブロック {store.submissionGate.blockingCount}件</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusLegend() {
  const items = [
    { label: "未確認", body: "本番反映や外部サービス側の証跡が足りない状態", className: "border-sky-200 bg-sky-50 text-sky-900" },
    { label: "要注意", body: "提出前に人の確認や設定見直しが必要な状態", className: "border-amber-200 bg-amber-50 text-amber-900" },
    { label: "提出不可", body: "ブロック項目が残っており提出条件を満たさない状態", className: "border-rose-200 bg-rose-50 text-rose-900" }
  ];

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className={`rounded-2xl border p-3 ${item.className}`}>
          <p className="text-sm font-black">{item.label}</p>
          <p className="mt-1 text-xs font-bold leading-5 opacity-85">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

function OwnerProgressBoard({ items }: { items: OwnerProgress[] }) {
  if (items.length === 0) return null;

  return (
    <section className="arare-panel rounded-[28px] border border-[#d8e5ee] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#008b83]">OWNER PROGRESS</p>
          <h2 className="mt-2 text-xl font-black">担当別進捗/提出ブロック</h2>
        </div>
        <p className="text-sm font-black text-slate-500">ブロックが0件になるまで提出不可</p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const progress = item.progress ?? (item.total > 0 ? Math.round((item.ready / item.total) * 100) : 0);
          const blocked = item.blocked > 0;
          return (
            <article key={item.owner} className={`rounded-2xl border p-4 ${blocked ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-black text-slate-900">{item.owner}</h3>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${blocked ? "bg-rose-700 text-white" : "bg-emerald-700 text-white"}`}>
                  {blocked ? `ブロック ${item.blocked}` : "確認済み"}
                </span>
              </div>
              <p className="mt-3 text-2xl font-black">{item.ready}/{item.total}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div className={`h-full ${blocked ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs font-bold text-slate-600">進捗 {progress}%</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoreControl({ store, blockedChecks }: { store: PlatformStore; blockedChecks: PlatformCheck[] }) {
  const missingLineCount = Math.max(0, store.metrics.activeTherapists - store.metrics.therapistsWithLine);
  const attention = storeAttention(store);
  const submissionPanelClass =
    store.submissionGate.status === "submit_allowed" && blockedChecks.length === 0
      ? "border-emerald-100 bg-emerald-50"
      : "border-rose-100 bg-rose-50";

  return (
    <article className="arare-panel rounded-[28px] border border-[#d8e5ee] bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#008b83]">STORE CONTROL</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black">{store.name}</h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${attention.className}`}>{attention.label}</span>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-600">
            {store.phone ?? "電話番号未設定"} / {store.address ?? "住所未設定"}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-500">
            営業時間 {store.openTime} - {store.closeTime} / 更新 {formatDate(store.updatedAt)}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500">{attention.description}</p>
        </div>
        <div className={`min-w-[220px] rounded-3xl border p-5 text-center ${store.submissionGate.status === "submit_allowed" ? scoreTone(store.readinessScore) : "border-rose-200 bg-rose-50 text-rose-900"}`}>
          <p className="text-xs font-black">管理状態スコア</p>
          <p className="mt-1 text-5xl font-black">{store.readinessScore}</p>
          <p className="text-xs font-bold">{store.submissionGate.label} / ブロック {store.submissionGate.blockingCount}件</p>
        </div>
      </div>

      <section className={`mt-5 rounded-2xl border p-4 ${submissionPanelClass}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className={`text-sm font-black ${blockedChecks.length > 0 ? "text-rose-900" : "text-emerald-900"}`}>
              提出判定: {blockedChecks.length > 0 ? "提出不可" : store.submissionGate.label}
            </h3>
            <p className={`mt-1 text-xs font-bold leading-5 ${blockedChecks.length > 0 ? "text-rose-800" : "text-emerald-800"}`}>
              {store.submissionGate.rule}
            </p>
          </div>
          <Link href="/setup" className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-white px-4 text-sm font-black text-rose-700">
            修正導線へ
          </Link>
        </div>
        {blockedChecks.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {blockedChecks.slice(0, 6).map((check) => <Blocker key={check.key} check={check} />)}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-white bg-white/75 p-3 text-xs font-bold text-slate-600">
            この画面上は提出ブロック項目がありません。ただし、本番LINEやSMSの実到達確認は別途必要です。
          </p>
        )}
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-5">
        <Metric label="LINE ID未登録" value={missingLineCount} caption={`${store.metrics.therapistsWithLine}/${store.metrics.activeTherapists}名登録`} danger={missingLineCount > 0} />
        <Metric
          label="通知失敗"
          value={store.metrics.failedNotifications}
          caption={`過去失敗 ${store.metrics.historicalFailedNotifications ?? 0}件は参考値`}
          danger={store.metrics.failedNotifications > 0}
        />
        <Metric
          label="SMS到達"
          value={store.metrics.deliveredSmsNotifications ?? 0}
          caption={`callback未確認 ${store.metrics.pendingSmsDeliveryNotifications ?? 0}件`}
          danger={(store.metrics.pendingSmsDeliveryNotifications ?? 0) > 0 || store.metrics.failedNotifications > 0}
        />
        <Metric label="未来予約" value={store.metrics.futureReservations} caption="今後の予約件数" />
        <Metric label="部屋" value={store.metrics.activeRooms} caption="有効ルーム数" danger={store.metrics.activeRooms === 0} />
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {store.checks.map((check) => <CheckCard key={check.key} check={check} />)}
      </section>

      <section className="mt-5 rounded-2xl border border-[#dbe7ee] bg-[#f8fbfc] p-4">
        <h3 className="text-sm font-black">担当別進捗俯瞰</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {store.ownerProgress.map((owner) => (
            <div key={owner.owner} className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-xs font-black text-slate-700">{owner.owner}</p>
              <p className="mt-1 text-lg font-black">{owner.ready}/{owner.total}</p>
              <p className={`mt-1 text-[11px] font-black ${owner.blocked > 0 ? "text-rose-700" : "text-emerald-700"}`}>{owner.blocked > 0 ? `ブロック ${owner.blocked}件` : "ブロックなし"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel title="LINE / 出勤 / 退店の確認ライン">
          <div className="space-y-2">
            {store.therapists.map((therapist) => (
              <div key={therapist.displayName} className="rounded-xl border border-[#e2eaf1] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black">{therapist.displayName}</p>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${therapist.hasLineId ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{therapist.hasLineId ? "LINE IDあり" : "LINE IDなし"}</span>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  特徴: {therapist.hasProfile ? "登録あり" : "未登録"} / 指名料 {therapist.nominationFee.toLocaleString()}円
                </p>
              </div>
            ))}
            {store.therapists.length === 0 ? <Empty text="セラピスト情報がまだありません。" /> : null}
          </div>
        </Panel>

        <Panel title="最新LINEイベント">
          <div className="space-y-2">
            {store.latestLineEvents.slice(0, 12).map((event, index) => (
              <div key={`${event.conversationId}-${event.createdAt}-${index}`} className="rounded-xl border border-[#e2eaf1] bg-white p-3">
                <div className="flex items-center justify-between gap-2 text-xs font-black text-slate-500">
                  <span>{event.role} / {event.workflowState}</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-bold leading-5 text-slate-700">{shortText(event.content)}</p>
                <p className="mt-1 break-all text-[11px] font-bold text-slate-400">{event.externalUserId ?? "externalUserIdなし"}</p>
              </div>
            ))}
            {store.latestLineEvents.length === 0 ? <Empty text="LINEイベントはまだありません。" /> : null}
          </div>
        </Panel>
      </section>

      <Panel title="最近の障害/要確認" className="mt-5">
        <div className="grid gap-2 md:grid-cols-2">
          {store.recentIssues.map((issue, index) => (
            <div key={`${issue.type}-${issue.createdAt}-${index}`} className="rounded-xl border border-rose-100 bg-white p-3">
              <p className="text-sm font-black text-rose-700">{issue.type}</p>
              <p className="mt-1 text-xs font-bold text-slate-600">{issue.detail}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">{formatDate(issue.createdAt)}</p>
            </div>
          ))}
          {store.recentIssues.length === 0 ? <Empty text="現在の障害/要確認はありません。" /> : null}
        </div>
      </Panel>
    </article>
  );
}

function CheckCard({ check }: { check: PlatformCheck }) {
  const label = check.blocksSubmission ? "提出不可" : statusLabel[check.status];
  const labelClass = check.blocksSubmission ? "bg-rose-700 text-white" : "bg-white/80";

  return (
    <div className={`arare-card rounded-2xl border p-4 ${statusClass[check.status]}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black">{check.label}</h3>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${labelClass}`}>{label}</span>
      </div>
      <p className="mt-2 text-[11px] font-black opacity-80">担当: {check.owner}</p>
      <p className="mt-2 text-xs font-bold leading-5 opacity-85">{check.detail}</p>
      <p className="mt-2 rounded-xl bg-white/65 p-2 text-[11px] font-bold leading-4 opacity-85">理想: {check.idealState}</p>
      {check.blocksSubmission ? <p className="mt-2 text-[11px] font-black text-rose-700">必要対応: {check.requiredAction}</p> : null}
    </div>
  );
}

function Blocker({ check }: { check: PlatformCheck }) {
  return (
    <div className="rounded-xl border border-white bg-white/80 p-3">
      <p className="text-xs font-black text-rose-800">{check.owner} / {check.label}</p>
      <p className="mt-1 text-[11px] font-bold leading-4 text-slate-600">{check.detail}</p>
      <p className="mt-1 text-[11px] font-black leading-4 text-rose-700">{check.requiredAction}</p>
    </div>
  );
}

function Metric({ label, value, caption, danger }: { label: string; value: number | string; caption: string; danger?: boolean }) {
  return (
    <div className={`arare-metric rounded-2xl border p-4 ${danger ? "border-rose-200 bg-rose-50" : "border-[#dbe7ee] bg-white"}`}>
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-black ${danger ? "text-rose-700" : "text-slate-950"}`}>{value}</p>
      <p className="mt-1 text-xs font-bold text-slate-500">{caption}</p>
    </div>
  );
}

function EnvCard({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className={`arare-card rounded-2xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">{label}</p>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${ready ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{ready ? "環境あり" : "未設定"}</span>
      </div>
      <p className="mt-2 text-xs font-bold text-slate-600">{detail}</p>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`arare-panel rounded-2xl border border-[#dbe7ee] bg-[#f8fbfc] p-4 ${className}`}>
      <h3 className="text-sm font-black">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Notice({ tone, title, body }: { tone: "blue" | "red"; title: string; body: string }) {
  const className = tone === "red" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-sky-200 bg-sky-50 text-sky-800";
  return (
    <section className={`arare-panel rounded-[28px] border p-5 text-sm font-bold ${className}`}>
      <h2 className="font-black">{title}</h2>
      <p className="mt-2 leading-6">{body}</p>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="arare-empty rounded-xl border border-dashed border-[#d8e1e8] bg-white px-4 py-3 text-sm font-bold text-slate-400">{text}</div>;
}

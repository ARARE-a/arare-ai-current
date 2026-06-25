"use client";

import { useEffect, useMemo, useState } from "react";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { AlertTriangle, Building2, CheckCircle2, DoorOpen, ExternalLink, Link2, Plus, RefreshCw, Save, UserRound, WalletCards } from "lucide-react";
import { userFacingError } from "@/lib/ui-errors";

type StoreProfile = {
  store: { name?: string | null; phone?: string | null; address?: string | null; openTime?: string | null; closeTime?: string | null } | null;
  courses: Array<{ id: string; name: string; durationMin: number; price: number; description?: string | null }>;
  therapists: Array<{ id: string; displayName: string; phone?: string | null; lineId?: string | null; profile?: string | null; nominationFee: number; acceptsNomination: boolean }>;
  rooms: Array<{ id: string; name: string }>;
  homepageImportEvidence?: { id: string; createdAt: string; after?: unknown } | null;
};

const emptyStore = { name: "", phone: "", address: "", openTime: "12:00", closeTime: "29:00" };
const emptyCourse = { name: "", durationMin: 90, price: 12000, description: "" };
const emptyTherapist = { displayName: "", phone: "", lineId: "", profile: "", nominationFee: 0, acceptsNomination: true };
const emptyRoom = { name: "" };

const therapistProfileFields = [
  { key: "personality", label: "性格", placeholder: "落ち着いた接客、聞き上手、初回向き", wide: false },
  { key: "height", label: "身長", placeholder: "160cm", wide: false },
  { key: "bust", label: "バスト", placeholder: "Cカップ、控えめ、グラマーなど", wide: false },
  { key: "hip", label: "ヒップ", placeholder: "すらっと、丸みあり、小柄など", wide: false },
  { key: "face", label: "顔/雰囲気", placeholder: "清楚系、きれいめ、可愛い系など", wide: false },
  { key: "lookalike", label: "似てる雰囲気", placeholder: "芸能人名ではなく、雰囲気だけ", wide: false },
  { key: "type", label: "タイプ", placeholder: "癒し系、会話好き、静かめなど", wide: false },
  { key: "specialties", label: "得意施術", placeholder: "フェザータッチ、ディープリンパ、ホイップなど", wide: true },
  { key: "sm", label: "SM傾向", placeholder: "ソフトS寄り、受け身寄り、落ち着いた案内など", wide: false },
  { key: "scope", label: "対応範囲", placeholder: "登録コース内、鼠径部リンパ重点など。断定NGは書かない", wide: true },
  { key: "popularity", label: "人気傾向", placeholder: "初回人気、夜帯人気、リピート多めなど", wide: false },
  { key: "memo", label: "自由メモ", placeholder: "電話AIに読ませたい補足。禁止事項や断定NGもここに残す", wide: true }
] as const;

type TherapistProfileKey = (typeof therapistProfileFields)[number]["key"];
type TherapistProfileFieldMap = Record<TherapistProfileKey, string>;
type TherapistRecord = StoreProfile["therapists"][number];

export default function SetupPage() {
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [store, setStore] = useState(emptyStore);
  const [course, setCourse] = useState(emptyCourse);
  const [therapist, setTherapist] = useState(emptyTherapist);
  const [room, setRoom] = useState(emptyRoom);
  const [homepageUrl, setHomepageUrl] = useState("");
  const [message, setMessage] = useState("店舗導入情報を読み込み中");
  const [loading, setLoading] = useState(false);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [lastSavedTarget, setLastSavedTarget] = useState<string | null>(null);

  async function load(nextMessage = "店舗導入情報を読み込みました") {
    setLoading(true);
    try {
      const response = await fetch("/api/store-profile", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "店舗情報の取得に失敗しました");
      const data = payload.data as StoreProfile;
      setProfile(data);
      setStore({
        name: data.store?.name ?? "",
        phone: data.store?.phone ?? "",
        address: data.store?.address ?? "",
        openTime: data.store?.openTime ?? "12:00",
        closeTime: data.store?.closeTime ?? "29:00"
      });
      setMessage(nextMessage);
    } catch (error) {
      setMessage(userFacingError(error, "店舗情報の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const score = useMemo(() => {
    const checks = [
      Boolean(store.name),
      Boolean(store.phone),
      Boolean(store.address),
      Boolean(store.openTime && store.closeTime),
      Boolean(profile?.courses.length),
      Boolean(profile?.therapists.length),
      Boolean(profile?.rooms.length),
      Boolean(profile?.therapists.length && profile.therapists.every((item) => item.lineId))
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [store, profile]);
  const missingLineTherapists = useMemo(() => (profile?.therapists ?? []).filter((item) => !item.lineId), [profile]);

  async function saveStore() {
    await postProfile({ store }, "店舗基本情報を保存しました", "store");
  }

  async function addCourse() {
    if (!course.name) return setMessage("コース名を入力してください");
    await postProfile({ courses: [course] }, "コースを保存しました", "course");
    setCourse(emptyCourse);
  }

  async function addTherapist() {
    if (!therapist.displayName) return setMessage("セラピスト名を入力してください");
    await postProfile({ therapists: [therapist] }, "セラピスト情報とLINE連携設定を保存しました", "therapist");
    setTherapist(emptyTherapist);
  }

  async function addRoom() {
    if (!room.name) return setMessage("部屋名を入力してください");
    await postProfile({ rooms: [room] }, "部屋情報を保存しました", "room");
    setRoom(emptyRoom);
  }

  async function importHomepage() {
    if (!homepageUrl) return setMessage("ホームページURLを入力してください");
    setLoading(true);
    try {
      const response = await fetch("/api/store-import/homepage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: homepageUrl })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "ホームページ読取に失敗しました");
      setMessage("ホームページ情報を読み取り、DBへ反映しました");
      await load();
    } catch (error) {
      setMessage(userFacingError(error, "ホームページ読取に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function postProfile(body: unknown, success: string, target: string) {
    setLoading(true);
    setSavingTarget(target);
    setLastSavedTarget(null);
    setMessage("保存中です。画面を閉じずにお待ちください。");
    try {
      const response = await fetch("/api/store-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存に失敗しました");
      const savedAt = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      await load(`${success}（${savedAt} 保存）`);
      setLastSavedTarget(target);
    } catch (error) {
      setLastSavedTarget(null);
      setMessage(userFacingError(error, "保存に失敗しました"));
    } finally {
      setSavingTarget(null);
      setLoading(false);
    }
  }

  return (
    <main className="arare-page min-h-screen bg-[#eef4f7] px-3 py-4 pb-28 text-slate-950 md:p-6">
      <div className="arare-stack mx-auto max-w-7xl space-y-5">
        <RoleNav active="setup" />

        <header className="rounded-[28px] border border-[#d8e1e8] bg-white p-5 shadow-sm md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#00796f]">ARARE AI / Store Onboarding</p>
              <h1 className="mt-2 text-3xl font-black md:text-5xl">店舗導入フォーム</h1>
              <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
                店舗情報、コース、セラピスト、LINE ID、部屋をここで登録します。保存した内容は電話AI、管理画面、SMS本文の参照元になります。
              </p>
            </div>
            <button onClick={() => void load()} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#d9e1ea] bg-white px-4 text-sm font-black">
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              再読込
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
            <div aria-live="polite" className="rounded-2xl border border-[#dfe8ee] bg-[#f8fbfc] px-4 py-3 text-sm font-black text-slate-700">{message}</div>
            <div className={`rounded-2xl px-5 py-3 text-sm font-black ${score >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              導入充足度 {score}%
            </div>
          </div>
        </header>

        <ScreenGuide
          eyebrow="Onboarding action lane"
          title="店舗導入は「読み取り → 修正 → 保存 → 画面反映」までを1つの流れにする"
          description="ホームページから拾えない情報は手入力で補完します。AIに捏造させず、店舗が確認した情報だけをDBへ保存します。"
          primaryAction={{ href: "/store-v2", label: "店舗作業台で反映を見る" }}
          secondaryAction={{ href: "/ops", label: "運用チェックを見る" }}
          steps={[
            { title: "URL読取", body: "店舗HPがあればURLを入れて、営業時間・コース・出勤候補を抽出します。" },
            { title: "不足を手入力", body: "住所、料金、セラピスト特徴、LINE ID、部屋を店舗側で確定します。" },
            { title: "全導線へ反映", body: "保存後は電話AI、LINE、管理画面、SMS本文が同じDBを参照します。" }
          ]}
        />

        <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <Panel title="ホームページ読み取り" icon={<ExternalLink size={20} />}>
            <div className="flex flex-col gap-3 md:flex-row">
              <input value={homepageUrl} onChange={(event) => setHomepageUrl(event.target.value)} placeholder="https://example.com" className="min-h-12 flex-1 rounded-2xl border border-[#d9e1ea] px-4 text-sm font-bold outline-none focus:border-[#008b83]" />
              <button onClick={importHomepage} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#008b83] px-5 text-sm font-black text-white">
                <Link2 size={18} /> 読み取って保存
              </button>
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500">抽出できない情報は捏造せず、下の手入力欄で補完します。</p>
          </Panel>

          <Panel title="導入証跡" icon={<CheckCircle2 size={20} />}>
            <div className="text-sm font-bold text-slate-600">
              最新監査ログ: {profile?.homepageImportEvidence?.id ?? "未作成"}
              <br />
              作成日時: {profile?.homepageImportEvidence?.createdAt ? new Date(profile.homepageImportEvidence.createdAt).toLocaleString("ja-JP") : "未確認"}
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title="店舗基本情報" icon={<Building2 size={20} />}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="店舗名" value={store.name} onChange={(value) => setStore({ ...store, name: value })} />
              <Field label="電話番号" value={store.phone} onChange={(value) => setStore({ ...store, phone: value })} />
              <Field label="住所" value={store.address} onChange={(value) => setStore({ ...store, address: value })} wide />
              <Field label="営業時間 開始" value={store.openTime} onChange={(value) => setStore({ ...store, openTime: value })} />
              <Field label="営業時間 終了" value={store.closeTime} onChange={(value) => setStore({ ...store, closeTime: value })} />
            </div>
            <SaveButton onClick={saveStore} label="店舗情報を保存" saving={savingTarget === "store"} saved={lastSavedTarget === "store"} />
          </Panel>

          <Panel title="登録済み情報" icon={<CheckCircle2 size={20} />}>
            <div className="grid gap-3 md:grid-cols-3">
              <CountCard label="コース" value={`${profile?.courses.length ?? 0}件`} />
              <CountCard label="セラピスト" value={`${profile?.therapists.length ?? 0}名`} />
              <CountCard label="部屋" value={`${profile?.rooms.length ?? 0}室`} />
            </div>
            <div className="mt-3 rounded-2xl border border-[#dce6ee] bg-[#f8fbfc] p-3 text-sm font-bold text-slate-600">
              LINE ID登録済み: {profile?.therapists.filter((item) => item.lineId).length ?? 0}名
            </div>
            {missingLineTherapists.length ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-700">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} />
                  提出不可: LINE ID未登録のセラピストがいます
                </div>
                <p className="mt-2 text-xs leading-6">
                  未登録: {missingLineTherapists.map((item) => item.displayName).join("、")}
                  <br />
                  出勤・退室・担当通知を使うには、各セラピスト本人のLINEから取得したLINE IDを登録してください。
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-700">
                全セラピストのLINE ID登録済み
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <Panel title="コース・料金" icon={<WalletCards size={20} />}>
            <Field label="コース名" value={course.name} onChange={(value) => setCourse({ ...course, name: value })} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="分数" value={String(course.durationMin)} onChange={(value) => setCourse({ ...course, durationMin: Number(value || 0) })} />
              <Field label="料金" value={String(course.price)} onChange={(value) => setCourse({ ...course, price: Number(value || 0) })} />
            </div>
            <Field label="説明" value={course.description} onChange={(value) => setCourse({ ...course, description: value })} />
            <SaveButton onClick={addCourse} label="コースを追加/更新" icon={<Plus size={18} />} saving={savingTarget === "course"} saved={lastSavedTarget === "course"} />
            <List items={(profile?.courses ?? []).map((item) => `${item.name} / ${item.durationMin}分 / ${item.price.toLocaleString("ja-JP")}円`)} empty="コース未登録" />
          </Panel>

          <Panel title="セラピスト・LINE連携" icon={<UserRound size={20} />}>
            <Field label="名前" value={therapist.displayName} onChange={(value) => setTherapist({ ...therapist, displayName: value })} />
            <Field label="LINE ID" value={therapist.lineId} onChange={(value) => setTherapist({ ...therapist, lineId: value })} />
            <Field label="電話番号" value={therapist.phone} onChange={(value) => setTherapist({ ...therapist, phone: value })} />
            <TherapistProfileEditor value={therapist.profile} onChange={(value) => setTherapist({ ...therapist, profile: value })} />
            <Field label="指名料" value={String(therapist.nominationFee)} onChange={(value) => setTherapist({ ...therapist, nominationFee: Number(value || 0) })} />
            <SaveButton onClick={addTherapist} label="セラピストを追加/更新" icon={<Plus size={18} />} saving={savingTarget === "therapist"} saved={lastSavedTarget === "therapist"} />
            <TherapistSummaryList
              therapists={profile?.therapists ?? []}
              onEdit={(item) =>
                setTherapist({
                  displayName: item.displayName,
                  phone: item.phone ?? "",
                  lineId: item.lineId ?? "",
                  profile: item.profile ?? "",
                  nominationFee: item.nominationFee ?? 0,
                  acceptsNomination: item.acceptsNomination ?? true
                })
              }
            />
          </Panel>

          <Panel title="部屋" icon={<DoorOpen size={20} />}>
            <Field label="部屋名" value={room.name} onChange={(value) => setRoom({ name: value })} />
            <SaveButton onClick={addRoom} label="部屋を追加/更新" icon={<Plus size={18} />} saving={savingTarget === "room"} saved={lastSavedTarget === "room"} />
            <List items={(profile?.rooms ?? []).map((item) => item.name)} empty="部屋未登録" />
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="arare-panel rounded-[28px] border border-[#d8e1e8] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">{icon}{title}</div>
      {children}
    </section>
  );
}

function TherapistProfileEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const fields = parseTherapistProfile(value);
  const filledCount = therapistProfileFields.filter((field) => fields[field.key]).length;
  const preview = buildTherapistProfile(fields);

  return (
    <div className="mt-3 rounded-2xl border border-[#dfe8ee] bg-[#f8fbfc] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-slate-500">AIプロフィール詳細</div>
          <div className="mt-1 text-sm font-black text-slate-900">電話AIが質問別に返答する参照データ</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-[#00796f]">
          {filledCount}/{therapistProfileFields.length}項目
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {therapistProfileFields.map((field) => (
          <ProfileField
            key={field.key}
            label={field.label}
            value={fields[field.key]}
            placeholder={field.placeholder}
            wide={Boolean(field.wide)}
            multiline={Boolean(field.wide)}
            onChange={(nextValue) => onChange(updateTherapistProfileField(value, field.key, nextValue))}
          />
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-[#e2eaf1] bg-white px-3 py-2">
        <div className="text-xs font-black text-slate-500">保存形式プレビュー</div>
        <p className="mt-1 break-words text-xs font-bold leading-6 text-slate-600">
          {preview || "未入力です。保存前に性格・得意施術・対応範囲だけでも入れてください。"}
        </p>
      </div>
    </div>
  );
}

function ProfileField({
  label,
  value,
  placeholder,
  onChange,
  wide = false,
  multiline = false
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  wide?: boolean;
  multiline?: boolean;
}) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-black text-slate-500">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="min-h-24 w-full resize-y rounded-2xl border border-[#d9e1ea] px-3 py-2 text-sm font-bold outline-none focus:border-[#008b83]"
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 w-full rounded-2xl border border-[#d9e1ea] px-3 text-sm font-bold outline-none focus:border-[#008b83]"
        />
      )}
    </label>
  );
}

function TherapistSummaryList({ therapists, onEdit }: { therapists: TherapistRecord[]; onEdit: (item: TherapistRecord) => void }) {
  if (!therapists.length) return <List items={[]} empty="セラピスト未登録" />;

  return (
    <div className="mt-3 space-y-3">
      {therapists.map((item) => {
        const fields = parseTherapistProfile(item.profile);
        return (
          <div key={item.id} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900">{item.displayName}</div>
                <div className="mt-1 text-xs font-bold leading-5 text-slate-500">
                  LINE: {item.lineId || "未登録"} / 指名料 {item.nominationFee.toLocaleString("ja-JP")}円 / {item.acceptsNomination ? "指名可" : "指名停止"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="min-h-9 rounded-xl border border-[#d9e1ea] bg-white px-3 text-xs font-black text-slate-700"
              >
                編集
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <ProfilePreview label="性格" value={fields.personality || "未登録"} />
              <ProfilePreview label="雰囲気" value={fields.face || fields.type || "未登録"} />
              <ProfilePreview label="得意施術" value={fields.specialties || "未登録"} />
              <ProfilePreview label="対応範囲" value={fields.scope || "未登録"} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfilePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e2eaf1] bg-white px-3 py-2">
      <div className="text-[11px] font-black text-slate-400">{label}</div>
      <div className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-700">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-black text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-2xl border border-[#d9e1ea] px-3 text-sm font-bold outline-none focus:border-[#008b83]" />
    </label>
  );
}

function SaveButton({
  onClick,
  label,
  icon = <Save size={18} />,
  saving = false,
  saved = false
}: {
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  saving?: boolean;
  saved?: boolean;
}) {
  const stateClass = saved ? "bg-emerald-600" : "bg-[#008b83]";
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white ${stateClass} disabled:cursor-wait disabled:opacity-80`}
    >
      {saving ? <RefreshCw size={18} className="animate-spin" /> : saved ? <CheckCircle2 size={18} /> : icon}
      {saving ? "保存中..." : saved ? "保存しました" : label}
    </button>
  );
}

function CountCard({ label, value }: { label: string; value: string }) {
  return <div className="arare-metric rounded-2xl border border-[#dce6ee] bg-[#f8fbfc] p-3"><div className="text-xs font-black text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>;
}

function List({ items, empty }: { items: string[]; empty: string }) {
  return <div className="mt-3 space-y-2">{items.length ? items.map((item) => <div key={item} className="rounded-2xl border border-[#e2eaf1] bg-[#f8fbfc] px-3 py-2 text-sm font-bold text-slate-700">{item}</div>) : <div className="arare-empty rounded-2xl border border-dashed border-[#d8e1e8] px-3 py-2 text-sm font-bold text-slate-400">{empty}</div>}</div>;
}

function createEmptyTherapistProfileFields(): TherapistProfileFieldMap {
  const fields = {} as TherapistProfileFieldMap;
  for (const field of therapistProfileFields) fields[field.key] = "";
  return fields;
}

function parseTherapistProfile(profile?: string | null): TherapistProfileFieldMap {
  const fields = createEmptyTherapistProfileFields();
  const source = (profile ?? "").trim();
  if (!source) return fields;

  let matched = 0;
  for (const chunk of source.split(/[｜|\n\r;；]+/u)) {
    const part = chunk.trim();
    if (!part) continue;
    const match = part.match(/^([^:：]+)[:：]\s*(.+)$/u);
    if (!match) continue;
    const key = normalizeTherapistProfileFieldKey(match[1]);
    if (!key) continue;
    const nextValue = cleanTherapistProfileValue(match[2]);
    if (!nextValue) continue;
    fields[key] = fields[key] ? `${fields[key]}、${nextValue}` : nextValue;
    matched += 1;
  }

  if (!matched) fields.memo = source;
  return fields;
}

function updateTherapistProfileField(profile: string, key: TherapistProfileKey, value: string): string {
  const fields = parseTherapistProfile(profile);
  fields[key] = cleanTherapistProfileValue(value);
  return buildTherapistProfile(fields);
}

function buildTherapistProfile(fields: TherapistProfileFieldMap): string {
  return therapistProfileFields
    .map((field) => {
      const value = cleanTherapistProfileValue(fields[field.key]);
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean)
    .join("｜");
}

function cleanTherapistProfileValue(value?: string | null): string {
  return (value ?? "")
    .replace(/\r?\n+/g, "、")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeTherapistProfileFieldKey(label: string): TherapistProfileKey | null {
  const normalized = label.trim().replace(/\s+/g, "").toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("性格")) return "personality";
  if (normalized.includes("身長")) return "height";
  if (normalized.includes("バスト") || normalized.includes("胸") || normalized.includes("カップ")) return "bust";
  if (normalized.includes("ヒップ") || normalized.includes("お尻") || normalized.includes("尻")) return "hip";
  if (normalized.includes("似て") || normalized.includes("似") || normalized.includes("芸能人")) return "lookalike";
  if (normalized.includes("顔") || normalized.includes("雰囲気") || normalized.includes("見た目") || normalized.includes("ルックス")) return "face";
  if (normalized.includes("タイプ") || normalized.includes("系統")) return "type";
  if (normalized.includes("得意") || normalized.includes("施術") || normalized.includes("特徴")) return "specialties";
  if (normalized.includes("sm") || normalized.includes("s寄り") || normalized.includes("m寄り")) return "sm";
  if (normalized.includes("対応範囲") || normalized.includes("どこまで") || normalized.includes("範囲") || normalized.includes("案内範囲")) return "scope";
  if (normalized.includes("人気") || normalized.includes("リピート") || normalized.includes("指名")) return "popularity";
  if (normalized.includes("メモ") || normalized.includes("補足") || normalized.includes("備考")) return "memo";
  return null;
}

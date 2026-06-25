"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, Trash2, UserCog } from "lucide-react";

import { RoleNav } from "@/components/UsabilityChrome";
import { userFacingError } from "@/lib/ui-errors";

type UserRole = "OWNER" | "MANAGER" | "STAFF";

type PermissionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

type PermissionStore = {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
};

type PermissionState = {
  context: {
    storeId: string;
    actorEmail?: string;
    actorRole?: string;
    isPlatformAdmin: boolean;
    source: string;
  };
  store: PermissionStore;
  stores: PermissionStore[];
  users: PermissionUser[];
  idealRoles: { role: UserRole; label: string; capability: string }[];
};

const emptyForm = { id: "", name: "", email: "", role: "STAFF" as UserRole };

const roleLabel: Record<UserRole, string> = {
  OWNER: "オーナー",
  MANAGER: "マネージャー",
  STAFF: "スタッフ"
};

export default function PermissionsPage() {
  const [state, setState] = useState<PermissionState | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("権限情報を読み込み中");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  async function load(storeId = selectedStoreId) {
    setLoading(true);
    try {
      const url = new URL("/api/permissions/users", window.location.origin);
      if (storeId) url.searchParams.set("storeId", storeId);
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "権限情報の取得に失敗しました");
      const data = payload.data as PermissionState;
      setState(data);
      setSelectedStoreId(data.context.storeId);
      setMessage("権限情報を反映しました");
    } catch (error) {
      setMessage(userFacingError(error, "権限情報の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleCounts = useMemo(() => {
    const counts: Record<UserRole, number> = { OWNER: 0, MANAGER: 0, STAFF: 0 };
    for (const user of state?.users ?? []) counts[user.role] += 1;
    return counts;
  }, [state?.users]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/permissions/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          storeId: selectedStoreId ?? state?.context.storeId,
          name: form.name,
          email: form.email,
          role: form.role
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "権限の保存に失敗しました");
      setForm(emptyForm);
      setMessage("権限を保存しました。Clerk側のユーザー登録は別途確認してください。");
      await load(selectedStoreId);
    } catch (error) {
      setMessage(userFacingError(error, "権限の保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(user: PermissionUser) {
    if (!window.confirm(`${user.email} を権限一覧から削除しますか？`)) return;
    setSaving(true);
    try {
      const url = new URL("/api/permissions/users", window.location.origin);
      url.searchParams.set("id", user.id);
      if (selectedStoreId) url.searchParams.set("storeId", selectedStoreId);
      const response = await fetch(url, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "権限削除に失敗しました");
      setMessage("権限を削除しました");
      await load(selectedStoreId);
    } catch (error) {
      setMessage(userFacingError(error, "権限削除に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  function editUser(user: PermissionUser) {
    setForm({ id: user.id, name: user.name, email: user.email, role: user.role });
  }

  return (
    <main className="arare-page min-h-screen bg-[#eef4f7] px-3 py-4 pb-28 text-slate-950 md:p-6">
      <div className="arare-stack mx-auto max-w-7xl space-y-5">
        <RoleNav active="permissions" />

        <header className="rounded-2xl border border-[#d8e1e8] bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#008b83]">ARARE AI / Clerk Access</p>
              <h1 className="mt-2 text-3xl font-black md:text-4xl">権限管理</h1>
              <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
                Clerkログイン後に参照する店舗ユーザー権限を管理します。提出判定では、権限DBの整備と実ログイン操作確認を分けて監視します。
              </p>
            </div>
            <button
              onClick={() => void load(selectedStoreId)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#d9e1ea] bg-white px-4 text-sm font-black"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              再読込
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-[#e0e8ee] bg-[#f8fbfc] px-4 py-3 text-sm font-black text-slate-700">{message}</div>
        </header>

        {state ? (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <Metric label="OWNER" value={roleCounts.OWNER} danger={roleCounts.OWNER === 0} />
              <Metric label="MANAGER" value={roleCounts.MANAGER} danger={roleCounts.MANAGER === 0} />
              <Metric label="STAFF" value={roleCounts.STAFF} danger={roleCounts.STAFF === 0} />
              <Metric label="店舗" value={state.store.name} />
            </section>

            <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <form onSubmit={submit} className="arare-panel rounded-2xl border border-[#d8e1e8] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <UserCog size={20} />
                  <h2 className="text-xl font-black">{form.id ? "権限を更新" : "権限を追加"}</h2>
                </div>

                {state.context.isPlatformAdmin && state.stores.length > 1 ? (
                  <label className="mt-4 block text-sm font-black text-slate-700">
                    店舗
                    <select
                      value={selectedStoreId ?? state.context.storeId}
                      onChange={(event) => {
                        setSelectedStoreId(event.target.value);
                        setForm(emptyForm);
                        void load(event.target.value);
                      }}
                      className="mt-2 min-h-12 w-full rounded-xl border border-[#cbd8e3] bg-white px-4 text-sm font-black outline-none focus:border-[#008b83] focus:ring-4 focus:ring-[#008b83]/10"
                    >
                      {state.stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="mt-4 block text-sm font-black text-slate-700">
                  名前
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#cbd8e3] px-4 text-sm font-bold outline-none focus:border-[#008b83] focus:ring-4 focus:ring-[#008b83]/10"
                    placeholder="山田 太郎"
                  />
                </label>

                <label className="mt-4 block text-sm font-black text-slate-700">
                  Clerkログインメール
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#cbd8e3] px-4 text-sm font-bold outline-none focus:border-[#008b83] focus:ring-4 focus:ring-[#008b83]/10"
                    placeholder="owner@example.com"
                  />
                </label>

                <label className="mt-4 block text-sm font-black text-slate-700">
                  権限
                  <select
                    value={form.role}
                    onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserRole }))}
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#cbd8e3] bg-white px-4 text-sm font-black outline-none focus:border-[#008b83] focus:ring-4 focus:ring-[#008b83]/10"
                  >
                    <option value="OWNER">OWNER / オーナー</option>
                    <option value="MANAGER">MANAGER / マネージャー</option>
                    <option value="STAFF">STAFF / スタッフ</option>
                  </select>
                </label>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button disabled={saving} className="min-h-12 rounded-xl bg-[#008b83] text-sm font-black text-white disabled:cursor-wait disabled:opacity-70">
                    {saving ? "保存中" : "保存"}
                  </button>
                  <button type="button" onClick={() => setForm(emptyForm)} className="min-h-12 rounded-xl border border-[#d9e1ea] text-sm font-black">
                    クリア
                  </button>
                </div>
              </form>

              <section className="arare-panel rounded-2xl border border-[#d8e1e8] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={20} />
                  <h2 className="text-xl font-black">権限一覧</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {state.users.map((user) => (
                    <article key={user.id} className="arare-card rounded-xl border border-[#e2eaf1] bg-[#f8fbfc] p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black">{user.name}</h3>
                            <RolePill role={user.role} />
                          </div>
                          <p className="mt-1 break-all text-sm font-bold text-slate-600">{user.email}</p>
                          <p className="mt-1 text-xs font-bold text-slate-400">更新 {formatDate(user.updatedAt)}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => editUser(user)} className="min-h-10 rounded-xl border border-[#cbd8e3] bg-white px-4 text-xs font-black">
                            編集
                          </button>
                          <button onClick={() => void removeUser(user)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-xs font-black text-rose-700">
                            <Trash2 size={14} />
                            削除
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {state.users.length === 0 ? <Empty text="権限ユーザーは未登録です。" /> : null}
                </div>
              </section>
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              {state.idealRoles.map((role) => (
                <article key={role.role} className="arare-card rounded-xl border border-[#d8e1e8] bg-white p-4 shadow-sm">
                  <RolePill role={role.role} />
                  <h3 className="mt-3 text-lg font-black">{role.label}</h3>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{role.capability}</p>
                </article>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metric({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <article className={`arare-metric rounded-xl border p-4 shadow-sm ${danger ? "border-rose-200 bg-rose-50" : "border-[#d8e1e8] bg-white"}`}>
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${danger ? "text-rose-700" : "text-slate-950"}`}>{value}</p>
    </article>
  );
}

function RolePill({ role }: { role: UserRole }) {
  const className =
    role === "OWNER"
      ? "bg-[#082033] text-white"
      : role === "MANAGER"
        ? "bg-[#008b83] text-white"
        : "bg-slate-100 text-slate-700";

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${className}`}>{roleLabel[role]}</span>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function Empty({ text }: { text: string }) {
  return <div className="arare-empty rounded-xl border border-dashed border-[#d8e1e8] bg-[#f8fbfc] px-4 py-3 text-sm font-bold text-slate-400">{text}</div>;
}

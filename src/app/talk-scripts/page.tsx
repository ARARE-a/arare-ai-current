"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Edit3, MessageSquareText, Plus, Save } from "lucide-react";
import {
  ActionButton,
  AdminPanel,
  AdminShell,
  DataTable,
  EmptyState,
  Field,
  RefreshButton,
  StatusPill,
  TableCell,
  TableHeader,
  TextareaField,
  adminUserFacingError,
  formatDateTime
} from "@/components/AdminUi";

type ApiResult<T> = { data?: T; error?: string };
type TalkScriptItem = {
  id: string;
  title: string;
  situation: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt?: string;
};

const emptyForm = { id: "", title: "", situation: "初回受付", content: "", isActive: true, sortOrder: 0 };

export default function TalkScriptsPage() {
  const [items, setItems] = useState<TalkScriptItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [situation, setSituation] = useState("all");
  const [message, setMessage] = useState("TalkScriptを読み込み中");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "TalkScriptを取得しました") {
    setLoading(true);
    try {
      const data = await requestJson<TalkScriptItem[]>("/api/talk-scripts");
      setItems(data ?? []);
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "TalkScriptの取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const situations = useMemo(() => Array.from(new Set(items.map((item) => item.situation))).sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const inSituation = situation === "all" || item.situation === situation;
      const inQuery = !q || [item.title, item.situation, item.content].join("\n").toLowerCase().includes(q);
      return inSituation && inQuery;
    });
  }, [items, query, situation]);

  async function save() {
    if (!form.title.trim() || !form.situation.trim() || !form.content.trim()) {
      setMessage("タイトル、状況、台本文を入力してください");
      return;
    }
    setSaving(true);
    try {
      await requestJson<TalkScriptItem>("/api/talk-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          title: form.title,
          situation: form.situation,
          content: form.content,
          isActive: form.isActive,
          sortOrder: Number(form.sortOrder) || 0
        })
      });
      setForm(emptyForm);
      await load(form.id ? "TalkScriptを更新しました" : "TalkScriptを追加しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "TalkScriptの保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    setSaving(true);
    try {
      await requestJson<TalkScriptItem>(`/api/talk-scripts/${id}`, { method: "DELETE" });
      await load("TalkScriptを無効化しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "TalkScriptの無効化に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      active="talk-scripts"
      title="TalkScript管理"
      subtitle="電話・LINE・Webチャットで使う応対台本を、状況別に整理します。値引きや未確認情報を含む台本は登録しません。"
      message={message}
      metrics={[
        { label: "登録", value: `${items.length}件` },
        { label: "有効", value: `${items.filter((item) => item.isActive).length}件`, tone: "green" },
        { label: "状況", value: `${situations.length}種` },
        { label: "検索結果", value: `${filtered.length}件` }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <AdminPanel title={form.id ? "TalkScriptを編集" : "TalkScriptを追加"} icon={<MessageSquareText size={20} />}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="表示順" value={form.sortOrder} onChange={(value) => setForm({ ...form, sortOrder: Number(value) || 0 })} type="number" />
            <Field label="状況" value={form.situation} onChange={(value) => setForm({ ...form, situation: value })} placeholder="初回受付、料金確認、予約変更など" required />
            <Field label="タイトル" value={form.title} onChange={(value) => setForm({ ...form, title: value })} wide required />
            <TextareaField label="台本文" value={form.content} onChange={(value) => setForm({ ...form, content: value })} rows={9} required />
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] px-3 text-sm font-black">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-5 w-5 accent-[#008b83]" />
            有効として応対候補に含める
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void save()} label={form.id ? "更新" : "追加"} icon={form.id ? <Save size={16} /> : <Plus size={16} />} disabled={saving} />
            {form.id ? <ActionButton onClick={() => setForm(emptyForm)} label="新規入力に戻す" tone="secondary" icon={<Edit3 size={16} />} /> : null}
          </div>
        </AdminPanel>

        <AdminPanel title="TalkScript一覧" icon={<MessageSquareText size={20} />}>
          <div className="mb-3 grid gap-3 md:grid-cols-[1fr_220px]">
            <Field label="検索" value={query} onChange={setQuery} placeholder="タイトル、状況、台本文で検索" />
            <label className="block">
              <span className="mb-1 block text-xs font-black text-slate-500">状況</span>
              <select value={situation} onChange={(event) => setSituation(event.target.value)} className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold outline-none focus:border-[#008b83]">
                <option value="all">すべて</option>
                {situations.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {filtered.length === 0 ? (
            <EmptyState text="条件に一致するTalkScriptはありません。" />
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {filtered.map((item) => (
                  <article key={`mobile-${item.id}`} className="rounded-xl border border-[#dfe8ee] bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-500">表示順 {item.sortOrder} / {item.situation}</div>
                        <h3 className="mt-1 break-words text-sm font-black text-slate-950">{item.title}</h3>
                      </div>
                      <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-line break-words text-sm font-bold leading-6 text-slate-700">{item.content}</p>
                    <div className="mt-2 text-[11px] font-bold text-slate-500">更新 {formatDateTime(item.updatedAt)}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton onClick={() => setForm({ id: item.id, title: item.title, situation: item.situation, content: item.content, isActive: item.isActive, sortOrder: item.sortOrder })} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
                      {item.isActive ? <ActionButton onClick={() => void deactivate(item.id)} label="無効化" icon={<Ban size={16} />} tone="danger" disabled={saving} /> : null}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <DataTable>
              <table className="min-w-[780px] w-full border-collapse">
                <TableHeader>
                  <tr>
                    <th className="px-3 py-3 text-left">表示順</th>
                    <th className="px-3 py-3 text-left">タイトル</th>
                    <th className="px-3 py-3 text-left">状況</th>
                    <th className="px-3 py-3 text-left">台本文</th>
                    <th className="px-3 py-3 text-left">状態</th>
                    <th className="px-3 py-3 text-left">更新</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </TableHeader>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <TableCell>{item.sortOrder}</TableCell>
                      <TableCell className="w-[180px]">
                        <div className="font-black text-slate-900">{item.title}</div>
                      </TableCell>
                      <TableCell>{item.situation}</TableCell>
                      <TableCell className="max-w-[300px]">
                        <p className="line-clamp-3 whitespace-pre-line leading-6">{item.content}</p>
                      </TableCell>
                      <TableCell>
                        <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                      </TableCell>
                      <TableCell>{formatDateTime(item.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <ActionButton onClick={() => setForm({ id: item.id, title: item.title, situation: item.situation, content: item.content, isActive: item.isActive, sortOrder: item.sortOrder })} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
                          {item.isActive ? <ActionButton onClick={() => void deactivate(item.id)} label="無効化" icon={<Ban size={16} />} tone="danger" disabled={saving} /> : null}
                        </div>
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
      </section>
    </AdminShell>
  );
}

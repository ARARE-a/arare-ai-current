"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, BookOpenText, Edit3, Plus, Save } from "lucide-react";
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
type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  content: string;
  source?: string | null;
  isActive: boolean;
  updatedAt?: string;
};

const emptyForm = { id: "", title: "", category: "店舗基本情報", content: "", source: "", isActive: true };

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [message, setMessage] = useState("KnowledgeBaseを読み込み中");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "KnowledgeBaseを取得しました") {
    setLoading(true);
    try {
      const data = await requestJson<KnowledgeItem[]>("/api/knowledge");
      setItems(data ?? []);
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "KnowledgeBaseの取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const categories = useMemo(() => Array.from(new Set(items.map((item) => item.category))).sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const inCategory = category === "all" || item.category === category;
      const inQuery = !q || [item.title, item.category, item.content, item.source ?? ""].join("\n").toLowerCase().includes(q);
      return inCategory && inQuery;
    });
  }, [items, query, category]);

  async function save() {
    if (!form.title.trim() || !form.category.trim() || !form.content.trim()) {
      setMessage("タイトル、カテゴリ、本文を入力してください");
      return;
    }
    setSaving(true);
    try {
      await requestJson<KnowledgeItem>("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          title: form.title,
          category: form.category,
          content: form.content,
          source: form.source || null,
          isActive: form.isActive
        })
      });
      setForm(emptyForm);
      await load(form.id ? "KnowledgeBaseを更新しました" : "KnowledgeBaseを追加しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "KnowledgeBaseの保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    setSaving(true);
    try {
      await requestJson<KnowledgeItem>(`/api/knowledge/${id}`, { method: "DELETE" });
      await load("KnowledgeBaseを無効化しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "KnowledgeBaseの無効化に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  const metrics = [
    { label: "登録", value: `${items.length}件`, caption: "全カテゴリ" },
    { label: "有効", value: `${items.filter((item) => item.isActive).length}件`, tone: "green" as const },
    { label: "無効", value: `${items.filter((item) => !item.isActive).length}件`, tone: "amber" as const },
    { label: "カテゴリ", value: `${categories.length}種` }
  ];

  return (
    <AdminShell
      active="knowledge"
      title="KnowledgeBase管理"
      subtitle="電話AI・LINE・Webチャットが参照する店舗情報を、確認済みの本文として登録します。未確認情報は登録せず、出典欄に根拠を残します。"
      message={message}
      metrics={metrics}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <AdminPanel title={form.id ? "KnowledgeBaseを編集" : "KnowledgeBaseを追加"} icon={<BookOpenText size={20} />}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="タイトル" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
            <Field label="カテゴリ" value={form.category} onChange={(value) => setForm({ ...form, category: value })} required />
            <Field label="出典/根拠" value={form.source} onChange={(value) => setForm({ ...form, source: value })} placeholder="店舗HP、スタッフ確認、料金表など" wide />
            <TextareaField label="本文" value={form.content} onChange={(value) => setForm({ ...form, content: value })} rows={8} required />
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] px-3 text-sm font-black">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-5 w-5 accent-[#008b83]" />
            有効としてAI回答候補に含める
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void save()} label={form.id ? "更新" : "追加"} icon={form.id ? <Save size={16} /> : <Plus size={16} />} disabled={saving} />
            {form.id ? <ActionButton onClick={() => setForm(emptyForm)} label="新規入力に戻す" tone="secondary" icon={<Edit3 size={16} />} /> : null}
          </div>
        </AdminPanel>

        <AdminPanel title="一覧と検索" icon={<BookOpenText size={20} />}>
          <div className="mb-3 grid gap-3 md:grid-cols-[1fr_220px]">
            <Field label="検索" value={query} onChange={setQuery} placeholder="タイトル、本文、出典で検索" />
            <label className="block">
              <span className="mb-1 block text-xs font-black text-slate-500">カテゴリ</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold outline-none focus:border-[#008b83]">
                <option value="all">すべて</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {filtered.length === 0 ? (
            <EmptyState text="条件に一致するKnowledgeBaseはありません。" />
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {filtered.map((item) => (
                  <article key={`mobile-${item.id}`} className="rounded-xl border border-[#dfe8ee] bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-black text-slate-950">{item.title}</h3>
                        <p className="mt-1 break-words text-xs font-bold text-slate-500">{item.source || "出典未入力"}</p>
                      </div>
                      <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black text-slate-500">
                      <span className="rounded-full bg-[#f3f7fa] px-2 py-1">{item.category}</span>
                      <span className="rounded-full bg-[#f3f7fa] px-2 py-1">{formatDateTime(item.updatedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-line break-words text-sm font-bold leading-6 text-slate-700">{item.content}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton
                        onClick={() => setForm({ id: item.id, title: item.title, category: item.category, content: item.content, source: item.source ?? "", isActive: item.isActive })}
                        label="編集"
                        icon={<Edit3 size={16} />}
                        tone="secondary"
                      />
                      {item.isActive ? <ActionButton onClick={() => void deactivate(item.id)} label="無効化" icon={<Ban size={16} />} tone="danger" disabled={saving} /> : null}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <DataTable>
              <table className="min-w-[760px] w-full border-collapse">
                <TableHeader>
                  <tr>
                    <th className="px-3 py-3 text-left">タイトル</th>
                    <th className="px-3 py-3 text-left">カテゴリ</th>
                    <th className="px-3 py-3 text-left">本文</th>
                    <th className="px-3 py-3 text-left">状態</th>
                    <th className="px-3 py-3 text-left">更新</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </TableHeader>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <TableCell className="w-[170px]">
                        <div className="font-black text-slate-900">{item.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.source || "出典未入力"}</div>
                      </TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <p className="line-clamp-3 whitespace-pre-line text-sm leading-6">{item.content}</p>
                      </TableCell>
                      <TableCell>
                        <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                      </TableCell>
                      <TableCell>{formatDateTime(item.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            onClick={() => setForm({ id: item.id, title: item.title, category: item.category, content: item.content, source: item.source ?? "", isActive: item.isActive })}
                            label="編集"
                            icon={<Edit3 size={16} />}
                            tone="secondary"
                          />
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

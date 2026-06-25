"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Edit3, FileQuestion, Plus, Save } from "lucide-react";
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
type FaqItem = {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt?: string;
};

const emptyForm = { id: "", question: "", answer: "", isActive: true, sortOrder: 0 };

export default function FaqPage() {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("FAQを読み込み中");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "FAQを取得しました") {
    setLoading(true);
    try {
      const data = await requestJson<FaqItem[]>("/api/faq");
      setItems(data ?? []);
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "FAQの取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => [item.question, item.answer].join("\n").toLowerCase().includes(q));
  }, [items, query]);

  async function save() {
    if (!form.question.trim() || !form.answer.trim()) {
      setMessage("質問と回答を入力してください");
      return;
    }
    setSaving(true);
    try {
      await requestJson<FaqItem>("/api/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          question: form.question,
          answer: form.answer,
          isActive: form.isActive,
          sortOrder: Number(form.sortOrder) || 0
        })
      });
      setForm(emptyForm);
      await load(form.id ? "FAQを更新しました" : "FAQを追加しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "FAQの保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    setSaving(true);
    try {
      await requestJson<FaqItem>(`/api/faq/${id}`, { method: "DELETE" });
      await load("FAQを無効化しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "FAQの無効化に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      active="faq"
      title="FAQ管理"
      subtitle="よくある質問と回答を、AIが参照できる確定済みの文面として管理します。推測回答を避けるため、未確認の内容は登録しません。"
      message={message}
      metrics={[
        { label: "登録", value: `${items.length}件` },
        { label: "有効", value: `${items.filter((item) => item.isActive).length}件`, tone: "green" },
        { label: "無効", value: `${items.filter((item) => !item.isActive).length}件`, tone: "amber" },
        { label: "検索結果", value: `${filtered.length}件` }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <AdminPanel title={form.id ? "FAQを編集" : "FAQを追加"} icon={<FileQuestion size={20} />}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="表示順" value={form.sortOrder} onChange={(value) => setForm({ ...form, sortOrder: Number(value) || 0 })} type="number" />
            <Field label="質問" value={form.question} onChange={(value) => setForm({ ...form, question: value })} required />
            <TextareaField label="回答" value={form.answer} onChange={(value) => setForm({ ...form, answer: value })} rows={8} required />
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] px-3 text-sm font-black">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-5 w-5 accent-[#008b83]" />
            有効としてFAQに含める
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void save()} label={form.id ? "更新" : "追加"} icon={form.id ? <Save size={16} /> : <Plus size={16} />} disabled={saving} />
            {form.id ? <ActionButton onClick={() => setForm(emptyForm)} label="新規入力に戻す" tone="secondary" icon={<Edit3 size={16} />} /> : null}
          </div>
        </AdminPanel>

        <AdminPanel title="FAQ一覧" icon={<FileQuestion size={20} />}>
          <div className="mb-3">
            <Field label="検索" value={query} onChange={setQuery} placeholder="質問または回答で検索" />
          </div>
          {filtered.length === 0 ? (
            <EmptyState text="条件に一致するFAQはありません。" />
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {filtered.map((item) => (
                  <article key={`mobile-${item.id}`} className="rounded-xl border border-[#dfe8ee] bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-500">表示順 {item.sortOrder}</div>
                        <h3 className="mt-1 break-words text-sm font-black text-slate-950">{item.question}</h3>
                      </div>
                      <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-line break-words text-sm font-bold leading-6 text-slate-700">{item.answer}</p>
                    <div className="mt-2 text-[11px] font-bold text-slate-500">更新 {formatDateTime(item.updatedAt)}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton onClick={() => setForm({ id: item.id, question: item.question, answer: item.answer, isActive: item.isActive, sortOrder: item.sortOrder })} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
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
                    <th className="px-3 py-3 text-left">表示順</th>
                    <th className="px-3 py-3 text-left">質問</th>
                    <th className="px-3 py-3 text-left">回答</th>
                    <th className="px-3 py-3 text-left">状態</th>
                    <th className="px-3 py-3 text-left">更新</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </TableHeader>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <TableCell>{item.sortOrder}</TableCell>
                      <TableCell className="w-[210px]">
                        <div className="font-black text-slate-900">{item.question}</div>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <p className="line-clamp-3 whitespace-pre-line leading-6">{item.answer}</p>
                      </TableCell>
                      <TableCell>
                        <StatusPill text={item.isActive ? "有効" : "無効"} tone={item.isActive ? "green" : "amber"} />
                      </TableCell>
                      <TableCell>{formatDateTime(item.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <ActionButton onClick={() => setForm({ id: item.id, question: item.question, answer: item.answer, isActive: item.isActive, sortOrder: item.sortOrder })} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Save, ShieldAlert } from "lucide-react";
import {
  ActionButton,
  AdminPanel,
  AdminShell,
  EmptyState,
  RefreshButton,
  StatusPill,
  TextareaField,
  ToggleRow,
  adminUserFacingError,
  formatDateTime
} from "@/components/AdminUi";

type ApiResult<T> = { data?: T; error?: string };
type NgAnswerSettings = {
  ngWords: string[];
  ngResponseRules: string;
  forbiddenAnswers: string[];
  escalationKeywords: string[];
  requireHumanApproval: boolean;
  updatedAt?: string | null;
};

const emptySettings: NgAnswerSettings = {
  ngWords: [],
  ngResponseRules: "",
  forbiddenAnswers: [],
  escalationKeywords: [],
  requireHumanApproval: true,
  updatedAt: null
};

export default function NgAnswersPage() {
  const [settings, setSettings] = useState(emptySettings);
  const [ngWordsText, setNgWordsText] = useState("");
  const [forbiddenText, setForbiddenText] = useState("");
  const [escalationText, setEscalationText] = useState("");
  const [ngResponseRules, setNgResponseRules] = useState("");
  const [requireHumanApproval, setRequireHumanApproval] = useState(true);
  const [message, setMessage] = useState("NG回答設定を読み込み中");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function load(nextMessage = "NG回答設定を取得しました") {
    setLoading(true);
    try {
      const data = (await requestJson<NgAnswerSettings>("/api/ng-answers")) ?? emptySettings;
      setSettings(data);
      setNgWordsText(data.ngWords.join("\n"));
      setForbiddenText(data.forbiddenAnswers.join("\n"));
      setEscalationText(data.escalationKeywords.join("\n"));
      setNgResponseRules(data.ngResponseRules ?? "");
      setRequireHumanApproval(data.requireHumanApproval);
      setMessage(nextMessage);
    } catch (error) {
      setMessage(adminUserFacingError(error, "NG回答設定の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const preview = useMemo(
    () => ({
      ngWords: toList(ngWordsText),
      forbiddenAnswers: toList(forbiddenText),
      escalationKeywords: toList(escalationText)
    }),
    [ngWordsText, forbiddenText, escalationText]
  );

  async function save() {
    setSaving(true);
    try {
      const data = await requestJson<NgAnswerSettings>("/api/ng-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ngWords: preview.ngWords,
          forbiddenAnswers: preview.forbiddenAnswers,
          escalationKeywords: preview.escalationKeywords,
          ngResponseRules,
          requireHumanApproval
        })
      });
      setSettings(data ?? emptySettings);
      setMessage("NG回答設定を保存しました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "NG回答設定の保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      active="ng-answers"
      title="NG回答管理"
      subtitle="AIが回答してはいけない内容、NGワード、人の確認へ回す語句を管理します。未登録情報を事実として話させないための運用画面です。"
      message={message}
      metrics={[
        { label: "禁止回答", value: `${preview.forbiddenAnswers.length}件`, tone: preview.forbiddenAnswers.length ? "red" : "slate" },
        { label: "NGワード", value: `${preview.ngWords.length}件`, tone: preview.ngWords.length ? "amber" : "slate" },
        { label: "エスカレーション", value: `${preview.escalationKeywords.length}件`, tone: "blue" },
        { label: "最終更新", value: formatDateTime(settings.updatedAt), caption: "DB上の更新日時" }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <AdminPanel title="NG回答設定" icon={<ShieldAlert size={20} />}>
          <div className="grid gap-3">
            <TextareaField label="禁止回答（1行1件）" value={forbiddenText} onChange={setForbiddenText} rows={7} placeholder="例: 値引きできます / セラピストの個人連絡先を教えます" />
            <TextareaField label="NGワード（1行1件）" value={ngWordsText} onChange={setNgWordsText} rows={5} placeholder="例: 返金 / 個人連絡先 / 違法行為" />
            <TextareaField label="エスカレーション語句（1行1件）" value={escalationText} onChange={setEscalationText} rows={5} placeholder="例: クレーム / 値引き / 返金" />
            <TextareaField label="NG時の返答方針" value={ngResponseRules} onChange={setNgResponseRules} rows={6} placeholder="AIは断定せず、店舗確認が必要であることを案内する。" />
            <ToggleRow label="人の確認を必須にする" checked={requireHumanApproval} onChange={setRequireHumanApproval} caption="AIだけで判断せず、スタッフ確認へ回す運用にします。" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void save()} label="保存" icon={<Save size={16} />} disabled={saving} />
          </div>
        </AdminPanel>

        <AdminPanel title="登録内容プレビュー" icon={<Ban size={20} />}>
          <PreviewBlock title="禁止回答" items={preview.forbiddenAnswers} tone="red" />
          <PreviewBlock title="NGワード" items={preview.ngWords} tone="amber" />
          <PreviewBlock title="エスカレーション語句" items={preview.escalationKeywords} tone="blue" />
          <div className="mt-4 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">NG時の返答方針</h3>
              <StatusPill text={requireHumanApproval ? "人確認必須" : "人確認任意"} tone={requireHumanApproval ? "green" : "amber"} />
            </div>
            {ngResponseRules.trim() ? <p className="whitespace-pre-line text-sm font-bold leading-6 text-slate-700">{ngResponseRules}</p> : <EmptyState text="返答方針が未入力です。" />}
          </div>
        </AdminPanel>
      </section>
    </AdminShell>
  );
}

function PreviewBlock({ title, items, tone }: { title: string; items: string[]; tone: "red" | "amber" | "blue" }) {
  return (
    <div className="mb-4 rounded-xl border border-[#dfe8ee] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        <StatusPill text={`${items.length}件`} tone={tone} />
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="rounded-full border border-[#dfe8ee] bg-[#f8fbfc] px-3 py-1 text-xs font-black text-slate-700">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <EmptyState text={`${title}は未登録です。`} />
      )}
    </div>
  );
}

function toList(value: string) {
  return Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
}

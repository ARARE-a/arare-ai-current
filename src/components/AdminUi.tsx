"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  Ban,
  BarChart3,
  Bell,
  BookOpenText,
  CalendarDays,
  ClipboardList,
  FileQuestion,
  MessageSquareText,
  RefreshCw,
  Save
} from "lucide-react";
import { userFacingError } from "@/lib/ui-errors";
import { RoleNav, type ActiveRole } from "./UsabilityChrome";

export type AdminToolKey = "knowledge" | "faq" | "talk-scripts" | "ng-answers" | "reservations" | "notification-logs" | "sales";

const adminTools: Array<{ key: AdminToolKey; label: string; href: string; caption: string; icon: ReactNode }> = [
  { key: "knowledge", label: "KnowledgeBase", href: "/knowledge", caption: "店舗情報", icon: <BookOpenText size={16} /> },
  { key: "faq", label: "FAQ", href: "/faq", caption: "よくある質問", icon: <FileQuestion size={16} /> },
  { key: "talk-scripts", label: "TalkScript", href: "/talk-scripts", caption: "応対台本", icon: <MessageSquareText size={16} /> },
  { key: "ng-answers", label: "NG回答", href: "/ng-answers", caption: "禁止回答", icon: <Ban size={16} /> },
  { key: "reservations", label: "予約", href: "/reservations", caption: "作成/編集", icon: <CalendarDays size={16} /> },
  { key: "notification-logs", label: "通知履歴", href: "/notification-logs", caption: "送信ログ", icon: <Bell size={16} /> },
  { key: "sales", label: "売上", href: "/sales", caption: "一覧", icon: <BarChart3 size={16} /> }
];

export function AdminShell({
  active,
  title,
  subtitle,
  message,
  metrics,
  actions,
  children,
  roleActive = "admin-ui"
}: {
  active: AdminToolKey;
  title: string;
  subtitle: string;
  message?: string;
  metrics?: Array<{ label: string; value: string; caption?: string; tone?: "green" | "amber" | "red" | "slate" | "blue" }>;
  actions?: ReactNode;
  children: ReactNode;
  roleActive?: ActiveRole;
}) {
  return (
    <main className="arare-page min-h-screen bg-[#eef4f7] px-3 py-4 pb-[calc(16rem+env(safe-area-inset-bottom))] text-slate-950 md:p-6">
      <div className="arare-stack mx-auto max-w-7xl space-y-5">
        <RoleNav active={roleActive} />
        <header className="arare-page-header">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="arare-eyebrow">ARARE AI / Admin UI</p>
              <h1 className="arare-page-title">{title}</h1>
              <p className="arare-page-copy mt-3">{subtitle}</p>
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
          {message ? (
            <div aria-live="polite" className="mt-4 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] px-4 py-3 text-sm font-black text-slate-700">
              {message}
            </div>
          ) : null}
          {metrics?.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {metrics.map((metric) => (
                <AdminMetric key={metric.label} {...metric} />
              ))}
            </div>
          ) : null}
        </header>
        <AdminToolNav active={active} />
        {children}
      </div>
    </main>
  );
}

export function AdminToolNav({ active }: { active: AdminToolKey }) {
  const mobileTools = [...adminTools].sort((a, b) => {
    if (a.key === active) return -1;
    if (b.key === active) return 1;
    return 0;
  });

  return (
    <nav aria-label="PRD管理画面ナビゲーション" className="rounded-2xl border border-[#d9e1ea] bg-white p-1.5 shadow-sm md:p-2">
      <div className="flex snap-x gap-2 overflow-x-auto scroll-px-2 px-0.5 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {mobileTools.map((tool) => {
          const isActive = tool.key === active;
          return (
            <Link
              key={`mobile-admin-tool-${tool.key}`}
              href={tool.href}
              className={`min-w-[132px] snap-start rounded-xl border px-2 py-1.5 transition md:min-w-[150px] md:px-3 md:py-2 ${
                isActive
                  ? "border-[#008b83] bg-[#008b83] text-white shadow-sm"
                  : "border-[#e3eaf1] bg-[#f8fbfc] text-slate-700 hover:border-[#00a99d] hover:bg-[#f4fffd]"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                {tool.icon}
                {tool.label}
              </span>
              <span className={`mt-0.5 block text-[11px] font-bold ${isActive ? "text-white/80" : "text-slate-500"}`}>{tool.caption}</span>
            </Link>
          );
        })}
      </div>
      <div className="hidden gap-2 lg:grid lg:grid-cols-7">
        {adminTools.map((tool) => {
          const isActive = tool.key === active;
          return (
            <Link
              key={tool.key}
              href={tool.href}
              className={`rounded-xl border px-3 py-2 transition ${
                isActive
                  ? "border-[#008b83] bg-[#008b83] text-white shadow-sm"
                  : "border-[#e3eaf1] bg-[#f8fbfc] text-slate-700 hover:border-[#00a99d] hover:bg-[#f4fffd]"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                {tool.icon}
                {tool.label}
              </span>
              <span className={`mt-0.5 block text-[11px] font-bold ${isActive ? "text-white/80" : "text-slate-500"}`}>{tool.caption}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminPanel({ title, icon, action, children, className = "" }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`arare-panel rounded-2xl border border-[#d8e1e8] bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminMetric({ label, value, caption, tone = "slate" }: { label: string; value: string; caption?: string; tone?: "green" | "amber" | "red" | "slate" | "blue" }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800"
          : tone === "blue"
            ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-[#dfe8ee] bg-white text-slate-800";
  return (
    <div className={`arare-metric rounded-xl border p-4 ${toneClass}`}>
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="arare-metric-value mt-1 text-2xl font-black">{value}</div>
      {caption ? <div className="mt-1 text-xs font-bold text-slate-500">{caption}</div> : null}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  wide = false,
  required = false,
  disabled = false
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-black text-slate-500">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        disabled={disabled}
        className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold outline-none focus:border-[#008b83]"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black text-slate-500">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-bold outline-none focus:border-[#008b83]">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  return (
    <label className="block md:col-span-2">
      <span className="mb-1 block text-xs font-black text-slate-500">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-xl border border-[#cbd8e3] bg-white px-3 py-3 text-sm font-bold leading-6 outline-none focus:border-[#008b83]"
      />
    </label>
  );
}

export function ToggleRow({ label, checked, onChange, caption }: { label: string; checked: boolean; onChange: (checked: boolean) => void; caption?: string }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] px-3">
      <span>
        <span className="block text-sm font-black text-slate-800">{label}</span>
        {caption ? <span className="block text-xs font-bold text-slate-500">{caption}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-[#008b83]" />
    </label>
  );
}

export function ActionButton({
  onClick,
  label,
  icon = <Save size={16} />,
  disabled = false,
  tone = "primary",
  type = "button"
}: {
  onClick?: () => void;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-[#008b83] text-white"
      : tone === "danger"
        ? "border border-red-200 bg-white text-red-700"
        : "border border-[#cbd8e3] bg-white text-slate-800";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55 ${toneClass}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return <ActionButton onClick={onClick} label="再読込" icon={<RefreshCw size={16} className={loading ? "animate-spin" : ""} />} tone="secondary" disabled={loading} />;
}

export function StatusPill({ text, tone = "slate" }: { text: string; tone?: "green" | "amber" | "red" | "slate" | "blue" }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : tone === "blue"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-black ${toneClass}`}>{text}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="arare-empty rounded-xl border border-dashed border-[#d8e1e8] bg-[#f8fbfc] px-4 py-3 text-sm font-bold text-slate-500">{text}</div>;
}

export function DataTable({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-[#dfe8ee] bg-white thin-scrollbar">{children}</div>;
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="bg-[#f8fbfc] text-xs font-black uppercase text-slate-500">{children}</thead>;
}

export function TableCell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`border-t border-[#edf2f6] px-3 py-3 align-top text-sm font-bold text-slate-700 ${className}`}>{children}</td>;
}

export function formatYen(value: number) {
  return `¥${value.toLocaleString("ja-JP")}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function adminUserFacingError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();
  const authSignals = ["authentication failed against database server", "database credentials", "not valid"];
  const connectionSignals = ["can't reach database server", "connection refused", "connection timed out", "pool_timeout"];
  const migrationSignals = [
    "does not exist",
    "column",
    "table",
    "migration",
    "database_url",
    "datasource"
  ];

  if (authSignals.some((signal) => lower.includes(signal))) {
    return `${fallback}。DB接続の認証に失敗しています。Vercel / Railway / Supabase の DATABASE_URL が現在のSupabase接続情報と一致しているか確認してください。`;
  }

  if (connectionSignals.some((signal) => lower.includes(signal))) {
    return `${fallback}。DBへ接続できません。Supabaseの稼働状態、DATABASE_URL、接続先ホスト、pooler設定を確認してください。`;
  }

  if (migrationSignals.some((signal) => lower.includes(signal))) {
    return `${fallback}。DB migration未適用、またはDB接続設定未反映の可能性があります。Supabaseで migration 202606110001_prd_core_models の適用状態を確認してください。`;
  }

  return userFacingError(error, fallback);
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  Building2,
  ClipboardList,
  Home,
  KeyRound,
  LogOut,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";

export type ActiveRole = "home" | "platform" | "setup" | "store" | "admin-ui" | "therapist" | "customer" | "chat" | "ops" | "phone-ai" | "permissions";

type GuideAction = { href: string; label: string };
type GuideStep = { title: string; body: string; href?: string; actionLabel?: string };

const routes: {
  key: ActiveRole;
  label: string;
  short: string;
  href: string;
  publicHref?: string;
  caption: string;
  icon: React.ReactNode;
}[] = [
  { key: "home", label: "全体ハブ", short: "ホーム", href: "/", caption: "今日の全体像", icon: <Home size={17} /> },
  { key: "platform", label: "ARARE管理", short: "管理", href: "/platform", caption: "全店舗監視", icon: <BarChart3 size={17} /> },
  { key: "setup", label: "導入", short: "導入", href: "/setup", caption: "店舗設定", icon: <Building2 size={17} /> },
  { key: "permissions", label: "権限管理", short: "権限", href: "/permissions", caption: "Clerk連携", icon: <KeyRound size={17} /> },
  { key: "store", label: "ダッシュボード", short: "店舗", href: "/store-v2", caption: "作業台", icon: <ShieldCheck size={17} /> },
  { key: "admin-ui", label: "管理UI", short: "管理UI", href: "/knowledge", caption: "PRD必須画面", icon: <ClipboardList size={17} /> },
  { key: "therapist", label: "セラピスト", short: "担当", href: "/therapist", caption: "担当別タスク", icon: <UsersRound size={17} /> },
  { key: "customer", label: "顧客管理", short: "顧客", href: "/customer", caption: "履歴確認", icon: <UserRound size={17} /> },
  { key: "chat", label: "Web Chat", short: "チャット", href: "/chat", caption: "予約入口", icon: <MessageCircle size={17} /> },
  { key: "ops", label: "運用", short: "運用", href: "/ops", caption: "状態監視", icon: <Bot size={17} /> },
  { key: "phone-ai", label: "電話AI", short: "電話", href: "/phone-ai", caption: "通話ログ", icon: <Phone size={17} /> }
];

const mobileDemoRoutes = [
  { label: "ホーム", href: "/", match: "/" },
  { label: "店舗", href: "/store-v2", match: "/store-v2" },
  { label: "電話", href: "/phone-ai#call-logs", match: "/phone-ai" },
  { label: "通知", href: "/notification-logs", match: "/notification-logs" },
  { label: "予約", href: "/reservations", match: "/reservations" }
];

export function RoleNav({ active, className = "" }: { active: ActiveRole; className?: string }) {
  const pathname = usePathname();
  const activeRoute = routes.find((route) => route.key === active) ?? routes[0];

  return (
    <>
      <div className={`arare-role-shell ${className}`}>
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--arare-sidebar-width)] flex-col border-r border-white/10 bg-[#082033] text-white shadow-xl lg:flex">
          <Link href="/store-v2" className="block px-5 py-5">
            <div className="text-2xl font-black tracking-wide">ARARE <span className="text-[#00b3a4]">AI</span></div>
            <div className="mt-1 text-xs font-bold text-white/70">AI予約受付</div>
          </Link>
          <nav aria-label="メインナビゲーション" className="flex-1 space-y-1 px-3 py-3">
            {routes.map((route) => {
              const isActive = route.key === active;
              const href = route.publicHref ?? route.href;
              return (
                <Link
                  key={`desktop-${route.key}`}
                  href={href}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black transition ${
                    isActive ? "bg-[#009b8f] text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {route.icon}
                  <span>{route.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="m-3 rounded-lg border border-white/12 bg-white/8 p-3">
            <p className="text-sm font-black">サンプル店</p>
            <p className="mt-1 text-xs font-bold text-white/65">店舗ID: ST-0001</p>
            <Link href="/store-v2" className="mt-3 flex h-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-xs font-black">
              店舗切替
            </Link>
          </div>
        </aside>

        <header className="fixed left-[var(--arare-sidebar-width)] right-0 top-0 z-30 hidden h-[var(--arare-topbar-height)] items-center justify-between border-b border-[#d9e1ea] bg-white/95 px-5 shadow-sm backdrop-blur lg:flex">
          <div>
            <div className="text-lg font-black leading-tight text-slate-950">{activeRoute.label}</div>
            <div className="text-xs font-bold text-slate-500">{activeRoute.caption}</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/store-v2" className="inline-flex h-10 items-center rounded-lg border border-[#d9e1ea] bg-white px-3 text-sm font-black text-slate-800">
              サンプル店
            </Link>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d9e1ea] bg-white px-3 text-sm font-black text-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              営業中
            </span>
            <button onClick={() => window.location.reload()} className="grid h-10 w-10 place-items-center rounded-lg border border-[#d9e1ea] bg-white text-slate-800" aria-label="再読込">
              <RefreshCw size={17} />
            </button>
            <button onClick={() => void signOutFromClerk()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#082033] px-3 text-sm font-black text-white" title="ログアウト">
              マネージャー
              <LogOut size={15} />
            </button>
          </div>
        </header>
      </div>

      <nav aria-label="役割別ナビゲーション" className={`hidden rounded-2xl border border-[#d9e1ea] bg-white/95 p-2 shadow-sm ${className}`}>
        <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-11 md:overflow-visible md:pb-0">
          {routes.map((route) => {
            const isActive = route.key === active;
            const href = route.publicHref ?? route.href;
            return (
              <Link
                key={route.key}
                href={href}
                className={`min-w-[132px] rounded-xl border px-3 py-2 transition md:min-w-0 ${
                  isActive
                    ? "border-[#008b83] bg-[#008b83] text-white shadow-sm"
                    : "border-[#e3eaf1] bg-[#f8fbfc] text-slate-700 hover:border-[#00a99d] hover:bg-[#f4fffd]"
                }`}
              >
                <span className="block text-sm font-black">{route.label}</span>
                <span className={`mt-0.5 block text-[11px] font-bold ${isActive ? "text-white/80" : "text-slate-500"}`}>{route.caption}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <nav aria-label="スマホ固定ナビゲーション" className="arare-mobile-role-nav rounded-2xl border border-[#cbd8e3] bg-white/95 p-1.5 shadow-2xl shadow-slate-900/15 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileDemoRoutes.map((route) => {
            const isActive = pathname === route.match || (route.match !== "/" && pathname.startsWith(route.match));
            return (
              <Link key={`mobile-demo-${route.href}`} href={route.href} className={`min-w-0 rounded-xl px-1 py-2 text-center text-xs font-black ${isActive ? "bg-[#008b83] text-white" : "bg-[#f1f5f9] text-slate-700"}`}>
                {route.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

async function signOutFromClerk() {
  const clerk = (window as Window & { Clerk?: { signOut?: (options?: { redirectUrl?: string }) => Promise<void> } }).Clerk;
  if (clerk?.signOut) {
    await clerk.signOut({ redirectUrl: "/sign-in" });
    return;
  }
  window.location.href = "/sign-in";
}

export function ScreenGuide({ eyebrow, title, description, steps, primaryAction, secondaryAction }: {
  eyebrow: string;
  title: string;
  description: string;
  steps: GuideStep[];
  primaryAction?: GuideAction;
  secondaryAction?: GuideAction;
}) {
  return (
    <section className="hidden rounded-2xl border border-[#d8e5ee] bg-gradient-to-br from-white via-[#f7fbfc] to-[#eaf7f4] p-4 shadow-sm md:block md:p-5">
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#008b83]">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-black leading-tight text-slate-950 md:text-2xl">{title}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{description}</p>
          {primaryAction || secondaryAction ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {primaryAction ? <Link href={primaryAction.href} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#008b83] px-4 text-sm font-black text-white shadow-sm shadow-emerald-900/10">{primaryAction.label}</Link> : null}
              {secondaryAction ? <Link href={secondaryAction.href} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#cbd8e3] bg-white px-4 text-sm font-black text-slate-700">{secondaryAction.label}</Link> : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {steps.map((step, index) => (
            <article key={`${step.title}-${index}`} className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e6f8f3] text-sm font-black text-[#007a6c]">{index + 1}</div>
              <h3 className="text-sm font-black text-slate-900">{step.title}</h3>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{step.body}</p>
              {step.href ? <Link href={step.href} className="mt-2 inline-flex text-xs font-black text-[#008b83]">{step.actionLabel ?? "この操作へ進む"}</Link> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

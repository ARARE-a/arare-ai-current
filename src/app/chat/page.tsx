"use client";

import Link from "next/link";
import { RoleNav, ScreenGuide } from "../../components/UsabilityChrome";
import { MessageCircle, RotateCcw, Send } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { userFacingError } from "@/lib/ui-errors";

type ChatMessage = {
  id: string;
  role: "customer" | "ai";
  body: string;
  time: string;
};

type ConversationStreamItem = {
  id: string;
  time: string;
  name: string;
  channel: string;
  status: string;
  body: string;
};

type ReceptionResponse = {
  data?: {
    conversationId: string;
    action: string;
    reply: string;
    reservation?: {
      id: string;
      status: string;
    } | null;
  };
  error?: string;
};

const quickMessages = [
  "明日の20時で予約を取りたいです",
  "コースの料金を知りたいです",
  "キャンセルしたいです",
  "変更したいです"
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "ai",
      body: "AI予約受付です。ご質問や予約内容（日時・コース）を送ってください。内容を受けたら、予約状況を自動で受理します。",
      time: ""
    }
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string>("");
  const [status, setStatus] = useState("受付待ち");
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<ConversationStreamItem[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadStream();
    const existing = localStorage.getItem("arare-web-chat-session");
    const next = existing ?? `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("arare-web-chat-session", next);
    setSessionId(next);
    const timer = window.setInterval(() => {
      void loadStream();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function loadStream() {
    try {
      const response = await fetch("/api/admin/state");
      const payload = (await response.json()) as { data?: { conversations?: ConversationStreamItem[] } };
      setStream(payload.data?.conversations ?? []);
    } catch {
      setStream([]);
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>, preset?: string) {
    event?.preventDefault();
    const body = (preset ?? input).trim();
    if (!body || loading) return;

    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { id: uid(), role: "customer", body, time: nowTime() }]);

    try {
      const response = await fetch("/api/ai/reception", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: new URLSearchParams(window.location.search).get("storeId") ?? undefined,
          channel: "WEB_CHAT",
          conversationId,
          customer: { lineId: sessionId },
          message: body
        })
      });
      const payload = (await response.json()) as ReceptionResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? `AI応答が失敗しました (${response.status})`);
      }

      setConversationId(payload.data.conversationId);
      setStatus(statusLabel(payload.data.action, payload.data.reservation?.status));
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "ai",
          body: payload.data!.reply,
          time: nowTime()
        }
      ]);
    } catch (error) {
      setStatus("要確認");
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "ai",
          body: userFacingError(error, "AI応答でエラーが発生しました"),
          time: nowTime()
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    const next = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("arare-web-chat-session", next);
    setSessionId(next);
    setConversationId(undefined);
    setStatus("受付待ち");
    setInput("");
    setMessages([
      {
        id: "welcome",
        role: "ai",
        body: "AI予約受付です。ご質問や予約内容（日時・コース）を送ってください。内容を受けたら、予約状況を自動で受理します。",
        time: nowTime()
      }
    ]);
  }

  return (
    <main className="arare-page min-h-screen bg-[#f3f6f8] pb-28 text-[#101828] md:pb-0">
      <div className="arare-stack mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5">
        <header className="mb-4 rounded-lg border border-[#d9e1ea] bg-white px-4 py-3">
          <div className="mb-3 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#e6f8f3] text-[#008b7d]">
                <MessageCircle size={24} />
              </div>
              <div>
                <div className="text-lg font-black">AI予約チャット</div>
                <div className="text-sm font-bold text-slate-500">予約入口（第一接点）</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[#9fd7cc] bg-[#eafaf6] px-3 py-1 text-xs font-black text-[#008263]">
                {status}
              </span>
              <button
                onClick={reset}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-[#d9e1ea] bg-white hover:border-[#009b8f]"
                aria-label="初期化"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </div>
          <RoleNav active="chat" />
        </header>

        <ScreenGuide
          eyebrow="Reception action lane"
          title="予約入口は「例文で開始 → 必要情報を補完 → 確定ステータス確認」"
          description="この画面は顧客の新規受付・変更受付の入り口。チャットの結果は運用で監視し、保留時は店舗へ接続されます。"
          primaryAction={{ href: "/chat", label: "チャットで受付を試す" }}
          secondaryAction={{ href: "/store-v2", label: "店舗側で結果を見る" }}
          steps={[
            { title: "例文を押す", body: "下の丸いボタンから予約や料金確認をすぐ開始します。" },
            { title: "会話する", body: "不足情報（日時・人数・コース）をAIが自然言語で聞き戻します。" },
            { title: "状態を見る", body: "右上ステータスが保留・確定・要対応を示すので、店舗監査にそのまま渡します。", href: "/store-v2", actionLabel: "結果確認へ" }
          ]}
        />

        <section className="arare-panel min-h-0 rounded-lg border border-[#d9e1ea] bg-white">
          <div ref={messagesRef} className="h-[220px] space-y-4 overflow-y-auto p-4 md:h-[240px]">
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
            {loading ? <ChatBubble message={{ id: "loading", role: "ai", body: "入力内容を解析中です...", time: nowTime() }} muted /> : null}
          </div>

          <div className="border-t border-[#d9e1ea] p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickMessages.map((messageText) => (
                <button
                  key={messageText}
                  onClick={() => submit(undefined, messageText)}
                  disabled={loading}
                  className="rounded-full border border-[#d9e1ea] bg-[#f8fafc] px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#009b8f] hover:bg-[#f4fffd] disabled:opacity-50"
                >
                  {messageText}
                </button>
              ))}
            </div>
            <form onSubmit={(event) => submit(event)} className="flex flex-col gap-2 rounded-lg border border-[#d9e1ea] bg-white p-2 sm:flex-row">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-h-11 min-w-0 flex-1 px-2 text-sm font-semibold outline-none"
                placeholder="予約内容や問い合わせを入力してください"
              />
              <button
                disabled={!canSend}
                className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#009b8f] px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Send size={16} />
                送信
              </button>
            </form>
          </div>
        </section>

        <section className="arare-panel rounded-lg border border-[#d9e1ea] bg-white p-4">
                <div className="text-xs font-black text-slate-500">監視向け：予約入口全体の最新履歴</div>
          {stream.length === 0 ? (
            <div className="mt-2 rounded-md border border-dashed border-[#d9e1ea] p-3 text-sm text-slate-500">履歴データはまだありません。</div>
          ) : null}
          <div className="mt-2 space-y-2">
            {stream.slice(0, 5).map((conversation) => (
              <div key={conversation.id} className="rounded-md border border-[#e2ebf2] p-2 text-sm">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-black text-slate-700">{conversation.channel}</span>
                  <span>{conversation.time}</span>
                </div>
                <div className="mt-1 font-black text-slate-700">{conversation.name}</div>
                <p className="mt-1 text-slate-600">{conversation.body}</p>
                <div className="mt-1 text-xs text-slate-500">ステータス: {conversation.status}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ChatBubble({ message, muted = false }: { message: ChatMessage; muted?: boolean }) {
  const isCustomer = message.role === "customer";
  return (
    <div className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[82%]">
        <div
          className={`whitespace-pre-line rounded-lg px-4 py-3 text-sm font-semibold leading-7 ${
            isCustomer
              ? "bg-[#d8f4ee] text-[#053b35]"
              : muted
                ? "bg-slate-100 text-slate-500"
                : "bg-[#f2f4f7] text-[#1f2937]"
          }`}
        >
          {message.body}
        </div>
        {message.time ? <div className={`mt-1 text-xs text-slate-400 ${isCustomer ? "text-right" : ""}`}>{message.time}</div> : null}
      </div>
    </div>
  );
}

function statusLabel(action: string, reservationStatus?: string) {
  if (reservationStatus === "CONFIRMED" || action === "CONFIRMED") return "予約確定";
  if (reservationStatus === "TENTATIVE" || action === "HOLD_CREATED" || action === "HOLD_REUSED") return "保留";
  if (action === "ESCALATED") return "要対応";
  return "受付待ち";
}

function nowTime() {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date());
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



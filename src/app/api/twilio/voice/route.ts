import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { escapeXml, twiml } from "@/lib/twilio-service";

export async function POST(request: NextRequest) {
  // Phone AI requires a separately hosted ConversationRelay-compatible
  // WebSocket service. Keep the Vercel endpoint explicit instead of silently
  // falling through to an old relay URL.
  const canonicalUrl =
    env("VOICE_WEBHOOK_CANONICAL_URL") ??
    env("NEXT_PUBLIC_VOICE_WEBHOOK_URL");

  if (!canonicalUrl) {
    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP">現在、電話AIデモは未設定です。Web予約チャットをご利用ください。</Say>
  <Reject reason="busy"/>
</Response>`);
  }

  const currentUrl = new URL(request.nextUrl.pathname, request.nextUrl.origin).toString();

  if (canonicalUrl === currentUrl) {
    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="busy"/>
</Response>`);
  }

  return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${escapeXml(canonicalUrl)}</Redirect>
</Response>`);
}

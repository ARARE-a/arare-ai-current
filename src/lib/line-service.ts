import crypto from "node:crypto";
import { env } from "./env";

export function verifyLineSignature(body: string, signature: string | null) {
  const secret = env("LINE_CHANNEL_SECRET");
  if (!secret) return { ok: false, reason: "LINE_CHANNEL_SECRET is not configured" };
  if (!signature) return { ok: false, reason: "x-line-signature is missing" };
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  try {
    return { ok: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) };
  } catch {
    return { ok: false, reason: "invalid signature" };
  }
}

export async function replyLineMessage(replyToken: string, messages: Array<{ type: "text"; text: string }>) {
  const accessToken = env("LINE_CHANNEL_ACCESS_TOKEN");
  if (!accessToken) {
    return { skipped: true, reason: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };
  }

  return sendLineApiRequest("https://api.line.me/v2/bot/message/reply", accessToken, {
    replyToken,
    messages
  });
}

export async function pushLineMessage(to: string, messages: Array<{ type: "text"; text: string }>) {
  const accessToken = env("LINE_CHANNEL_ACCESS_TOKEN");
  if (!accessToken) {
    return { skipped: true, reason: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };
  }

  return sendLineApiRequest("https://api.line.me/v2/bot/message/push", accessToken, {
    to,
    messages
  });
}

async function sendLineApiRequest(url: string, accessToken: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return { skipped: false, ok: response.ok, status: response.status, body: await response.text() };
}

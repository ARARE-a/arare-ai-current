import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

loadEnv(".env.local");
loadEnv(".env");

const relayUrl = process.argv[2] ?? process.env.VOICE_RELAY_VERIFY_URL ?? buildDefaultRelayUrl();
const callSid = `CA_VERIFY_RELAY_${Date.now()}`;
const timeoutMs = Number(process.env.VERIFY_VOICE_RELAY_TIMEOUT_MS ?? 30000);
const received = [];
let promptStartIndex = 0;
let promptSent = false;

try {
  const result = await verifyRelay();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function verifyRelay() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(false, new Error(`Voice relay verification timed out after ${timeoutMs}ms. Received: ${JSON.stringify(received)}`));
    }, timeoutMs);

    const ws = new WebSocket(relayUrl);

    function finish(ok, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // Ignore close errors during verification cleanup.
      }
      if (ok) {
        resolve(value);
      } else {
        reject(value);
      }
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          sessionId: `VX_VERIFY_${Date.now()}`,
          callSid,
          from: "+818037884404",
          to: "+19412396480",
          direction: "inbound",
          callStatus: "RINGING",
          customParameters: {
            storeId: "demo-store-arare-ai",
            storePhoneSettingId: "",
            toNumber: "+19412396480",
            fromNumber: "+818037884404",
            callReference: callSid
          }
        })
      );

      setTimeout(() => {
        promptStartIndex = received.length;
        promptSent = true;
        ws.send(
          JSON.stringify({
            type: "prompt",
            voicePrompt: "明日の21時から90分で空いてますか？",
            lang: "ja-JP",
            last: true
          })
        );
      }, 500);
    });

    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      received.push(message);

      const aiTextMessages = received.slice(promptStartIndex).filter(
        (item) => promptSent && item.type === "text" && String(item.token ?? "").trim().length > 0
      );
      const hasText = aiTextMessages.length > 0;
      const hasFinal = aiTextMessages.some((item) => item.last === true) || received.some((item) => item.type === "end");
      if (hasText && hasFinal) {
        const responseText = aiTextMessages.map((item) => String(item.token ?? "")).join("");
        const availabilityAnswered = /(確認します|ご案内可能|承れません|空き|候補|最短|予約可能|店舗に確認)/u.test(responseText);
        const courseInfoOnly = /(ご予約なら希望日時|希望日時をお願いします|コース情報)/u.test(responseText) && !availabilityAnswered;
        if (!availabilityAnswered || courseInfoOnly) {
          finish(false, new Error(`Voice relay did not answer availability after prompt. Response: ${responseText}`));
          return;
        }

        finish(true, {
          ok: true,
          relayUrl: redactToken(relayUrl),
          callSid,
          openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
          responseText,
          messages: received
        });
      }
    });

    ws.on("error", (error) => {
      finish(false, error);
    });
  });
}

function buildDefaultRelayUrl() {
  const token = process.env.VOICE_RELAY_SHARED_SECRET;
  const base = "ws://127.0.0.1:8787/conversation-relay";
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function redactToken(value) {
  return value.replace(/token=([^&]+)/, "token=***");
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

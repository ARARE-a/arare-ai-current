import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

loadEnv(".env.local");
loadEnv(".env");

const relayUrl = process.argv[2] ?? process.env.VOICE_RELAY_VERIFY_URL ?? buildDefaultRelayUrl();
const callSid = `CA_VERIFY_RELAY_${Date.now()}`;
const timeoutMs = Number(process.env.VERIFY_VOICE_RELAY_TIMEOUT_MS ?? 30000);
const received = [];
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
    const timeout = setTimeout(() => {
      reject(new Error(`Voice relay verification timed out after ${timeoutMs}ms. Received: ${JSON.stringify(received)}`));
    }, timeoutMs);

    const ws = new WebSocket(relayUrl);

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

      const aiTextMessages = received.filter(
        (item) => promptSent && item.type === "text" && String(item.token ?? "").trim().length > 0
      );
      const hasText = aiTextMessages.length > 0;
      const hasFinal = aiTextMessages.some((item) => item.last === true) || received.some((item) => item.type === "end");
      if (hasText && hasFinal) {
        clearTimeout(timeout);
        ws.close();
        resolve({
          ok: true,
          relayUrl: redactToken(relayUrl),
          callSid,
          openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
          messages: received
        });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
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

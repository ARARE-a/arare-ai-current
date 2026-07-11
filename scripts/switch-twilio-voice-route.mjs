import { existsSync, readFileSync } from "node:fs";
import twilio from "twilio";

loadEnv(".env");
loadEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode ?? "status").toLowerCase();
const apply = args.apply === true || args.apply === "true";
const baseUrl = String(args.base ?? "https://arare-ai-voice-relay.onrender.com").replace(/\/+$/, "");
const legacyUrl = `${baseUrl}/api/twilio/voice`;
const realtimeUrl = `${baseUrl}/api/twilio/voice/realtime`;
const agentUrl = `${baseUrl}/api/twilio/voice/realtime-agent`;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const configuredNumber = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !configuredNumber) {
  throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are required");
}
if (!["status", "agent", "realtime", "japanese", "legacy"].includes(mode)) {
  throw new Error("--mode must be status, agent, realtime, japanese, or legacy");
}

const client = twilio(accountSid, authToken);
const matches = await client.incomingPhoneNumbers.list({ phoneNumber: configuredNumber, limit: 20 });
const number = matches.find((item) => normalizePhone(item.phoneNumber) === normalizePhone(configuredNumber));
if (!number) throw new Error("Configured Twilio phone number was not found");

const before = summarize(number);
if (mode === "status" || !apply) {
  console.log(JSON.stringify({
    mode,
    apply,
    changed: false,
    before: { ...before, activeMode: detectMode(before.voiceUrl) },
    proposed: mode === "agent"
      ? agentUrl
      : mode === "realtime"
        ? realtimeUrl
        : ["japanese", "legacy"].includes(mode)
          ? legacyUrl
          : null
  }, null, 2));
  if (mode !== "status" && !apply) process.exitCode = 2;
} else {
  if (mode === "agent") await assertRealtimeAgentReady();
  if (mode === "realtime") await assertRealtimeReady();
  if (mode === "japanese") await assertJapaneseVoiceReady();
  const targetUrl = mode === "agent" ? agentUrl : mode === "realtime" ? realtimeUrl : legacyUrl;
  const targetFallback = ["agent", "realtime"].includes(mode) ? legacyUrl : number.voiceFallbackUrl || legacyUrl;
  await client.incomingPhoneNumbers(number.sid).update({
    voiceUrl: targetUrl,
    voiceMethod: "POST",
    voiceFallbackUrl: targetFallback,
    voiceFallbackMethod: "POST"
  });
  const afterResource = await client.incomingPhoneNumbers(number.sid).fetch();
  const after = summarize(afterResource);
  if (after.voiceUrl !== targetUrl || after.voiceMethod !== "POST") {
    throw new Error("Twilio route update could not be verified");
  }
  console.log(JSON.stringify({ mode, apply, changed: before.voiceUrl !== after.voiceUrl, before, after }, null, 2));
}

async function assertRealtimeReady() {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(20000) });
  const health = await response.json();
  const media = health?.realtimeMedia;
  if (!response.ok || !health?.ok || !media?.enabled || !media?.twilioSignatureRequired || !media?.twilioSignatureReady) {
    throw new Error("Realtime relay is not ready; Twilio route was not changed");
  }
}

async function assertRealtimeAgentReady() {
  const response = await fetch(`${baseUrl}/health?deep=1`, { signal: AbortSignal.timeout(20000) });
  const health = await response.json();
  const agent = health?.realtimeAgent;
  const ready =
    response.ok &&
    health?.ok &&
    health?.databaseHealth?.ok &&
    health?.openaiConfigured &&
    agent?.enabled &&
    agent?.architecture === "native-speech-to-speech" &&
    agent?.scriptedReplyPrimary === false &&
    agent?.reservationToolGateReady &&
    agent?.explicitConfirmationGateReady &&
    agent?.duplicateToolCallGuardReady &&
    agent?.rollbackRouteReady &&
    agent?.twilioSignatureRequired &&
    agent?.twilioSignatureReady;
  if (!ready) throw new Error("Realtime direct agent is not ready; Twilio route was not changed");
}

async function assertJapaneseVoiceReady() {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(20000) });
  const health = await response.json();
  const japaneseVoiceReady = health?.ttsProvider === "Amazon" && health?.ttsVoice === "Takumi-Neural";
  const japaneseSttReady =
    health?.transcriptionProvider === "Google" &&
    health?.speechModel === "telephony" &&
    health?.conversationRelaySpeechTimeoutMs === 1200;
  if (!response.ok || !health?.ok || !health?.openaiConfigured || !japaneseVoiceReady || !japaneseSttReady) {
    throw new Error("Japanese GPT + Takumi voice path is not ready; Twilio route was not changed");
  }
}

function detectMode(value) {
  const url = String(value ?? "");
  if (url.endsWith("/api/twilio/voice/realtime-agent")) return "agent";
  if (url.endsWith("/api/twilio/voice/realtime")) return "realtime";
  if (url.endsWith("/api/twilio/voice")) return "japanese";
  return "custom";
}

function summarize(value) {
  return {
    phoneNumber: maskPhone(value.phoneNumber),
    sid: maskSid(value.sid),
    voiceUrl: value.voiceUrl || null,
    voiceMethod: value.voiceMethod || null,
    voiceFallbackUrl: value.voiceFallbackUrl || null,
    voiceFallbackMethod: value.voiceFallbackMethod || null,
    statusCallback: value.statusCallback || null
  };
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskPhone(value) {
  const digits = normalizePhone(value);
  return digits ? `***${digits.slice(-4)}` : null;
}

function maskSid(value) {
  const text = String(value ?? "");
  return text.length > 10 ? `${text.slice(0, 4)}...${text.slice(-6)}` : "***";
}

function parseArgs(values) {
  return Object.fromEntries(
    values.map((value) => {
      const normalized = value.replace(/^--/, "");
      const separator = normalized.indexOf("=");
      return separator === -1 ? [normalized, true] : [normalized.slice(0, separator), normalized.slice(separator + 1)];
    })
  );
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import twilio from "twilio";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");

const baseUrl = String(process.env.VOICE_RELAY_PRODUCTION_URL ?? "https://arare-ai-voice-relay.onrender.com").replace(/\/+$/, "");
const webhookUrl = `${baseUrl}/api/twilio/voice`;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const toNumber = process.env.TWILIO_PHONE_NUMBER;
const fromNumber = "+818000000000";
const callSid = `CA_REGRESSION_JAPANESE_${Date.now()}`;
const timeoutMs = Number(process.env.VERIFY_JAPANESE_PRODUCTION_TIMEOUT_MS ?? 45000);

if (!accountSid || !authToken || !toNumber) {
  throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are required");
}

const twiml = await fetchSignedVoiceTwiml();
const relay = parseConversationRelay(twiml);
assert.equal(relay.attributes.language, "ja-JP", "ConversationRelay language must be ja-JP");
assert.equal(relay.attributes.transcriptionLanguage, "ja-JP", "STT language must be ja-JP");
assert.equal(relay.attributes.ttsLanguage, "ja-JP", "TTS language must be ja-JP");
assert.equal(relay.attributes.ttsProvider, "Amazon", "Production Japanese route must use Amazon TTS");
assert.equal(relay.attributes.voice, "Takumi-Neural", "Production Japanese route must use Takumi-Neural");
assert.equal(relay.attributes.transcriptionProvider, "Google", "Production Japanese route must use Google STT");
assert.equal(relay.attributes.speechModel, "telephony", "Production Japanese route must use Google's telephony model");
assert.equal(relay.attributes.speechTimeout, "1200", "Production Japanese route must keep short pauses inside one turn");
assert.equal(relay.attributes.interruptSensitivity, "medium", "Production Japanese route must avoid false high-sensitivity interrupts");
assert.ok(relay.parameters.storeId, "Voice webhook must bind the call to a store");

const signature = twilio.getExpectedTwilioSignature(authToken, relay.attributes.url, {});
const conversation = await openConversationRelay({
  url: relay.attributes.url,
  signature,
  parameters: relay.parameters
});

const transcript = [];
try {
  const greeting = await conversation.nextResponse();
  record("initial_greeting", "(setup)", greeting, /(AI|受付|予約|お電話)/u);

  const timeFragment = await conversation.prompt("20とかいただきます");
  record("repaired_time_fragment_to_date", "20とかいただきます", timeFragment, /(日にち|今日|明日|お日にち)/u);

  const availability = await conversation.prompt("明日です");
  record("date_to_name", "明日です", availability, /(お名前|名字)/u);

  const name = await conversation.prompt("佐藤です");
  record("name_to_caller_phone", "佐藤です", name, /(今おかけの番号|下4桁|ショートメッセージ)/u);

  const callerNumber = await conversation.prompt("はい大丈夫です");
  record("caller_number_selected", "はい大丈夫です", callerNumber, /(コース|60分|90分|120分)/u);

  const course = await conversation.prompt("60分でお願いします");
  record("course_to_visit_history", "60分でお願いします", course, /(初めて|以前|利用)/u);

  const visit = await conversation.prompt("以前もある");
  record("repeat_visit_to_attention", "以前もある", visit, /(注意事項|店舗ルール|確認)/u);

  const finalSummary = await conversation.prompt("確認した");
  record("attention_to_final_summary", "確認した", finalSummary, /(60分|佐藤).*(はい|内容|合って)/u);

  const repeatedSummary = await conversation.prompt("確認内容をもう一度言ってください");
  record("repeat_summary", "確認内容をもう一度言ってください", repeatedSummary, /(60分|佐藤).*(はい|内容|合って)/u);

  const changedCourse = await conversation.prompt("60分から90分に変更して");
  record("course_change_and_recheck", "60分から90分に変更して", changedCourse, /(90分).*(変更|空き|確認)/u);
} finally {
  conversation.close();
}

console.log(
  JSON.stringify(
    {
      ok: true,
      webhookStatus: 200,
      callSid,
      route: {
        url: redactToken(relay.attributes.url),
        language: relay.attributes.language,
        transcriptionLanguage: relay.attributes.transcriptionLanguage,
        transcriptionProvider: relay.attributes.transcriptionProvider,
        speechModel: relay.attributes.speechModel,
        speechTimeout: relay.attributes.speechTimeout,
        interruptSensitivity: relay.attributes.interruptSensitivity,
        ttsLanguage: relay.attributes.ttsLanguage,
        ttsProvider: relay.attributes.ttsProvider,
        voice: relay.attributes.voice,
        storeBound: Boolean(relay.parameters.storeId)
      },
      reservationCreated: false,
      smsSent: false,
      checks: transcript
    },
    null,
    2
  )
);

function record(step, input, response, expectedPattern) {
  assert.match(response, expectedPattern, `${step} returned an unexpected response: ${response}`);
  transcript.push({ step, input, response });
}

async function fetchSignedVoiceTwiml() {
  const params = {
    AccountSid: accountSid,
    CallSid: callSid,
    CallStatus: "ringing",
    Direction: "inbound",
    From: fromNumber,
    To: toNumber
  };
  const signature = twilio.getExpectedTwilioSignature(authToken, webhookUrl, params);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Production voice webhook returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

function parseConversationRelay(xml) {
  const tag = xml.match(/<ConversationRelay\b([\s\S]*?)>/iu)?.[1];
  if (!tag) throw new Error(`Production voice webhook did not return ConversationRelay: ${xml.slice(0, 500)}`);
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/gu)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  if (!attributes.url) throw new Error("ConversationRelay URL is missing");
  const parameters = {};
  for (const match of xml.matchAll(/<Parameter\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*\/?\s*>/giu)) {
    parameters[decodeXml(match[1])] = decodeXml(match[2]);
  }
  return { attributes, parameters };
}

function openConversationRelay({ url, signature, parameters }) {
  const socket = new WebSocket(url, { headers: { "x-twilio-signature": signature } });
  const completed = [];
  const waiters = [];
  let currentText = "";
  let closed = false;

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== "text") return;
    currentText += String(message.token ?? "");
    if (message.last !== true) return;
    const response = currentText.trim();
    currentText = "";
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(response);
    else completed.push(response);
  });

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Production ConversationRelay open timed out")), timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.send(
        JSON.stringify({
          type: "setup",
          sessionId: `VX_REGRESSION_JAPANESE_${Date.now()}`,
          callSid,
          from: fromNumber,
          to: toNumber,
          direction: "inbound",
          callStatus: "RINGING",
          customParameters: parameters
        })
      );
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  function nextResponse() {
    return opened.then(
      () =>
        new Promise((resolve, reject) => {
          if (completed.length) {
            resolve(completed.shift());
            return;
          }
          if (closed) {
            reject(new Error("Production ConversationRelay closed before returning a response"));
            return;
          }
          const timer = setTimeout(() => {
            const index = waiters.findIndex((item) => item.resolve === wrappedResolve);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error(`Production ConversationRelay response timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          const wrappedResolve = (value) => {
            clearTimeout(timer);
            resolve(value);
          };
          waiters.push({ resolve: wrappedResolve, reject });
        })
    );
  }

  socket.on("close", (code, reason) => {
    closed = true;
    const error = new Error(`Production ConversationRelay closed (${code}): ${reason.toString()}`);
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });

  return {
    nextResponse,
    async prompt(text) {
      await opened;
      socket.send(JSON.stringify({ type: "prompt", voicePrompt: text, lang: "ja-JP", last: true }));
      return nextResponse();
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "production regression complete");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
  };
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function redactToken(value) {
  return String(value).replace(/token=([^&]+)/u, "token=***");
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

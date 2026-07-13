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
  assertConciseAndSafe("initial_greeting", greeting);

  const courseQuestion = "60分と90分は何が違いますか？";
  const courseAnswer = joinResponses(await conversation.promptAndCollect(courseQuestion));
  record(
    "course_question_uses_registered_facts",
    courseQuestion,
    courseAnswer,
    /60分.*12[,，]?000円.*90分.*17[,，]?000円/u
  );
  assertConciseAndSafe("course_question_uses_registered_facts", courseAnswer);

  const bookingRequest = "明後日の23時から60分、フリーでお願いします。";
  const availability = joinResponses(await conversation.promptAndCollect(bookingRequest));
  record(
    "datetime_duration_and_preference_to_identity",
    bookingRequest,
    availability,
    /(確認|空き|案内|名前|名字|23時|60分)/u
  );
  assertConciseAndSafe("datetime_duration_and_preference_to_identity", availability);

  const identityRequest = "名前は佐藤です。SMSは今かけている番号で大丈夫です。";
  let finalSummary = joinResponses(await conversation.promptAndCollect(identityRequest));
  if (!isCompactFinalSummary(finalSummary)) {
    const summaryRequest = "予約内容を短く確認してください。";
    finalSummary = joinResponses(await conversation.promptAndCollect(summaryRequest));
  }
  record("identity_to_compact_final_summary", identityRequest, finalSummary, /23時.*60分.*12[,，]?000円.*フリー.*佐藤/u);
  assert.match(finalSummary, /(よろしい|間違いない|合って)/u, "Final summary must request explicit confirmation");
  assertConciseAndSafe("identity_to_compact_final_summary", finalSummary, { maxLength: 220 });

  const repeatedSummaryRequest = "確認内容をもう一度、短くお願いします。";
  const repeatedSummary = joinResponses(await conversation.promptAndCollect(repeatedSummaryRequest));
  record("repeat_summary", repeatedSummaryRequest, repeatedSummary, /23時.*60分.*12[,，]?000円.*フリー.*佐藤/u);
  assertConciseAndSafe("repeat_summary", repeatedSummary, { maxLength: 220 });

  const changedCourseRequest = "60分から90分に変更してください。";
  const changedCourse = joinResponses(await conversation.promptAndCollect(changedCourseRequest));
  record("course_change_requires_recheck", changedCourseRequest, changedCourse, /(90分).*(変更|空き|確認|案内)/u);
  assertConciseAndSafe("course_change_requires_recheck", changedCourse);
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

function assertConciseAndSafe(step, response, { maxLength = 180 } = {}) {
  assert.ok(response.length <= maxLength, `${step} was too long (${response.length} chars): ${response}`);
  assert.doesNotMatch(
    response,
    /(次に進め|内部|ツール|必須項目|不足して|処理できません|入力してください|初めてですか|以前の利用|注意事項を確認)/u,
    `${step} leaked internal state or an obsolete turn: ${response}`
  );
}

function joinResponses(responses) {
  return responses.map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
}

function isCompactFinalSummary(response) {
  return /23時/u.test(response) && /60分/u.test(response) && /12[,，]?000円/u.test(response) && /フリー/u.test(response) && /佐藤/u.test(response);
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

  function nextResponse(waitTimeoutMs = timeoutMs) {
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
            reject(new Error(`Production ConversationRelay response timed out after ${waitTimeoutMs}ms`));
          }, waitTimeoutMs);
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
    async promptAndCollect(text, { idleTimeoutMs = 2500, maxResponses = 4 } = {}) {
      const responses = [await this.prompt(text)];
      while (responses.length < maxResponses) {
        try {
          responses.push(await nextResponse(idleTimeoutMs));
        } catch (error) {
          if (/response timed out/u.test(String(error?.message ?? error))) break;
          throw error;
        }
      }
      return responses;
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

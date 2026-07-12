import { existsSync, readFileSync } from "node:fs";
import twilio from "twilio";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.base ?? "https://arare-ai-voice-relay.onrender.com").replace(/\/+$/, "");
const forwardedProto = new URL(baseUrl).protocol.replace(":", "");
const webhookUrl = `${baseUrl}/api/twilio/voice/realtime-agent`;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const toNumber = process.env.TWILIO_PHONE_NUMBER;
if (!accountSid || !authToken || !toNumber) throw new Error("Twilio environment is incomplete");

const healthResponse = await fetch(`${baseUrl}/health?deep=1`, { signal: AbortSignal.timeout(30000) });
const health = await healthResponse.json();
if (
  !healthResponse.ok ||
  !health?.ok ||
  !health?.databaseHealth?.ok ||
  !health?.realtimeAgent?.enabled ||
  health?.realtimeAgent?.conversationFlowVersion !== 5 ||
  health?.realtimeAgent?.firstVisitExplicitAnswerGateReady !== true ||
  health?.realtimeAgent?.forcedToolQuestionReady !== false ||
  health?.realtimeAgent?.ambiguousConfirmationGuardReady !== true ||
  health?.realtimeAgent?.nextAvailabilityToolReady !== true ||
  health?.realtimeAgent?.commentaryAudioSuppressionReady !== true ||
  health?.realtimeAgent?.forcedSpeechToolLockReady !== false ||
  health?.realtimeAgent?.naturalReceptionPromptReady !== true ||
  health?.realtimeAgent?.autonomousConversationReady !== true ||
  health?.realtimeAgent?.structuredToolFactsReady !== true ||
  health?.realtimeAgent?.fixedToolUtterancesDisabled !== true ||
  health?.realtimeAgent?.storeKnowledgeToolReady !== true ||
  health?.realtimeAgent?.freeTalkSideTopicReady !== true ||
  health?.realtimeAgent?.toolLoopGuardReady !== true ||
  health?.realtimeAgent?.staleTruncateRecoveryReady !== true ||
  health?.realtimeAgent?.automaticLegacyFailoverReady !== true ||
  health?.realtimeAgent?.scriptedReplyPrimary !== false
) {
  throw new Error("Production Realtime agent health gate is not ready");
}

const callSid = `CA_REGRESSION_AGENT_${Date.now()}`;
const streamSid = `MZ_REGRESSION_AGENT_${Date.now()}`;
const webhookParams = {
  AccountSid: accountSid,
  CallSid: callSid,
  CallStatus: "ringing",
  Direction: "inbound",
  From: "+818000000000",
  To: toNumber
};
const webhookSignature = twilio.getExpectedTwilioSignature(authToken, webhookUrl, webhookParams);
const webhookResponse = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "x-forwarded-proto": forwardedProto,
    "x-twilio-signature": webhookSignature
  },
  body: new URLSearchParams(webhookParams),
  signal: AbortSignal.timeout(30000)
});
const twiml = await webhookResponse.text();
if (!webhookResponse.ok) throw new Error(`Realtime agent webhook returned HTTP ${webhookResponse.status}`);

let websocketUrl = extractStreamUrl(twiml);
if (forwardedProto === "http") websocketUrl = websocketUrl.replace(/^wss:/, "ws:");
const customParameters = extractParameters(twiml);
if (!websocketUrl || !customParameters.storeId || customParameters.agentMode !== "native-speech-to-speech") {
  throw new Error("Realtime agent webhook did not return a store-bound direct Media Stream");
}

const websocketSignature = twilio.getExpectedTwilioSignature(authToken, websocketUrl, {});
const result = await runAgentSmoke({ websocketUrl, websocketSignature, forwardedProto, customParameters, callSid, streamSid });
const failoverCallSid = `CA_REGRESSION_FAILOVER_${Date.now()}`;
const failoverResponse = await fetch(`${baseUrl}/api/twilio/voice/connect-status?source=realtime-agent`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    CallSid: failoverCallSid,
    CallStatus: "in-progress",
    HandoffData: JSON.stringify({ reason: "synthetic-direct-agent-failure" })
  }),
  signal: AbortSignal.timeout(30000)
});
const failoverTwiml = await failoverResponse.text();
const automaticFailoverRedirect = failoverResponse.ok &&
  /<Redirect\b/i.test(failoverTwiml) &&
  /\/api\/twilio\/voice\?fallbackFrom=realtime-agent/i.test(failoverTwiml) &&
  !/店舗に確認して折り返し/u.test(failoverTwiml);
const report = {
  webhookStatus: webhookResponse.status,
  healthArchitecture: health.realtimeAgent.architecture,
  conversationFlowVersion: health.realtimeAgent.conversationFlowVersion,
  firstVisitExplicitAnswerGateReady: health.realtimeAgent.firstVisitExplicitAnswerGateReady,
  forcedToolQuestionReady: health.realtimeAgent.forcedToolQuestionReady,
  ambiguousConfirmationGuardReady: health.realtimeAgent.ambiguousConfirmationGuardReady,
  nextAvailabilityToolReady: health.realtimeAgent.nextAvailabilityToolReady,
  commentaryAudioSuppressionReady: health.realtimeAgent.commentaryAudioSuppressionReady,
  forcedSpeechToolLockReady: health.realtimeAgent.forcedSpeechToolLockReady,
  naturalReceptionPromptReady: health.realtimeAgent.naturalReceptionPromptReady,
  autonomousConversationReady: health.realtimeAgent.autonomousConversationReady,
  structuredToolFactsReady: health.realtimeAgent.structuredToolFactsReady,
  fixedToolUtterancesDisabled: health.realtimeAgent.fixedToolUtterancesDisabled,
  storeKnowledgeToolReady: health.realtimeAgent.storeKnowledgeToolReady,
  freeTalkSideTopicReady: health.realtimeAgent.freeTalkSideTopicReady,
  toolLoopGuardReady: health.realtimeAgent.toolLoopGuardReady,
  staleTruncateRecoveryReady: health.realtimeAgent.staleTruncateRecoveryReady,
  automaticLegacyFailoverReady: health.realtimeAgent.automaticLegacyFailoverReady,
  scriptedReplyPrimary: health.realtimeAgent.scriptedReplyPrimary,
  storeBound: Boolean(customParameters.storeId),
  websocketOpened: result.opened,
  closeCode: result.code,
  websocketError: result.error,
  mediaMessages: result.mediaMessages,
  decodedAudioBytes: result.mediaBytes,
  playbackMarks: result.marks,
  automaticFailoverRedirect,
  pass: result.opened && result.mediaMessages > 0 && result.mediaBytes >= 160 && result.marks > 0 && automaticFailoverRedirect
};
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

function runAgentSmoke({ websocketUrl, websocketSignature, forwardedProto, customParameters, callSid, streamSid }) {
  return new Promise((resolve) => {
    const socket = new WebSocket(websocketUrl, {
      headers: {
        "x-forwarded-proto": forwardedProto,
        "x-twilio-signature": websocketSignature
      }
    });
    const state = { opened: false, code: null, reason: null, error: null, mediaMessages: 0, mediaBytes: 0, marks: 0 };
    const timeout = setTimeout(() => {
      state.error = "production Realtime agent smoke timeout";
      socket.terminate();
    }, 40000);

    socket.on("open", () => {
      state.opened = true;
      socket.send(JSON.stringify({
        event: "start",
        streamSid,
        start: { streamSid, callSid, customParameters }
      }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event === "media" && message.media?.payload) {
        state.mediaMessages += 1;
        state.mediaBytes += Buffer.from(message.media.payload, "base64").length;
      }
      if (message.event === "mark") {
        state.marks += 1;
        socket.send(JSON.stringify({ event: "mark", streamSid, mark: { name: message.mark?.name } }));
        socket.send(JSON.stringify({ event: "stop", streamSid }));
        socket.close(1000, "agent smoke complete");
      }
    });
    socket.on("error", (error) => {
      state.error = error.message;
    });
    socket.on("close", (code, reason) => {
      clearTimeout(timeout);
      state.code = code;
      state.reason = reason.toString();
      resolve(state);
    });
  });
}

function extractStreamUrl(xml) {
  return decodeXml(xml.match(/<Stream\b[^>]*\burl="([^"]+)"/i)?.[1] ?? "");
}

function extractParameters(xml) {
  const values = {};
  for (const match of xml.matchAll(/<Parameter\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*\/?\s*>/gi)) {
    values[decodeXml(match[1])] = decodeXml(match[2]);
  }
  return values;
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseArgs(values) {
  return Object.fromEntries(values.map((value) => {
    const normalized = value.replace(/^--/, "");
    const separator = normalized.indexOf("=");
    return separator === -1
      ? [normalized, true]
      : [normalized.slice(0, separator), normalized.slice(separator + 1)];
  }));
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

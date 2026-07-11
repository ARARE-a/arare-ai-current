import { existsSync, readFileSync } from "node:fs";
import twilio from "twilio";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");

const baseUrl = "https://arare-ai-voice-relay.onrender.com";
const webhookUrl = `${baseUrl}/api/twilio/voice/realtime`;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const toNumber = process.env.TWILIO_PHONE_NUMBER;
if (!accountSid || !authToken || !toNumber) throw new Error("Twilio environment is incomplete");

const callSid = `CA_REGRESSION_REALTIME_${Date.now()}`;
const streamSid = `MZ_REGRESSION_REALTIME_${Date.now()}`;
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
    "x-twilio-signature": webhookSignature
  },
  body: new URLSearchParams(webhookParams),
  signal: AbortSignal.timeout(30000)
});
const twiml = await webhookResponse.text();
if (!webhookResponse.ok) throw new Error(`Realtime voice webhook returned HTTP ${webhookResponse.status}`);

const websocketUrl = extractStreamUrl(twiml);
const customParameters = extractParameters(twiml);
if (!websocketUrl || !customParameters.storeId) {
  throw new Error("Realtime voice webhook did not return a store-bound Media Stream");
}

const websocketSignature = twilio.getExpectedTwilioSignature(authToken, websocketUrl, {});
const result = await runMediaSmoke({ websocketUrl, websocketSignature, customParameters, callSid, streamSid });
console.log(
  JSON.stringify(
    {
      webhookStatus: webhookResponse.status,
      storeBound: Boolean(customParameters.storeId),
      websocketOpened: result.opened,
      closeCode: result.code,
      mediaMessages: result.mediaMessages,
      decodedAudioBytes: result.mediaBytes,
      playbackMarks: result.marks,
      pass: result.opened && result.mediaMessages > 0 && result.mediaBytes >= 160 && result.marks > 0
    },
    null,
    2
  )
);
if (!result.opened || result.mediaMessages < 1 || result.mediaBytes < 160 || result.marks < 1) process.exitCode = 1;

function runMediaSmoke({ websocketUrl, websocketSignature, customParameters, callSid, streamSid }) {
  return new Promise((resolve) => {
    const socket = new WebSocket(websocketUrl, { headers: { "x-twilio-signature": websocketSignature } });
    const state = { opened: false, code: null, reason: null, error: null, mediaMessages: 0, mediaBytes: 0, marks: 0 };
    const timeout = setTimeout(() => {
      state.error = "production media smoke timeout";
      socket.terminate();
    }, 30000);

    socket.on("open", () => {
      state.opened = true;
      socket.send(
        JSON.stringify({
          event: "start",
          streamSid,
          start: { streamSid, callSid, customParameters }
        })
      );
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
        socket.close(1000, "smoke complete");
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

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

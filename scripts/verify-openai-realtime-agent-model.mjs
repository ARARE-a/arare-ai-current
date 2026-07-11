import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");
process.env.VOICE_RELAY_TEST_MODE = "true";
process.env.DEMO_AUTO_BUSINESS_HOUR_SHIFTS_ENABLED = "false";

const {
  buildRealtimeAgentInstructions,
  buildRealtimeAgentTools,
  createPhoneSession
} = await import("./voice-relay-server.mjs");

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_AGENT_MODEL ?? process.env.OPENAI_REALTIME_MEDIA_MODEL ?? "gpt-realtime-2.1";
const voice = process.env.OPENAI_REALTIME_AGENT_VOICE ?? "cedar";
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const session = createPhoneSession();
session.from = "+818037884404";
session.storeContext = {
  storeId: "model-verification-store",
  store: { name: "ARARE デモ店", openTime: "12:00", closeTime: "29:00" },
  courses: [
    { id: "course-60", name: "60分リラックスコース", durationMin: 60, price: 12000 },
    { id: "course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000 }
  ],
  options: [],
  therapists: [
    { id: "therapist-1", displayName: "みさき" },
    { id: "therapist-2", displayName: "あおい" }
  ],
  rooms: [{ id: "room-a", name: "Room A" }]
};

const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
  headers: { Authorization: `Bearer ${apiKey}` }
});
const events = createEventQueue(socket);

await waitForOpen(socket);
socket.send(JSON.stringify({
  type: "session.update",
  session: {
    type: "realtime",
    model,
    output_modalities: ["audio"],
    instructions: buildRealtimeAgentInstructions(session),
    tools: buildRealtimeAgentTools(),
    tool_choice: "auto",
    audio: {
      output: { format: { type: "audio/pcmu" }, voice }
    }
  }
}));
await events.waitFor((event) => event.type === "session.updated", 15000);

sendUserText(socket, "明日の21時から90分、フリーで予約したいです");
let response = await createResponseAndWait(socket, events);
const availabilityCall = findToolCall(response, "check_availability");
if (!availabilityCall) {
  throw new Error(`Model spoke before checking availability: ${extractTranscript(response) || "no tool call"}`);
}
const preCheckSpeech = extractTranscript(response);
if (/空き(?:が)?(?:あります|ございます|空いています|確認できました)|ご案内可能/u.test(preCheckSpeech)) {
  throw new Error(`Model claimed availability before the tool result: ${preCheckSpeech}`);
}
const availabilityArgs = parseArguments(availabilityCall);
if (Number(availabilityArgs.course_duration_min) !== 90 || availabilityArgs.booking_type !== "free") {
  throw new Error(`Availability arguments were incorrect: ${availabilityCall.arguments}`);
}

const availabilityToken = "verification-availability-token";
sendToolOutput(socket, availabilityCall.call_id, {
  ok: true,
  code: "AVAILABLE",
  availability_token: availabilityToken,
  slot: {
    starts_at: availabilityArgs.starts_at,
    course_name: "90分スタンダードコース",
    course_duration_min: 90,
    therapist_name: "みさき",
    booking_type: "free"
  },
  next_question: "空きを確認できました。お名前をお願いします。名字だけでも大丈夫です。"
});
let nameQuestion = "";
for (let attempt = 0; attempt < 3 && !nameQuestion; attempt += 1) {
  response = await createResponseAndWait(socket, events);
  nameQuestion = extractTranscript(response);
  if (nameQuestion) break;
  const stateCall = findToolCall(response, "record_booking_details") ?? findToolCall(response, "get_reception_state");
  if (!stateCall) {
    throw new Error(`Model returned neither speech nor a safe state tool: ${JSON.stringify(response?.output ?? [])}`);
  }
  if (stateCall.name === "record_booking_details") {
    const args = parseArguments(stateCall);
    if (args.availability_token !== availabilityToken || Object.keys(args).some((key) => key !== "availability_token")) {
      throw new Error(`Model invented booking details before asking: ${stateCall.arguments}`);
    }
  }
  sendToolOutput(socket, stateCall.call_id, {
    ok: true,
    code: "DETAILS_RECORDED",
    next_required_field: "customer_name",
    next_question: "お名前をお願いします。名字だけでも大丈夫です。"
  });
}
if (!/名前|名字/u.test(nameQuestion) || /予約でき|確定|SMSを送り/u.test(nameQuestion)) {
  throw new Error(`Model did not ask only for the customer name: ${nameQuestion || "no transcript"}; output=${JSON.stringify(response?.output ?? [])}`);
}

sendUserText(socket, "佐藤です");
response = await createResponseAndWait(socket, events);
const recordCall = findToolCall(response, "record_booking_details");
if (!recordCall) {
  throw new Error(`Model did not record the supplied name: ${extractTranscript(response) || "no tool call"}`);
}
const recordArgs = parseArguments(recordCall);
if (recordArgs.availability_token !== availabilityToken || !String(recordArgs.customer_name ?? "").includes("佐藤")) {
  throw new Error(`Booking detail arguments were incorrect: ${recordCall.arguments}`);
}

socket.close(1000, "verification complete");
console.log(JSON.stringify({
  ok: true,
  model,
  voice,
  checks: {
    availabilityToolBeforeSpeech: true,
    availabilityArgumentsCorrect: true,
    asksForNameAfterAvailability: true,
    recordsNameWithAvailabilityToken: true
  }
}, null, 2));

function sendUserText(ws, text) {
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
}

function sendToolOutput(ws, callId, output) {
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output)
    }
  }));
}

async function createResponseAndWait(ws, queue) {
  ws.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
  const event = await queue.waitFor((item) => item.type === "response.done", 30000);
  if (event.response?.status !== "completed") {
    throw new Error(`Realtime response did not complete: ${JSON.stringify(event.response?.status_details ?? {})}`);
  }
  event.response.verificationTranscript = await queue.waitForTranscript(event.response.id, 2500);
  return event.response;
}

function findToolCall(response, name) {
  return (response?.output ?? []).find((item) => item?.type === "function_call" && item.name === name);
}

function parseArguments(call) {
  try {
    return JSON.parse(call?.arguments ?? "{}");
  } catch {
    return {};
  }
}

function extractTranscript(response) {
  const embedded = (response?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.transcript ?? content?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return embedded || String(response?.verificationTranscript ?? "").trim();
}

function createEventQueue(ws) {
  const backlog = [];
  const waiters = [];
  const transcripts = new Map();
  const transcriptWaiters = new Map();
  const recentEvents = [];
  let currentResponseId = "";
  ws.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    recentEvents.push({ type: event.type, responseId: event.response_id ?? event.response?.id ?? null });
    if (recentEvents.length > 80) recentEvents.shift();
    if (event.type === "error") {
      const error = new Error(event.error?.message ?? "OpenAI Realtime error");
      for (const waiter of waiters.splice(0)) waiter.reject(error);
      return;
    }
    if (event.type === "response.created") currentResponseId = String(event.response?.id ?? "");
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      const responseId = String(event.response_id ?? currentResponseId ?? "");
      const transcript = String(event.transcript ?? "").trim();
      transcripts.set(responseId, transcript);
      const resolve = transcriptWaiters.get(responseId);
      if (resolve) {
        transcriptWaiters.delete(responseId);
        resolve(transcript);
      }
    }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      waiter.resolve(event);
    } else {
      backlog.push(event);
    }
  });
  return {
    describe() {
      return recentEvents;
    },
    getTranscript(responseId) {
      return transcripts.get(String(responseId ?? "")) ?? "";
    },
    waitForTranscript(responseId, timeoutMs) {
      const key = String(responseId ?? "");
      if (transcripts.has(key)) return Promise.resolve(transcripts.get(key));
      return new Promise((resolve) => {
        transcriptWaiters.set(key, resolve);
        setTimeout(() => {
          if (transcriptWaiters.get(key) === resolve) transcriptWaiters.delete(key);
          resolve(transcripts.get(key) ?? "");
        }, timeoutMs);
      });
    },
    waitFor(predicate, timeoutMs) {
      const index = backlog.findIndex(predicate);
      if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        waiters.push(waiter);
        const timeout = setTimeout(() => {
          const position = waiters.indexOf(waiter);
          if (position >= 0) waiters.splice(position, 1);
          reject(new Error("OpenAI Realtime model verification timeout"));
        }, timeoutMs);
        waiter.resolve = (value) => {
          clearTimeout(timeout);
          resolve(value);
        };
        waiter.reject = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
    }
  };
}

function waitForOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenAI Realtime connection timeout")), 15000);
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OpenAiRealtimeAgentBridge } from "./lib/openai-realtime-agent-bridge.mjs";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(value) {
    const message = JSON.parse(value);
    this.sent.push(message);
    if (message.type === "session.update") {
      queueMicrotask(() => this.emit("message", JSON.stringify({ type: "session.updated" })));
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

process.env.VOICE_RELAY_TEST_MODE = "true";
process.env.DEMO_AUTO_BUSINESS_HOUR_SHIFTS_ENABLED = "false";

const {
  classifyRealtimeAgentCustomerTurn,
  createPhoneSession,
  createRealtimeAgentState,
  validateRealtimeAgentAvailabilityEvidence
} = await import("./voice-relay-server.mjs");

let checks = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

const random = createRandom(20260713);
const backchannels = ["はい", "はーい", "うん", "うーん", "ええ", "そうです", "そうですね", "なるほど", "了解"];
const multipleChoicePrompts = [
  "13時ですか、それとも深夜1時ですか？",
  "60分または90分のどちらですか？",
  "初回ですか、それとも再来ですか？"
];

for (let index = 0; index < 200; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.lastAssistantText = "ご希望を確認しています。";
  const text = pick(backchannels, random);
  const decision = classifyRealtimeAgentCustomerTurn(session, text, {
    confidence: 0.9 + random() * 0.09,
    assistantWasPlaying: true,
    durationMs: 100 + Math.floor(random() * 700)
  });
  check(decision.ignore, true, `backchannel ${index + 1} must not advance the turn`);
}

for (let index = 0; index < 200; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.lastAssistantText = pick(multipleChoicePrompts, random);
  const decision = classifyRealtimeAgentCustomerTurn(session, pick(["はい", "はーい", "うん", "それで"], random), {
    confidence: 0.97
  });
  check(decision.reason, "ambiguous_affirmative_after_multiple_choice");
  check(decision.toolChoice, "none");
}

for (let index = 0; index < 100; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  const decision = classifyRealtimeAgentCustomerTurn(session, "聞こえてますか？", { confidence: 0.98 });
  check(decision.reason, "connection_check");
  check(decision.toolChoice, "none");
}

for (let index = 0; index < 100; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.lastAssistantText = "空きを確認しています。少々お待ちください。";
  session.realtimeAgentState.userSpeechSequence = 1;
  const first = classifyRealtimeAgentCustomerTurn(session, "今かけている番号で大丈夫です", {
    confidence: 0.98,
    receivedAt: 1000
  });
  session.realtimeAgentState.userSpeechSequence = 2;
  const duplicate = classifyRealtimeAgentCustomerTurn(session, "この電話番号を使ってください", {
    confidence: 0.98,
    receivedAt: 5000
  });
  check(first.reason, "normal_turn");
  check(duplicate.reason, "duplicate_turn_during_response_wait");
  check(duplicate.ignore, true);
  check(
    session.realtimeAgentState.lastUserTranscriptSpeechSequence,
    session.realtimeAgentState.userSpeechSequence,
    "ignored duplicate must preserve the accepted turn for an in-flight tool call"
  );
  session.realtimeAgentState.userSpeechSequence = 3;
  const afterWindow = classifyRealtimeAgentCustomerTurn(session, "この電話番号を使ってください", {
    confidence: 0.98,
    receivedAt: 10000
  });
  check(afterWindow.reason, "normal_turn", "the duplicate window must not suppress a later intentional answer");
}

const courses = [
  { name: "60分リラックスコース", durationMin: 60, price: 12000 },
  { name: "90分スタンダードコース", durationMin: 90, price: 17000 },
  { name: "120分ゆったりコース", durationMin: 120, price: 22000 }
];
const evidenceBaselineAt = new Date("2026-07-13T10:03:00.000Z").getTime();
for (let index = 0; index < 300; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = evidenceBaselineAt;
  const course = pick(courses, random);
  const hour = pick([13, 18, 21], random);
  const startsAt = new Date(`2026-07-14T${String(hour - 9).padStart(2, "0")}:00:00.000Z`);
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `明日の${hour}時から${course.durationMin}分でお願いします`
  }];
  check(validateRealtimeAgentAvailabilityEvidence(session, startsAt, course), null);
}

for (let index = 0; index < 100; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = new Date("2026-07-13T10:03:00.000Z").getTime();
  const course = pick(courses, random);
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `2時間後から${course.durationMin}分でお願いします`
  }];
  const supportedStart = new Date("2026-07-13T12:00:00.000Z");
  const unsupportedStart = new Date("2026-07-13T13:00:00.000Z");
  check(validateRealtimeAgentAvailabilityEvidence(session, supportedStart, course), null);
  check(validateRealtimeAgentAvailabilityEvidence(session, unsupportedStart, course)?.code, "DATETIME_EVIDENCE_REQUIRED");
}

for (let index = 0; index < 150; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = evidenceBaselineAt;
  const course = pick(courses, random);
  const startsAt = new Date("2026-07-14T04:00:00.000Z");
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `明日の1時から${course.durationMin}分でお願いします`
  }];
  check(validateRealtimeAgentAvailabilityEvidence(session, startsAt, course)?.code, "DATETIME_EVIDENCE_REQUIRED");
}

for (let index = 0; index < 150; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = evidenceBaselineAt;
  const course = pick(courses, random);
  const wrongDuration = course.durationMin === 90 ? 60 : 90;
  const startsAt = new Date("2026-07-14T04:00:00.000Z");
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `明日の13時から${wrongDuration}分でお願いします`
  }];
  check(validateRealtimeAgentAvailabilityEvidence(session, startsAt, course)?.code, "COURSE_EVIDENCE_REQUIRED");
}

for (let index = 0; index < 100; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = evidenceBaselineAt;
  const course = pick(courses, random);
  const oldHour = pick([13, 18, 21], random);
  const newHour = pick([13, 18, 21].filter((hour) => hour !== oldHour), random);
  const oldStart = new Date(`2026-07-14T${String(oldHour - 9).padStart(2, "0")}:00:00.000Z`);
  const newStart = new Date(`2026-07-14T${String(newHour - 9).padStart(2, "0")}:00:00.000Z`);
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `7月14日の${oldHour}時、いや${newHour}時から${course.durationMin}分でお願いします`
  }];
  check(validateRealtimeAgentAvailabilityEvidence(session, oldStart, course)?.code, "DATETIME_EVIDENCE_REQUIRED");
  check(validateRealtimeAgentAvailabilityEvidence(session, newStart, course), null);
}

for (let index = 0; index < 100; index += 1) {
  const session = createPhoneSession();
  session.realtimeAgentState = createRealtimeAgentState();
  session.setupAt = evidenceBaselineAt;
  const oldCourse = pick(courses, random);
  const newCourse = pick(courses.filter((course) => course.durationMin !== oldCourse.durationMin), random);
  const startsAt = new Date("2026-07-14T04:00:00.000Z");
  session.reservationDraft.course = oldCourse;
  session.conversationTurns = [{
    role: "CUSTOMER",
    content: `7月14日の13時から${oldCourse.durationMin}分、やっぱり${newCourse.durationMin}分でお願いします`
  }];
  check(validateRealtimeAgentAvailabilityEvidence(session, startsAt, oldCourse)?.code, "COURSE_EVIDENCE_REQUIRED");
  check(validateRealtimeAgentAvailabilityEvidence(session, startsAt, newCourse), null);
}

const twilio = new FakeSocket();
twilio.open();
const openai = new FakeSocket();
const bridgeErrors = [];
const latencyEvents = [];
const bridge = new OpenAiRealtimeAgentBridge({
  twilioSocket: twilio,
  apiKey: "test-key",
  model: "gpt-realtime-2.1",
  voice: "cedar",
  transcriptionModel: "gpt-4o-transcribe",
  instructions: "Respond naturally in Japanese.",
  bargeInDelayMs: 250,
  openAiSocketFactory: () => {
    queueMicrotask(() => openai.open());
    return openai;
  },
  onLatency: (event) => latencyEvents.push(event),
  onError: async (error) => bridgeErrors.push(error.message)
});

await bridge.connect();
await bridge.handleTwilioMessage({
  event: "start",
  streamSid: "MZ_LONG_TURN_TEST",
  start: { streamSid: "MZ_LONG_TURN_TEST", callSid: "CA_LONG_TURN_TEST" }
});

for (let index = 0; index < 120; index += 1) {
  const callerItemId = `caller_${index}`;
  const responseId = `response_${index}`;
  const assistantItemId = `assistant_${index}`;
  const audioStartMs = index * 2000;
  openai.emit("message", JSON.stringify({
    type: "input_audio_buffer.speech_started",
    item_id: callerItemId,
    audio_start_ms: audioStartMs
  }));
  openai.emit("message", JSON.stringify({
    type: "input_audio_buffer.speech_stopped",
    item_id: callerItemId,
    audio_end_ms: audioStartMs + 850
  }));
  openai.emit("message", JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: callerItemId,
    transcript: `確認用の発話${index + 1}です`,
    logprobs: [{ logprob: -0.01 }]
  }));
  await tick();
  check(openai.sent.at(-1).type, "response.create");

  openai.emit("message", JSON.stringify({ type: "response.created", response: { id: responseId } }));
  openai.emit("message", JSON.stringify({
    type: "response.output_item.added",
    item: { id: assistantItemId, type: "message", phase: "final_answer" }
  }));
  openai.emit("message", JSON.stringify({
    type: "response.output_audio.delta",
    item_id: assistantItemId,
    delta: Buffer.alloc(160).toString("base64")
  }));

  if (index % 10 === 0) {
    const backchannelId = `backchannel_${index}`;
    openai.emit("message", JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: backchannelId,
      audio_start_ms: audioStartMs + 900
    }));
    openai.emit("message", JSON.stringify({
      type: "input_audio_buffer.speech_stopped",
      item_id: backchannelId,
      audio_end_ms: audioStartMs + 1100
    }));
    openai.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: backchannelId,
      transcript: "うん",
      logprobs: [{ logprob: -0.01 }]
    }));
    await tick();
  }

  openai.emit("message", JSON.stringify({
    type: "response.done",
    response: { id: responseId, status: "completed", output: [] }
  }));
  await tick();
  const mark = twilio.sent.at(-1);
  check(mark.event, "mark");
  await bridge.handleTwilioMessage(mark);
}

check(bridgeErrors.length, 0, "long conversation must not fail");
check(latencyEvents.length, 120, "every caller turn must produce latency telemetry");
check(twilio.sent.filter((item) => item.event === "clear").length, 0, "brief backchannels must not clear playback");

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "interrupt_response" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "interrupt_output", type: "message", phase: "final_answer" }
}));
openai.emit("message", JSON.stringify({
  type: "response.output_audio.delta",
  item_id: "interrupt_output",
  delta: Buffer.alloc(8000).toString("base64")
}));
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_started",
  item_id: "meaningful_interrupt",
  audio_start_ms: 999000
}));
const clearsBeforeMeaningfulInterrupt = twilio.sent.filter((item) => item.event === "clear").length;
await wait(280);
check(
  twilio.sent.filter((item) => item.event === "clear").length,
  clearsBeforeMeaningfulInterrupt,
  "speech duration without meaning must not clear playback"
);
openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.delta",
  item_id: "meaningful_interrupt",
  delta: "ちょっと待って"
}));
await tick();
check(twilio.sent.at(-1).event, "clear");
check(openai.sent.some((item) => item.type === "response.cancel"), true);

bridge.close();
console.log(JSON.stringify({
  ok: true,
  randomizedPolicyCases: 1500,
  longConversationTurns: 120,
  checks
}, null, 2));

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(values, randomValue) {
  return values[Math.floor(randomValue() * values.length)];
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OpenAiRealtimeAgentBridge } from "./lib/openai-realtime-agent-bridge.mjs";

class FakeSocket extends EventEmitter {
  constructor(options = {}) {
    super();
    this.readyState = 0;
    this.sent = [];
    this.autoSessionUpdated = options.autoSessionUpdated !== false;
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(value) {
    const message = JSON.parse(value);
    this.sent.push(message);
    if (message.type === "session.update" && this.autoSessionUpdated) {
      queueMicrotask(() => this.emit("message", JSON.stringify({ type: "session.updated" })));
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

const twilio = new FakeSocket();
twilio.open();
const openai = new FakeSocket();
const customerTranscripts = [];
const assistantTranscripts = [];
const toolCalls = [];
const playbackEvents = [];
const usageEvents = [];
const latencyEvents = [];
const toolLatencyEvents = [];
const bridgeErrors = [];
const bridgeLogs = [];
const tools = [
  {
    type: "function",
    name: "check_availability",
    description: "Check availability",
    parameters: {
      type: "object",
      properties: { starts_at: { type: "string" } },
      required: ["starts_at"]
    }
  }
];

const bridge = new OpenAiRealtimeAgentBridge({
  twilioSocket: twilio,
  apiKey: "test-key",
  model: "gpt-realtime-2.1",
  voice: "cedar",
  transcriptionModel: "gpt-4o-transcribe",
  bargeInDelayMs: 250,
  transcriptionWatchdogMs: 1000,
  instructions: "日本語で自然に応答してください。",
  tools,
  log: (event, detail) => bridgeLogs.push({ event, detail }),
  openAiSocketFactory: () => {
    queueMicrotask(() => openai.open());
    return openai;
  },
  onCustomerTranscript: async (text) => customerTranscripts.push(text),
  onAssistantTranscript: async (text) => assistantTranscripts.push(text),
  onToolCall: async (call) => {
    toolCalls.push(call);
    if (call.name === "search_store_knowledge") {
      return {
        ok: true,
        code: "KNOWLEDGE_FOUND",
        spoken_course_comparison: "60分は12,000円、90分は17,000円です。主な違いは利用時間と料金です。"
      };
    }
    if (call.name === "prepare_final_confirmation") {
      return {
        ok: true,
        code: "FINAL_CONFIRMATION_READY",
        spoken_summary: "7月16日22時、90分スタンダードコース、17,000円、フリー、斎藤様で仮受付します。よろしいですか？",
        confirmation_token: "confirmation-token"
      };
    }
    return call.arguments.terminal
      ? {
          ok: true,
          code: "HOLD_CREATED_SMS_SENT",
          terminal: true,
          reservation_status: "tentative",
          sms_status: "sent",
          required_disclosures: ["reservation_is_tentative", "sms_was_sent"]
        }
      : {
          ok: true,
          code: "AVAILABLE",
          slot: { starts_at: "2026-07-12T21:00:00+09:00", course_duration_min: 90 },
          missing_fields: ["customer_name", "phone"],
          allowed_actions: ["record_booking_details", "continue_conversation"]
        };
  },
  onUsage: (source, usage) => usageEvents.push({ source, usage }),
  onLatency: (event) => latencyEvents.push(event),
  onToolLatency: (event) => toolLatencyEvents.push(event),
  onPlaybackComplete: (event) => playbackEvents.push(event),
  onError: async (error) => bridgeErrors.push(error.message)
});

await bridge.connect();
const sessionUpdate = openai.sent[0];
assert.equal(sessionUpdate.type, "session.update");
assert.equal(sessionUpdate.session.model, "gpt-realtime-2.1");
assert.equal(sessionUpdate.session.reasoning.effort, "low");
assert.equal(sessionUpdate.session.audio.input.turn_detection.create_response, false);
assert.equal(sessionUpdate.session.audio.input.turn_detection.interrupt_response, false);
assert.equal(sessionUpdate.session.max_output_tokens, 512);
assert.equal(sessionUpdate.session.truncation.type, "retention_ratio");
assert.equal(sessionUpdate.session.truncation.retention_ratio, 0.8);
assert.equal(sessionUpdate.session.truncation.token_limits.post_instructions, 1800);
assert.equal(sessionUpdate.session.audio.output.voice, "cedar");
assert.deepEqual(sessionUpdate.session.tools, tools);
assert.equal(bridge.sessionReady, true);

const handshakeTwilio = new FakeSocket();
handshakeTwilio.open();
const handshakeOpenAi = new FakeSocket({ autoSessionUpdated: false });
const handshakeBridge = new OpenAiRealtimeAgentBridge({
  twilioSocket: handshakeTwilio,
  apiKey: "test-key",
  model: "gpt-realtime-2.1",
  voice: "cedar",
  transcriptionModel: "gpt-4o-transcribe",
  instructions: "日本語で応答してください。",
  tools: [],
  openAiSocketFactory: () => {
    queueMicrotask(() => handshakeOpenAi.open());
    return handshakeOpenAi;
  }
});
let handshakeResolved = false;
const handshakeConnect = handshakeBridge.connect().then(() => {
  handshakeResolved = true;
});
await tick();
assert.equal(handshakeOpenAi.sent[0].type, "session.update");
assert.equal(handshakeResolved, false, "connect must wait for session.updated");
handshakeOpenAi.emit("message", JSON.stringify({ type: "session.updated" }));
await handshakeConnect;
assert.equal(handshakeResolved, true);
handshakeBridge.close();

await bridge.handleTwilioMessage({
  event: "start",
  streamSid: "MZ_AGENT_TEST",
  start: { streamSid: "MZ_AGENT_TEST", callSid: "CA_AGENT_TEST" }
});
await bridge.handleTwilioMessage({ event: "media", media: { payload: "CALLER_PCMU" } });
assert.deepEqual(openai.sent.at(-1), { type: "input_audio_buffer.append", audio: "CALLER_PCMU" });

const twilioMessagesBeforeCommentary = twilio.sent.length;
openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_commentary" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_commentary", type: "message", phase: "commentary" }
}));
openai.emit("message", JSON.stringify({
  type: "response.output_audio_transcript.done",
  item_id: "item_commentary",
  transcript: "では、確認してから進めます。"
}));
openai.emit("message", JSON.stringify({
  type: "response.output_audio.delta",
  delta: Buffer.alloc(160).toString("base64")
}));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: {
    id: "resp_commentary",
    status: "completed",
    output: [{
      id: "item_commentary",
      type: "message",
      phase: "commentary",
      content: [{ type: "output_audio", transcript: "では、確認してから進めます。" }]
    }]
  }
}));
await tick();
assert.equal(twilio.sent.length, twilioMessagesBeforeCommentary, "commentary audio must not reach the caller");
assert.deepEqual(assistantTranscripts, [], "suppressed commentary must not enter the call transcript");
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_commentary_audio_suppressed"));
assert.equal(openai.sent.at(-1).type, "response.create");
assert.equal(openai.sent.at(-1).response.tool_choice, "none");
assert.match(openai.sent.at(-1).response.instructions, /利用者へ音声が届きませんでした/u);
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_completed_without_audio"));

bridge.startGreeting();
assert.equal(openai.sent.at(-1).type, "response.create");
assert.match(openai.sent.at(-1).response.instructions, /ARARE AIです。ご希望をどうぞ/);
assert.match(openai.sent.at(-1).response.instructions, /追加は禁止/);
assert.equal(openai.sent.at(-1).response.tool_choice, "none");

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_greeting" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_greeting", type: "message", phase: "final_answer" }
}));
openai.emit("message", JSON.stringify({
  type: "response.output_audio_transcript.done",
  item_id: "item_greeting",
  transcript: "お電話ありがとうございます。ご希望をどうぞ。"
}));
openai.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(160).toString("base64") }));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: { id: "resp_greeting", status: "completed", output: [], usage: { total_tokens: 20 } }
}));
await tick();
assert.deepEqual(assistantTranscripts, ["お電話ありがとうございます。ご希望をどうぞ。"]);
assert.equal(twilio.sent.at(-1).event, "mark");
const greetingMark = twilio.sent.at(-1);
await bridge.handleTwilioMessage(greetingMark);
assert.deepEqual(playbackEvents, [{ name: greetingMark.mark.name, terminal: false }]);
assert.equal(bridge.currentOutputItemId, undefined, "acknowledged playback must not be truncated on the next caller turn");

openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.completed",
  item_id: "caller_1",
  transcript: "明日の21時、90分で空いていますか",
  logprobs: [{ logprob: -0.01 }],
  usage: { total_tokens: 8 }
}));
await tick();
assert.deepEqual(customerTranscripts, ["明日の21時、90分で空いていますか"]);

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_tool" } }));
const toolResponse = {
  type: "response.done",
  response: {
    id: "resp_tool",
    status: "completed",
    output: [{
      type: "function_call",
      name: "check_availability",
      call_id: "call_availability_1",
      arguments: JSON.stringify({ starts_at: "2026-07-12T21:00:00+09:00" })
    }],
    usage: { total_tokens: 12 }
  }
};
openai.emit("message", JSON.stringify(toolResponse));
await tick();
assert.equal(toolCalls.length, 1);
assert.equal(toolCalls[0].name, "check_availability");
assert.equal(toolLatencyEvents.length, 1);
assert.equal(toolLatencyEvents[0].name, "check_availability");
assert.ok(toolLatencyEvents[0].latencyMs >= 0);
const toolOutput = openai.sent.find((item) => item.type === "conversation.item.create" && item.item.call_id === "call_availability_1");
assert.ok(toolOutput);
assert.equal(JSON.parse(toolOutput.item.output).code, "AVAILABLE");
assert.equal(openai.sent.at(-1).type, "response.create");
assert.equal(openai.sent.at(-1).response.instructions, undefined, "tool facts must not force a customer utterance");
assert.equal(openai.sent.at(-1).response.tool_choice, undefined, "the model must remain free to answer or call another tool");

const responseCreateCount = openai.sent.filter((item) => item.type === "response.create").length;
openai.emit("message", JSON.stringify(toolResponse));
await tick();
assert.equal(toolCalls.length, 1, "duplicate tool call IDs must not execute twice");
assert.equal(openai.sent.filter((item) => item.type === "response.create").length, responseCreateCount);

openai.emit("message", JSON.stringify({
  type: "response.done",
  response: {
    id: "resp_course_comparison_tool",
    status: "completed",
    output: [{
      type: "function_call",
      name: "search_store_knowledge",
      call_id: "call_course_comparison_1",
      arguments: JSON.stringify({ query: "60分と90分の違い" })
    }]
  }
}));
await tick();
const exactCourseComparisonRequest = openai.sent.at(-1);
assert.equal(exactCourseComparisonRequest.type, "response.create");
assert.equal(exactCourseComparisonRequest.response.tool_choice, "none");
assert.match(exactCourseComparisonRequest.response.instructions, /60分は12,000円/u);
assert.match(exactCourseComparisonRequest.response.instructions, /90分は17,000円/u);
assert.match(exactCourseComparisonRequest.response.instructions, /言い換え、要約、省略、補足/u);

openai.emit("message", JSON.stringify({
  type: "response.done",
  response: {
    id: "resp_prepare_confirmation_tool",
    status: "completed",
    output: [{
      type: "function_call",
      name: "prepare_final_confirmation",
      call_id: "call_prepare_confirmation_1",
      arguments: JSON.stringify({ availability_token: "availability-token" })
    }]
  }
}));
await tick();
const exactConfirmationRequest = openai.sent.at(-1);
assert.equal(exactConfirmationRequest.type, "response.create");
assert.equal(exactConfirmationRequest.response.tool_choice, "none");
assert.match(exactConfirmationRequest.response.instructions, /utteranceの値だけ/u);
assert.match(exactConfirmationRequest.response.instructions, /斎藤様で仮受付します/u);
assert.match(exactConfirmationRequest.response.instructions, /言い換え、要約、省略、補足/u);
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_exact_spoken_follow_up"));

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_interrupt" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_interrupt", type: "message" }
}));
openai.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(800).toString("base64") }));
bridge.firstOutputAudioAt = Date.now() - 50;
const clearsBeforeBackchannel = twilio.sent.filter((item) => item.event === "clear").length;
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_started",
  item_id: "caller_backchannel",
  audio_start_ms: 1000
}));
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_stopped",
  item_id: "caller_backchannel",
  audio_end_ms: 1200
}));
openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.completed",
  item_id: "caller_backchannel",
  transcript: "はい",
  logprobs: [{ logprob: -0.01 }]
}));
await tick();
assert.equal(twilio.sent.filter((item) => item.event === "clear").length, clearsBeforeBackchannel);
assert.ok(openai.sent.some((item) =>
  item.type === "conversation.item.delete" && item.item_id === "caller_backchannel"
));
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_backchannel_ignored"));
assert.equal(latencyEvents.length, 1);
assert.ok(latencyEvents[0].latencyMs >= 0);

const clearsBeforeNoise = twilio.sent.filter((item) => item.event === "clear").length;
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_started",
  item_id: "caller_short_noise",
  audio_start_ms: 1300
}));
await wait(300);
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_stopped",
  item_id: "caller_short_noise",
  audio_end_ms: 1800
}));
openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.completed",
  item_id: "caller_short_noise",
  transcript: "",
  logprobs: []
}));
await tick();
assert.equal(twilio.sent.filter((item) => item.event === "clear").length, clearsBeforeNoise);
assert.ok(openai.sent.some((item) =>
  item.type === "conversation.item.delete" && item.item_id === "caller_short_noise"
));

const clearsBeforeExplicitInterrupt = twilio.sent.filter((item) => item.event === "clear").length;
openai.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "caller_interrupt" }));
await wait(280);
assert.equal(
  twilio.sent.filter((item) => item.event === "clear").length,
  clearsBeforeExplicitInterrupt,
  "speech duration alone must not interrupt playback"
);
openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.delta",
  item_id: "caller_interrupt",
  delta: "ちょっと待って"
}));
await tick();
assert.equal(
  twilio.sent.filter((item) => item.event === "clear").length,
  clearsBeforeExplicitInterrupt + 1
);
const truncate = openai.sent.find((item) => item.type === "conversation.item.truncate" && item.item_id === "item_interrupt");
assert.ok(truncate);
assert.ok(truncate.audio_end_ms >= 0 && truncate.audio_end_ms <= 100);
assert.ok(openai.sent.some((item) => item.type === "response.cancel"));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: { id: "resp_interrupt", status: "cancelled", output: [] }
}));
await tick();
openai.emit("message", JSON.stringify({
  type: "error",
  error: { message: "Audio content of 8450ms is already shorter than 14050ms" }
}));
await tick();
assert.deepEqual(bridgeErrors, [], "a stale truncate response must not terminate the call");

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_general_interrupt" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_general_interrupt", type: "message" }
}));
openai.emit("message", JSON.stringify({
  type: "response.output_audio.delta",
  item_id: "item_general_interrupt",
  delta: Buffer.alloc(8000).toString("base64")
}));
const clearsBeforeGeneralInterrupt = twilio.sent.filter((item) => item.event === "clear").length;
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_started",
  item_id: "caller_general_interrupt"
}));
openai.emit("message", JSON.stringify({
  type: "conversation.item.input_audio_transcription.delta",
  item_id: "caller_general_interrupt",
  delta: "明日の15時に変更したいです"
}));
await wait(930);
assert.equal(
  twilio.sent.filter((item) => item.event === "clear").length,
  clearsBeforeGeneralInterrupt + 1,
  "meaningful sustained speech must interrupt after the backchannel window"
);
assert.ok(bridgeLogs.some((item) =>
  item.event === "openai_realtime_agent_meaningful_interruption" &&
  item.detail.reason === "meaningful_sustained_caller_speech"
));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: { id: "resp_general_interrupt", status: "cancelled", output: [] }
}));
await tick();

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_terminal_tool" } }));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: {
    id: "resp_terminal_tool",
    status: "completed",
    output: [{
      type: "function_call",
      name: "check_availability",
      call_id: "call_terminal_1",
      arguments: JSON.stringify({ terminal: true })
    }, {
      type: "function_call",
      name: "check_availability",
      call_id: "call_after_terminal_must_skip",
      arguments: JSON.stringify({ starts_at: "2026-07-12T22:00:00+09:00" })
    }]
  }
}));
await tick();
assert.equal(toolCalls.some((call) => call.callId === "call_after_terminal_must_skip"), false);
const skippedAfterTerminal = openai.sent.find((item) =>
  item.type === "conversation.item.create" && item.item.call_id === "call_after_terminal_must_skip"
);
assert.equal(JSON.parse(skippedAfterTerminal.item.output).code, "SKIPPED_AFTER_TERMINAL_RESULT");
assert.equal(openai.sent.at(-1).response.instructions, undefined);
assert.equal(openai.sent.at(-1).response.tool_choice, "none", "terminal result may not trigger another side effect tool");
openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_terminal_audio" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_terminal", type: "message" }
}));
openai.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(160).toString("base64") }));
openai.emit("message", JSON.stringify({
  type: "response.done",
  response: { id: "resp_terminal_audio", status: "completed", output: [] }
}));
await tick();
const terminalMark = twilio.sent.at(-1);
assert.equal(terminalMark.event, "mark");
await bridge.handleTwilioMessage(terminalMark);
assert.equal(playbackEvents.at(-1).terminal, true);
assert.deepEqual(usageEvents.map((item) => item.source), ["realtime_agent", "transcription", "realtime_agent"]);

bridge.maxConsecutiveToolTurns = 1;
for (let index = 1; index <= 2; index += 1) {
  openai.emit("message", JSON.stringify({ type: "response.created", response: { id: `resp_loop_${index}` } }));
  openai.emit("message", JSON.stringify({
    type: "response.done",
    response: {
      id: `resp_loop_${index}`,
      status: "completed",
      output: [{
        type: "function_call",
        name: "check_availability",
        call_id: `call_loop_${index}`,
        arguments: JSON.stringify({ starts_at: "2026-07-12T21:00:00+09:00" })
      }]
    }
  }));
  await tick();
}
assert.match(openai.sent.at(-1).response.instructions, /これ以上ツールを呼ばず/);
assert.equal(openai.sent.at(-1).response.tool_choice, "none");

const preambleTwilio = new FakeSocket();
preambleTwilio.open();
const preambleOpenAi = new FakeSocket();
const preambleTranscripts = [];
const preambleBridge = new OpenAiRealtimeAgentBridge({
  twilioSocket: preambleTwilio,
  apiKey: "test-key",
  model: "gpt-realtime-2.1",
  voice: "cedar",
  transcriptionModel: "gpt-4o-transcribe",
  instructions: "日本語で応答してください。",
  commentaryAudioEnabled: true,
  openAiSocketFactory: () => {
    queueMicrotask(() => preambleOpenAi.open());
    return preambleOpenAi;
  },
  onAssistantTranscript: async (text) => preambleTranscripts.push(text)
});
await preambleBridge.connect();
await preambleBridge.handleTwilioMessage({
  event: "start",
  streamSid: "MZ_PREAMBLE_TEST",
  start: { streamSid: "MZ_PREAMBLE_TEST", callSid: "CA_PREAMBLE_TEST" }
});
preambleOpenAi.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_preamble" } }));
preambleOpenAi.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_preamble", type: "message", phase: "commentary" }
}));
preambleOpenAi.emit("message", JSON.stringify({
  type: "response.output_audio_transcript.done",
  item_id: "item_preamble",
  transcript: "確認しますね。"
}));
preambleOpenAi.emit("message", JSON.stringify({
  type: "response.output_audio.delta",
  item_id: "item_preamble",
  delta: Buffer.alloc(160).toString("base64")
}));
preambleOpenAi.emit("message", JSON.stringify({
  type: "response.done",
  response: { id: "resp_preamble", status: "completed", output: [] }
}));
await tick();
assert.ok(preambleTwilio.sent.some((item) => item.event === "media"));
assert.deepEqual(preambleTranscripts, ["確認しますね。"]);
preambleBridge.close();
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_tool_loop_guard"));

openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_started",
  item_id: "caller_without_transcript",
  audio_start_ms: 5000
}));
openai.emit("message", JSON.stringify({
  type: "input_audio_buffer.speech_stopped",
  item_id: "caller_without_transcript",
  audio_end_ms: 5600
}));
await wait(1050);
assert.ok(bridgeLogs.some((item) => item.event === "openai_realtime_agent_transcription_watchdog"));
assert.equal(openai.sent.at(-1).type, "response.create");
assert.equal(openai.sent.at(-1).response.tool_choice, "none");

bridge.close();
console.log(JSON.stringify({ ok: true, checks: 73 }, null, 2));

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

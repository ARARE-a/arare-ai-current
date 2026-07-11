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
    this.sent.push(JSON.parse(value));
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
  instructions: "日本語で自然に応答してください。",
  tools,
  openAiSocketFactory: () => {
    queueMicrotask(() => openai.open());
    return openai;
  },
  onCustomerTranscript: async (text) => customerTranscripts.push(text),
  onAssistantTranscript: async (text) => assistantTranscripts.push(text),
  onToolCall: async (call) => {
    toolCalls.push(call);
    return call.arguments.terminal
      ? { ok: true, code: "HOLD_CREATED", terminal: true, spoken_reply: "仮予約を承りました。" }
      : { ok: true, code: "AVAILABLE", next_question: "お名前をお願いします。" };
  },
  onUsage: (source, usage) => usageEvents.push({ source, usage }),
  onPlaybackComplete: (event) => playbackEvents.push(event)
});

await bridge.connect();
const sessionUpdate = openai.sent[0];
assert.equal(sessionUpdate.type, "session.update");
assert.equal(sessionUpdate.session.model, "gpt-realtime-2.1");
assert.equal(sessionUpdate.session.audio.input.turn_detection.create_response, true);
assert.equal(sessionUpdate.session.audio.input.turn_detection.interrupt_response, true);
assert.equal(sessionUpdate.session.audio.output.voice, "cedar");
assert.deepEqual(sessionUpdate.session.tools, tools);

await bridge.handleTwilioMessage({
  event: "start",
  streamSid: "MZ_AGENT_TEST",
  start: { streamSid: "MZ_AGENT_TEST", callSid: "CA_AGENT_TEST" }
});
await bridge.handleTwilioMessage({ event: "media", media: { payload: "CALLER_PCMU" } });
assert.deepEqual(openai.sent.at(-1), { type: "input_audio_buffer.append", audio: "CALLER_PCMU" });

bridge.startGreeting("お電話ありがとうございます。ご希望をどうぞ。");
assert.equal(openai.sent.at(-1).type, "response.create");
assert.match(openai.sent.at(-1).response.instructions, /お電話ありがとうございます/);

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_greeting" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_greeting", type: "message" }
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
const toolOutput = openai.sent.find((item) => item.type === "conversation.item.create" && item.item.call_id === "call_availability_1");
assert.ok(toolOutput);
assert.equal(JSON.parse(toolOutput.item.output).code, "AVAILABLE");
assert.equal(openai.sent.at(-1).type, "response.create");

const responseCreateCount = openai.sent.filter((item) => item.type === "response.create").length;
openai.emit("message", JSON.stringify(toolResponse));
await tick();
assert.equal(toolCalls.length, 1, "duplicate tool call IDs must not execute twice");
assert.equal(openai.sent.filter((item) => item.type === "response.create").length, responseCreateCount);

openai.emit("message", JSON.stringify({ type: "response.created", response: { id: "resp_interrupt" } }));
openai.emit("message", JSON.stringify({
  type: "response.output_item.added",
  item: { id: "item_interrupt", type: "message" }
}));
openai.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(800).toString("base64") }));
bridge.firstOutputAudioAt = Date.now() - 50;
openai.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "caller_interrupt" }));
await tick();
assert.ok(twilio.sent.some((item) => item.event === "clear"));
const truncate = openai.sent.find((item) => item.type === "conversation.item.truncate" && item.item_id === "item_interrupt");
assert.ok(truncate);
assert.ok(truncate.audio_end_ms >= 0 && truncate.audio_end_ms <= 100);

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
    }]
  }
}));
await tick();
assert.match(openai.sent.at(-1).response.instructions, /仮予約を承りました/);
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

bridge.close();
console.log(JSON.stringify({ ok: true, checks: 22 }, null, 2));

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

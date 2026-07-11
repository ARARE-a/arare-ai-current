import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OpenAiRealtimeMediaBridge } from "./lib/openai-realtime-media-bridge.mjs";

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
const transcripts = [];
let playbackMarks = 0;
const bridge = new OpenAiRealtimeMediaBridge({
  twilioSocket: twilio,
  apiKey: "test-key",
  model: "gpt-realtime-2.1",
  voice: "marin",
  transcriptionModel: "gpt-4o-transcribe",
  openAiSocketFactory: () => {
    queueMicrotask(() => openai.open());
    return openai;
  },
  onTranscript: async (text) => transcripts.push(text),
  onPlaybackComplete: () => {
    playbackMarks += 1;
  }
});

await bridge.connect();
assert.equal(openai.sent[0].type, "session.update");
assert.deepEqual(openai.sent[0].session.audio.input.format, { type: "audio/pcmu" });
assert.deepEqual(openai.sent[0].session.audio.output.format, { type: "audio/pcmu" });
assert.equal(openai.sent[0].session.audio.output.voice, "marin");
assert.equal(openai.sent[0].session.audio.input.turn_detection.create_response, false);

await bridge.handleTwilioMessage({
  event: "start",
  streamSid: "MZ_TEST",
  start: { streamSid: "MZ_TEST", callSid: "CA_TEST" }
});
await bridge.handleTwilioMessage({ event: "media", media: { payload: "BASE64_AUDIO" } });
assert.deepEqual(openai.sent.at(-1), { type: "input_audio_buffer.append", audio: "BASE64_AUDIO" });

openai.emit(
  "message",
  JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_1",
    transcript: "明日の21時で空いていますか"
  })
);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(transcripts, ["明日の21時で空いていますか"]);

bridge.enqueueSpeech("明日の21時ですね。", true);
assert.equal(openai.sent.at(-1).type, "response.create");
assert.equal(openai.sent.at(-1).response.output_modalities[0], "audio");

openai.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: "PCMU_OUTPUT" }));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(twilio.sent.at(-1), {
  event: "media",
  streamSid: "MZ_TEST",
  media: { payload: "PCMU_OUTPUT" }
});

openai.emit("message", JSON.stringify({ type: "response.done", response: { status: "completed" } }));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(twilio.sent.at(-1).event, "mark");
await bridge.handleTwilioMessage(twilio.sent.at(-1));
assert.equal(playbackMarks, 1);

bridge.enqueueSpeech("確認します。", true);
openai.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
await new Promise((resolve) => setImmediate(resolve));
assert.ok(twilio.sent.some((item) => item.event === "clear"));
assert.ok(openai.sent.some((item) => item.type === "response.cancel"));

bridge.close();
console.log("OpenAI Realtime media bridge verification passed.");

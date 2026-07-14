import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import twilio from "twilio";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");

const baseUrl = String(
  process.env.VOICE_RELAY_PRODUCTION_URL ?? "https://arare-ai-voice-relay.onrender.com"
).replace(/\/+$/, "");
const webhookUrl = `${baseUrl}/api/twilio/voice/realtime-agent`;
const forwardedProto = new URL(baseUrl).protocol.replace(":", "");
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const toNumber = process.env.TWILIO_PHONE_NUMBER;
const openAiKey = process.env.OPENAI_API_KEY;
const fromNumber = "+818000000000";
const callSid = `CA_REGRESSION_JAPANESE_${Date.now()}`;
const streamSid = `MZ_REGRESSION_JAPANESE_${Date.now()}`;
const timeoutMs = Number(process.env.VERIFY_JAPANESE_PRODUCTION_TIMEOUT_MS ?? 45000);
const expectedVadEagerness = process.env.VERIFY_JAPANESE_EXPECTED_VAD_EAGERNESS ?? "medium";
const expectedVadMode = process.env.VERIFY_JAPANESE_EXPECTED_VAD_MODE ?? "server_vad";
const question = "60分と90分は何が違いますか？";

if (!accountSid || !authToken || !toNumber || !openAiKey) {
  throw new Error(
    "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and OPENAI_API_KEY are required"
  );
}

const healthResponse = await fetch(`${baseUrl}/health?deep=1`, {
  signal: AbortSignal.timeout(30000)
});
const health = await healthResponse.json();
assert.equal(healthResponse.ok, true, "Production health endpoint must return success");
assert.equal(health?.ok, true, "Production relay must be healthy");
assert.equal(health?.databaseHealth?.ok, true, "Production database must be healthy");
assert.equal(health?.realtimeAgent?.enabled, true, "GPT Realtime agent must be enabled");
assert.equal(health?.realtimeAgent?.architecture, "native-speech-to-speech");
assert.equal(health?.realtimeAgent?.conversationFlowVersion, 16);
assert.equal(health?.realtimeAgent?.model, "gpt-realtime-2.1-mini");
assert.equal(health?.realtimeAgent?.voice, "cedar");
assert.equal(health?.realtimeAgent?.transcriptionModel, "gpt-4o-transcribe");
assert.equal(health?.realtimeAgent?.vadMode, expectedVadMode);
assert.equal(health?.realtimeAgent?.vadEagerness, expectedVadEagerness);
assert.equal(health?.realtimeAgent?.serverVadThreshold, 0.5);
assert.equal(health?.realtimeAgent?.serverVadPrefixPaddingMs, 300);
assert.equal(health?.realtimeAgent?.serverVadSilenceDurationMs, 900);
assert.equal(health?.realtimeAgent?.serverVadManualTurnControlReady, true);
assert.equal(health?.realtimeAgent?.completeCourseComparisonFactsReady, true);
assert.equal(health?.realtimeAgent?.deterministicCourseComparisonSpeechReady, true);
assert.equal(health?.realtimeAgent?.noAudioResponseRecoveryReady, true);
assert.equal(health?.realtimeAgent?.sessionHandshakeReady, true);

const synthesizedQuestion = await synthesizeJapanesePcm(question);
const questionPcmu = pcm24kToPcmu8k(synthesizedQuestion);
assert.ok(questionPcmu.length > 8000, "Synthesized Japanese question was unexpectedly short");

const twiml = await fetchSignedRealtimeTwiml();
let websocketUrl = extractStreamUrl(twiml);
if (forwardedProto === "http") websocketUrl = websocketUrl.replace(/^wss:/u, "ws:");
const customParameters = extractParameters(twiml);
assert.ok(websocketUrl, "Realtime webhook must return a Media Stream URL");
assert.equal(customParameters.agentMode, "native-speech-to-speech");
assert.ok(customParameters.storeId, "Realtime webhook must bind the call to a store");
assert.ok(customParameters.storePhoneSettingId, "Realtime webhook must bind the phone setting");

const websocketSignature = twilio.getExpectedTwilioSignature(authToken, websocketUrl, {});
const media = await openMediaStream({
  websocketUrl,
  websocketSignature,
  customParameters
});

let greetingPacket;
let answerPackets;
try {
  greetingPacket = await media.nextMarkedAudio(timeoutMs, "initial greeting");
  assert.ok(greetingPacket.audio.length > 4000, "Realtime greeting did not contain audible media");

  await delay(250);
  media.beginCallerTurn();
  const inputCompletedAt = await media.sendCallerAudio(questionPcmu);
  answerPackets = [await media.nextMarkedAudio(timeoutMs, "course answer")];
  while (answerPackets.length < 4) {
    try {
      answerPackets.push(await media.nextMarkedAudio(4000, "course answer follow-up"));
    } catch (error) {
      if (isTimeoutError(error)) break;
      throw error;
    }
  }
  media.inputCompletedAt = inputCompletedAt;
} finally {
  media.close();
}

const greetingTranscript = await transcribePcmu(
  greetingPacket.audio,
  "greeting.wav",
  "ARARE AIによる日本語の電話受付挨拶です。"
);
const answerAudio = joinPcmuPackets(answerPackets.map((packet) => packet.audio));
assert.ok(answerAudio.length > 4000, "Realtime course answer did not contain audible media");
const answerTranscript = await transcribePcmu(
  answerAudio,
  "course-answer.wav",
  "ARARE AIの日本語コース案内です。60分、90分、12000円、17000円などの時間と料金が含まれる場合があります。"
);
const normalizedAnswer = normalizeTranscript(answerTranscript);
const firstAnswerAudioAt = answerPackets
  .map((packet) => packet.firstAudioAt)
  .filter(Number.isFinite)
  .sort((left, right) => left - right)[0];
const responseLatencyMs = Number.isFinite(firstAnswerAudioAt) && Number.isFinite(media.inputCompletedAt)
  ? firstAnswerAudioAt - media.inputCompletedAt
  : null;

assert.match(
  normalizeTranscript(greetingTranscript),
  /(?:ARARE|アラレ|AI|エーアイ|受付|予約|電話)/u,
  `Greeting was not recognized as a Japanese reception greeting: ${greetingTranscript}`
);
assert.match(
  normalizedAnswer,
  /(?:60分|六十分)[^。]{0,45}(?:12000円|1万2000円|一万二千円)/u,
  `60-minute registered price was missing: ${answerTranscript}`
);
assert.match(
  normalizedAnswer,
  /(?:90分|九十分)[^。]{0,45}(?:17000円|1万7000円|一万七千円)/u,
  `90-minute registered price was missing: ${answerTranscript}`
);
assert.doesNotMatch(
  normalizedAnswer,
  /(?:性的サービス|禁止事項|登録コースは確認中|店舗に確認|折り返し)/u,
  `Course comparison contained an unrequested disclaimer or unsupported fallback: ${answerTranscript}`
);
assert.ok(
  normalizedAnswer.length <= 180,
  `Course comparison was too long (${normalizedAnswer.length} chars): ${answerTranscript}`
);
assert.ok(
  responseLatencyMs !== null && responseLatencyMs <= 12000,
  `First response audio exceeded the production watchdog: ${responseLatencyMs}ms`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      webhookStatus: 200,
      callSid,
      route: {
        endpoint: webhookUrl,
        architecture: health.realtimeAgent.architecture,
        model: health.realtimeAgent.model,
        voice: health.realtimeAgent.voice,
        transcriptionModel: health.realtimeAgent.transcriptionModel,
        storeBound: Boolean(customParameters.storeId),
        agentMode: customParameters.agentMode
      },
      input: question,
      greetingTranscript,
      answerTranscript,
      responseLatencyMs,
      answerSegments: answerPackets.length,
      reservationCreated: false,
      smsSent: false,
      pass: true
    },
    null,
    2
  )
);

async function fetchSignedRealtimeTwiml() {
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
      "x-forwarded-proto": forwardedProto,
      "x-twilio-signature": signature
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Production Realtime webhook returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return body;
}

function openMediaStream({ websocketUrl, websocketSignature, customParameters }) {
  const socket = new WebSocket(websocketUrl, {
    headers: {
      "x-forwarded-proto": forwardedProto,
      "x-twilio-signature": websocketSignature
    }
  });
  const responseQueue = [];
  const waiters = [];
  let currentAudio = [];
  let currentFirstAudioAt = null;
  let sequenceNumber = 1;
  let callerChunk = 1;
  let callerTimestampMs = 0;
  let callerTurnStarted = false;
  let closedError = null;

  const opened = new Promise((resolve, reject) => {
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          event: "start",
          streamSid,
          start: { streamSid, callSid, customParameters }
        })
      );
      resolve();
    });
    socket.once("error", reject);
  });

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.event === "media" && message.media?.payload) {
      if (currentFirstAudioAt === null) currentFirstAudioAt = Date.now();
      currentAudio.push(Buffer.from(message.media.payload, "base64"));
      return;
    }
    if (message.event !== "mark") return;
    const packet = {
      name: message.mark?.name ?? null,
      audio: Buffer.concat(currentAudio),
      firstAudioAt: currentFirstAudioAt,
      markedAt: Date.now(),
      callerTurnStarted
    };
    currentAudio = [];
    currentFirstAudioAt = null;
    socket.send(JSON.stringify({ event: "mark", streamSid, mark: { name: packet.name } }));
    enqueuePacket(packet);
  });

  socket.on("error", (error) => {
    closedError = error;
    rejectWaiters(error);
  });
  socket.on("close", (code, reason) => {
    if (code === 1000 || closedError) return;
    closedError = new Error(`Production Media Stream closed (${code}): ${reason.toString()}`);
    rejectWaiters(closedError);
  });

  function enqueuePacket(packet) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(packet);
    else responseQueue.push(packet);
  }

  function rejectWaiters(error) {
    while (waiters.length) waiters.shift().reject(error);
  }

  async function nextMarkedAudio(waitTimeoutMs, stage = "audio response") {
    await opened;
    if (closedError) throw closedError;
    if (responseQueue.length) return responseQueue.shift();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(
          new Error(
            `Production Realtime ${stage} timed out after ${waitTimeoutMs}ms ` +
            `(CallSid ${callSid}, callerTurnStarted ${callerTurnStarted})`
          )
        );
      }, waitTimeoutMs);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      waiter.reject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      waiters.push(waiter);
    });
  }

  async function sendCallerAudio(pcmu) {
    await opened;
    const silenceBefore = Buffer.alloc(160 * 12, 0xff);
    const silenceAfter = Buffer.alloc(160 * 75, 0xff);
    const payload = Buffer.concat([silenceBefore, pcmu, silenceAfter]);
    const speechEndOffset = silenceBefore.length + pcmu.length;
    let speechCompletedAt = null;
    for (let offset = 0; offset < payload.length; offset += 160) {
      const chunk = payload.subarray(offset, Math.min(offset + 160, payload.length));
      socket.send(
        JSON.stringify({
          event: "media",
          sequenceNumber: String(sequenceNumber++),
          streamSid,
          media: {
            track: "inbound",
            chunk: String(callerChunk++),
            timestamp: String(callerTimestampMs),
            payload: chunk.toString("base64")
          }
        })
      );
      callerTimestampMs += 20;
      await delay(20);
      if (speechCompletedAt === null && offset + chunk.length >= speechEndOffset) {
        speechCompletedAt = Date.now();
      }
    }
    return speechCompletedAt ?? Date.now();
  }

  return {
    inputCompletedAt: null,
    beginCallerTurn() {
      callerTurnStarted = true;
    },
    nextMarkedAudio,
    sendCallerAudio,
    close() {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: "stop", streamSid }));
        socket.close(1000, "Japanese production voice verification complete");
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
  };
}

async function synthesizeJapanesePcm(text) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openAiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "cedar",
      input: text,
      instructions: "日本語の成人男性として、自然な速さと明瞭な発音で質問してください。",
      response_format: "pcm"
    }),
    signal: AbortSignal.timeout(60000)
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`OpenAI speech synthesis failed (${response.status}): ${buffer.toString("utf8").slice(0, 300)}`);
  }
  return buffer;
}

async function transcribePcmu(pcmu, filename, prompt) {
  const wav = pcmuToWav(pcmu);
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), filename);
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ja");
  form.append("response_format", "json");
  if (prompt) form.append("prompt", prompt);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${openAiKey}` },
    body: form,
    signal: AbortSignal.timeout(90000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const payload = JSON.parse(body);
  return String(payload.text ?? "").trim();
}

function pcm24kToPcmu8k(pcm) {
  const sampleCount = Math.floor(pcm.length / 2);
  const downsampled = new Int16Array(Math.floor(sampleCount / 3));
  let peak = 0;
  for (let outputIndex = 0, sampleIndex = 0; outputIndex < downsampled.length; outputIndex += 1, sampleIndex += 3) {
    const first = pcm.readInt16LE(sampleIndex * 2);
    const second = pcm.readInt16LE((sampleIndex + 1) * 2);
    const third = pcm.readInt16LE((sampleIndex + 2) * 2);
    const sample = Math.round((first + second + third) / 3);
    downsampled[outputIndex] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak < 200) throw new Error(`Synthesized Japanese question was effectively silent (peak ${peak})`);
  const gain = Math.max(0.6, Math.min(4, 18000 / peak));
  const output = Buffer.alloc(downsampled.length);
  for (let index = 0; index < downsampled.length; index += 1) {
    output[index] = linearPcmToMulaw(Math.round(downsampled[index] * gain));
  }
  return output;
}

function pcmuToWav(pcmu) {
  const pcm = Buffer.alloc(pcmu.length * 2);
  for (let index = 0; index < pcmu.length; index += 1) {
    pcm.writeInt16LE(mulawToLinearPcm(pcmu[index]), index * 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function linearPcmToMulaw(value) {
  const bias = 0x84;
  let sample = Math.max(-32635, Math.min(32635, Math.round(value)));
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample += bias;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (sample & mask) === 0; mask >>= 1) exponent -= 1;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function mulawToLinearPcm(value) {
  const decoded = (~value) & 0xff;
  const sign = decoded & 0x80;
  const exponent = (decoded >> 4) & 0x07;
  const mantissa = decoded & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function joinPcmuPackets(packets) {
  const separator = Buffer.alloc(160 * 8, 0xff);
  const values = [];
  for (const packet of packets.filter((value) => value?.length)) {
    if (values.length) values.push(separator);
    values.push(packet);
  }
  return Buffer.concat(values);
}

function normalizeTranscript(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s,，、]/gu, "")
    .trim();
}

function extractStreamUrl(xml) {
  return decodeXml(xml.match(/<Stream\b[^>]*\burl="([^"]+)"/iu)?.[1] ?? "");
}

function extractParameters(xml) {
  const values = {};
  for (const match of xml.matchAll(/<Parameter\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*\/?\s*>/giu)) {
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

function isTimeoutError(error) {
  return /timed out/u.test(String(error?.message ?? error));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

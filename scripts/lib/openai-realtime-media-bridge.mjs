import WebSocket from "ws";

const OPEN = WebSocket.OPEN;

export class OpenAiRealtimeMediaBridge {
  constructor(options) {
    this.twilioSocket = options.twilioSocket;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.voice = options.voice;
    this.transcriptionModel = options.transcriptionModel;
    this.vadEagerness = options.vadEagerness ?? "medium";
    this.openAiUrl = options.openAiUrl ?? "wss://api.openai.com/v1/realtime";
    this.openAiSocketFactory = options.openAiSocketFactory ?? createOpenAiSocket;
    this.log = options.log ?? (() => {});
    this.onTranscript = options.onTranscript ?? (async () => {});
    this.onUsage = options.onUsage ?? (() => {});
    this.onSpeechStarted = options.onSpeechStarted ?? (() => {});
    this.onPlaybackComplete = options.onPlaybackComplete ?? (() => {});
    this.onError = options.onError ?? (async () => {});
    this.streamSid = undefined;
    this.callSid = undefined;
    this.openai = undefined;
    this.pendingSpeechText = "";
    this.speechQueue = [];
    this.activeSpeech = false;
    this.audioReceivedForResponse = false;
    this.flushTimer = undefined;
    this.responseTimer = undefined;
    this.markCounter = 0;
    this.pendingInputAudio = [];
    this.closed = false;
    this.inputSpeechStartedAt = 0;
    this.transcriptionCompletedAt = 0;
    this.speechRequestStartedAt = 0;
    this.firstOutputAudioAt = 0;
  }

  async connect() {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
    if (this.openai?.readyState === OPEN) return;

    const url = `${this.openAiUrl}?model=${encodeURIComponent(this.model)}`;
    const socket = this.openAiSocketFactory(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    this.openai = socket;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenAI Realtime media connection timeout")), 12000);
      const onOpen = () => {
        clearTimeout(timeout);
        socket.send(JSON.stringify(this.buildSessionUpdate()));
        for (const audio of this.pendingInputAudio.splice(0)) {
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
        }
        resolve();
      };
      const onError = (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });

    socket.on("message", (raw) => {
      void this.handleOpenAiMessage(raw);
    });
    socket.on("close", () => {
      this.clearTimers();
      if (!this.closed) void this.fail(new Error("OpenAI Realtime media connection closed"));
    });
    socket.on("error", (error) => {
      if (!this.closed) void this.fail(error instanceof Error ? error : new Error(String(error)));
    });
  }

  buildSessionUpdate() {
    return {
      type: "session.update",
      session: {
        type: "realtime",
        model: this.model,
        output_modalities: ["audio"],
        include: ["item.input_audio_transcription.logprobs"],
        instructions: [
          "あなたは日本語音声の読み上げ担当です。",
          "システムから渡された文章だけを、内容や語順を変えずに発話してください。",
          "日本で育った日本語ネイティブの成人男性電話受付として、落ち着いた標準語で自然に話してください。",
          "国内のコールセンターと同じ発音・抑揚を使い、時刻、料金、人名は日本語として明瞭に読んでください。",
          "英語話者の日本語訛り、英語風の抑揚、翻訳調、過度な演技、前置き、相づち、説明の追加は禁止です。"
        ].join("\n"),
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: {
              model: this.transcriptionModel,
              language: "ja"
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: this.vadEagerness,
              create_response: false,
              interrupt_response: false
            }
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: this.voice
          }
        }
      }
    };
  }

  async handleTwilioMessage(message) {
    if (message.event === "start") {
      this.streamSid = message.start?.streamSid ?? message.streamSid;
      this.callSid = message.start?.callSid;
      return;
    }
    if (message.event === "media") {
      if (!message.media?.payload) return;
      if (this.openai?.readyState !== OPEN) {
        this.pendingInputAudio.push(message.media.payload);
        if (this.pendingInputAudio.length > 100) this.pendingInputAudio.shift();
        return;
      }
      this.openai.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: message.media.payload
        })
      );
      return;
    }
    if (message.event === "mark") {
      this.onPlaybackComplete(message.mark?.name);
      return;
    }
    if (message.event === "stop") {
      this.close();
    }
  }

  enqueueSpeech(text, final = false) {
    const value = String(text ?? "");
    if (value.trim()) this.pendingSpeechText += value;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (final) {
      this.flushPendingSpeech();
      return;
    }
    this.flushTimer = setTimeout(() => this.flushPendingSpeech(), 350);
  }

  flushPendingSpeech() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const text = this.pendingSpeechText.trim();
    this.pendingSpeechText = "";
    if (!text) return;
    this.speechQueue.push(text);
    this.pumpSpeechQueue();
  }

  pumpSpeechQueue() {
    if (this.activeSpeech || this.openai?.readyState !== OPEN) return;
    const text = this.speechQueue.shift();
    if (!text) return;

    this.activeSpeech = true;
    this.audioReceivedForResponse = false;
    this.speechRequestStartedAt = Date.now();
    this.firstOutputAudioAt = 0;
    this.log("openai_realtime_tts_requested", {
      textLength: text.length,
      queuedSpeechCount: this.speechQueue.length
    });
    this.openai.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions: "次の文章だけを一字一句変えず、日本語ネイティブの落ち着いた成人男性電話受付として、標準語で明瞭に発話してください。英語風の抑揚と追加説明は禁止です。",
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text }]
            }
          ]
        }
      })
    );
    this.responseTimer = setTimeout(() => {
      if (!this.audioReceivedForResponse) void this.fail(new Error("OpenAI Realtime returned no audio"));
    }, 8000);
  }

  async handleOpenAiMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      this.inputSpeechStartedAt = Date.now();
      this.interruptPlayback();
      this.onSpeechStarted();
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript ?? "").trim();
      this.transcriptionCompletedAt = Date.now();
      const confidence = summarizeTranscriptionConfidence(event.logprobs);
      this.log("openai_realtime_transcription_completed", {
        itemId: event.item_id,
        textLength: transcript.length,
        confidence,
        sttLatencyMs: this.inputSpeechStartedAt ? this.transcriptionCompletedAt - this.inputSpeechStartedAt : null
      });
      if (event.usage) this.onUsage("transcription", event.usage);
      if (transcript) {
        await this.onTranscript(transcript, event.item_id, {
          confidence,
          sttLatencyMs: this.inputSpeechStartedAt ? this.transcriptionCompletedAt - this.inputSpeechStartedAt : null
        });
      }
      return;
    }

    if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
      if (!event.delta || !this.streamSid || this.twilioSocket.readyState !== OPEN) return;
      this.audioReceivedForResponse = true;
      if (!this.firstOutputAudioAt) {
        this.firstOutputAudioAt = Date.now();
        this.log("openai_realtime_tts_first_audio", {
          firstAudioLatencyMs: this.speechRequestStartedAt ? this.firstOutputAudioAt - this.speechRequestStartedAt : null
        });
      }
      if (this.responseTimer) clearTimeout(this.responseTimer);
      this.responseTimer = undefined;
      this.twilioSocket.send(
        JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: event.delta }
        })
      );
      return;
    }

    if (event.type === "response.done") {
      if (event.response?.usage) this.onUsage("realtime_media", event.response.usage);
      if (this.responseTimer) clearTimeout(this.responseTimer);
      this.responseTimer = undefined;
      this.activeSpeech = false;
      this.log("openai_realtime_tts_completed", {
        totalLatencyMs: this.speechRequestStartedAt ? Date.now() - this.speechRequestStartedAt : null,
        audioReceived: this.audioReceivedForResponse
      });
      if (this.audioReceivedForResponse) this.sendPlaybackMark();
      this.pumpSpeechQueue();
      return;
    }

    if (event.type === "error") {
      const reason = event.error?.message ?? event.message ?? "OpenAI Realtime media error";
      if (/no active response|Cancellation failed/i.test(reason)) return;
      await this.fail(new Error(reason));
    }
  }

  interruptPlayback() {
    if (this.streamSid && this.twilioSocket.readyState === OPEN) {
      this.twilioSocket.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
    }
    if (this.openai?.readyState === OPEN && this.activeSpeech) {
      this.openai.send(JSON.stringify({ type: "response.cancel" }));
    }
    this.activeSpeech = false;
    this.speechQueue = [];
    this.pendingSpeechText = "";
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.responseTimer) clearTimeout(this.responseTimer);
    this.responseTimer = undefined;
  }

  sendPlaybackMark() {
    if (!this.streamSid || this.twilioSocket.readyState !== OPEN) return;
    const name = `arare-audio-${++this.markCounter}`;
    this.twilioSocket.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  async fail(error) {
    this.log("openai_realtime_media_error", { reason: error.message });
    await this.onError(error);
  }

  clearTimers() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.responseTimer) clearTimeout(this.responseTimer);
    this.flushTimer = undefined;
    this.responseTimer = undefined;
  }

  close() {
    this.closed = true;
    this.clearTimers();
    if (this.openai?.readyState === OPEN) this.openai.close();
  }
}

function summarizeTranscriptionConfidence(logprobs) {
  if (!Array.isArray(logprobs) || !logprobs.length) return null;
  const values = logprobs
    .map((item) => Number(item?.logprob))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const probability = values.reduce((sum, value) => sum + Math.exp(value), 0) / values.length;
  return Number(Math.max(0, Math.min(1, probability)).toFixed(4));
}

function createOpenAiSocket(url, options) {
  return new WebSocket(url, options);
}

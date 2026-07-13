import WebSocket from "ws";

const OPEN = WebSocket.OPEN;
const PCMU_BYTES_PER_MILLISECOND = 8;

export class OpenAiRealtimeAgentBridge {
  constructor(options) {
    this.twilioSocket = options.twilioSocket;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.voice = options.voice;
    this.transcriptionModel = options.transcriptionModel;
    this.instructions = options.instructions;
    this.tools = options.tools ?? [];
    this.vadEagerness = options.vadEagerness ?? "medium";
    this.manualTurnControl = options.manualTurnControl !== false;
    this.bargeInDelayMs = clampNumber(options.bargeInDelayMs, 250, 1200, 450);
    this.shortBackchannelMaxMs = clampNumber(options.shortBackchannelMaxMs, 250, 1600, 900);
    this.lowConfidenceThreshold = clampNumber(options.lowConfidenceThreshold, 0, 1, 0.58);
    this.transcriptionWatchdogMs = clampNumber(options.transcriptionWatchdogMs, 1000, 5000, 2500);
    this.openAiUrl = options.openAiUrl ?? "wss://api.openai.com/v1/realtime";
    this.openAiSocketFactory = options.openAiSocketFactory ?? createOpenAiSocket;
    this.log = options.log ?? (() => {});
    this.onCustomerTranscript = options.onCustomerTranscript ?? (async () => {});
    this.onAssistantTranscript = options.onAssistantTranscript ?? (async () => {});
    this.onToolCall = options.onToolCall ?? (async () => ({ ok: false, code: "TOOL_NOT_IMPLEMENTED" }));
    this.onUsage = options.onUsage ?? (() => {});
    this.onLatency = options.onLatency ?? (() => {});
    this.onSpeechStarted = options.onSpeechStarted ?? (() => {});
    this.onSpeechStopped = options.onSpeechStopped ?? (() => {});
    this.onPlaybackComplete = options.onPlaybackComplete ?? (() => {});
    this.onResponseComplete = options.onResponseComplete ?? (() => {});
    this.onError = options.onError ?? (async () => {});
    this.responseWatchdogMs = Math.max(6000, Number(options.responseWatchdogMs ?? 12000));
    this.maxConsecutiveToolTurns = Math.max(2, Number(options.maxConsecutiveToolTurns ?? 8));

    this.streamSid = undefined;
    this.callSid = undefined;
    this.openai = undefined;
    this.pendingInputAudio = [];
    this.closed = false;
    this.responseWatchdog = undefined;
    this.responseActive = false;
    this.responseHadAudio = false;
    this.responseHadToolCall = false;
    this.currentResponseId = undefined;
    this.activeOutputItemId = undefined;
    this.currentOutputItemId = undefined;
    this.currentAssistantTranscript = "";
    this.outputItemPhases = new Map();
    this.outputItemTranscripts = new Map();
    this.suppressedCommentaryItems = new Set();
    this.currentOutputBytes = 0;
    this.firstOutputAudioAt = 0;
    this.markCounter = 0;
    this.pendingMarks = new Map();
    this.processedToolCallIds = new Set();
    this.processedResponseIds = new Set();
    this.terminalPending = false;
    this.consecutiveToolTurns = 0;
    this.speechTurns = new Map();
    this.partialInputTranscripts = new Map();
    this.pendingTurnResponse = undefined;
    this.responseCancellationPending = false;
    this.discardResponseAudio = false;
    this.activeTurnStartedAt = 0;
    this.activeTurnItemId = undefined;
    this.activeTurnVadDecisionLatencyMs = null;
    this.toolExecutionActive = false;
    this.inputAudioTimelineOriginAt = undefined;
  }

  async connect() {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
    if (this.openai?.readyState === OPEN) return;

    const url = `${this.openAiUrl}?model=${encodeURIComponent(this.model)}`;
    const socket = this.openAiSocketFactory(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    this.openai = socket;
    socket.on("message", (raw) => {
      void this.handleOpenAiMessage(raw).catch((error) => {
        void this.fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    socket.on("close", () => {
      this.clearResponseWatchdog();
      if (!this.closed) void this.fail(new Error("OpenAI Realtime agent connection closed"));
    });
    socket.on("error", (error) => {
      if (!this.closed) void this.fail(error instanceof Error ? error : new Error(String(error)));
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenAI Realtime agent connection timeout")), 12000);
      socket.once("open", () => {
        clearTimeout(timeout);
        socket.send(JSON.stringify(this.buildSessionUpdate()));
        for (const audio of this.pendingInputAudio.splice(0)) {
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
        }
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
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
        instructions: this.instructions,
        tools: this.tools,
        tool_choice: "auto",
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
              create_response: !this.manualTurnControl,
              interrupt_response: !this.manualTurnControl
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
      const mediaTimestampMs = finiteNumberOrNull(message.media?.timestamp);
      if (this.inputAudioTimelineOriginAt === undefined && mediaTimestampMs !== null) {
        this.inputAudioTimelineOriginAt = Date.now() - mediaTimestampMs;
      }
      if (this.openai?.readyState !== OPEN) {
        this.pendingInputAudio.push(message.media.payload);
        if (this.pendingInputAudio.length > 100) this.pendingInputAudio.shift();
        return;
      }
      this.openai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: message.media.payload }));
      return;
    }
    if (message.event === "mark") {
      const name = String(message.mark?.name ?? "");
      const mark = this.pendingMarks.get(name);
      if (mark) {
        this.pendingMarks.delete(name);
        if (mark.itemId && mark.itemId === this.currentOutputItemId) this.resetCurrentOutputState();
        this.onPlaybackComplete({ name, terminal: mark.terminal });
      }
      return;
    }
    if (message.event === "stop") this.close();
  }

  startGreeting() {
    this.requestResponse(
      "電話受付として短く自然に挨拶し、相手の要件を自由に伺ってください。定型文を読む必要はありません。",
      { toolChoice: "none" }
    );
  }

  requestResponse(instructions, options = {}) {
    if (this.openai?.readyState !== OPEN) throw new Error("OpenAI Realtime agent is not connected");
    if (options.terminal === true) this.terminalPending = true;
    const response = { output_modalities: ["audio"] };
    if (instructions) response.instructions = instructions;
    if (options.toolChoice) response.tool_choice = options.toolChoice;
    this.openai.send(JSON.stringify({ type: "response.create", response }));
  }

  async handleOpenAiMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      this.beginCustomerSpeech(event);
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      this.endCustomerSpeech(event);
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const itemId = String(event.item_id ?? "");
      if (itemId) {
        const transcript = (this.partialInputTranscripts.get(itemId) ?? "") + String(event.delta ?? "");
        this.partialInputTranscripts.set(itemId, transcript);
        this.maybeInterruptFromPartialTranscript(itemId, transcript);
      }
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      await this.handleCustomerTranscription(event);
      return;
    }
    if (event.type === "response.created") {
      this.beginResponse(event.response?.id);
      return;
    }
    if (event.type === "response.output_item.added") {
      const itemId = String(event.item?.id ?? "");
      if (itemId) {
        this.activeOutputItemId = itemId;
        this.outputItemPhases.set(itemId, normalizeOutputPhase(event.item?.phase));
      }
      if (event.item?.type === "function_call") {
        this.responseHadToolCall = true;
        this.clearResponseWatchdog();
      }
      if (event.item?.type === "message" && itemId) {
        this.outputItemTranscripts.set(itemId, "");
        if (!this.isSuppressedCommentary(itemId)) {
          this.currentOutputItemId = itemId;
          this.currentOutputBytes = 0;
          this.firstOutputAudioAt = 0;
        }
      }
      return;
    }
    if (event.type === "response.output_audio_transcript.delta" || event.type === "response.audio_transcript.delta") {
      const itemId = this.resolveOutputItemId(event.item_id);
      const transcript = (this.outputItemTranscripts.get(itemId) ?? "") + String(event.delta ?? "");
      if (itemId) this.outputItemTranscripts.set(itemId, transcript);
      if (!this.isSuppressedCommentary(itemId)) this.currentAssistantTranscript = transcript;
      return;
    }
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      const itemId = this.resolveOutputItemId(event.item_id);
      const transcript = String(event.transcript ?? this.outputItemTranscripts.get(itemId) ?? "").trim();
      if (this.isSuppressedCommentary(itemId)) {
        this.log("openai_realtime_agent_commentary_suppressed", {
          itemId,
          textLength: transcript.length
        });
        this.outputItemTranscripts.delete(itemId);
        return;
      }
      this.currentAssistantTranscript = transcript;
      if (transcript) await this.onAssistantTranscript(transcript, itemId || this.currentOutputItemId);
      this.outputItemTranscripts.delete(itemId);
      return;
    }
    if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
      this.streamAudioToTwilio(event.delta, event.item_id);
      return;
    }
    if (event.type === "response.done") {
      await this.handleResponseDone(event.response);
      return;
    }
    if (event.type === "error") {
      const reason = event.error?.message ?? event.message ?? "OpenAI Realtime agent error";
      if (/no active response|Cancellation failed/i.test(reason)) return;
      if (/Audio content of \d+ms is already shorter than \d+ms/i.test(reason)) {
        this.log("openai_realtime_agent_stale_truncate_ignored", { reason });
        return;
      }
      await this.fail(new Error(reason));
    }
  }

  beginResponse(responseId) {
    this.clearResponseWatchdog();
    this.responseActive = true;
    this.responseHadAudio = false;
    this.responseHadToolCall = false;
    this.currentResponseId = responseId;
    this.activeOutputItemId = undefined;
    this.currentOutputItemId = undefined;
    this.currentAssistantTranscript = "";
    this.currentOutputBytes = 0;
    this.firstOutputAudioAt = 0;
    this.responseCancellationPending = false;
    this.discardResponseAudio = false;
    this.responseWatchdog = setTimeout(() => {
      if (this.responseActive && !this.responseHadAudio && !this.responseHadToolCall) {
        void this.fail(new Error("OpenAI Realtime agent returned no audio or tool call"));
      }
    }, this.responseWatchdogMs);
  }

  streamAudioToTwilio(delta, itemId) {
    if (!delta || !this.streamSid || this.twilioSocket.readyState !== OPEN) return;
    if (this.discardResponseAudio) return;
    const resolvedItemId = this.resolveOutputItemId(itemId);
    if (this.isSuppressedCommentary(resolvedItemId)) {
      if (!this.suppressedCommentaryItems.has(resolvedItemId)) {
        this.suppressedCommentaryItems.add(resolvedItemId);
        this.log("openai_realtime_agent_commentary_audio_suppressed", { itemId: resolvedItemId });
      }
      return;
    }
    if (resolvedItemId && resolvedItemId !== this.currentOutputItemId) {
      this.currentOutputItemId = resolvedItemId;
      this.currentOutputBytes = 0;
      this.firstOutputAudioAt = 0;
    }
    this.responseHadAudio = true;
    this.consecutiveToolTurns = 0;
    if (!this.firstOutputAudioAt) {
      this.firstOutputAudioAt = Date.now();
      if (this.activeTurnStartedAt > 0) {
        const latencyMs = Math.max(0, this.firstOutputAudioAt - this.activeTurnStartedAt);
        const vadDecisionLatencyMs = finiteNumberOrNull(this.activeTurnVadDecisionLatencyMs);
        const detail = {
          latencyMs,
          vadDecisionLatencyMs,
          postVadLatencyMs: vadDecisionLatencyMs === null ? null : Math.max(0, latencyMs - vadDecisionLatencyMs),
          itemId: this.activeTurnItemId ?? null
        };
        this.log("openai_realtime_agent_response_latency", detail);
        this.onLatency(detail);
        this.activeTurnStartedAt = 0;
        this.activeTurnItemId = undefined;
        this.activeTurnVadDecisionLatencyMs = null;
      }
    }
    this.currentOutputBytes += Buffer.from(delta, "base64").length;
    this.clearResponseWatchdog();
    this.twilioSocket.send(JSON.stringify({
      event: "media",
      streamSid: this.streamSid,
      media: { payload: delta }
    }));
  }

  async handleResponseDone(response) {
    const responseId = String(response?.id ?? this.currentResponseId ?? "");
    if (responseId && this.processedResponseIds.has(responseId)) return;
    if (responseId) this.processedResponseIds.add(responseId);
    this.clearResponseWatchdog();
    const cancelled = this.responseCancellationPending || response?.status === "cancelled";
    this.responseActive = false;
    this.responseCancellationPending = false;
    this.discardResponseAudio = false;
    if (response?.usage) this.onUsage("realtime_agent", response.usage);
    if (cancelled) {
      this.clearResponseOutputItems(response);
      this.resetCurrentOutputState();
      this.flushPendingTurnResponse();
      return;
    }
    const toolCalls = (response?.output ?? []).filter((item) => item?.type === "function_call");
    if (toolCalls.length) {
      this.responseHadToolCall = true;
      if (this.responseHadAudio) this.sendPlaybackMark();
      this.clearResponseOutputItems(response);
      await this.executeToolCalls(toolCalls);
      return;
    }

    if (!this.currentAssistantTranscript) {
      const transcript = extractUserVisibleAudioTranscript(response);
      if (transcript) {
        this.currentAssistantTranscript = transcript;
        await this.onAssistantTranscript(transcript, this.currentOutputItemId);
      }
    }
    this.onResponseComplete({
      responseId: response?.id ?? this.currentResponseId,
      status: response?.status ?? "unknown",
      transcript: this.currentAssistantTranscript,
      hadAudio: this.responseHadAudio
    });
    if (this.responseHadAudio) this.sendPlaybackMark();
    this.clearResponseOutputItems(response);
    this.flushPendingTurnResponse();
  }

  async executeToolCalls(toolCalls) {
    this.toolExecutionActive = true;
    let executed = 0;
    let terminalResultSeen = false;
    try {
      for (const item of toolCalls) {
        const callId = String(item.call_id ?? "");
        if (!callId || this.processedToolCallIds.has(callId)) continue;
        this.processedToolCallIds.add(callId);
        executed += 1;
        let args;
        try {
          args = JSON.parse(item.arguments || "{}");
        } catch {
          args = {};
        }

        let result;
        if (terminalResultSeen) {
          result = {
            ok: false,
            code: "SKIPPED_AFTER_TERMINAL_RESULT",
            error: { reason: "call_already_completed" },
            allowed_actions: ["close_call"]
          };
        } else {
          try {
            result = await this.onToolCall({ name: item.name, arguments: args, callId });
          } catch (error) {
            this.log("openai_realtime_agent_tool_callback_failed", {
              name: item.name,
              callId,
              reason: error instanceof Error ? error.message : String(error)
            });
            result = {
              ok: false,
              code: "TOOL_EXECUTION_FAILED",
              error: { reason: "tool_execution_failed" },
              allowed_actions: ["explain_unavailable", "continue_without_action"]
            };
          }
        }
        if (result?.terminal === true) {
          this.terminalPending = true;
          terminalResultSeen = true;
        }
        this.log("openai_realtime_agent_tool_completed", {
          name: item.name,
          callId,
          ok: result?.ok === true,
          code: result?.code ?? null
        });
        if (this.openai?.readyState !== OPEN) return;
        this.openai.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result ?? { ok: false, code: "EMPTY_TOOL_RESULT" })
          }
        }));
      }
    } finally {
      this.toolExecutionActive = false;
    }
    if (executed > 0 && this.openai?.readyState === OPEN) {
      if (terminalResultSeen) {
        this.consecutiveToolTurns = 0;
        this.requestResponse(undefined, { toolChoice: "none" });
        return;
      }
      if (this.pendingTurnResponse) {
        this.flushPendingTurnResponse();
        return;
      }
      this.consecutiveToolTurns += 1;
      if (this.consecutiveToolTurns > this.maxConsecutiveToolTurns) {
        this.log("openai_realtime_agent_tool_loop_guard", {
          consecutiveToolTurns: this.consecutiveToolTurns,
          maxConsecutiveToolTurns: this.maxConsecutiveToolTurns
        });
        this.requestResponse(
          "これ以上ツールを呼ばず、取得済みの事実だけを使って利用者へ自然に応答してください。必要な事実が足りなければ、分からない点を一つ確認してください。",
          { toolChoice: "none" }
        );
        return;
      }
      this.requestResponse();
    }
  }

  resolveOutputItemId(itemId) {
    return String(itemId ?? this.activeOutputItemId ?? this.currentOutputItemId ?? "");
  }

  isSuppressedCommentary(itemId) {
    return Boolean(itemId) && this.outputItemPhases.get(itemId) === "commentary";
  }

  clearResponseOutputItems(response) {
    for (const item of response?.output ?? []) {
      const itemId = String(item?.id ?? "");
      if (!itemId) continue;
      this.outputItemPhases.delete(itemId);
      this.outputItemTranscripts.delete(itemId);
      this.suppressedCommentaryItems.delete(itemId);
    }
    this.activeOutputItemId = undefined;
  }

  interruptPlayback(options = {}) {
    if (this.streamSid && this.twilioSocket.readyState === OPEN) {
      this.twilioSocket.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
    }
    const currentItemHasPendingPlayback = [...this.pendingMarks.values()]
      .some((mark) => mark.itemId && mark.itemId === this.currentOutputItemId);
    if (
      options.cancelResponse !== false &&
      this.openai?.readyState === OPEN &&
      this.responseActive &&
      !this.responseCancellationPending
    ) {
      this.responseCancellationPending = true;
      this.discardResponseAudio = true;
      this.openai.send(JSON.stringify({ type: "response.cancel" }));
      this.log("openai_realtime_agent_response_cancelled_for_caller", {
        reason: options.reason ?? "caller_speech"
      });
    }
    if (
      this.openai?.readyState === OPEN &&
      this.currentOutputItemId &&
      this.firstOutputAudioAt &&
      (this.responseActive || currentItemHasPendingPlayback)
    ) {
      const bufferedMs = Math.floor(this.currentOutputBytes / PCMU_BYTES_PER_MILLISECOND);
      const elapsedMs = Math.max(0, Date.now() - this.firstOutputAudioAt);
      const audioEndMs = Math.max(0, Math.min(Math.max(0, bufferedMs - 80), elapsedMs));
      if (audioEndMs > 0) {
        this.openai.send(JSON.stringify({
          type: "conversation.item.truncate",
          item_id: this.currentOutputItemId,
          content_index: 0,
          audio_end_ms: audioEndMs
        }));
        this.log("openai_realtime_agent_audio_truncated", {
          itemId: this.currentOutputItemId,
          audioEndMs
        });
      }
    }
    this.pendingMarks.clear();
    this.clearResponseWatchdog();
    this.responseHadAudio = false;
    this.currentOutputBytes = 0;
    this.firstOutputAudioAt = 0;
    this.currentOutputItemId = undefined;
    this.terminalPending = false;
  }

  sendPlaybackMark() {
    if (!this.streamSid || this.twilioSocket.readyState !== OPEN) return;
    const name = `arare-agent-audio-${++this.markCounter}`;
    this.pendingMarks.set(name, { terminal: this.terminalPending, itemId: this.currentOutputItemId });
    this.terminalPending = false;
    this.twilioSocket.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  clearResponseWatchdog() {
    if (this.responseWatchdog) clearTimeout(this.responseWatchdog);
    this.responseWatchdog = undefined;
  }

  resetCurrentOutputState() {
    this.currentOutputItemId = undefined;
    this.currentOutputBytes = 0;
    this.firstOutputAudioAt = 0;
  }

  async fail(error) {
    this.clearResponseWatchdog();
    this.log("openai_realtime_agent_error", { reason: error.message });
    await this.onError(error);
  }

  close() {
    this.closed = true;
    this.clearResponseWatchdog();
    for (const turn of this.speechTurns.values()) {
      if (turn.interruptTimer) clearTimeout(turn.interruptTimer);
      if (turn.sustainedSpeechTimer) clearTimeout(turn.sustainedSpeechTimer);
      if (turn.transcriptionTimer) clearTimeout(turn.transcriptionTimer);
    }
    this.speechTurns.clear();
    this.partialInputTranscripts.clear();
    this.pendingTurnResponse = undefined;
    this.toolExecutionActive = false;
    this.inputAudioTimelineOriginAt = undefined;
    this.outputItemPhases.clear();
    this.outputItemTranscripts.clear();
    this.suppressedCommentaryItems.clear();
    if (this.openai?.readyState === OPEN) this.openai.close();
  }

  beginCustomerSpeech(event) {
    const itemId = String(event.item_id ?? `speech-${Date.now()}`);
    const assistantWasPlaying = this.isAssistantPlaybackActive();
    const turn = {
      itemId,
      audioStartMs: finiteNumberOrNull(event.audio_start_ms),
      startedAt: Date.now(),
      stoppedAt: 0,
      durationMs: null,
      assistantWasPlaying,
      interrupted: false,
      interruptReason: undefined,
      interruptTimer: undefined,
      sustainedSpeechTimer: undefined,
      transcriptionTimer: undefined,
      respondedByWatchdog: false
    };
    if (this.manualTurnControl && assistantWasPlaying) {
      turn.interruptTimer = setTimeout(() => {
        turn.interruptTimer = undefined;
        this.maybeInterruptFromPartialTranscript(itemId);
      }, this.bargeInDelayMs);
      turn.sustainedSpeechTimer = setTimeout(() => {
        turn.sustainedSpeechTimer = undefined;
        this.maybeInterruptFromPartialTranscript(itemId, undefined, { allowGeneralSpeech: true });
      }, Math.max(this.shortBackchannelMaxMs, this.bargeInDelayMs + 250));
    } else if (!this.manualTurnControl) {
      this.interruptPlayback({ cancelResponse: false, reason: "automatic_vad" });
    }
    this.speechTurns.set(itemId, turn);
    this.onSpeechStarted({
      audioStartMs: turn.audioStartMs,
      itemId,
      assistantWasPlaying
    });
  }

  endCustomerSpeech(event) {
    const itemId = String(event.item_id ?? "");
    const turn = this.speechTurns.get(itemId);
    const audioEndMs = finiteNumberOrNull(event.audio_end_ms);
    if (turn) {
      const eventReceivedAt = Date.now();
      turn.stoppedAt = this.resolveAcousticTimestamp(audioEndMs, eventReceivedAt);
      turn.vadDecisionLatencyMs = Math.max(0, eventReceivedAt - turn.stoppedAt);
      turn.durationMs = Number.isFinite(turn.audioStartMs) && Number.isFinite(audioEndMs)
        ? Math.max(0, audioEndMs - turn.audioStartMs)
        : Math.max(0, turn.stoppedAt - turn.startedAt);
      if (turn.interruptTimer) {
        clearTimeout(turn.interruptTimer);
        turn.interruptTimer = undefined;
      }
      if (turn.sustainedSpeechTimer) {
        clearTimeout(turn.sustainedSpeechTimer);
        turn.sustainedSpeechTimer = undefined;
      }
      turn.transcriptionTimer = setTimeout(() => {
        turn.transcriptionTimer = undefined;
        if (
          turn.assistantWasPlaying &&
          !turn.interrupted &&
          turn.durationMs !== null &&
          turn.durationMs <= this.shortBackchannelMaxMs
        ) {
          if (this.openai?.readyState === OPEN && itemId) {
            this.openai.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
          }
          this.speechTurns.delete(itemId);
          this.partialInputTranscripts.delete(itemId);
          this.log("openai_realtime_agent_short_untranscribed_audio_ignored", {
            itemId,
            durationMs: turn.durationMs
          });
          return;
        }
        turn.respondedByWatchdog = true;
        if (turn.assistantWasPlaying && !turn.interrupted) {
          this.interruptPlayback({ cancelResponse: true, reason: "transcription_timeout" });
        }
        this.log("openai_realtime_agent_transcription_watchdog", {
          itemId,
          durationMs: turn.durationMs,
          vadDecisionLatencyMs: turn.vadDecisionLatencyMs
        });
        this.queueTurnResponse({
          instructions: "直前の利用者音声を確実に聞き取れませんでした。内容を推測せず、短い自然な日本語で一度だけ聞き返してください。予約情報は更新しないでください。",
          toolChoice: "none",
          startedAt: turn.stoppedAt || Date.now(),
          itemId,
          vadDecisionLatencyMs: turn.vadDecisionLatencyMs
        });
      }, this.transcriptionWatchdogMs);
    }
    this.onSpeechStopped({
      audioEndMs,
      itemId: itemId || null,
      durationMs: turn?.durationMs ?? null,
      interrupted: turn?.interrupted === true,
      vadDecisionLatencyMs: turn?.vadDecisionLatencyMs ?? null
    });
  }

  async handleCustomerTranscription(event) {
    const itemId = String(event.item_id ?? "");
    const transcript = String(event.transcript ?? this.partialInputTranscripts.get(itemId) ?? "").trim();
    const confidence = summarizeTranscriptionConfidence(event.logprobs);
    const turn = this.speechTurns.get(itemId);
    if (turn?.interruptTimer) clearTimeout(turn.interruptTimer);
    if (turn?.sustainedSpeechTimer) clearTimeout(turn.sustainedSpeechTimer);
    if (turn?.transcriptionTimer) clearTimeout(turn.transcriptionTimer);
    this.speechTurns.delete(itemId);
    this.partialInputTranscripts.delete(itemId);
    if (event.usage) this.onUsage("transcription", event.usage);
    this.log("openai_realtime_agent_customer_transcript", {
      itemId,
      textLength: transcript.length,
      confidence,
      durationMs: turn?.durationMs ?? null,
      assistantWasPlaying: turn?.assistantWasPlaying === true,
      interrupted: turn?.interrupted === true,
      interruptReason: turn?.interruptReason ?? null,
      vadDecisionLatencyMs: turn?.vadDecisionLatencyMs ?? null
    });
    if (!transcript) {
      if (this.openai?.readyState === OPEN && itemId) {
        this.openai.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
      }
      this.log("openai_realtime_agent_empty_transcript_ignored", {
        itemId,
        durationMs: turn?.durationMs ?? null
      });
      return;
    }

    const metadata = {
      confidence,
      durationMs: turn?.durationMs ?? null,
      assistantWasPlaying: turn?.assistantWasPlaying === true,
      interrupted: turn?.interrupted === true,
      interruptReason: turn?.interruptReason ?? null,
      vadDecisionLatencyMs: turn?.vadDecisionLatencyMs ?? null
    };
    const callbackDecision = await this.onCustomerTranscript(transcript, itemId, metadata);
    if (!this.manualTurnControl) return;
    if (turn?.respondedByWatchdog) {
      this.log("openai_realtime_agent_late_transcript_recorded", { itemId });
      return;
    }
    const decision = normalizeTurnDecision(callbackDecision);
    const briefBackchannel = metadata.assistantWasPlaying &&
      (metadata.durationMs === null || metadata.durationMs <= this.shortBackchannelMaxMs) &&
      isBriefBackchannel(transcript);
    if (decision.ignore === true || (briefBackchannel && decision.forceRespond !== true)) {
      if (this.openai?.readyState === OPEN && itemId) {
        this.openai.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
      }
      this.log("openai_realtime_agent_backchannel_ignored", {
        itemId,
        durationMs: metadata.durationMs,
        transcriptLength: transcript.length
      });
      if (metadata.interrupted) {
        this.queueTurnResponse({
          instructions: "利用者の直前発話は短い相づちでした。新しい予約情報として扱わず、遮られた説明が残っている場合だけ自然に短く続けてください。",
          toolChoice: "none",
          startedAt: turn?.stoppedAt || Date.now(),
          itemId,
          vadDecisionLatencyMs: turn?.vadDecisionLatencyMs
        });
      }
      return;
    }

    if (metadata.assistantWasPlaying && !metadata.interrupted) {
      this.interruptPlayback({ cancelResponse: true, reason: "completed_caller_turn" });
    }
    const lowConfidence = typeof confidence === "number" && confidence < this.lowConfidenceThreshold;
    const instructions = decision.instructions ?? (lowConfidence
      ? "直前の利用者発話は認識信頼度が低いため、内容を推測せず、短い自然な日本語で一度だけ聞き返してください。予約情報は更新しないでください。"
      : undefined);
    this.queueTurnResponse({
      instructions,
      toolChoice: lowConfidence ? "none" : decision.toolChoice,
      startedAt: turn?.stoppedAt || Date.now(),
      itemId,
      vadDecisionLatencyMs: turn?.vadDecisionLatencyMs
    });
  }

  queueTurnResponse(options = {}) {
    this.pendingTurnResponse = options;
    if (this.responseActive || this.responseCancellationPending || this.toolExecutionActive) return;
    this.flushPendingTurnResponse();
  }

  maybeInterruptFromPartialTranscript(itemId, transcript, options = {}) {
    const turn = this.speechTurns.get(String(itemId ?? ""));
    if (!turn?.assistantWasPlaying || turn.interrupted || turn.stoppedAt) return false;
    const elapsedMs = Math.max(0, Date.now() - turn.startedAt);
    if (elapsedMs < this.bargeInDelayMs) return false;
    const partial = String(transcript ?? this.partialInputTranscripts.get(turn.itemId) ?? "").trim();
    const explicitInterrupt = isExplicitInterruptPhrase(partial);
    const sustainedSpeechDelayMs = Math.max(this.shortBackchannelMaxMs, this.bargeInDelayMs + 250);
    const generalSpeechReady =
      (options.allowGeneralSpeech === true || elapsedMs >= sustainedSpeechDelayMs) &&
      isMeaningfulPartialSpeech(partial);
    if (!explicitInterrupt && !generalSpeechReady) return false;

    turn.interrupted = true;
    turn.interruptReason = explicitInterrupt ? "explicit_stop_or_correction" : "meaningful_sustained_caller_speech";
    if (turn.interruptTimer) clearTimeout(turn.interruptTimer);
    if (turn.sustainedSpeechTimer) clearTimeout(turn.sustainedSpeechTimer);
    turn.interruptTimer = undefined;
    turn.sustainedSpeechTimer = undefined;
    this.interruptPlayback({ cancelResponse: true, reason: turn.interruptReason });
    this.log("openai_realtime_agent_meaningful_interruption", {
      itemId: turn.itemId,
      reason: turn.interruptReason,
      elapsedMs,
      transcriptLength: partial.length
    });
    return true;
  }

  flushPendingTurnResponse() {
    if (
      !this.pendingTurnResponse ||
      this.responseActive ||
      this.responseCancellationPending ||
      this.toolExecutionActive
    ) return;
    const pending = this.pendingTurnResponse;
    this.pendingTurnResponse = undefined;
    this.activeTurnStartedAt = Number(pending.startedAt) || Date.now();
    this.activeTurnItemId = pending.itemId;
    this.activeTurnVadDecisionLatencyMs = finiteNumberOrNull(pending.vadDecisionLatencyMs);
    this.requestResponse(pending.instructions, { toolChoice: pending.toolChoice });
  }

  isAssistantPlaybackActive() {
    if (this.responseActive && (this.responseHadAudio || this.currentOutputItemId)) return true;
    if (!this.firstOutputAudioAt || this.currentOutputBytes <= 0) return false;
    const bufferedMs = Math.floor(this.currentOutputBytes / PCMU_BYTES_PER_MILLISECOND);
    const elapsedMs = Math.max(0, Date.now() - this.firstOutputAudioAt);
    return elapsedMs + 80 < bufferedMs;
  }

  resolveAcousticTimestamp(audioEndMs, fallbackAt) {
    if (this.inputAudioTimelineOriginAt === undefined || audioEndMs === null) return fallbackAt;
    const candidate = this.inputAudioTimelineOriginAt + audioEndMs;
    const ageMs = fallbackAt - candidate;
    if (!Number.isFinite(candidate) || ageMs < -500 || ageMs > 30000) return fallbackAt;
    return candidate;
  }
}

function summarizeTranscriptionConfidence(logprobs) {
  if (!Array.isArray(logprobs) || !logprobs.length) return null;
  const values = logprobs.map((item) => Number(item?.logprob)).filter(Number.isFinite);
  if (!values.length) return null;
  const probability = values.reduce((sum, value) => sum + Math.exp(value), 0) / values.length;
  return Number(Math.max(0, Math.min(1, probability)).toFixed(4));
}

function normalizeTurnDecision(value) {
  if (!value || typeof value !== "object") return {};
  return {
    ignore: value.ignore === true,
    forceRespond: value.forceRespond === true,
    instructions: typeof value.instructions === "string" && value.instructions.trim()
      ? value.instructions.trim()
      : undefined,
    toolChoice: typeof value.toolChoice === "string" && value.toolChoice.trim()
      ? value.toolChoice.trim()
      : undefined
  };
}

function isBriefBackchannel(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s。、！？!?.,]/g, "")
    .replace(/ー+/g, "");
  return /^(?:はい|うん|ええ|そう|そうです|そうですね|なるほど|わかりました|了解|あ|え|へえ|ふん)$/u.test(text);
}

function isExplicitInterruptPhrase(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s。、！？!?.,]/g, "");
  if (!text) return false;
  return /(?:ちょっと待って|少し待って|待ってください|待って|ストップ|止めて|止まって|話を聞いて|聞いてください|訂正|言い直し|違います|違う違う|いや違う|そうじゃない|キャンセル)/u.test(text);
}

function isMeaningfulPartialSpeech(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s。、！？!?.,]/g, "");
  if (text.length < 2 || isBriefBackchannel(text)) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractUserVisibleAudioTranscript(response) {
  return (response?.output ?? [])
    .filter((item) => normalizeOutputPhase(item?.phase) !== "commentary")
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.transcript ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeOutputPhase(phase) {
  return phase === "commentary" ? "commentary" : "final_answer";
}

function createOpenAiSocket(url, options) {
  return new WebSocket(url, options);
}

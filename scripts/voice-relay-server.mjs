import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import WebSocket, { WebSocketServer } from "ws";

loadEnv(".env.local");
loadEnv(".env");

const port = Number(process.env.VOICE_RELAY_PORT ?? process.env.PORT ?? 8787);
const openAiKey = process.env.OPENAI_API_KEY;
const realtimeModel = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const sharedSecret = process.env.VOICE_RELAY_SHARED_SECRET;
const validateTwilioSignature = process.env.VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE === "true";
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const ttsProvider = normalizeJapaneseTtsProvider(process.env.VOICE_RELAY_TTS_PROVIDER ?? "Amazon");
const ttsVoice = normalizeJapaneseTtsVoice(ttsProvider, process.env.VOICE_RELAY_TTS_VOICE ?? "Takumi-Neural");
const transcriptionProvider = normalizeTranscriptionProvider(process.env.VOICE_RELAY_TRANSCRIPTION_PROVIDER ?? "Google");
const speechModel = normalizeSpeechModel(transcriptionProvider, process.env.VOICE_RELAY_SPEECH_MODEL);
const sayVoice =
  process.env.VOICE_RELAY_SAY_VOICE ??
  (ttsProvider === "Google" ? `Google.${ttsVoice}` : ttsProvider === "Amazon" ? `Polly.${ttsVoice}` : ttsVoice);
const speechTimeoutMs = process.env.VOICE_RELAY_SPEECH_TIMEOUT_MS ?? "650";
const ttsSpeechRate = normalizeSpeechRate(process.env.VOICE_RELAY_TTS_RATE ?? "94%");
const configuredNoPromptFirstFallbackMs = Number(process.env.VOICE_RELAY_NO_PROMPT_FIRST_FALLBACK_MS ?? 14000);
const noPromptFirstFallbackMs = Number.isFinite(configuredNoPromptFirstFallbackMs)
  ? Math.max(configuredNoPromptFirstFallbackMs, 14000)
  : 14000;
const configuredNoPromptTerminalFallbackMs = Number(process.env.VOICE_RELAY_NO_PROMPT_TERMINAL_FALLBACK_MS ?? 42000);
const noPromptTerminalFallbackMs = Number.isFinite(configuredNoPromptTerminalFallbackMs)
  ? Math.max(configuredNoPromptTerminalFallbackMs, 42000)
  : 42000;
const destructiveIntentTraining = loadDestructiveIntentTraining("data/phone_ai_destructive_intents.csv");
const dateTimeContextTraining = loadDateTimeContextTraining("data/date_time_context_training.csv");
const relativeTimeRegressionTraining = loadCsvGuardTraining("data/phone_ai_relative_time_regression.csv");
const freeTalkRecoveryTraining = loadCsvGuardTraining("data/phone_ai_free_talk_recovery.csv");
const adultServiceTerminology = loadAdultServiceTerminology("data/phone_ai_adult_service_terms.csv");
const serviceKnowledge = loadServiceKnowledge("data/phone_ai_service_knowledge.csv");
const datetimeGuardTraining = mergeDateTimeGuardTraining([
  loadDateTimeGuardTraining("data/phone_ai_datetime_guard_1000.csv"),
  loadDateTimeGuardTraining("data/nlu_guard_classification_augmentation_3000.csv")
]);
const TIME_CONFIDENCE_THRESHOLD = 0.85;
const THERAPIST_MATCH_CONFIDENCE_THRESHOLD = 0.95;
const JAPANESE_ONLY_INSTRUCTION = [
  "最重要: 返答は必ず日本語だけで行ってください。",
  "英語のあいさつ、英語の説明、ローマ字、中国語、翻訳口調を使ってはいけません。",
  "お客様が英語や聞き取りづらい言葉で話しても、日本語で短く聞き返してください。",
  "電話でそのまま読み上げる自然な日本語だけを返してください。"
].join("\n");
const JAPANESE_LANGUAGE_FALLBACK_REPLY =
  "すみません。日本語でご案内します。ご予約でしたら、ご希望の日時とコースをもう一度お聞かせください。";
const STORE_CONFIRMATION_REQUIRED_REPLY = "確認が必要です。店舗に確認して折り返します。";
const VOICE_RELAY_TWIML_WELCOME_GREETING = "";
const VOICE_RELAY_INITIAL_LISTENING_GREETING = "お電話ありがとうございます。ご希望をどうぞ。";
const RESPONSE_WATCHDOG_MS = Number(process.env.VOICE_RELAY_RESPONSE_WATCHDOG_MS ?? "4500");
const prisma = new PrismaClient();
const activeSessions = new Map();

function logRelay(event, data = {}) {
  const safeData = Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (/token|secret|authorization/i.test(key)) return [key, "REDACTED"];
      if (/datetime|date|time/i.test(key)) return [key, value];
      if (/number|from|to|phone/i.test(key)) return [key, maskPhone(value)];
      return [key, value];
    })
  );
  console.log(JSON.stringify({ event, ...safeData }));
}

function loadCsvGuardTraining(filePath) {
  if (!existsSync(filePath)) {
    return { path: filePath, rows: [], byUtterance: new Map(), skippedCorruptRows: 0 };
  }
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return { path: filePath, rows: [], byUtterance: new Map(), skippedCorruptRows: 0 };
  const headers = parsePhoneAiGuardCsvLine(lines[0]).map((header) => header.trim());
  const rows = [];
  let skippedCorruptRows = 0;
  for (const line of lines.slice(1)) {
    const values = parsePhoneAiGuardCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (isCorruptGuardTrainingRow(row)) {
      skippedCorruptRows += 1;
      continue;
    }
    rows.push(row);
  }
  const byUtterance = new Map();
  for (const row of rows) {
    const key = normalizeJapaneseSpeech(row.utterance ?? "");
    if (key && !byUtterance.has(key)) byUtterance.set(key, row);
  }
  if (skippedCorruptRows > 0) {
    console.warn(
      JSON.stringify({
        event: "csv_guard_training_corrupt_rows_skipped",
        path: filePath,
        skippedCorruptRows
      })
    );
  }
  return { path: filePath, rows, byUtterance, skippedCorruptRows };
}

function isCorruptGuardTrainingRow(row) {
  const values = [row.utterance, row.expected_action, row.expectedAction, row.forbidden_action, row.forbiddenAction]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return values.some((value) => /\?{4,}|�/.test(value));
}

function parsePhoneAiGuardCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function findCsvGuardMatch(training, text) {
  if (!training?.rows?.length) return null;
  const normalized = normalizeJapaneseSpeech(text);
  const exact = training.byUtterance.get(normalized);
  if (exact) return exact;
  return (
    training.rows.find((row) => {
      const utterance = normalizeJapaneseSpeech(row.utterance ?? "");
      return utterance && utterance.length >= 4 && (normalized.includes(utterance) || utterance.includes(normalized));
    }) ?? null
  );
}

function maskPhone(value) {
  const text = String(value ?? "");
  if (!text) return undefined;
  const digits = text.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `${text.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

if (!openAiKey) {
  console.warn("OPENAI_API_KEY is not configured. The relay will hand off calls after logging the prompt.");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    const databaseHealth = url.searchParams.get("deep") === "1" ? await checkVoiceRelayDatabaseHealth() : null;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: databaseHealth ? databaseHealth.ok : true,
        service: "arare-ai-voice-relay",
        openaiConfigured: Boolean(openAiKey),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        databaseHealth,
        dateTimeContextTrainingRows: dateTimeContextTraining.rows.length,
        relativeTimeRegressionRows: relativeTimeRegressionTraining.rows.length,
        freeTalkRecoveryRows: freeTalkRecoveryTraining.rows.length,
        adultServiceTerminologyRows: adultServiceTerminology.rows.length,
        serviceKnowledgeRows: serviceKnowledge.rows.length,
        freeTalkRecoverySkippedCorruptRows: freeTalkRecoveryTraining.skippedCorruptRows,
        datetimeGuardRows: datetimeGuardTraining.rows.length,
        sameDayAvailabilityClarificationReady: true,
        naturalAvailabilityRouterReady: true,
        fixedFirstPhraseRequired: false,
        preConnectGreetingEnabled: false,
        shortWelcomeGreetingReady: true,
        twimlWelcomeGreetingDisabledReady: true,
        serverInitialListeningGreetingReady: true,
        latencyOptimizedSameDayReady: true,
        fastNextAvailableSlotReady: true,
        futureShiftAvailabilityReady: true,
        nextAvailableSearchDiagnosticsReady: true,
        audibleWelcomeGreetingReady: true,
        softSuggestedCandidateAcceptanceReady: true,
        availabilityStopWithThanksReady: true,
        shortNoAvailabilityReplyReady: true,
        openAlternativeNoAvailabilityReplyReady: true,
        phoneMismatchConfirmationPriorityReady: true,
        compactPhoneConversationReady: true,
        welcomeGreetingLength: VOICE_RELAY_TWIML_WELCOME_GREETING.length,
        initialListeningGreetingLength: VOICE_RELAY_INITIAL_LISTENING_GREETING.length,
        endAfterTokensPlayedReady: true,
        callLogUpsertMode: "atomic-by-id",
        responseWatchdogMs: RESPONSE_WATCHDOG_MS,
        noPromptWatchdogReady: true,
        noPromptTerminalExtendedReady: true,
        noPromptFirstFallbackRelaxedReady: true,
        configurableTranscriptionProviderReady: true,
        googleJapaneseTranscriptionDefaultReady: true,
        reportInputDuringAgentSpeechReady: true,
        highInterruptSensitivityReady: true,
        fragmentedFollowUpQuestionGuardReady: true,
        therapistProfileCommaCleanupReady: true,
        candidateOfferVariationReady: true,
        candidateOfferAcceptanceFlowReady: true,
        alternativeCandidatePriorityReady: true,
        candidateExactTimeAcceptanceReady: true,
        adultServiceTerminologyGuardReady: adultServiceTerminology.rows.length > 0,
        adultServiceSoftBoundaryReady: true,
        adultServiceNoImpliedAvailabilityReady: true,
        ambiguousAdultServiceQuestionReady: true,
        menesGroinLymphNormalGuidanceReady: true,
        adultServiceNonCommittalBoundaryReady: true,
        registeredAdultOptionGuidanceReady: true,
        prohibitedAdultServiceStillDeniedReady: true,
        adultServiceScopeAuditLogReady: true,
        treatmentServiceQuestionRouterReady: true,
        therapistProfileSentenceCleanupReady: true,
        therapistProfilePhoneMetricReady: true,
        therapistFeatureContinuationCompactReady: true,
        firstVisitStatePriorityReady: true,
        appearanceQuestionSafeRouterReady: true,
        courseServiceKnowledgeReady: serviceKnowledge.rows.length > 0,
        courseDescriptionDemoWordingFilteredReady: true,
        speechPronunciationHintsReady: true,
        speechPronunciationHintsExpandedReady: true,
        seiraSpeechShortNameReady: true,
        ttsProvider,
        ttsVoice,
        ttsSpeechRate,
        transcriptionProvider,
        speechModel,
        noPromptFirstFallbackMs,
        noPromptTerminalFallbackMs,
        activeSessions: activeSessions.size,
        uptimeSec: Math.round(process.uptime())
      })
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/twilio/voice") {
    try {
      await handleTwilioVoice(request, response);
    } catch (error) {
      await handleVoiceWebhookFatalError(response, error, "twilio_voice_webhook_failed");
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/twilio/voice/connect-status") {
    try {
      await handleTwilioConnectStatus(request, response);
    } catch (error) {
      await handleVoiceWebhookFatalError(response, error, "twilio_connect_status_failed");
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/twilio/sms/status") {
    try {
      await handleTwilioSmsStatus(request, response, url);
    } catch (error) {
      logRelay("twilio_sms_status_failed", {
        reason: error instanceof Error ? error.message : String(error)
      });
      writeJson(response, 500, { ok: false, error: "sms_status_failed" });
    }
    return;
  }

  response.writeHead(404);
  response.end("not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token");

  if (sharedSecret && token !== sharedSecret) {
    logRelay("conversation_relay_rejected", { reason: "invalid_shared_secret" });
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  if (validateTwilioSignature && twilioAuthToken && !isValidTwilioWebSocketRequest(request)) {
    logRelay("conversation_relay_rejected", { reason: "invalid_twilio_signature" });
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit("connection", websocket, request);
  });
});

wss.on("connection", (twilioSocket) => {
  logRelay("conversation_relay_connected");

  const session = {
    sessionId: undefined,
    callSid: undefined,
    from: undefined,
    to: undefined,
    storeId: undefined,
    storePhoneSettingId: undefined,
    transcript: [],
    assistantTranscript: [],
    openai: undefined,
    publicBaseUrl: undefined,
    pendingText: "",
    currentAssistantText: "",
    unsentAssistantText: "",
    sentAssistantText: false,
    lastAssistantText: "",
    queuedCallerText: "",
    storeContext: undefined,
    reservationDraft: createReservationDraft(),
    conversationId: undefined,
    reservationId: undefined,
    requiredReview: false,
    hasActiveOpenAiResponse: false,
    responseStartedAt: 0,
    responseWatchdogTimer: undefined,
    responseWatchdogFallbackSent: false,
    setupAt: 0,
    firstPromptReceived: false,
    lastClientSpeakingAt: 0,
    lastAgentSpeakingAt: 0,
    lastTokensPlayedAt: 0,
    initialListeningGreetingSent: false,
    noPromptFallbackSent: false,
    noPromptFirstTimer: undefined,
    noPromptTerminalTimer: undefined,
    endCallScheduled: false,
    endCallPendingAfterTokensPlayed: false,
    endCallEarliestAt: 0,
    endCallHandoffData: undefined,
    endCallFallbackTimer: undefined
  };

  twilioSocket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const relayInfoName = getConversationRelayInfoName(message);
    if (relayInfoName) {
      handleConversationRelayInfoEvent(session, twilioSocket, message, relayInfoName);
      return;
    }

    if (message.type === "setup") {
      const custom = readCustomParameters(message);
      session.sessionId = stringValue(message.sessionId);
      session.callSid = stringValue(message.callSid ?? custom.callSid ?? custom.callReference);
      session.from = stringValue(message.from ?? custom.fromNumber);
      session.to = stringValue(message.to ?? custom.toNumber);
      session.publicBaseUrl = stringValue(custom.voiceRelayBaseUrl ?? custom.publicBaseUrl);
      const explicitStoreId = stringValue(custom.storeId ?? message.storeId);
      const resolvedRoute = explicitStoreId
        ? null
        : await resolveRelaySetupStore({ callSid: session.callSid, toNumber: session.to });
      session.storeId = explicitStoreId ?? resolvedRoute?.storeId;
      session.storePhoneSettingId = stringValue(custom.storePhoneSettingId ?? custom.settingId);
      if (!session.storePhoneSettingId && resolvedRoute?.settingId) {
        session.storePhoneSettingId = resolvedRoute.settingId;
      }
      if (!session.storeId) {
        logRelay("conversation_relay_rejected", {
          callSid: session.callSid,
          to: session.to,
          reason: "store_unresolved"
        });
        twilioSocket.close(1008, "store unresolved");
        return;
      }
      session.storeContext = await loadStoreReceptionContext(session.storeId);
      await ensurePhoneConversation(session);
      if (session.callSid) activeSessions.set(session.callSid, session);
      session.setupAt = Date.now();
      scheduleNoPromptWatchdog(session, twilioSocket);

      logRelay("conversation_relay_setup", {
        callSid: session.callSid,
        from: session.from,
        to: session.to,
        storeId: session.storeId,
        storePhoneSettingId: session.storePhoneSettingId
      });

      await upsertCallLog(session, "RECEIVED");
      await sendInitialListeningGreeting(session, twilioSocket);
      if (openAiKey) {
        ensureOpenAI(session, twilioSocket).catch((error) => {
          logRelay("openai_prewarm_failed", {
            callSid: session.callSid,
            reason: error instanceof Error ? error.message : String(error)
          });
        });
      }
      return;
    }

    if (message.type === "prompt") {
      if (message.last === false) return;
      const promptStartedAt = Date.now();
      const callerText = String(message.voicePrompt ?? "").trim();
      if (!callerText) {
        await handleEmptyCallerPrompt(session, twilioSocket);
        return;
      }
      session.consecutiveEmptyPrompts = 0;
      try {
        session.firstPromptReceived = true;
        clearNoPromptWatchdog(session);
        session.lastUserUtterance = callerText;
        logRelay("conversation_relay_prompt", {
          callSid: session.callSid,
          textLength: callerText.length
        });

        session.transcript.push(`\u304a\u5ba2\u69d8: ${callerText}`);
        await appendPhoneConversationMessage(session, "CUSTOMER", callerText);
        await upsertCallLog(session, "TRANSCRIBED");
        if (session.hasActiveOpenAiResponse) {
          queueCallerText(session, callerText);
          if (session.openai?.readyState === WebSocket.OPEN) {
            logRelay("openai_response_cancel_for_new_prompt", { callSid: session.callSid });
            session.openai.send(JSON.stringify({ type: "response.cancel" }));
          }
          return;
        }
        if (shouldSendFinalConfirmationAck(session, callerText)) {
      await sendProcessingAck(session, twilioSocket, "ありがとうございます。受付処理します。");
        }
        const scriptedReply = await scriptedReplyFor(session, callerText);
        if (scriptedReply) {
          logRelay("conversation_relay_prompt_processed", {
            callSid: session.callSid,
            route: "scripted",
            elapsedMs: Date.now() - promptStartedAt
          });
          await sendScriptedReply(session, twilioSocket, scriptedReply);
          return;
        }
        logRelay("conversation_relay_prompt_processed", {
          callSid: session.callSid,
          route: "openai",
          elapsedMs: Date.now() - promptStartedAt
        });
        await askOpenAI(session, callerText, twilioSocket);
        return;
      } catch (error) {
        await handlePromptProcessingError(session, twilioSocket, error, callerText);
        return;
      }
    }

    if (message.type === "interrupt") {
      if (session.openai?.readyState === WebSocket.OPEN && session.hasActiveOpenAiResponse) {
        logRelay("openai_response_cancel", { callSid: session.callSid });
        session.openai.send(JSON.stringify({ type: "response.cancel" }));
      } else {
        logRelay("openai_response_cancel_skipped", { callSid: session.callSid });
      }
      return;
    }

    if (message.type === "dtmf") {
      session.transcript.push(`DTMF: ${message.digit}`);
      await upsertCallLog(session, "TRANSCRIBED");
      return;
    }

    if (message.type === "tokens-played") {
      endCallAfterTerminalAudioPlayed(session, twilioSocket, "tokens-played");
      return;
    }

    if (message.type === "clientSpeaking") {
      session.lastClientSpeakingAt = Date.now();
      return;
    }

    if (message.type === "error") {
      logRelay("conversation_relay_error", {
        callSid: session.callSid,
        description: message.description ?? "ConversationRelay error"
      });
      await upsertCallLog(session, "ESCALATED", message.description ?? "ConversationRelay error");
      return;
    }

    if (message.type !== "tokens-played" && message.type !== "agentSpeaking" && message.type !== "clientSpeaking") {
      logRelay("conversation_relay_message", {
        callSid: session.callSid,
        type: message.type,
        details: summarizeConversationRelayMessage(message)
      });
    }
  });

  twilioSocket.on("close", async () => {
    logRelay("conversation_relay_closed", { callSid: session.callSid });
    if (session.endCallFallbackTimer) clearTimeout(session.endCallFallbackTimer);
    clearNoPromptWatchdog(session);
    clearResponseWatchdog(session);
    await upsertCallLog(session, session.reservationId ? "HOLD_CREATED" : session.requiredReview ? "ESCALATED" : "SUMMARIZED");
    session.openai?.close();
    if (session.callSid) activeSessions.delete(session.callSid);
  });
});

function scheduleNoPromptWatchdog(session, twilioSocket) {
  clearNoPromptWatchdog(session);
  if (!Number.isFinite(noPromptFirstFallbackMs) || noPromptFirstFallbackMs <= 0) return;
  scheduleNoPromptFirstFallback(session, twilioSocket, noPromptFirstFallbackMs);

  if (Number.isFinite(noPromptTerminalFallbackMs) && noPromptTerminalFallbackMs > noPromptFirstFallbackMs) {
    session.noPromptTerminalTimer = setTimeout(async () => {
      if (session.firstPromptReceived || twilioSocket.readyState !== WebSocket.OPEN) return;
      const reply = "お声が確認できないため、店舗スタッフから折り返しご案内します。お電話ありがとうございました。";
      session.assistantTranscript.push(`AI: ${reply}`);
      session.lastAssistantText = reply;
      logRelay("conversation_relay_no_prompt_terminal", {
        callSid: session.callSid,
        elapsedMs: Date.now() - (session.setupAt || Date.now())
      });
      sendTwilioText(twilioSocket, reply, true);
      scheduleTwilioCallEndAfterAudio(session, twilioSocket, reply, {
        reasonCode: "no-caller-prompt",
        reason: "no prompt received after setup"
      });
      await upsertCallLog(session, "ESCALATED", "no caller prompt received before terminal fallback");
    }, noPromptTerminalFallbackMs);
  }
}

function scheduleNoPromptFirstFallback(session, twilioSocket, delayMs) {
  if (session.noPromptFirstTimer) clearTimeout(session.noPromptFirstTimer);
  session.noPromptFirstTimer = setTimeout(async () => {
    if (session.firstPromptReceived || session.noPromptFallbackSent || twilioSocket.readyState !== WebSocket.OPEN) return;
    const delayReason = getNoPromptFallbackDelayReason(session);
    if (delayReason) {
      logRelay("conversation_relay_no_prompt_fallback_delayed", {
        callSid: session.callSid,
        reason: delayReason,
        elapsedMs: Date.now() - (session.setupAt || Date.now())
      });
      scheduleNoPromptFirstFallback(session, twilioSocket, 1800);
      return;
    }
    const reply = buildNoPromptRecoveryReply(session);
    session.noPromptFallbackSent = true;
    session.assistantTranscript.push(`AI: ${reply}`);
    session.lastAssistantText = reply;
    logRelay("conversation_relay_no_prompt_fallback", {
      callSid: session.callSid,
      elapsedMs: Date.now() - (session.setupAt || Date.now())
    });
    sendTwilioText(twilioSocket, reply, true);
    await upsertCallLog(session, "ESCALATED", "no caller prompt received after ConversationRelay setup");
  }, delayMs);
}

function getNoPromptFallbackDelayReason(session) {
  const now = Date.now();
  if (session.lastClientSpeakingAt && now - session.lastClientSpeakingAt < 3000) return "recent_client_speaking";
  if (session.lastAgentSpeakingAt && now - session.lastAgentSpeakingAt < 2500) return "recent_agent_speaking";
  if (session.lastTokensPlayedAt && now - session.lastTokensPlayedAt < 3500) return "recent_tokens_played";
  return "";
}

function clearNoPromptWatchdog(session) {
  if (session?.noPromptFirstTimer) clearTimeout(session.noPromptFirstTimer);
  if (session?.noPromptTerminalTimer) clearTimeout(session.noPromptTerminalTimer);
  if (session) {
    session.noPromptFirstTimer = undefined;
    session.noPromptTerminalTimer = undefined;
  }
}

function buildNoPromptRecoveryReply(session) {
  const draft = session?.reservationDraft ?? createReservationDraft();
  const nextQuestion = buildShortNextQuestion(draft);
  if (nextQuestion) return "もしもし、少し聞こえにくいです。" + nextQuestion;
  return "もしもし、少し聞こえにくいです。ご予約でしたら、ご希望の日時をお話しください。";
}

async function sendInitialListeningGreeting(session, twilioSocket) {
  if (session.initialListeningGreetingSent || twilioSocket.readyState !== WebSocket.OPEN) return;
  const reply = VOICE_RELAY_INITIAL_LISTENING_GREETING;
  session.initialListeningGreetingSent = true;
  session.assistantTranscript.push(`AI: ${reply}`);
  session.lastAssistantText = reply;
  session.lastAgentSpeakingAt = Date.now();
  logRelay("conversation_relay_initial_listening_greeting", {
    callSid: session.callSid,
    textLength: reply.length
  });
  sendTwilioText(twilioSocket, reply, true);
  await upsertCallLog(session, "RECEIVED");
}

async function handleEmptyCallerPrompt(session, twilioSocket) {
  session.consecutiveEmptyPrompts = (session.consecutiveEmptyPrompts ?? 0) + 1;
  if (session.consecutiveEmptyPrompts < 2) return;
  const reply = buildFreeTalkRecoveryReply(session, "") || buildNoPromptRecoveryReply(session);
  session.consecutiveEmptyPrompts = 0;
  session.assistantTranscript.push(`AI: ${reply}`);
  session.lastAssistantText = reply;
  logRelay("conversation_relay_empty_prompt_recovery", {
    callSid: session.callSid,
    consecutiveEmptyPrompts: 2
  });
  sendTwilioText(twilioSocket, reply, true);
  await upsertCallLog(session, "TRANSCRIBED", "empty caller prompt recovery");
}

function maybeReplyAvailabilitySearchStop(session, text) {
  if (!isUnavailableStopText(text)) return "";
  if (isCourseOrOptionContinuationText(text)) return "";
  const draft = session.reservationDraft ?? createReservationDraft();
  if (draft.awaitingField === "phoneMismatchConfirmation" || draft.phoneMismatchConfirmation) return "";
  if (draft.suggestedStartsAt || draft.awaitingFinalConfirmation || draft.completed) return "";
  if (!(draft.availability_search_mode || draft.availabilityCheckResult?.ok === false || draft.noSameDayShift)) return "";
  const reply = buildUnavailableStopReply(draft);
  logConversationState(session, "availability_search_stop", {
    user_utterance: text,
    assistant_response: reply,
    next_action: "close_without_reservation",
    error_reason: "customer_stopped_after_unavailable"
  });
  return reply;
}

function isSameDayAvailabilityQuestionWithoutTime(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  if (!normalized) return false;
  if (!/(今日|本日|きょう)/u.test(normalized)) return false;
  if (/(何時|なんじ|\d{1,2}時|\d{1,2}:\d{2}|午前|午後|朝|昼|夕方|夜)/u.test(normalized)) return false;
  return /(空|開|行け|入れ|予約|可能|大丈夫|いけ|あい)/u.test(normalized);
}

function getConversationRelayInfoName(message) {
  if (message?.type !== "info") return "";
  const rawName = stringValue(message.name ?? message.event ?? message.details?.name ?? message.detail?.name);
  const normalized = rawName.replace(/[\s_-]/g, "").toLowerCase();
  if (normalized === "tokensplayed") return "tokensPlayed";
  if (normalized === "agentspeaking") return "agentSpeaking";
  if (normalized === "clientspeaking") return "clientSpeaking";
  return rawName;
}

function handleConversationRelayInfoEvent(session, twilioSocket, message, relayInfoName) {
  logRelay("conversation_relay_message", {
    callSid: session.callSid,
    type: message.type,
    details: summarizeConversationRelayMessage({ ...message, name: relayInfoName })
  });
  if (relayInfoName === "clientSpeaking") {
    session.lastClientSpeakingAt = Date.now();
    return true;
  }
  if (relayInfoName === "agentSpeaking") {
    session.lastAgentSpeakingAt = Date.now();
    return true;
  }
  if (relayInfoName === "tokensPlayed") {
    session.lastTokensPlayedAt = Date.now();
    endCallAfterTerminalAudioPlayed(session, twilioSocket, "tokens-played");
    return true;
  }
  return false;
}

function summarizeConversationRelayMessage(message) {
  const keys = ["description", "message", "reason", "code", "event", "name", "sequenceId", "status"];
  return Object.fromEntries(
    keys
      .filter((key) => message[key] !== undefined && message[key] !== null)
      .map((key) => [key, String(message[key]).slice(0, 240)])
  );
}

server.listen(port, () => {
  console.log(`ARARE AI voice relay listening on :${port}`);
});


async function handleTwilioVoice(request, response) {
  const form = await readForm(request);
  const from = form.get("From") || undefined;
  const to = form.get("To") || form.get("Called") || undefined;
  const callSid = form.get("CallSid") || undefined;
  logRelay("twilio_voice_webhook", { callSid, from, to });
  const route = await resolvePhoneRoute(to);

  if (!route.ok) {
    const unavailable = route.reason === "db_unavailable";
    logRelay(unavailable ? "twilio_voice_route_lookup_unavailable" : "twilio_voice_route_not_found", { callSid, to });
    return writeXml(
      response,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<Response>",
        "  " +
          (unavailable ? sayJaBasic : sayJa)(
            unavailable
              ? "申し訳ありません。現在、電話AI受付の確認に時間がかかっています。店舗より折り返しご案内いたします。"
              : "この電話AI受付番号はARARE AIに登録されていません。店舗の電話AI設定を確認してください。"
          ),
        "</Response>"
      ].join("\n")
    );
  }

  await prisma.callLog
    .create({
      data: {
        storeId: route.storeId,
        storePhoneSettingId: route.settingId,
        phoneNumber: from,
        toNumber: to,
        twilioCallSid: callSid,
        status: "RECEIVED",
        requiredReview: true
      }
    })
    .catch(() => null);

  if (!route.voiceAiEnabled || route.routingMode === "MANUAL_ONLY") {
    logRelay("twilio_voice_manual_or_disabled", {
      callSid,
      storeId: route.storeId,
      routingMode: route.routingMode,
      voiceAiEnabled: route.voiceAiEnabled
    });

    const body = route.fallbackPhoneNumber
      ? [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<Response>",
          "  " + sayJa("現在はスタッフ受付に切り替えています。このまま店舗へおつなぎします。"),
          "  <Dial>" + escapeXml(route.fallbackPhoneNumber) + "</Dial>",
          "</Response>"
        ].join("\n")
      : [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<Response>",
          "  " + sayJa("現在は電話AI受付が停止中です。店舗より折り返しご案内いたします。"),
          "</Response>"
        ].join("\n");

    return writeXml(response, body);
  }

  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "https";
  const publicBaseUrl = proto + "://" + host;
  const websocketUrl = buildRelayWebSocketUrl(host);
  const connectActionUrl = publicBaseUrl + "/api/twilio/voice/connect-status";

  logRelay("twilio_voice_connect_relay", {
    callSid,
    storeId: route.storeId,
    storePhoneSettingId: route.settingId,
    connectActionUrl
  });
  return writeXml(
    response,
    conversationRelayXml({
      websocketUrl,
      connectActionUrl,
      callReference: callSid,
      parameters: {
        storeId: route.storeId,
        storePhoneSettingId: route.settingId,
        voiceRelayBaseUrl: publicBaseUrl,
        toNumber: to,
        fromNumber: from,
        routingMode: route.routingMode
      }
    })
  );
}

async function handleTwilioConnectStatus(request, response) {
  const form = await readForm(request);
  const callSid = form.get("CallSid") || undefined;
  const callStatus = form.get("CallStatus") || undefined;
  const handoffData = form.get("ConversationRelayHandoffData") || form.get("HandoffData") || undefined;

  logRelay("twilio_connect_status", {
    callSid,
    callStatus,
    hasHandoffData: Boolean(handoffData)
  });

  if (callSid) {
    const reviewNotes = [callStatus ? "Call status: " + callStatus : undefined, handoffData ? "Handoff: " + handoffData : undefined]
      .filter(Boolean)
      .join("\n");

    await prisma.callLog
      .updateMany({
        where: { twilioCallSid: callSid },
        data: {
          status: handoffData ? "ESCALATED" : "SUMMARIZED",
          reviewNotes: reviewNotes || undefined,
          requiredReview: Boolean(handoffData)
        }
      })
      .catch(() => null);
  }

  if (handoffData) {
    return writeXml(
      response,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<Response>",
        "  " + sayJa(STORE_CONFIRMATION_REQUIRED_REPLY),
        "</Response>"
      ].join("\n")
    );
  }

  return writeXml(response, ['<?xml version="1.0" encoding="UTF-8"?>', "<Response/>"].join("\n"));
}
async function sendScriptedReply(session, twilioSocket, reply) {
  const text = String(reply ?? "").trim();
  if (!text) return;
  session.assistantTranscript.push(`AI: ${text}`);
  await appendPhoneConversationMessage(session, "AI", text);
  session.lastAssistantText = text;
  logConversationState(session, "assistant_reply", {
    user_utterance: session.lastUserUtterance ?? null,
    assistant_response: text,
    next_action: inferNextAction(session)
  });
  sendTwilioText(twilioSocket, text, true);
  await upsertCallLog(session, "TRANSCRIBED");
  scheduleTwilioCallEndIfTerminal(session, twilioSocket, text);
}

async function sendProcessingAck(session, twilioSocket, text) {
  if (session.processingAckSentForFinalConfirmation) return;
  session.processingAckSentForFinalConfirmation = true;
  session.assistantTranscript.push(`AI: ${text}`);
  await appendPhoneConversationMessage(session, "AI", text);
  session.lastAssistantText = text;
  logConversationState(session, "assistant_processing_ack", {
    user_utterance: session.lastUserUtterance ?? null,
    assistant_response: text,
    next_action: "create_hold_and_send_sms"
  });
  sendTwilioText(twilioSocket, text, false);
}

function shouldSendFinalConfirmationAck(session, callerText) {
  const draft = session.reservationDraft;
  if (!draft?.awaitingFinalConfirmation) return false;
  if (draft.completed) return false;
  if (session.processingAckSentForFinalConfirmation) return false;
  return isAffirmative(normalizeJapaneseSpeech(callerText));
}

async function handlePromptProcessingError(session, twilioSocket, error, callerText) {
  const reason = error instanceof Error ? error.message : String(error);
  logRelay("conversation_relay_prompt_failed", {
    callSid: session.callSid,
    textLength: String(callerText ?? "").length,
    reason: reason.slice(0, 500)
  });
  const reply = "\u78ba\u8a8d\u306b\u6642\u9593\u304c\u304b\u304b\u3063\u3066\u3044\u308b\u305f\u3081\u3001\u5e97\u8217\u30b9\u30bf\u30c3\u30d5\u304b\u3089\u6298\u308a\u8fd4\u3057\u3054\u6848\u5185\u3044\u305f\u3057\u307e\u3059\u3002";
  session.assistantTranscript.push(`AI: ${reply}`);
  session.lastAssistantText = reply;
  sendTwilioText(twilioSocket, reply, true);
  sendTwilioEnd(twilioSocket, {
    reasonCode: "prompt-processing-error",
    reason: reason.slice(0, 300)
  });
  await upsertCallLog(session, "ESCALATED", reason);
}

async function scriptedReplyFor(session, callerText) {
  const text = normalizeJapaneseSpeech(callerText);
  const context = await ensureStoreReceptionContext(session);
  const courses = context?.courses ?? [];
  const draft = session.reservationDraft ?? createReservationDraft();
  const earlyStopReply = maybeReplyAvailabilitySearchStop(session, text);
  if (earlyStopReply) return earlyStopReply;

  const destructiveIntent = classifyDestructiveIntent(text);
  if (destructiveIntent) {
    session.reservationDraft = session.reservationDraft ?? draft;
    const reply = handleDestructiveIntent(session, destructiveIntent, context);
    logConversationState(session, "destructive_intent_guard", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: destructiveIntent.expectedAction,
      error_reason: destructiveIntent.intent
    });
    return reply;
  }
  const adultServiceTerminologyReply = handleAdultServiceTerminology(session, callerText, context);
  if (adultServiceTerminologyReply) return adultServiceTerminologyReply;
  const earlyTherapistFeatureReply = formatSpecificTherapistFeatureAnswer(text, context?.therapists ?? [], draft);
  if (earlyTherapistFeatureReply) {
    logConversationState(session, "therapist_feature_question", {
      user_utterance: callerText,
      assistant_response: earlyTherapistFeatureReply,
      next_action: draft.awaitingField ?? "continue_flow",
      error_reason: "specific_therapist_feature_question"
    });
    return earlyTherapistFeatureReply;
  }
  const firstVisitStateReply = handleFirstVisitStateReply(session, callerText, context);
  if (firstVisitStateReply) return firstVisitStateReply;
  const serviceKnowledgeReply = handleServiceKnowledgeQuestion(session, callerText, context);
  if (serviceKnowledgeReply) return serviceKnowledgeReply;
  const earlySuggestedAcceptanceReply = await handleSuggestedCandidateAcceptance(session, draft, context, text);
  if (earlySuggestedAcceptanceReply) return earlySuggestedAcceptanceReply;
  if (isExplicitCourseOrPriceQuestion(text) && !isCourseMentionInsideBookingRequest(text)) {
    return hasAnyDraftValue(draft) ? buildCourseInfoReply(draft, courses) : formatCourseMenu(courses);
  }
  const relativeHourReply = await handleRelativeHourOffsetReply(session, callerText, context);
  if (relativeHourReply) return relativeHourReply;
  const csvConversationGuardReply = await applyCsvConversationGuards(session, callerText, context);
  if (csvConversationGuardReply) return csvConversationGuardReply;
  const naturalAvailabilityReply = await handleNaturalAvailabilityQuestion(session, context, callerText);
  if (naturalAvailabilityReply) return naturalAvailabilityReply;
  const datetimeGuardReply = await applyDateTimeGuard(session, callerText, context);
  if (datetimeGuardReply) return datetimeGuardReply;
  const stateSafeFreeTalkReply = await handleStateSafeFreeTalk(session, callerText, context);
  if (stateSafeFreeTalkReply) return stateSafeFreeTalkReply;
  updateReservationDraft(session, callerText, context);
  mergeSplitPhoneNumber(session, callerText);
  logConversationState(session, "after_user_prompt", {
    user_utterance: callerText,
    next_action: "route_prompt"
  });
  const activeDraft = session.reservationDraft ?? draft;
  if (activeDraft.awaitingField === "firstVisit" && activeDraft.firstVisit !== undefined) {
    const nextQuestion = buildShortNextQuestion(activeDraft, context?.courses ?? activeDraft.availableCourses ?? []);
    return nextQuestion || "来店歴を確認しました。続けて注意事項の確認に進みます。";
  }
  const intent = classifyReservationIntent(text, activeDraft);
  const directNoSameDayShiftReply = await maybeReplyNoSameDayShiftDirect(session, context, text);
  if (directNoSameDayShiftReply) return directNoSameDayShiftReply;

  const specificTherapistFeatureReply = formatSpecificTherapistFeatureAnswer(text, context?.therapists ?? [], activeDraft);
  if (specificTherapistFeatureReply) return specificTherapistFeatureReply;

  const fragmentedFollowUpReply = handleFragmentedFollowUpQuestion(text, activeDraft, context);
  if (fragmentedFollowUpReply) return fragmentedFollowUpReply;

  if (activeDraft.availabilityCheckResult?.ok === false && !activeDraft.suggestedStartsAt && isAffirmative(text) && isPlainSuggestedCandidateAcceptance(text)) {
    activeDraft.awaitingField = "startsAt";
    activeDraft.awaitingFinalConfirmation = false;
    return "\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u3002\u73fe\u5728\u306e\u304a\u6642\u9593\u306f\u6307\u540d\u30fb\u30d5\u30ea\u30fc\u3069\u3061\u3089\u3082\u627f\u308c\u307e\u305b\u3093\u3002\u5225\u306e\u65e5\u6642\u3092\u304a\u4f3a\u3044\u3057\u3066\u3001\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002";
  }

  const suggestedAcceptanceReply = await handleSuggestedCandidateAcceptance(session, activeDraft, context, text);
  if (suggestedAcceptanceReply) return suggestedAcceptanceReply;
  if (isCourseQuestion(text) && hasAnyDraftValue(activeDraft)) {
    return buildCourseInfoReply(activeDraft, courses);
  }

  if (activeDraft.suggestedStartsAt && isOtherCandidateRequest(text)) {
    return await buildAlternativeCandidateReply(session, context, activeDraft);
  }

  if (activeDraft.suggestedStartsAt && isSuggestedCandidateClarificationQuestion(text)) {
    return buildSuggestedCandidateClarificationReply(activeDraft);
  }
  const requestedTimeUnavailableReply = await maybeReplyRequestedTimeUnavailable(session, context, text);
  if (requestedTimeUnavailableReply) return requestedTimeUnavailableReply;
  const noSameDayShiftReply = await maybeReplyNoSameDayShift(session, context, text);
  if (noSameDayShiftReply) return noSameDayShiftReply;

  if (intent === "therapist_availability") {
    const availabilityReply = await formatRequestedTimeAvailabilityAnswer(session, context, text);
    if (availabilityReply) return availabilityReply;
    return formatTherapistAvailabilityAnswer(context?.therapists ?? []);
  }

  if (activeDraft.startsAt && /(\u7a7a\u3044|\u7a7a\u304d|\u884c\u3051|\u4e88\u7d04|\u5165\u308c)/u.test(text) && findRequestedTherapist(text, context?.therapists ?? [])) {
    const availabilityReply = await formatRequestedTimeAvailabilityAnswer(session, context, text);
    if (availabilityReply) return availabilityReply;
  }

  if (intent === "therapist_recommendation") {
    return formatTherapistRecommendationAnswer(context?.therapists ?? [], activeDraft);
  }

  if (intent === "nomination_explanation") {
      session.reservationDraft = session.reservationDraft ?? activeDraft;
    const wantsFree = /(\u30d5\u30ea\u30fc|\u6307\u540d\u306a\u3057|\u8ab0\u3067\u3082|\u304a\u307e\u304b\u305b)/u.test(text);
    if (wantsFree) {
      session.reservationDraft.nominationIntent = false;
      session.reservationDraft.therapistName = undefined;
      const nextQuestion = buildShortNextQuestion(session.reservationDraft);
      return ("\u304a\u540d\u524d\u3092\u805e\u3044\u305f\u3060\u3051\u3067\u306f\u6307\u540d\u78ba\u5b9a\u306b\u306f\u3057\u307e\u305b\u3093\u3002\u4eca\u56de\u306f\u30d5\u30ea\u30fc\u3067\u627f\u308a\u307e\u3059\u3002" + nextQuestion).trim();
    }
    return "\u304a\u540d\u524d\u3092\u805e\u3044\u305f\u3060\u3051\u3067\u306f\u6307\u540d\u78ba\u5b9a\u306b\u306f\u3057\u307e\u305b\u3093\u3002\u6307\u540d\u306b\u3059\u308b\u5834\u5408\u3060\u3051\u6307\u540d\u3068\u3057\u3066\u627f\u308a\u307e\u3059\u3002\u30d5\u30ea\u30fc\u306b\u3057\u307e\u3059\u304b\u3001\u3054\u6307\u540d\u306b\u3057\u307e\u3059\u304b\uff1f";
  }

  if (isTherapistRecommendationQuestion(text)) {
    return formatTherapistRecommendationAnswer(context?.therapists ?? [], activeDraft);
  }

  if (isTherapistAvailabilityQuestion(text) && !hasTherapistBookingActionText(text)) {
    return formatTherapistAvailabilityAnswer(context?.therapists ?? []);
  }

  if (draft.completed && isCallClosingText(text)) {
    return "\u306f\u3044\u3001\u304a\u96fb\u8a71\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f\u3002\u5e97\u8217\u3067\u78ba\u8a8d\u3057\u3066\u3054\u6848\u5185\u3057\u307e\u3059\u3002\u5931\u793c\u3044\u305f\u3057\u307e\u3059\u3002";
  }

  if (isCourseQuestion(text) && !hasAnyDraftValue(draft)) {
    return formatCourseMenu(courses);
  }
  if (session.reservationDraft?.customerName && isNonNameCandidate(session.reservationDraft.customerName)) {
    session.reservationDraft.customerName = undefined;
  }
  if (!session.reservationDraft?.phone && session.pendingPhoneDigits && isPhoneFragmentText(callerText)) {
    return buildIncompletePhoneReply(session);
  }

  if (["attention", "attentionConfirmed"].includes(session.reservationDraft?.awaitingField) && isAttentionConfirmationText(text)) {
    session.reservationDraft.attentionConfirmed = true;
    session.reservationDraft.awaitingField = "finalConfirmation";
    session.reservationDraft.awaitingFinalConfirmation = true;
    return buildFinalConfirmationText(session.reservationDraft);
  }

  if (isCourseQuestion(text) && hasAnyDraftValue(session.reservationDraft)) {
    return buildCourseInfoReply(session.reservationDraft, courses);
  }

  if (shouldPrioritizeReservationState(session.reservationDraft, text)) {
    const flowReply = await reservationFlowReply(session, callerText, context);
    if (flowReply) return flowReply;
  }

  const selectedTherapist = extractTherapistSelectionName(text, context?.therapists ?? []);
  if (selectedTherapist) {
    session.reservationDraft = session.reservationDraft ?? draft;
    session.reservationDraft.nominationIntent = true;
    session.reservationDraft.therapistName = selectedTherapist;
    session.reservationDraft.selected_therapist_source = "explicit_user_nomination";
    session.selectedTherapist = selectedTherapist;
    if (session.reservationDraft.customerName && namesLookSame(session.reservationDraft.customerName, selectedTherapist)) {
      session.reservationDraft.customerName = undefined;
    }
    if (session.reservationDraft.startsAt) {
      const gate = await ensureAvailabilityGate(session, context);
      if (!gate.ok) return gate.message;
    }
    const nextQuestion = buildShortNextQuestion(session.reservationDraft);
    return nextQuestion || `${selectedTherapist}さんで承ります。ありがとうございます。`;
  }


  if (isSurnameOnlyQuestion(text)) {
    return "はい、名字だけで大丈夫です。ご予約者様のお名前をお願いいたします。";
  }

  const spokenName =
    canCollectCustomerInfo(session.reservationDraft) && session.reservationDraft?.awaitingField === "name"
      ? extractSpokenCustomerName(text)
      : "";
  if (session.reservationDraft?.customerName && spokenName) {
    const nextQuestion = buildShortNextQuestion(session.reservationDraft);
    return nextQuestion || `${session.reservationDraft.customerName}様ですね。ありがとうございます。`;
  }

  if (!session.reservationDraft?.customerName && spokenName) {
    session.reservationDraft = session.reservationDraft ?? draft;
    session.reservationDraft.customerName = spokenName;
    const nextQuestion = buildShortNextQuestion(session.reservationDraft);
    return nextQuestion || `${spokenName}様ですね。ありがとうございます。`;
  }

  if (isCourseQuestion(text) && hasAnyDraftValue(session.reservationDraft)) {
    return buildCourseInfoReply(session.reservationDraft, courses);
  }

  if (isStoreLocationQuestion(text)) {
    return formatStoreLocationReply(context);
  }

  const flowReply = await reservationFlowReply(session, callerText, context);
  if (flowReply) return flowReply;

  if (isAvailabilityQuestion(text)) {
    return "\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3068\u30b3\u30fc\u30b9\u3092\u304a\u4f3a\u3044\u3067\u304d\u308c\u3070\u3001\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002";
  }

  const freeTalkRecoveryReply = buildFreeTalkRecoveryReply(session, text);
  if (freeTalkRecoveryReply) return freeTalkRecoveryReply;

  return "";
}

function buildFreeTalkRecoveryReply(session, text) {
  const draft = session.reservationDraft ?? createReservationDraft();
  const nextQuestion = buildShortNextQuestion(draft);
  const hasDraft = hasAnyDraftValue(draft);

  if (!text) {
    return nextQuestion || "失礼しました。お声が届いていないようです。ご予約でしたら、ご希望の日時をお話しください。";
  }

  if (/(予約したい|予約取りたい|取りたい|入れたい|押さえたい|空き確認)/u.test(text) && !hasDraft) {
    return "承知しました。ご希望の日付と時間を教えてください。空きを確認します。";
  }

  if (/(やっぱ|違う|間違|訂正|修正)/u.test(text) && hasDraft) {
    if (draft.awaitingField === "name") return "承知しました。お名前をもう一度お願いします。";
    if (draft.awaitingField === "phone") return "承知しました。お電話番号をもう一度お願いします。";
    if (draft.startsAt || draft.suggestedStartsAt) return "承知しました。ご希望の日にちとお時間をもう一度お願いします。";
    return nextQuestion || "承知しました。変更したい内容を教えてください。";
  }

  if (/(何を言えば|なにを言えば|どうすれば|どうしたら|わからない|分からない|初めて|はじめて|使い方|流れ)/u.test(text)) {
    return nextQuestion || "大丈夫です。まず、ご希望の日付と時間を教えてください。空きを確認します。";
  }

  if (/(聞こえ|きこえ|もしもし|声|途切れ|遠い|電波|もう一回|もういっかい|なんて|何て)/u.test(text)) {
    return nextQuestion || "失礼しました。予約でしたら、ご希望の日付と時間をもう一度お願いします。";
  }

  if (/(考え|迷って|悩んで|まだ|一旦|いったん|ちょっと待って|少し待って|保留)/u.test(text)) {
    return "承知しました。決まりましたら、ご希望の日付と時間をお伝えください。";
  }

  if (/(えー|あのー|うーん|んー|んー+|あー)/u.test(text) && text.length <= 12) {
    return nextQuestion || "大丈夫です。ゆっくりで構いません。ご希望の日時をお聞かせください。";
  }

  if (/(ありがとう|助かる|了解|りょうかい|はいはい|うん|そうなんだ|なるほど)/u.test(text) && hasDraft) {
    return nextQuestion || "ありがとうございます。この内容でよろしければ、はいとお答えください。";
  }

  return "";
}

function handleFirstVisitStateReply(session, callerText, context) {
  const draft = session.reservationDraft;
  if (!draft || draft.awaitingField !== "firstVisit") return "";
  const firstVisit = extractFirstVisit(callerText, "firstVisit");
  if (firstVisit === undefined) return "";
  draft.firstVisit = firstVisit;
  draft.awaitingFinalConfirmation = false;
  const nextQuestion = buildShortNextQuestion(draft, context?.courses ?? draft.availableCourses ?? []);
  return nextQuestion || "\u6765\u5e97\u6b74\u3092\u78ba\u8a8d\u3057\u307e\u3057\u305f\u3002\u7d9a\u3051\u3066\u6700\u7d42\u78ba\u8a8d\u306b\u9032\u307f\u307e\u3059\u3002";
}

async function applyCsvConversationGuards(session, callerText, context) {
  const text = normalizeJapaneseSpeech(callerText);
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;

  if (draft.awaitingFinalConfirmation && isAffirmative(text)) {
    return "";
  }
  if (draft.awaitingFinalConfirmation) {
    if (
      isAlreadySaidComplaint(text) ||
      isWhatShouldISayQuestion(text) ||
      isAudioOrPaceComplaint(text) ||
      isCurrentReservationSummaryQuestion(text)
    ) {
      return buildStateSafeRecoveryReply(draft, context, text);
    }
    const featureReply = formatSpecificTherapistFeatureAnswer(text, context?.therapists ?? []);
    if (featureReply) {
      return featureReply + " 先ほどの予約内容でよろしければ「はい」、変更する場合は「変更」とお伝えください。";
    }
    if (isFinalConfirmationChangeRequest(text)) {
      draft.awaitingFinalConfirmation = false;
      draft.awaitingField = "startsAt";
      return "変更ですね。ご希望の日にちとお時間をもう一度お願いします。";
    }
    return "確認のお返事は、よろしければ「はい」、変更する場合は「変更」とお伝えください。";
  }

  const relativeMatch = findCsvGuardMatch(relativeTimeRegressionTraining, text);
  const freeTalkMatch = findCsvGuardMatch(freeTalkRecoveryTraining, text);
  const category = relativeMatch?.category || freeTalkMatch?.category || "";

  if (category) {
    logConversationState(session, "csv_conversation_guard", {
      user_utterance: callerText,
      guard_category: category,
      next_action: relativeMatch?.expected_action || freeTalkMatch?.expected_action || "guard_route"
    });
  }

  if (shouldLetDateTimeFlowHandle(text, context?.store, category)) {
    return "";
  }

  if (isOtherTherapistCandidateRequest(text) && (draft.suggestedStartsAt || draft.startsAt)) {
    return await buildOtherTherapistCandidateReply(session, context, draft);
  }

  if (isOtherCandidateRequest(text) && (draft.suggestedStartsAt || draft.availabilityCheckResult?.ok === false || draft.availability_search_mode)) {
    return await buildAlternativeCandidateReply(session, context, draft);
  }

  if (draft.suggestedStartsAt && isSuggestedCandidateConfirmationQuestion(text)) {
    return buildSuggestedCandidateClarificationReply(draft);
  }

  if (
    category === "alternative_time_question" ||
    category === "alternative_request" ||
    isAlternativeTimeRequestText(text)
  ) {
    return await buildAlternativeCandidateReply(session, context, draft);
  }

  if (
    category === "candidate_clarification" ||
    category === "candidate_question" ||
    isCandidateClarificationText(text)
  ) {
    if (!draft.suggestedStartsAt && !draft.startsAt) {
      return await buildAvailabilitySearchReply(session, context, callerText);
    }
    return buildCurrentCandidateReply(draft);
  }

  if (category === "user_confused" || category === "audio_trouble" || category === "hold_or_thinking" || category === "casual_ack" || category === "complaint_light" || category === "reservation_intent" || category === "mid_correction" || category === "hesitation") {
    return buildFreeTalkRecoveryReply(session, text);
  }

  return "";
}

function shouldLetDateTimeFlowHandle(text, store, category) {
  if (!category) return false;
  const recoveryCategories = new Set(["reservation_intent", "mid_correction", "hesitation", "casual_ack", "complaint_light"]);
  if (!recoveryCategories.has(category)) return false;
  const normalized = normalizeDateTimeDigits(normalizeJapaneseSpeech(text));
  const hasDateOrTime = Boolean(parseRequestedDateParts(normalized) || parseRequestedTimeParts(normalized, store));
  if (!hasDateOrTime) return false;
  return /(\u4e88\u7d04|\u53d6\u308a\u305f\u3044|\u5165\u308c\u305f\u3044|\u304a\u9858\u3044|\u7a7a\u304d|\u5e0c\u671b|\u30b3\u30fc\u30b9|\u5206)/u.test(normalized);
}

function buildCurrentCandidateReply(draft) {
  if (draft.suggestedStartsAt) {
    return buildSuggestedCandidateClarificationReply(draft);
  }
  if (draft.startsAt) {
    return "\u73fe\u5728\u78ba\u8a8d\u3057\u3066\u3044\u308b\u5e0c\u671b\u6642\u9593\u306f" + formatDateTimeJa(draft.startsAt) + "\u3067\u3059\u3002\u5225\u306e\u65e5\u6642\u3082\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002";
  }
  return "\u307e\u3060\u5019\u88dc\u6642\u9593\u304c\u78ba\u5b9a\u3057\u3066\u3044\u307e\u305b\u3093\u3002\u7a7a\u3044\u3066\u3044\u308b\u5019\u88dc\u3092\u304a\u8abf\u3079\u3057\u307e\u3059\u3002";
}

async function buildAlternativeCandidateReply(session, context, draft) {
  draft.availability_search_mode = true;
  draft.availabilitySearchMode = true;
  draft.awaitingFinalConfirmation = false;
  const from = draft.suggestedStartsAt
    ? new Date(new Date(draft.suggestedStartsAt).getTime() + 30 * 60 * 1000)
    : draft.startsAt
      ? new Date(new Date(draft.startsAt).getTime() + 30 * 60 * 1000)
      : new Date();
  const dayParts = draft.suggestedStartsAt
    ? getJstDatePartsFromDate(draft.suggestedStartsAt)
    : draft.startsAt
      ? getJstDatePartsFromDate(draft.startsAt)
      : getJstTodayParts();
  const nextSlot = await findNextAvailableSlot(session, context, dayParts, from, draft.therapistName);
  if (!nextSlot) {
    return "\u5225\u306e\u5019\u88dc\u3092\u78ba\u8a8d\u3057\u307e\u3057\u305f\u304c\u3001\u73fe\u5728\u6761\u4ef6\u306b\u5408\u3046\u5225\u67a0\u306f\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u5225\u306e\u65e5\u306b\u3061\u3084\u6642\u9593\u5e2f\u304c\u3042\u308c\u3070\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }
  setSuggestedCandidate(draft, nextSlot);
  return "\u5225\u5019\u88dc\u3067\u3059\u3068" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
}

async function buildOtherTherapistCandidateReply(session, context, draft) {
  draft.availability_search_mode = true;
  draft.availabilitySearchMode = true;
  draft.awaitingFinalConfirmation = false;
  const startsAt = draft.suggestedStartsAt || draft.startsAt;
  if (!startsAt) return await buildAvailabilitySearchReply(session, context, "");

  const probeDraft = {
    ...draft,
    startsAt: new Date(startsAt),
    therapistName: undefined,
    nominationIntent: false,
    selected_therapist_source: "free_or_ai_assigned"
  };
  const check = await checkReservationAvailability(session, context, probeDraft);
  const currentName = draft.suggestedTherapistName || draft.therapistName || check.selectedTherapist?.displayName || "";
  const currentNormalized = normalizeTherapistName(currentName);
  const alternative = (check.availableTherapists ?? []).find((therapist) => {
    const display = String(therapist?.displayName || therapist?.name || "").trim();
    return display && !namesLookSame(normalizeTherapistName(display), currentNormalized);
  });

  if (alternative?.displayName) {
    draft.suggestedStartsAt = new Date(startsAt);
    draft.suggestedTherapistName = alternative.displayName;
    draft.suggested_therapist = alternative.displayName;
    draft.suggestedNominationIntent = true;
    draft.candidateOfferSequence = Number(draft.candidateOfferSequence ?? 0) + 1;
    draft.suggestedCandidateOfferKey = [new Date(startsAt).toISOString(), alternative.displayName].join("|");
    return formatDateTimeJa(startsAt) + "\u3067\u3057\u305f\u3089\u3001" + alternative.displayName + "\u3055\u3093\u3082\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "therapist");
  }

  const candidateName = currentName ? currentName + "\u3055\u3093" : "\u73fe\u5728\u306e\u5019\u88dc";
  const nextDifferentSlot = currentName
    ? await findNextAvailableSlot(session, context, getJstDatePartsFromDate(startsAt), startsAt, undefined, { excludeTherapistNames: [currentName] })
    : null;
  if (nextDifferentSlot?.therapist?.displayName) {
    setSuggestedCandidate(draft, nextDifferentSlot);
    draft.suggestedNominationIntent = true;
    return formatDateTimeJa(startsAt) + "\u306f" + candidateName + "\u306e\u307f\u78ba\u8a8d\u3067\u304d\u3066\u3044\u307e\u3059\u3002\u5225\u306e\u30bb\u30e9\u30d4\u30b9\u30c8\u3067\u3059\u3068" + formatDateTimeJa(nextDifferentSlot.startsAt) + "\u306b" + nextDifferentSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "therapist");
  }

  return formatDateTimeJa(startsAt) + "\u306f\u3001\u7a7a\u3044\u3066\u3044\u308b\u5225\u306e\u30bb\u30e9\u30d4\u30b9\u30c8\u304c\u73fe\u5728\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002" + candidateName + "\u3067\u9032\u3081\u308b\u5834\u5408\u306f\u300c\u305d\u308c\u3067\u304a\u9858\u3044\u3057\u307e\u3059\u300d\u3001\u5225\u306e\u6642\u9593\u306a\u3089\u300c\u5225\u306e\u6642\u9593\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
}

function isCandidateClarificationText(text) {
  return /(\u4f55\u6642|\u306a\u3093\u3058|\u3044\u3064|\u4f55\u65e5|\u306a\u3093\u306b\u3061|\u305d\u306e\u6642\u9593|\u305d\u308c\u3063\u3066|\u5019\u88dc.*\u6559\u3048|\u6642\u9593.*\u6559\u3048|\u7a7a\u3044\u3066\u308b(?:\u3068\u3053|\u3068\u3053\u308d)|\u3042\u3044\u3066\u308b(?:\u3068\u3053|\u3068\u3053\u308d))/u.test(text);
}

function isAlternativeTimeRequestText(text) {
  return /(\u305d\u308c.*\u4ee5\u5916|\u305d\u306e\u6642\u9593.*\u4ee5\u5916|\u5225\u306e\u6642\u9593|\u5225\u306e\u65e5|\u4ed6\u306e\u6642\u9593|\u4ed6\u306a\u3044|\u4ed6\u306b|\u3082\u3046\u4e00\u3064|\u7a7a\u3044\u3066\u308b\u65e5|\u7a7a\u3044\u3066\u308b\u67a0|\u7a7a\u304d\u67a0|\u7a7a\u3044\u3066\u308b(?:\u3068\u3053|\u3068\u3053\u308d)|\u3042\u3044\u3066\u308b(?:\u3068\u3053|\u3068\u3053\u308d)|\u7a7a\u304d(?:\u3042\u308b|\u3042\u308a\u307e\u3059))/u.test(text);
}

async function handleRelativeHourOffsetReply(session, callerText, context) {
  const parsed = parseRelativeHourOffset(callerText);
  if (!parsed) return "";

  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;

  const explicitClock = extractExplicitClockExcludingRelativeHour(callerText);
  const startsAt = explicitClock
    ? combineExplicitClockWithCurrentJstDate(explicitClock)
    : roundRelativeHourOffsetToReceptionSlot(parsed.hours);

  draft.startsAt = startsAt;
  draft.awaitingFinalConfirmation = false;
  draft.noSameDayShift = false;
  draft.availabilitySearchMode = false;
  syncDraftDateTimeFromStartsAt(draft, startsAt, "relative_hour_offset");

  const gate = await ensureAvailabilityGate(session, context);
  if (!gate.ok) return gate.message;

  const nextQuestion = buildShortNextQuestion(draft);
  return (parsed.label + "\u3067\u3059\u3068" + formatDateTimeJa(startsAt) + "\u3067\u3059\u306d\u3002\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3057\u305f\u3002" + nextQuestion).trim();
}

function parseRelativeHourOffset(rawText) {
  const text = normalizeJapaneseSpeech(rawText).replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const match = text.match(/([0-9]{1,2}|一|二|三|四|五|六|七|八|九|十|十一|十二)\s*時間\s*後/u);
  if (!match) return null;
  const hours = parseRelativeHourJapaneseNumber(match[1]);
  if (!Number.isFinite(hours) || hours < 1 || hours > 12) return null;
  return { hours, label: `${hours}時間後` };
}

function parseRelativeHourJapaneseNumber(value) {
  if (/^[0-9]+$/.test(value)) return Number(value);
  const table = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10,
    "\u5341\u4e00": 11,
    "\u5341\u4e8c": 12
  };
  return table[value] ?? Number.NaN;
}

function extractExplicitClockExcludingRelativeHour(rawText) {
  const text = normalizeJapaneseSpeech(rawText)
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/([0-9]{1,2}|一|二|三|四|五|六|七|八|九|十|十一|十二)\s*時間\s*後/gu, "");
  const match = text.match(/(午前|朝|昼|午後|夕方|夜)?\s*([0-9]{1,2})\s*時(?:\s*([0-9]{1,2}|半)\s*分?)?/u);
  if (!match) return null;
  let hour = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
  const dayPart = match[1] ?? "";
  if (/午後|夕方|夜/.test(dayPart) && hour < 12) hour += 12;
  if (/午前|朝/.test(dayPart) && hour === 12) hour = 0;
  const minute = match[3] === "半" ? 30 : Number(match[3] ?? 0);
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function roundRelativeHourOffsetToReceptionSlot(hours) {
  const target = new Date(Date.now() + hours * 60 * 60 * 1000);
  const parts = getJstDateTimeParts(target);
  if (parts.minute <= 10) {
    parts.minute = 0;
  } else if (parts.minute <= 40) {
    parts.minute = 30;
  } else {
    parts.hour += 1;
    parts.minute = 0;
  }
  return jstDateTimePartsToDate(parts);
}

function combineExplicitClockWithCurrentJstDate(clock) {
  const parts = getJstDateTimeParts(new Date());
  parts.hour = clock.hour;
  parts.minute = clock.minute;
  let date = jstDateTimePartsToDate(parts);
  if (date.getTime() < Date.now() - 15 * 60 * 1000) {
    date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }
  return date;
}

function getJstDateTimeParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

function jstDateTimePartsToDate(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 9, parts.minute, 0, 0));
}

function isSuggestedCandidateClarificationQuestion(text) {
  return /(何時|なんじ|どの時間|その時間|この時間|それって|その候補|この候補|候補|何日|なんにち|日時|時間.*ですか|で合って|であって|でいい|で大丈夫|ですよね)/u.test(text);
}

function isSuggestedCandidateConfirmationQuestion(text) {
  return /(\d{1,2}日|\d{1,2}時|時半|その時間|この時間|その候補|この候補|候補|で合って|であって|でいい|で大丈夫|ですよね)/u.test(text);
}

function isFinalConfirmationChangeRequest(text) {
  return /(変更|変え|違う|ちがう|キャンセルじゃなくて|別の|やっぱ|待って|まって|一旦|いったん)/u.test(text);
}

function buildSuggestedCandidateClarificationReply(draft) {
  const startsAt = new Date(draft.suggestedStartsAt);
  const therapist = draft.suggestedTherapistName ? draft.suggestedTherapistName + "\u3055\u3093" : "\u62c5\u5f53\u5019\u88dc";
  return "\u5019\u88dc\u306f" + formatDateTimeJa(startsAt) + "\u3001" + therapist + "\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "clarify");
}

function buildCandidateOfferInstruction(draft, mode = "time") {
  const sequence = Number(draft?.candidateOfferSequence ?? 0);
  if (mode === "therapist" && sequence <= 1) return "\u3053\u306e\u30bb\u30e9\u30d4\u30b9\u30c8\u3067\u9032\u3081\u307e\u3059\u304b\uff1f";
  if (mode === "hold" && sequence <= 1) return "\u3053\u306e\u67a0\u3067\u4eee\u62bc\u3055\u3048\u3057\u307e\u3059\u304b\uff1f";
  if (mode === "time" && sequence <= 1) return "\u3053\u306e\u304a\u6642\u9593\u3067\u304a\u53d6\u308a\u3057\u307e\u3059\u304b\uff1f";
  if (mode === "clarify") return "\u9032\u3081\u308b\u5834\u5408\u306f\u300c\u306f\u3044\u300d\u3001\u5225\u306a\u3089\u300c\u5225\u306e\u5019\u88dc\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
  return "\u9032\u3081\u308b\u5834\u5408\u306f\u300c\u304a\u9858\u3044\u3057\u307e\u3059\u300d\u3001\u5225\u306a\u3089\u300c\u5225\u306e\u5019\u88dc\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
}

async function handleSuggestedCandidateAcceptance(session, draft, context, text) {
  if (!draft?.suggestedStartsAt) return "";
  const acceptsSuggestedCandidate =
    isPlainSuggestedCandidateAcceptance(text) ||
    isSuggestedCandidateExactTimeAcceptance(text, draft, context);
  if (!acceptsSuggestedCandidate) return "";
  session.reservationDraft = draft;
  const acceptedSuggestedTherapist = draft.suggestedTherapistName;
  const acceptAsExplicitNomination = draft.suggestedNominationIntent === true && !isNoNominationText(text);
  draft.startsAt = new Date(draft.suggestedStartsAt);
  syncDraftDateTimeFromStartsAt(draft, draft.startsAt, "suggested_candidate_accept");
  if (isNoNominationText(text) || !acceptAsExplicitNomination) {
    draft.therapistName = undefined;
    draft.nominationIntent = false;
    session.selectedTherapist = undefined;
    draft.selected_therapist_source = "free_or_ai_assigned";
  } else {
    draft.therapistName = draft.suggestedTherapistName;
    draft.nominationIntent = true;
    session.selectedTherapist = draft.therapistName;
    draft.selected_therapist_source = "explicit_user_nomination";
  }
  draft.noSameDayShift = false;
  draft.suggestedStartsAt = undefined;
  draft.suggestedTherapistName = undefined;
  draft.suggestedNominationIntent = undefined;
  draft.suggested_therapist = undefined;
  draft.allowEarlierAlternative = false;
  draft.availabilityCheckResult = undefined;
  const gate = await ensureAvailabilityGate(session, context);
  if (!gate.ok) return gate.message;
  const nextQuestion = buildShortNextQuestion(draft, context?.courses ?? draft.availableCourses ?? []);
  const bookingTypeText = draft.nominationIntent
    ? draft.therapistName + "\u3055\u3093\u6307\u540d\u3067\u9032\u3081\u307e\u3059\u3002"
    : acceptedSuggestedTherapist
      ? "\u30d5\u30ea\u30fc\uff08\u62c5\u5f53\u5019\u88dc\u306f" + acceptedSuggestedTherapist + "\u3055\u3093\uff09\u3067\u9032\u3081\u307e\u3059\u3002"
      : "\u30d5\u30ea\u30fc\u3067\u9032\u3081\u307e\u3059\u3002";
  return (formatDateTimeJa(draft.startsAt) + "\u3001" + bookingTypeText + nextQuestion).trim();
}

function isCourseQuestion(text) {
  if (isCurrentReservationSummaryQuestion(text)) return false;
  return /(\u30b3\u30fc\u30b9|\u6599\u91d1|\u30e1\u30cb\u30e5\u30fc|\u3044\u304f\u3089|\u4f55\u304c|\u306a\u306b\u304c|\u7a2e\u985e|\u5185\u5bb9|\u7279\u5fb4|\u9055\u3044|\u30b5\u30fc\u30d3\u30b9|\u30aa\u30d7\u30b7\u30e7\u30f3|\u8aac\u660e)/u.test(text);
}

function isExplicitCourseOrPriceQuestion(text) {
  return /(\u30b3\u30fc\u30b9|\u6599\u91d1|\u30e1\u30cb\u30e5\u30fc|\u3044\u304f\u3089|\u5024\u6bb5|\u91d1\u984d|\u7a2e\u985e|\u5185\u5bb9|\u7279\u5fb4|\u9055\u3044|\u30b5\u30fc\u30d3\u30b9|\u30aa\u30d7\u30b7\u30e7\u30f3|\u8aac\u660e)/u.test(text);
}

function isCourseMentionInsideBookingRequest(text) {
  return hasDateTimeCue(text) && /(\u4e88\u7d04|\u53d6\u308a\u305f\u3044|\u5165\u308c\u305f\u3044|\u304a\u9858\u3044|\u7a7a\u304d|\u5e0c\u671b|できます|可能)/u.test(text);
}

function handleFragmentedFollowUpQuestion(text, draft, context) {
  if (!draft?.suggestedStartsAt) return "";
  const normalized = normalizeJapaneseSpeech(text);
  if (!normalized || normalized.length > 18) return "";
  const candidate = buildSuggestedCandidateClarificationReply(draft);
  if (/(\u5fc5\u8981|\u3044\u308a\u307e\u3059|\u8981\u308a\u307e\u3059|\u6307\u540d.*\u3044\u308b|\u6307\u540d.*\u5fc5\u8981)/u.test(normalized)) {
    return "\u6307\u540d\u306f\u5fc5\u9808\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u30d5\u30ea\u30fc\u3067\u9032\u3081\u308b\u5834\u5408\u306f\u3001\u5e97\u8217\u5074\u3067\u7a7a\u304d\u306e\u3042\u308b\u62c5\u5f53\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002" + candidate;
  }
  if (/^(\u3069\u3046\u3044\u3046|\u3069\u3093\u306a|\u306a\u3093\u306e|\u4f55\u306e|\u3069\u3046\u3044\u3046\u3053\u3068)[\uff1f?。]*$/u.test(normalized)) {
    const therapist = findTherapistBySpokenName(draft.suggestedTherapistName ?? draft.therapistName, context?.therapists ?? []);
    const therapistLine = therapist ? formatSpecificTherapistFeatureAnswer("\u7279\u5fb4", context?.therapists ?? [], draft) : "";
    const courseLine = formatRegisteredCourseShort(context?.courses ?? draft.availableCourses ?? []);
    return therapistLine || (courseLine + candidate);
  }
  return "";
}

function isStoreLocationQuestion(text) {
  return /(\u5834\u6240|\u4f4f\u6240|\u3069\u3053|\u9053\u6848\u5185|\u30de\u30f3\u30b7\u30e7\u30f3|\u30a2\u30af\u30bb\u30b9|\u884c\u304d\u65b9)/u.test(text) &&
    !/(\u3069\u3053\u304b|\u3069\u3063\u304b).*(\u7a7a\u3044|\u7a7a\u304d|\u5165\u308c|\u4e88\u7d04)/u.test(text);
}

function formatStoreLocationReply(context) {
  const store = context?.store;
  const address = String(store?.address ?? "").trim();
  const phone = String(store?.phone ?? "").trim();
  if (address && phone) return "\u5834\u6240\u306f" + address + "\u3067\u3059\u3002\u5230\u7740\u3055\u308c\u307e\u3057\u305f\u3089" + phone + "\u3078\u304a\u96fb\u8a71\u304f\u3060\u3055\u3044\u3002";
  if (address) return "\u5834\u6240\u306f" + address + "\u3067\u3059\u3002\u8a73\u7d30\u306f\u4e88\u7d04\u78ba\u5b9a\u5f8c\u306b\u5e97\u8217\u304b\u3089\u3054\u6848\u5185\u3057\u307e\u3059\u3002";
  return "\u5834\u6240\u306e\u8a73\u7d30\u306f\u78ba\u8a8d\u304c\u5fc5\u8981\u3067\u3059\u3002\u5e97\u8217\u306b\u78ba\u8a8d\u3057\u3066\u6298\u308a\u8fd4\u3057\u307e\u3059\u3002";
}

function isAvailabilityQuestion(text) {
  return /(\u7a7a\u304d|\u7a7a\u3044\u3066|\u958b\u3044\u3066|\u3042\u3044\u3066|\u4e88\u7d04|\u884c\u3051|\u884c\u304d|\u3044\u3051|\u3044\u304d|\u5165\u308c|\u53d6\u308c|\u304a\u9858\u3044)/u.test(text);
}

function isCourseOnlyAnswer(text) {
  return /^\d{2,3}(?:\u5206|\u3075\u3093)?(?:\u3067|\u30b3\u30fc\u30b9)?$/u.test(text) && !/(\u30d5\u30ea\u30fc|\u6307\u540d|\u672c\u6307\u540d|\u8ab0\u3067\u3082|\u304a\u307e\u304b\u305b)/u.test(text);
}

function isSurnameOnlyQuestion(text) {
  return /(\u30d5\u30eb\u30cd\u30fc\u30e0|\u540d\u5b57|\u82d7\u5b57|\u4e0b\u306e\u540d\u524d).*(\u5fc5\u8981|\u3044\u308b|\u3044\u308a\u307e\u3059|\u3067\u3059\u304b|\u3060\u3051|\u3044\u3044)|(\u540d\u5b57\u3060\u3051|\u82d7\u5b57\u3060\u3051)/u.test(text);
}

function extractSpokenCustomerName(text) {
  if (isInvalidCustomerNameText(text)) return "";
  const direct = String(text ?? "")
    .replace(/[、。！？!?]/g, "")
    .replace(/^(?:\u3042\u306e|\u3048\u3063\u3068|\u306f\u3044|\u3058\u3083\u3042|\u3088\u3057|\u540d\u524d\u306f|\u540d\u524d|\u540d\u5b57\u306f|\u82d7\u5b57\u306f)+/u, "")
    .replace(/(?:\u3067\u304a\u9858\u3044\u3057\u307e\u3059|\u3067\u304a\u9858\u3044|\u3067|\u3067\u3059|\u3067\u3054\u3056\u3044\u307e\u3059|\u3068\u7533\u3057\u307e\u3059|\u3068\u8a00\u3044\u307e\u3059|\u3063\u3066\u3044\u3044\u307e\u3059)$/u, "")
    .trim();
  const matched = String(text ?? "").match(/(?:\u540d\u524d\u306f|\u540d\u5b57\u306f|\u82d7\u5b57\u306f)?([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30fc]{1,12})(?:\u3067\u3059|\u3067\u3054\u3056\u3044\u307e\u3059|\u3068\u7533\u3057\u307e\u3059|\u3068\u8a00\u3044\u307e\u3059|\u3063\u3066\u3044\u3044\u307e\u3059)$/u);
  const candidate = matched?.[1] ?? direct;

  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30fc]{1,12}$/u.test(candidate)) return "";
  if (isNonNameCandidate(candidate)) return "";
  return candidate;
}

function extractTherapistSelectionName(text, therapists) {
  const normalized = String(text ?? "").replace(/\s+/g, "");
  if (isCourseOnlyAnswer(normalized)) return "";
  if (!/(\u3058\u3083\u3042|\u3067|\u6307\u540d|\u304a\u9858\u3044|\u305d\u306e\u5b50|\u305d\u306e\u4eba)/u.test(normalized)) return "";

  const strictMatch = findRequestedTherapistMatch(text, therapists);
  if (strictMatch.confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD) {
    return strictMatch.therapist?.displayName || strictMatch.therapist?.name || "";
  }

  const looseMatch = normalized.match(/(?:\u3058\u3083\u3042|\u3067\u306f|\u305d\u308c\u306a\u3089)?([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30fc]{1,8})(?:\u3055\u3093|\u3061\u3083\u3093)?(?:\u3067|\u6307\u540d|\u304a\u9858\u3044)$/u);
  const candidate = looseMatch?.[1] ?? "";
  if (!candidate || isNonNameCandidate(candidate)) return "";
  return candidate;
}

function namesLookSame(left, right) {
  const normalize = (value) => String(value ?? "").replace(/(?:\u3055\u3093|\u3061\u3083\u3093)/g, "").trim();
  return normalize(left) === normalize(right);
}

function isNonNameCandidate(value) {
  const normalized = normalizeJapaneseSpeech(value).replace(/\s+/g, "");
  if (/^(?:\u306f\u3044|\u3044\u3044\u3048|\u3046\u3093|\u3044\u3084|\u3042|\u3048|\u3093|\u306d|\u3084|\u307e\u3042|\u305d\u3046|\u305d\u3046\u306d|\u305d\u3046\u3067\u3059|\u305d\u3046\u3067\u3059\u306d|\u5927\u4e08\u592b|\u304a\u9858\u3044|\u304a\u9858\u3044\u3057\u307e\u3059|\u4eca\u65e5|\u660e\u65e5|\u30d5\u30ea\u30fc|\u6307\u540d|\u672c\u6307\u540d|\u521d\u3081\u3066|\u30d5\u30eb\u30cd\u30fc\u30e0|\u540d\u5b57|\u82d7\u5b57|\u30b3\u30fc\u30b9|\u6642\u9593|\u96fb\u8a71|\u756a\u53f7|\u7a7a\u304d|\u8ab0|\u7279\u5fb4|\u304a\u3059\u3059\u3081)$/u.test(normalized)) return true;
  return /(\d|\u4eca\u65e5|\u660e\u65e5|\u30d5\u30ea\u30fc|\u6307\u540d|\u672c\u6307\u540d|\u30b3\u30fc\u30b9|\u6642\u9593|\u96fb\u8a71|\u756a\u53f7|\u7a7a\u304d|\u8ab0|\u304a\u3059\u3059\u3081|\u304a\u9858\u3044|\u5206|\u6642)/u.test(normalized);
}

function isInvalidCustomerNameText(value) {
  const raw = String(value ?? "").trim();
  const text = normalizeJapaneseSpeech(raw).replace(/\s+/g, "");
  if (!text) return true;
  if (text.length > 20) return true;
  if (/[?？]/.test(raw)) return true;
  if (/(\u3055\u3063\u304d|\u3082\u3046|\u3055\u304d\u307b\u3069|\u5148\u307b\u3069|\u8a00\u3063\u305f|\u8a00\u3044\u307e\u3057\u305f|\u4f1d\u3048\u305f|\u4f1d\u3048\u307e\u3057\u305f|\u805e\u3044\u305f|\u805e\u3053\u3048|\u5206\u304b\u308b|\u308f\u304b\u308b|\u540c\u3058|\u305d\u306e\u307e\u307e)/u.test(text)) return true;
  if (/(\u3067\u3059\u304b|\u3067\u3057\u3087\u3046\u304b|\u3067\u3059\u304b\u306d|\u8ab0|\u4f55|\u3069\u306a\u305f|\u3069\u306e|\u30bb\u30e9\u30d4\u30b9\u30c8|\u5973\u306e\u5b50|\u62c5\u5f53|\u7a7a\u3044|\u4e88\u7d04|\u6307\u540d|\u30b3\u30fc\u30b9|\u96fb\u8a71|\u756a\u53f7)/u.test(text)) return true;
  return isNonNameCandidate(text);
}

function isExplicitCustomerNameCorrection(value) {
  const text = normalizeJapaneseSpeech(value);
  return /(\u540d\u524d\u306f|\u6c0f\u540d\u306f|\u540d\u5b57\u306f|\u82d7\u5b57\u306f|\u540d\u524d\u5909\u66f4|\u540d\u524d\u306f\u3084\u3063\u3071|\u3067\u304a\u9858\u3044|\u3067\u3059)$/u.test(text) &&
    !/(\u3055\u3063\u304d|\u8a00\u3063\u305f|\u4f1d\u3048\u305f|\u540c\u3058)/u.test(text);
}

function normalizePhoneDigits(value) {
  return String(value ?? "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 48))
    .replace(/[^\d]/g, "");
}

function isLikelyCustomerPhone(value) {
  const digits = normalizePhoneDigits(value);
  if (/^(?:070|080|090)\d{8}$/.test(digits)) return true;
  return /^0\d{9}$/.test(digits) && !/^(?:070|080|090)/.test(digits);
}

function normalizePhoneForComparison(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.startsWith("81") && digits.length >= 11 && digits.length <= 13) return `0${digits.slice(2)}`;
  return digits;
}

function formatPhoneWithHyphen(value) {
  const digits = normalizePhoneForComparison(value);
  return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}

function phoneLast4(value) {
  const digits = normalizePhoneForComparison(value);
  return digits ? digits.slice(-4) : "";
}

function buildCallerPhoneMismatch(session, heardPhone) {
  const callerPhone = normalizePhoneForComparison(session.from);
  const heard = normalizePhoneForComparison(heardPhone);
  if (!callerPhone || !heard) return null;
  if (!isLikelyCustomerPhone(callerPhone) || !isLikelyCustomerPhone(heard)) return null;
  if (callerPhone === heard) return null;
  return {
    callerPhone: formatPhoneWithHyphen(callerPhone),
    heardPhone: formatPhoneWithHyphen(heard),
    callerLast4: phoneLast4(callerPhone),
    heardLast4: phoneLast4(heard),
    pendingPrompt: true
  };
}

function setDraftPhoneFromCallerInput(session, draft, phone) {
  const normalized = normalizePhoneForComparison(phone);
  draft.phone = formatPhoneWithHyphen(normalized || phone);
  const mismatch = buildCallerPhoneMismatch(session, normalized);
  if (mismatch) {
    draft.phoneMismatchConfirmation = mismatch;
    draft.awaitingField = "phoneMismatchConfirmation";
    draft.awaitingFinalConfirmation = false;
    return;
  }
  draft.phoneMismatchConfirmation = undefined;
}

function buildPhoneMismatchQuestion(draft) {
  const mismatch = draft.phoneMismatchConfirmation;
  if (!mismatch) return "";
  return `念のため確認です。今おかけの番号は末尾${mismatch.callerLast4}、伺った番号は末尾${mismatch.heardLast4}です。SMSは今おかけの番号へ送ってよろしいですか？違う場合は送信先番号をお願いします。`;
}

function clearPhoneMismatch(draft, phone) {
  draft.phone = formatPhoneWithHyphen(phone);
  draft.phoneMismatchConfirmation = undefined;
  draft.awaitingField = "phone";
  draft.awaitingFinalConfirmation = false;
}

function continueAfterPhoneConfirmed(draft) {
  if (draft.startsAt && draft.customerName && draft.course) {
    draft.awaitingField = "finalConfirmation";
    draft.awaitingFinalConfirmation = true;
    return buildFinalConfirmationText(draft);
  }
  return "\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002" + buildStateNextInstruction(draft);
}

function handlePhoneMismatchConfirmation(session, callerText) {
  const draft = session.reservationDraft;
  const mismatch = draft?.phoneMismatchConfirmation;
  if (!draft || draft.awaitingField !== "phoneMismatchConfirmation" || !mismatch) return "";
  if (mismatch.pendingPrompt) {
    mismatch.pendingPrompt = false;
    return buildPhoneMismatchQuestion(draft);
  }

  const text = normalizeJapaneseSpeech(callerText);
  const explicitPhone = extractPhoneNumber(callerText);
  if (explicitPhone) {
    const explicitDigits = normalizePhoneForComparison(explicitPhone);
    const heardDigits = normalizePhoneForComparison(mismatch.heardPhone);
    const callerDigits = normalizePhoneForComparison(mismatch.callerPhone);
    if (explicitDigits === heardDigits || explicitDigits === callerDigits) {
      clearPhoneMismatch(draft, explicitDigits);
      return continueAfterPhoneConfirmed(draft);
    }
    setDraftPhoneFromCallerInput(session, draft, explicitDigits);
    return draft.phoneMismatchConfirmation ? buildPhoneMismatchQuestion(draft) : continueAfterPhoneConfirmed(draft);
  }

  if (isAffirmative(text) || /(\u4eca\u304b\u3051|\u304b\u3051\u3066|\u767a\u4fe1|\u3053\u306e\u756a\u53f7|\u7740\u4fe1|\u81ea\u5206\u306e\u756a\u53f7)/u.test(text)) {
    clearPhoneMismatch(draft, mismatch.callerPhone);
    return continueAfterPhoneConfirmed(draft);
  }

  if (/(\u4eca\u8a00\u3063\u305f|\u5148\u307b\u3069|\u4f1d\u3048\u305f|\u805e\u304d\u53d6\u3063\u305f|\u305d\u306e\u756a\u53f7|\u672b\u5c3e)/u.test(text) && text.includes(mismatch.heardLast4)) {
    clearPhoneMismatch(draft, mismatch.heardPhone);
    return continueAfterPhoneConfirmed(draft);
  }

  if (isFinalConfirmationChangeRequest(text) || /(\u9055\u3046|\u3061\u304c\u3046|\u3044\u3044\u3048|\u3044\u3084|\u5225)/u.test(text)) {
    draft.phone = undefined;
    draft.phoneMismatchConfirmation = undefined;
    draft.awaitingField = "phone";
    draft.awaitingFinalConfirmation = false;
    return "\u627f\u77e5\u3057\u307e\u3057\u305f\u3002SMS\u3092\u9001\u308b\u304a\u96fb\u8a71\u756a\u53f7\u309211\u6841\u3067\u3082\u3046\u4e00\u5ea6\u3086\u3063\u304f\u308a\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }

  return buildPhoneMismatchQuestion(draft);
}

function mergePhoneDigits(left, right) {
  const previous = normalizePhoneDigits(left);
  const current = normalizePhoneDigits(right);
  if (!previous) return current ? [current] : [];
  if (!current) return previous ? [previous] : [];
  const candidates = [previous + current, current];

  let overlap = 0;
  const maxOverlap = Math.min(previous.length, current.length);
  for (let size = 1; size <= maxOverlap; size += 1) {
    if (previous.slice(-size) === current.slice(0, size)) overlap = size;
  }
  if (overlap > 0) candidates.push(previous + current.slice(overlap));

  if (/^(?:070|080|090)/.test(previous) && previous.length === 7 && current.length === 4) {
    candidates.push(previous + current);
  }
  if (/^(?:070|080|090)/.test(previous) && previous.length === 3 && current.length === 8) {
    candidates.push(previous + current);
  }

  return [...new Set(candidates.map(normalizePhoneDigits).filter((digits) => digits.length <= 14))];
}

function isPhoneFragmentText(text) {
  const normalized = normalizeJapaneseSpeech(text);
  const digits = normalizePhoneDigits(text);
  if (/^(?:070|080|090)/.test(digits) && digits.length < 11) return true;
  return Boolean(digits) && (digits.length < 10 || /(\u96fb\u8a71|\u756a\u53f7|\u305d\u306e|\u7d9a\u304d|\u4e0b|\u6b8b\u308a)/u.test(normalized));
}

function buildIncompletePhoneReply(session) {
  const digits = normalizePhoneDigits(session.pendingPhoneDigits);
  if (/^(?:070|080|090)/.test(digits) && digits.length > 0 && digits.length < 11) {
    const remaining = 11 - digits.length;
    const suffix = remaining === 1 ? "\u3042\u30681\u6841\u8db3\u308a\u306a\u3044\u3088\u3046\u3067\u3059\u3002" : "\u307e\u3060" + remaining + "\u6841\u307b\u3069\u8db3\u308a\u306a\u3044\u3088\u3046\u3067\u3059\u3002";
    return "\u304a\u96fb\u8a71\u756a\u53f7\u304c" + digits.length + "\u6841\u307e\u3067\u805e\u3053\u3048\u3066\u3044\u307e\u3059\u3002" + suffix + "\u7d9a\u304d\u3001\u307e\u305f\u306f11\u6841\u3059\u3079\u3066\u3092\u3082\u3046\u4e00\u5ea6\u3086\u3063\u304f\u308a\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }
  return "\u9014\u4e2d\u3067\u5207\u308c\u3066\u3044\u308b\u305f\u3081\u3001\u304a\u96fb\u8a71\u756a\u53f7\u309211\u6841\u3067\u3082\u3046\u4e00\u5ea6\u3086\u3063\u304f\u308a\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
}

function mergeSplitPhoneNumber(session, callerText) {
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  if (!canCollectCustomerInfo(draft) || draft.awaitingField !== "phone") return;
  if (draft.phone && !isLikelyCustomerPhone(draft.phone)) {
    session.pendingPhoneDigits = normalizePhoneDigits(draft.phone);
    draft.phone = undefined;
  }

  const text = normalizeJapaneseSpeech(callerText);
  const digits = normalizePhoneDigits(callerText);
  if (!digits) return;

  if (isLikelyCustomerPhone(digits)) {
    setDraftPhoneFromCallerInput(session, draft, digits);
    session.pendingPhoneDigits = "";
    return;
  }

  const shouldTrack =
    draft.awaitingField === "phone" ||
    Boolean(session.pendingPhoneDigits) ||
    /(\u96fb\u8a71|\u756a\u53f7|\u305d\u306e|\u7d9a\u304d|\u4e0b|\u6b8b\u308a)/u.test(text) ||
    /^(?:070|080|090)/.test(digits);
  if (!shouldTrack) return;

  const previous = session.pendingPhoneDigits || "";
  const candidates = mergePhoneDigits(previous, digits);
  const complete = candidates.find(isLikelyCustomerPhone);
  if (complete) {
    setDraftPhoneFromCallerInput(session, draft, complete);
    session.pendingPhoneDigits = "";
    return;
  }

  const best = candidates
    .filter((candidate) => candidate.length < 11)
    .sort((left, right) => right.length - left.length)[0];
  session.pendingPhoneDigits = best || digits;
}

function isTherapistAvailabilityQuestion(text) {
  return /(\u8ab0|\u3069\u306a\u305f|\u3069\u306e\u5b50|\u5973\u306e\u5b50|\u30bb\u30e9\u30d4\u30b9\u30c8|\u62c5\u5f53|\u51fa\u52e4|\u304a\u3059\u3059\u3081|\u7a7a\u3044\u3066\u308b\u4eba|\u7a7a\u3044\u3066\u308b\u5b50|\u3044\u3051\u308b\u4eba|\u3044\u3051\u308b\u5b50|\u5bfe\u5fdc\u3067\u304d\u308b\u4eba|\u5bfe\u5fdc\u3067\u304d\u308b\u5b50).*(\u7a7a\u3044|\u3044\u308b|\u304a\u308b|\u3044\u3051|\u51fa\u52e4|\u304a\u3059\u3059\u3081|\u6559\u3048|\u78ba\u8a8d)|(\u51fa\u52e4\u8ab0|\u7a7a\u304d\u8ab0|\u8ab0\u3044\u308b|\u8ab0\u7a7a\u3044|\u8ab0\u304a\u308b|\u304a\u3059\u3059\u3081\u8ab0)/u.test(text);
}

function hasTherapistBookingActionText(text) {
  return /(\u4e88\u7d04|\u53d6\u308a\u305f\u3044|\u53d6\u308c|\u304a\u9858\u3044|\u5165\u308c|\u884c\u3051|\u5411\u304b|\u305d\u306e\u4eba\u3067|\u305d\u306e\u5b50\u3067|\u3053\u306e\u4eba\u3067|\u3053\u306e\u5b50\u3067|\u6307\u540d\u3067|\u672c\u6307\u540d\u3067|\u4e00\u4eba|1\u4eba|\u3058\u3083\u3042|\u305d\u308c\u3067)/u.test(text);
}

function isTherapistRecommendationQuestion(text) {
  return /(\u304a\u3059\u3059\u3081|\u30aa\u30b9\u30b9\u30e1|\u304a\u52e7\u3081|\u8ab0\u304c\u3044\u3044|\u3060\u308c\u304c\u3044\u3044|\u8ab0\u304c\u4eba\u6c17|\u4eba\u6c17\u306e\u5b50|\u3044\u3044\u5b50|\u5408\u3046\u5b50|\u4efb\u305b\u3089\u308c\u308b|\u7279\u5fb4|\u3069\u3093\u306a\u5b50|\u3069\u3093\u306a\u4eba|\u30bf\u30a4\u30d7|\u96f0\u56f2\u6c17|\u6027\u683c)/u.test(text);
}

function classifyReservationIntent(text, draft) {
  if (isTherapistPresenceQuestion(text)) return "therapist_availability";
  if (isTherapistRecommendationQuestion(text)) return "therapist_recommendation";
  if (isNominationMeaningQuestion(text)) return "nomination_explanation";
  if (["attention", "attentionConfirmed"].includes(draft?.awaitingField) && isAttentionConfirmationText(text)) return "attention_confirmed";
  return "";
}

function classifyDestructiveIntent(text) {
  const key = normalizeIntentKey(text);
  if (!key) return null;
  const exact = destructiveIntentTraining.byKey.get(key);
  if (exact) return exact;

  const fallback = [
    {
      intent: "cancel_intent",
      priority: 100,
      expectedAction: "\u4e88\u7d04\u5c0e\u7dda\u3092\u7d42\u4e86\u3059\u308b",
      forbiddenAction: "selected_therapist\u3078\u4fdd\u5b58\u3057\u306a\u3044",
      pattern: /(\u30ad\u30e3\u30f3\u30bb\u30eb|\u3084\u3081|\u3084\u3081\u3068|\u53d6\u308a\u6d88\u3057|\u767d\u7d19|\u4e00\u65e6\u5927\u4e08\u592b|\u3044\u3063\u305f\u3093\u5927\u4e08\u592b|\u4eca\u56de\u306f\u3044\u3044|\u4eca\u65e5\u306f\u3044\u3044|\u4e88\u7d04\u3044\u3089\u306a\u3044|\u3084\u3063\u3071\u306a\u3057|\u3084\u3081\u3068\u304d|\u3084\u3081\u3068\u304f|\u3084\u3081\u3068\u3044\u3046|\u3084\u3081\u3068\u3044\u3046\u306e|\u3084\u3081\u3068\u3044\u3046\u3093)/u
    },
    {
      intent: "referral_intent",
      priority: 90,
      expectedAction: "\u7d39\u4ecb\u8005\u540d\u3092\u805e\u304f",
      forbiddenAction: "\u65e5\u6642\u78ba\u8a8d\u3078\u9032\u307e\u306a\u3044",
      pattern: /(\u7d39\u4ecb|\u53cb\u9054\u306b\u805e\u3044\u3066|\u53cb\u9054\u304b\u3089|\u77e5\u308a\u5408\u3044\u304b\u3089|\u30c4\u30ec\u304b\u3089|\u5148\u8f29\u304b\u3089|\u540c\u50da\u304b\u3089)/u
    },
    {
      intent: "name_clarification_question",
      priority: 90,
      expectedAction: "\u8aac\u660e\u3057\u3066\u518d\u5ea6\u540d\u524d\u3092\u805e\u304f",
      forbiddenAction: "customer_name\u3078\u4fdd\u5b58\u3057\u306a\u3044",
      pattern: /(\u540d\u524d|\u4e88\u7d04\u8005|\u6c0f\u540d|\u540d\u5b57|\u82d7\u5b57|\u30d5\u30eb\u30cd\u30fc\u30e0).*(\u50d5|\u4ffa|\u81ea\u5206|\u8ab0|\u4f55|\u3069\u3063\u3061|\u5fc5\u8981|\u3044\u308b|\u8a00\u3048\u3070|\u3067\u3044\u3044|\u3067\u3059\u304b)/u
    },
    {
      intent: "recommendation_question",
      priority: 80,
      expectedAction: "\u304a\u3059\u3059\u3081\u6848\u5185\u5f8c\u306b\u5e0c\u671b\u65e5\u6642\u3092\u805e\u304f",
      forbiddenAction: "customer_name\u3078\u4fdd\u5b58\u3057\u306a\u3044",
      pattern: /(\u304a\u3059\u3059\u3081|\u4eba\u6c17|\u8ab0\u304c\u3044\u3044|\u521d\u3081\u3066\u306a\u3089\u8ab0|\u521d\u3081\u3066.*\u8ab0|\u3044\u3044\u5b50|\u8a55\u5224|\u30d5\u30ea\u30fc\u306a\u3089\u8ab0|\u304a\u307e\u304b\u305b\u306a\u3089\u8ab0)/u
    }
  ]
    .filter((item) => item.pattern.test(text))
    .sort((left, right) => right.priority - left.priority);

  return fallback[0] ?? null;
}

async function applyDateTimeGuard(session, callerText, context) {
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  const rawText = String(callerText ?? "");
  if (isPhoneNumberDominantText(rawText)) return "";
  const text = normalizeJapaneseSpeech(rawText).replace(/\s+/g, "");
  const normalizedDateTimeText = normalizeDateTimeDigits(normalizeJapaneseSpeech(rawText));
  const guard = classifyDateTimeGuard(text);
  if (guard) {
    draft.datetime_guard_category = guard.category;
    draft.datetime_guard_priority = guard.priority;
  }

  const unavailableContextReply = await maybeReplyUnavailableContext(session, context, rawText);
  if (unavailableContextReply) return unavailableContextReply;

  const pendingTimeResolution = resolvePendingTimeConfirmation(draft, rawText);
  if (pendingTimeResolution) {
    applyResolvedPendingTimeToDraft(draft, pendingTimeResolution);
    const availabilityReply = draft.startsAt ? await formatRequestedTimeAvailabilityAnswer(session, context, rawText) : "";
    const reply = availabilityReply || buildShortNextQuestion(draft) || (formatJstTimeText(draft.requested_time) + "\u3067\u3059\u306d\u3002\u3054\u5e0c\u671b\u306e\u304a\u65e5\u306b\u3061\u306f\u3044\u3064\u3067\u3059\u304b\uff1f");
    logConversationState(session, "pending_time_confirmation_resolved", {
      raw_utterance: callerText,
      assistant_response: reply,
      parsed_date: draft.requested_date ?? null,
      parsed_time: draft.requested_time ?? null,
      parsed_datetime_jst: draft.requested_datetime ?? null,
      time_source: draft.time_source,
      time_confidence: draft.time_confidence,
      next_action: draft.startsAt ? "check_availability" : "ask_date"
    });
    return reply;
  }

  const parsedDate = parseRequestedDateParts(normalizedDateTimeText);
  const parsedTime = parseRequestedTimeParts(normalizedDateTimeText, context?.store);
  if (parsedTime && parsedTime.confidence < TIME_CONFIDENCE_THRESHOLD) {
    if (parsedDate) applyParsedDateOnlyToDraft(draft, parsedDate);
    draft.requested_time = undefined;
    draft.requested_datetime = undefined;
    draft.startsAt = undefined;
    draft.startsAtText = "";
    draft.pending_time_candidate = parsedTime.time;
    draft.pending_time_confirmation = {
      rawHour: parsedTime.rawHour,
      parsedTime: parsedTime.time,
      confidence: parsedTime.confidence
    };
    draft.datetime_confirmation_required = {
      type: "time_ambiguity",
      rawHour: parsedTime.rawHour,
      parsedTime: parsedTime.time,
      confidence: parsedTime.confidence
    };
    draft.time_source = parsedTime.source;
    draft.time_confidence = parsedTime.confidence;
    draft.awaitingField = "startsAt";
    const reply = formatTimeAmbiguityQuestion(rawText, parsedTime);
    logConversationState(session, "datetime_guard_1000", {
      raw_utterance: callerText,
      assistant_response: reply,
      parsed_date: parsedDate?.iso ?? null,
      parsed_time: parsedTime.time,
      date_source: parsedDate?.source ?? draft.date_source ?? null,
      time_source: parsedTime.source,
      date_confidence: parsedDate?.confidence ?? draft.date_confidence ?? null,
      time_confidence: parsedTime.confidence,
      next_action: "confirm_time_ambiguity",
      error_reason: "time_confidence_below_threshold"
    });
    return reply;
  }

  if (guard?.category === "availability_search_question") {
    const reply = await buildAvailabilitySearchReply(session, context, rawText);
    logConversationState(session, "datetime_guard_1000", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "availability_search",
      error_reason: "availability_search_question"
    });
    return reply;
  }

  if (guard?.category === "therapist_false_positive") {
    draft.therapist_match_guarded = true;
    draft.therapist_match_confidence = 0;
    if (isNoNominationText(text)) {
      draft.nominationIntent = false;
      draft.therapistName = undefined;
      session.selectedTherapist = undefined;
      return "";
    }
    if (isAvailabilitySearchQuestionText(text) || isTherapistAvailabilityQuestion(text)) {
      const reply = await buildAvailabilitySearchReply(session, context, rawText);
      logConversationState(session, "therapist_false_positive_guard", {
        user_utterance: callerText,
        assistant_response: reply,
        next_action: "availability_search",
        error_reason: "therapist_false_positive"
      });
      return reply;
    }
  }

  if (guard?.category === "confirmation_required" && isLowConfidenceConfirmationText(text)) {
    draft.awaitingField = "startsAt";
    const reply = "\u78ba\u8a8d\u3067\u3059\u306d\u3002\u4e88\u7d04\u3068\u3057\u3066\u78ba\u5b9a\u305b\u305a\u306b\u78ba\u8a8d\u3057\u307e\u3059\u3002\u3054\u5e0c\u671b\u306e\u65e5\u306b\u3061\u3068\u304a\u6642\u9593\u3092\u3082\u3046\u4e00\u5ea6\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
    logConversationState(session, "datetime_guard_1000", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "clarify_low_confidence",
      error_reason: "confirmation_required"
    });
    return reply;
  }

  return "";
}

function classifyDateTimeGuard(text) {
  const key = normalizeIntentKey(text);
  const exact = datetimeGuardTraining.byKey.get(key);
  if (exact) return exact;

  const fallbacks = [
    {
      category: "availability_search_question",
      priority: 98,
      expectedAction: "availability_search_mode=true",
      forbiddenAction: "repeat_unavailable_response",
      pattern: isAvailabilitySearchQuestionText
    },
    {
      category: "therapist_false_positive",
      priority: 96,
      expectedAction: "block_low_confidence_therapist_match",
      forbiddenAction: "partial_match_to_therapist",
      pattern: isTherapistFalsePositiveText
    },
    {
      category: "time_ambiguity_guard",
      priority: 95,
      expectedAction: "confirm_low_confidence_time",
      forbiddenAction: "infer_pm_without_confirmation",
      pattern: isAmbiguousClockTimeText
    },
    {
      category: "relative_date_context",
      priority: 95,
      expectedAction: "update_requested_date_from_current_date",
      forbiddenAction: "keep_previous_requested_date",
      pattern: (value) => /(\d{1,2}|\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)\u65e5\u5f8c|\u660e\u65e5|\u660e\u5f8c\u65e5|\u3042\u3057\u305f|\u3042\u3055\u3063\u3066|\u6765\u9031|\u518d\u6765\u9031|\u4eca\u9031|\u6765\u6708|\u6708\u672b/u.test(value)
    },
    {
      category: "confirmation_required",
      priority: 100,
      expectedAction: "clarification_required",
      forbiddenAction: "save_low_confidence_value",
      pattern: isLowConfidenceConfirmationText
    }
  ];

  return fallbacks.find((item) => item.pattern(text)) ?? null;
}

function applyParsedDateOnlyToDraft(draft, parsedDate) {
  draft.requested_date = parsedDate.iso;
  draft.last_requested_date = parsedDate.iso;
  draft.date_source = parsedDate.source;
  draft.date_confidence = parsedDate.confidence;
}

async function handleNaturalAvailabilityQuestion(session, context, callerText) {
  const raw = String(callerText ?? "");
  const normalized = normalizeJapaneseSpeech(raw);
  const text = normalized.replace(/\s+/g, "");
  if (!isNaturalAvailabilityQuestion(text)) return "";

  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  if (shouldKeepReservationStatePriority(draft, raw, text)) return "";
  if (hasExplicitAvailabilityTime(raw, context?.store)) return "";

  const normalizedDateTimeText = normalizeDateTimeDigits(normalized);
  const parsedDate = parseRequestedDateParts(normalizedDateTimeText);
  if (parsedDate) {
    applyParsedDateOnlyToDraft(draft, {
      ...parsedDate,
      source: parsedDate.source + "_availability_question"
    });
    draft.requested_time = undefined;
    draft.last_requested_time = undefined;
    draft.requested_datetime = undefined;
    draft.last_requested_datetime = undefined;
    draft.startsAt = undefined;
    draft.startsAtText = "";
    draft.availability_query_datetime = undefined;
    draft.availabilityCheckResult = undefined;
    draft.allowEarlierAlternative = true;
    clearSuggestedCandidate(draft);
  }

  const noSameDayShiftReply = await maybeReplyNoSameDayShiftDirect(session, context, text);
  if (noSameDayShiftReply) return noSameDayShiftReply;

  const reply = await buildAvailabilitySearchReply(session, context, raw);
  logConversationState(session, "natural_availability_question", {
    user_utterance: raw,
    assistant_response: reply,
    parsed_date: parsedDate?.iso ?? draft.requested_date ?? null,
    next_action: "availability_search"
  });
  return reply;
}

function isNaturalAvailabilityQuestion(text) {
  if (!text) return false;
  if (/(LINE|ライン|本名|個人|連絡先|店外)/u.test(text) || isCourseQuestion(text) || isStoreLocationQuestion(text)) return false;
  if (/(最短|一番早|いつ空|いつ行け|いつぐ|いつごろ|いつが開|いつ.*開|行ける日|空いてる日|空きある日|空き枠|空いてる枠|誰かい|誰か空|空いてる人|空いてる子|一番近い)/u.test(text)) return true;
  const mentionsDate = /(今日|本日|明日|あした|明後日|あさって|来週|今週|週末|\d{1,2}日|[日月火水木金土]曜)/u.test(text);
  const asksAvailability = /(空き|空い|開い|あい|行け|行き|いけ|いき|入れ|取れ|予約|お願い|できます|可能|大丈夫)/u.test(text);
  if (mentionsDate && asksAvailability) return true;
  return asksAvailability && /(あります|ある|います|できる|できます|ですか|かな|かね|[？?])/u.test(text);
}

function shouldKeepReservationStatePriority(draft, rawText, text) {
  if (!draft) return false;
  if (draft.awaitingFinalConfirmation) return true;
  if (draft.suggestedStartsAt && (isSuggestedCandidateConfirmationQuestion(text) || isCandidateClarificationText(text) || /(その時間|それ|候補)/u.test(text))) return true;
  if (draft.awaitingField === "phone" && normalizePhoneDigits(rawText)) return true;
  if (draft.awaitingField === "firstVisit" && extractFirstVisit(rawText, "firstVisit") !== undefined) return true;
  if (["attention", "attentionConfirmed"].includes(draft.awaitingField) && isAttentionConfirmationText(text)) return true;
  return false;
}

function hasExplicitAvailabilityTime(rawText, store) {
  const text = normalizeDateTimeDigits(normalizeJapaneseSpeech(rawText));
  const parsedTime = parseRequestedTimeParts(text, store);
  return Boolean(parsedTime && parsedTime.confidence >= TIME_CONFIDENCE_THRESHOLD);
}

async function buildAvailabilitySearchReply(session, context, callerText) {
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  draft.availability_search_mode = true;
  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
  const searchWholeRequestedDay = shouldSearchWholeRequestedDay(draft, callerText);
  draft.allowEarlierAlternative = searchWholeRequestedDay;
  const searchFrom = searchWholeRequestedDay ? undefined : getAvailabilitySearchFrom(draft, callerText);
  draft.alternative_search_from_datetime = searchFrom ? formatJstDateTimeOffset(searchFrom) : null;
  const therapistName = draft.therapist_match_confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD ? draft.therapistName : undefined;
  const dayParts = getAvailabilitySearchDayParts(draft);
  const nextSlot = await findNextAvailableSlot(session, context, dayParts, searchFrom, therapistName);
  const prefix = "\u78ba\u8a8d\u3057\u307e\u3059\u3002";
  if (!nextSlot) {
    clearSuggestedCandidate(draft);
    draft.availabilityCheckResult = { ok: false, reason: "NO_AVAILABLE_CANDIDATE" };
    const noFutureShiftReply = buildNoFutureShiftReply(draft, dayParts, prefix);
    if (noFutureShiftReply) return noFutureShiftReply;
    return prefix + "\u73fe\u5728\u78ba\u8a8d\u3067\u304d\u308b\u7a7a\u304d\u5019\u88dc\u304c\u3042\u308a\u307e\u305b\u3093\u3002\u5225\u306e\u65e5\u306b\u3061\u304b\u6642\u9593\u5e2f\u306a\u3089\u304a\u8abf\u3079\u3067\u304d\u307e\u3059\u3002\u3054\u5e0c\u671b\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  if (!isCandidateAllowedForDraft(draft, nextSlot)) {
    clearSuggestedCandidate(draft);
    draft.availabilityCheckResult = { ok: false, reason: "NO_ALLOWED_CANDIDATE" };
    return prefix + "\u3054\u5e0c\u671b\u65e5\u6642\u4ee5\u964d\u3067\u78ba\u8a8d\u3067\u304d\u308b\u7a7a\u304d\u5019\u88dc\u304c\u3042\u308a\u307e\u305b\u3093\u3002\u5225\u306e\u65e5\u306b\u3061\u304b\u6642\u9593\u5e2f\u306a\u3089\u304a\u8abf\u3079\u3067\u304d\u307e\u3059\u3002\u3054\u5e0c\u671b\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  setSuggestedCandidate(draft, nextSlot);
  return prefix + "\u6700\u77ed\u3067\u3059\u3068" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
}

function getAvailabilitySearchDayParts(draft) {
  if (draft?.startsAt) return getJstDatePartsFromDate(draft.startsAt);
  const match = String(draft?.requested_date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (match) return normalizeJstDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  return getJstTodayParts();
}

function getAvailabilitySearchFrom(draft, callerText) {
  const text = normalizeJapaneseSpeech(callerText).replace(/\s+/g, "");
  if (/(\u305d\u306e\u65e5|\u540c\u3058\u65e5|\u305d\u306e\u6642\u9593|\u3055\u3063\u304d|\u524d\u306e)/u.test(text) && draft?.startsAt) return new Date(draft.startsAt);
  if (/(\d{1,2}\s*\u65e5|\u660e\u65e5|\u660e\u5f8c\u65e5|\u3042\u3057\u305f|\u3042\u3055\u3063\u3066|\u6765\u9031|\u4eca\u9031|\u66dc)/u.test(text) && draft?.startsAt) return new Date(draft.startsAt);
  return draft?.startsAt ? new Date(draft.startsAt) : undefined;
}

function shouldSearchWholeRequestedDay(draft, callerText) {
  if (!draft?.startsAt || draft.availabilityCheckResult?.ok !== false) return false;
  const text = normalizeJapaneseSpeech(callerText).replace(/\s+/g, "");
  if (/(以降|より後|この時間より後|その時間より後|後ろ|遅め|遅い時間)/u.test(text)) return false;
  return /(別の時間|ほか|他|別|どこか|どっか|枠|空き|入れ|入ってない|どこも)/u.test(text);
}

function buildNoFutureShiftReply(draft, dayParts, prefix = "") {
  const diagnostics = draft?.availabilitySearchDiagnostics;
  if (!diagnostics || diagnostics.shiftCount !== 0) return "";
  const requestedParts = dayParts ?? getJstTodayParts();
  if (isSameJstDateParts(requestedParts, getJstTodayParts())) {
    return prefix + "\u672c\u65e5\u3053\u308c\u4ee5\u964d\u306b\u4e88\u7d04\u53ef\u80fd\u306a\u51fa\u52e4\u30b7\u30d5\u30c8\u304c\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u5225\u306e\u65e5\u306b\u3061\u304b\u6642\u9593\u5e2f\u306a\u3089\u304a\u8abf\u3079\u3067\u304d\u307e\u3059\u3002\u3054\u5e0c\u671b\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  return prefix + formatJstDateOnlyJa(formatJstDateIso(requestedParts)) + "\u306f\u4e88\u7d04\u53ef\u80fd\u306a\u51fa\u52e4\u30b7\u30d5\u30c8\u304c\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u5225\u306e\u65e5\u306b\u3061\u304b\u6642\u9593\u5e2f\u306a\u3089\u304a\u8abf\u3079\u3067\u304d\u307e\u3059\u3002\u3054\u5e0c\u671b\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
}

function isSameJstDateParts(left, right) {
  return Boolean(left && right && left.year === right.year && left.month === right.month && left.day === right.day);
}

async function maybeReplyUnavailableContext(session, context, callerText) {
  const draft = session.reservationDraft;
  if (!draft || draft.availabilityCheckResult?.ok !== false) return "";
  const normalizedDateTimeText = normalizeDateTimeDigits(normalizeJapaneseSpeech(callerText));
  const parsedDate = parseRequestedDateParts(normalizedDateTimeText);
  const parsedTime = parseRequestedTimeParts(normalizedDateTimeText, context?.store);
  const text = normalizeJapaneseSpeech(callerText).replace(/[、。！？!?？\s]/g, "");
  if (!text) return "";

  if (isUnavailableStopText(text)) {
    const reply = buildUnavailableStopReply(draft);
    logConversationState(session, "unavailable_context_reply", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "close_without_reservation",
      error_reason: "customer_stopped_after_unavailable"
    });
    return reply;
  }

  const shouldSearchAlternativeDay = Boolean(parsedDate && !parsedTime);
  if (!isUnavailableClarificationQuestion(text) && !shouldSearchAlternativeDay) return "";

  draft.availability_search_mode = true;
  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
  draft.allowEarlierAlternative = true;
  if (shouldSearchAlternativeDay) {
    applyParsedDateOnlyToDraft(draft, parsedDate);
    draft.requested_time = undefined;
    draft.last_requested_time = undefined;
    draft.requested_datetime = undefined;
    draft.last_requested_datetime = undefined;
    draft.availability_query_datetime = undefined;
    draft.startsAt = undefined;
    draft.startsAtText = "";
  }
  const therapistName = draft.therapist_match_confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD ? draft.therapistName : undefined;
  const searchDayParts = parsedDate?.parts ?? (draft.startsAt ? getJstDatePartsFromDate(draft.startsAt) : getJstTodayParts());
  const nextSlot = await findNextAvailableSlot(session, context, searchDayParts, undefined, therapistName);
  const slot = draft.startsAt ? formatRequestedSlotLabel(draft.startsAt) : formatJstDateOnlyJa(formatJstDateIso(searchDayParts));
  let reply = slot + "で確認します。";
  if (draft.startsAt) reply = slot + "は現在ご案内できません。";
  if (nextSlot && isCandidateAllowedForDraft(draft, nextSlot)) {
    setSuggestedCandidate(draft, nextSlot);
    reply += (draft.startsAt ? "同じ日も含めて確認すると、" : "") + "直近では" + formatDateTimeJa(nextSlot.startsAt) + "に" + nextSlot.therapist.displayName + "さんがご案内可能です。" + buildCandidateOfferInstruction(draft, "time");
  } else {
    clearSuggestedCandidate(draft);
    reply += "現在、条件に合う別候補も確認できませんでした。別の日にちや時間帯があれば確認します。";
  }
  logConversationState(session, "unavailable_context_reply", {
    user_utterance: callerText,
    assistant_response: reply,
    next_action: nextSlot ? "suggest_alternative_candidate" : "ask_alternative_datetime",
    error_reason: "unavailable_clarification"
  });
  return reply;
}

function isUnavailableClarificationQuestion(text) {
  return /(開いてない|空いてない|空きない|入ってない|入れない|どこも|枠は|空きは|開いてる日|空いてる日|開いてる時間|空いてる時間|空いてる枠|空き枠|あるんですか|ありますか|別の時間|別時間|ほか|他|どこか|どっか)/u.test(text);
}

function isUnavailableStopText(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/[、。！？!?？\s]/g, "");
  if (!normalized) return false;
  if (/(大丈夫ですか|大丈夫でしょうか|大丈夫かな)/u.test(normalized)) return false;
  if (isCourseOrOptionContinuationText(normalized)) return false;
  if (/(今の番号|この番号|おかけの番号|かけている番号|着信番号|発信番号|自分の番号)/u.test(normalized)) return false;
  if (/^(?:はい|ええ|うん)?(?:ありがとう|ありがとうございます|ありがと|どうも|失礼します|失礼いたします)$/u.test(normalized)) return true;
  if (/(大丈夫|いいです|結構|やめ|なし|また|検討|切ります|切る|ありがとう|ありがと|失礼)/u.test(normalized)) {
    return !/(ありますか|できますか|可能ですか|誰|いつ|何時|何日|空き|予約|行け|入れ|取れ|お願い|ください)/u.test(normalized);
  }
  return false;
}

function isCourseOrOptionContinuationText(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/[、。！？!?？\s]/g, "");
  if (!normalized) return false;
  if (/(コース|オプション|追加|付け|つけ|ディープリンパ|リンパ|鼠径部|そけい|ホイップ|フェザー|カエル脚|四つん這い|マーメイド|ベビードール|マイクロビキニ|ノーブラ|ノーパン|トップレス|オールヌード|おっぱいスタンプ)/u.test(normalized)) {
    return /(お願いします|お願い|ください|できますか|可能ですか|いいですか|ありますか|付け|つけ|追加|どうしよう|どんな|何がある|なにがある)/u.test(normalized);
  }
  return /(?:60|90|120)分(?:コース)?(?:で|に|の)?(?:お願いします|お願い|いいですか|ください|どうしよう)/u.test(normalized);
}

function buildUnavailableStopReply(draft) {
  draft.awaitingField = "cancelled";
  draft.awaitingFinalConfirmation = false;
  draft.cancelled = true;
  clearSuggestedCandidate(draft);
  return "承知しました。今回は仮予約を作成せず終了します。また必要でしたら別日時で確認します。お電話ありがとうございました。失礼いたします。";
}

function formatTimeAmbiguityQuestion(callerText, parsedTime) {
  const rawHour = parsedTime?.rawHour ?? extractSpokenHour(callerText) ?? parsedTime?.hour ?? 10;
  return String(rawHour) + "\u6642\u3050\u3089\u3044\u3067\u3059\u306d\u3002\u5348\u524d" + String(rawHour) + "\u6642\u304b\u591c" + String(rawHour) + "\u6642\u3001\u3069\u3061\u3089\u3092\u3054\u5e0c\u671b\u3067\u3059\u304b\uff1f";
}

function extractSpokenHour(value) {
  const text = normalizeDateTimeDigits(normalizeJapaneseSpeech(value));
  const match = text.match(/([0-2]?\d)\s*\u6642/u);
  return match ? Number(match[1]) : undefined;
}

function resolvePendingTimeConfirmation(draft, callerText) {
  const pending = draft?.datetime_confirmation_required?.type === "time_ambiguity"
    ? draft.datetime_confirmation_required
    : draft?.pending_time_confirmation;
  if (!pending) return null;
  const text = normalizeJapaneseSpeech(callerText).replace(/\s+/g, "");
  const wantsMorning = /(\u5348\u524d|\u5348\u524d\u4e2d|\u671d|\u3042\u3055|\u65e9\u3044\u65b9|\u524d\u306e\u65b9)/u.test(text);
  const wantsEvening = /(\u591c|\u3088\u308b|\u6669|\u591c\u306e\u65b9|\u5348\u5f8c|\u9045\u3044\u65b9|\u5f8c\u308d\u306e\u65b9)/u.test(text);
  if (wantsMorning === wantsEvening) return null;

  const rawHour = Number(pending.rawHour ?? extractSpokenHour(pending.parsedTime) ?? 10);
  if (!Number.isFinite(rawHour)) return null;
  const [parsedHour, parsedMinute] = String(pending.parsedTime ?? "").split(":").map(Number);
  const minute = Number.isFinite(parsedMinute) ? parsedMinute : 0;
  const hour = wantsMorning ? normalizeMorningHour(rawHour) : normalizeEveningHour(rawHour);
  return {
    time: String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
    source: wantsMorning ? "pending_time_confirmation_morning" : "pending_time_confirmation_evening",
    confidence: 0.96,
    rawHour,
    parsedHour: Number.isFinite(parsedHour) ? parsedHour : null
  };
}

function normalizeMorningHour(rawHour) {
  if (rawHour === 12) return 0;
  return rawHour >= 0 && rawHour < 12 ? rawHour : rawHour % 12;
}

function normalizeEveningHour(rawHour) {
  if (rawHour >= 12) return rawHour;
  return rawHour + 12;
}

function applyResolvedPendingTimeToDraft(draft, resolution) {
  draft.requested_time = resolution.time;
  draft.last_requested_time = resolution.time;
  draft.time_source = resolution.source;
  draft.time_confidence = resolution.confidence;
  draft.pending_time_candidate = undefined;
  draft.pending_time_confirmation = undefined;
  draft.datetime_confirmation_required = undefined;
  draft.datetime_ambiguous = undefined;
  draft.datetime_question_only = false;
  draft.awaitingFinalConfirmation = false;

  const effectiveDate = draft.requested_date ?? draft.last_requested_date;
  if (effectiveDate) {
    const startsAt = buildStartsAtFromDateTime(effectiveDate, resolution.time);
    draft.startsAt = startsAt;
    draft.startsAtText = formatDateTimeJa(startsAt);
    draft.requested_datetime = formatJstDateTimeOffset(startsAt);
    draft.last_requested_datetime = draft.requested_datetime;
    draft.availability_query_datetime = draft.requested_datetime;
    draft.availabilityCheckResult = undefined;
    clearSuggestedCandidate(draft);
    clearNonExplicitTherapistSelection(draft);
  } else {
    draft.startsAt = undefined;
    draft.startsAtText = "";
    draft.requested_datetime = undefined;
    draft.availability_query_datetime = undefined;
  }
  draft.awaitingField = "startsAt";
}

function setSuggestedCandidate(draft, nextSlot) {
  if (!draft || !nextSlot) return;
  if (!isCandidateAllowedForDraft(draft, nextSlot)) return;
  draft.candidateOfferSequence = Number(draft.candidateOfferSequence ?? 0) + 1;
  draft.suggestedCandidateOfferKey = [new Date(nextSlot.startsAt).toISOString(), nextSlot.therapist.displayName].join("|");
  draft.suggestedStartsAt = nextSlot.startsAt;
  draft.suggestedTherapistName = nextSlot.therapist.displayName;
  draft.suggested_therapist = nextSlot.therapist.displayName;
  draft.suggestedNominationIntent = Boolean(
    draft.nominationIntent === true &&
      draft.therapistName &&
      nextSlot.therapist.displayName === draft.therapistName &&
      draft.selected_therapist_source === "explicit_user_nomination"
  );
}

function isCandidateAllowedForDraft(draft, nextSlot) {
  if (!draft || !nextSlot?.startsAt) return false;
  if (!draft.startsAt) return true;
  if (draft.allowEarlierAlternative && isSameJstDay(nextSlot.startsAt, getJstDatePartsFromDate(draft.startsAt))) return true;
  return new Date(nextSlot.startsAt).getTime() >= new Date(draft.startsAt).getTime();
}

function clearSuggestedCandidate(draft) {
  if (!draft) return;
  draft.suggestedStartsAt = undefined;
  draft.suggestedTherapistName = undefined;
  draft.suggested_therapist = undefined;
  draft.suggestedNominationIntent = undefined;
  draft.suggestedCandidateOfferKey = undefined;
  draft.allowEarlierAlternative = false;
}

function isPlainSuggestedCandidateAcceptance(text) {
  const normalized = normalizeDateTimeDigits(normalizeJapaneseSpeech(text)).replace(/\s+/g, "");
  if (!normalized) return false;
  if (/^(?:はい|うん|そうですね|じゃあ|では|それなら|なら)?(?:その時間|この時間|その候補|この候補|それ|そちら)で(?:お願いします|お願い|大丈夫です|大丈夫|いいです|進めてください|進めて|取ってください|取って|予約お願いします|予約)?$/u.test(normalized)) return true;
  if (/(その時間|この時間|その候補|この候補|それ|そちら).*(お願い|お願いします|大丈夫|はい|それで|取って|お取り|予約)/u.test(normalized)) return true;
  if (hasDateTimeCue(normalized)) return false;
  if (/(じゃない|ではない|違う|ちがう|無理|むり|やめ|待って|まって)/u.test(normalized)) return false;
  if (/(空いて|あいて|誰|だれ|いつ|何時|なんじ|何日|なんにち|変更|キャンセル|やっぱ|別|他|ほか|午前|午後|朝|昼|夕方|夜|コース|分|料金|名前|電話|番号)/u.test(normalized)) {
    return false;
  }
  if (isSoftSuggestedCandidateAcceptance(normalized)) return true;
  return isAffirmative(normalized);
}

function isSuggestedCandidateExactTimeAcceptance(text, draft, context) {
  if (!draft?.suggestedStartsAt) return false;
  const normalized = normalizeDateTimeDigits(normalizeJapaneseSpeech(text)).replace(/\s+/g, "");
  if (!normalized) return false;
  if (!/(お願い|お願いします|大丈夫|いいです|取って|予約|進めて|はい|それで|そこで|その時間|この時間)/u.test(normalized)) return false;
  if (/(じゃない|ではない|違う|ちがう|無理|むり|やめ|待って|まって|変更|キャンセル|別|他|ほか|空いて|あいて|ありますか|できますか|ですか|何時|なんじ|いつ)/u.test(normalized)) return false;
  const parsed = parseRequestedTimeParts(normalized, context?.store);
  if (!parsed || parsed.confidence < TIME_CONFIDENCE_THRESHOLD) return false;
  const suggested = getJstDateTimePartsFromDate(draft.suggestedStartsAt);
  return parsed.hour === suggested.hour && parsed.minute === suggested.minute;
}

function isSoftSuggestedCandidateAcceptance(text) {
  return /^(?:そうですね|そうです|それで|そちらで|その枠で|この枠で|その時間で|この時間で|お願いします|お願いできますか|お願いしていいですか|それでお願いします|それで大丈夫です|それで大丈夫|それでいいです|それでいい|はいお願いします|うんお願いします)$/u.test(text);
}

function hasDateTimeCue(text) {
  return /(\d{1,2}日|\d{1,2}\/\d{1,2}|\d{1,2}時|\d{1,2}:\d{2}|今日|本日|明日|あした|明後日|あさって|昨日|来週|再来週|今週|来月|月末|週末|月曜|火曜|水曜|木曜|金曜|土曜|日曜|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|午前|午後|朝|昼|夕方|夜|早め|遅め|最短|今から|あと\d+分|\d+日後)/u.test(text);
}

function clearNonExplicitTherapistSelection(draft) {
  if (!draft) return;
  if (!draft.therapistName) return;
  if (draft.selected_therapist_source === "explicit_user_nomination") return;
  draft.therapistName = undefined;
  if (draft.nominationIntent === true) draft.nominationIntent = undefined;
  draft.selected_therapist_source = undefined;
}

function isAmbiguousClockTimeText(text) {
  const parsed = parseRequestedTimeParts(normalizeDateTimeDigits(text), undefined);
  return Boolean(parsed && parsed.confidence < TIME_CONFIDENCE_THRESHOLD);
}

function isAvailabilitySearchQuestionText(text) {
  return /(\u7a7a\u3044\u3066\u308b\u65e5|\u958b\u3044\u3066\u308b\u65e5|\u3042\u3044\u3066\u308b\u65e5|\u7a7a\u3044\u3066\u308b\u6642\u9593|\u958b\u3044\u3066\u308b\u6642\u9593|\u3042\u3044\u3066\u308b\u6642\u9593|\u7a7a\u3044\u3066\u308b\u67a0|\u958b\u3044\u3066\u308b\u67a0|\u7a7a\u304d\u67a0|\u7a7a\u304d\u5019\u88dc|\u5019\u88dc|\u3044\u3064.*\u7a7a\u3044|\u3044\u3064.*\u958b\u3044|\u3044\u3064\u3050.*\u958b\u3044|\u3044\u3064\u3054\u308d.*\u7a7a\u3044|\u6700\u77ed|\u4e00\u756a\u65e9\u3044|\u4e00\u756a\u8fd1\u3044|\u4e00\u756a\u8fd1\u304f|\u4e88\u7d04\u3067\u304d\u308b\u65e5|\u4f55\u6642\u306a\u3089|\u3069\u306e\u65e5\u306a\u3089|\u5225\u306e\u65e5|\u5225\u306e\u6642\u9593|\u4ed6\u306e\u6642\u9593|\u305d\u306e\u6642\u9593.*\u4ee5\u5916|\u305d\u308c.*\u4ee5\u5916|\u4ed6\u306b\u7a7a\u304d|\u7a7a\u3044\u3066\u308b\u4eba|\u8ab0\u304b\u7a7a\u3044|\u8ab0\u304b\u3044\u306a\u3044|\u7a7a\u3044\u3066\u308b\u5b50|\u67a0\u306f|\u7a7a\u304d\u306f|\u5165\u308c\u308b|\u5165\u3063\u3066\u306a\u3044)/u.test(text);
}

function isTherapistFalsePositiveText(text) {
  if (/\u304b\u306a(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)(?:\u3067|\u6307\u540d|\u304a\u9858\u3044|\u7a7a\u3044|\u3044\u307e\u3059|\u3044\u308b)/u.test(text)) return false;
  return /(\u304b\u306a\u3044|\u304b\u306a\u308a|\u305d\u3053\u3058\u3083|\u305d\u3053\u3058\u3083\u306a\u3044|\u4ed6\u306a\u3044|\u7a7a\u304d\u306a\u3044|\u8ab0\u3067\u3082\u3044\u3044|\u8ab0\u3067\u3082\u5927\u4e08\u592b|\u30d5\u30ea\u30fc\u3067\u3044\u3044|\u30d5\u30ea\u30fc\u3067\u5927\u4e08\u592b|\u6307\u540d\u306a\u3057|\u6307\u540d\u306f\u3044\u3089\u306a\u3044|\u304a\u307e\u304b\u305b|\u7a7a\u3044\u3066\u308b\u4eba|\u7a7a\u3044\u3066\u308b\u5b50|\u8ab0\u304b\u3044\u306a\u3044|\u8ab0\u3067\u3082)/u.test(text);
}

function isNoNominationText(text) {
  return /(\u30d5\u30ea\u30fc|\u6307\u540d\u306a\u3057|\u6307\u540d\u306f\u3044\u3089\u306a\u3044|\u8ab0\u3067\u3082\u3044\u3044|\u8ab0\u3067\u3082\u5927\u4e08\u592b|\u304a\u307e\u304b\u305b)/u.test(text);
}

function buildCourseInfoReply(draft, courses) {
  const menu = formatCourseMenu(courses ?? draft?.availableCourses ?? []);
  if (draft?.suggestedStartsAt) {
    const startsAt = new Date(draft.suggestedStartsAt);
    const therapist = draft.suggestedTherapistName ? draft.suggestedTherapistName + "\u3055\u3093" : "\u62c5\u5f53\u5019\u88dc";
    return (menu + " \u73fe\u5728\u306e\u5019\u88dc\u306f" + formatDateTimeJa(startsAt) + "\u3001" + therapist + "\u3067\u3059\u3002\u3053\u306e\u5019\u88dc\u3067\u9032\u3081\u308b\u5834\u5408\u306f\u300c\u304a\u9858\u3044\u3057\u307e\u3059\u300d\u3001\u5225\u306e\u65e5\u6642\u306a\u3089\u300c\u5225\u306e\u6642\u9593\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002").trim();
  }
  const nextQuestion = draft ? buildShortNextQuestion(draft, courses ?? draft.availableCourses ?? []) : "";
  return (menu + (nextQuestion ? " " + nextQuestion : "")).trim();
}

function isLowConfidenceConfirmationText(text) {
  return /(\u3067\u3059\u304b|\u5927\u4e08\u592b\u3067\u3059\u304b|\u5408\u3063\u3066|\u3067\u5408\u3063\u3066|\u4f55\u6642|\u805e\u3053\u3048|\u305d\u306e\u6642\u9593|\u3053\u308c|\u305d\u308c|\u3042\u308c|\u591c\u3067|\u663c\u3067|\u4ed5\u4e8b\u7d42\u308f\u308a|\u9045\u3081|\u65e9\u3081|\u7a7a\u3044\u3066\u308b\u6642|\u7a7a\u3044\u3066\u308b\u3068\u304d|\u591a\u5206|\u305f\u3076\u3093)[\uff1f?]?$/u.test(text);
}

function handleDestructiveIntent(session, match, context) {
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;

  if (match.intent === "cancel_intent") {
    draft.awaitingField = "cancelled";
    draft.awaitingFinalConfirmation = false;
    draft.cancelled = true;
    draft.completed = false;
    draft.therapistName = undefined;
    draft.nominationIntent = undefined;
    session.selectedTherapist = undefined;
    return "\u627f\u77e5\u3057\u307e\u3057\u305f\u3002\u4e88\u7d04\u53d7\u4ed8\u306f\u3053\u3053\u3067\u7d42\u4e86\u3057\u307e\u3059\u3002\u307e\u305f\u5fc5\u8981\u3067\u3057\u305f\u3089\u304a\u96fb\u8a71\u304f\u3060\u3055\u3044\u3002";
  }

  if (match.intent === "referral_intent") {
    draft.referralIntent = true;
    draft.awaitingField = "referrerName";
    draft.awaitingFinalConfirmation = false;
    return "\u3054\u7d39\u4ecb\u3067\u3059\u306d\u3002\u7d39\u4ecb\u8005\u69d8\u306e\u304a\u540d\u524d\u3092\u5148\u306b\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }

  if (match.intent === "name_clarification_question") {
    draft.awaitingField = "name";
    draft.awaitingFinalConfirmation = false;
    return "\u306f\u3044\u3001\u3054\u4e88\u7d04\u3055\u308c\u308b\u304a\u5ba2\u69d8\u306e\u304a\u540d\u524d\u3067\u3059\u3002\u82d7\u5b57\u3060\u3051\u3067\u5927\u4e08\u592b\u3067\u3059\u306e\u3067\u3001\u304a\u540d\u524d\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }

  if (match.intent === "recommendation_question") {
    draft.awaitingField = "startsAt";
    draft.awaitingFinalConfirmation = false;
    const names = (context?.therapists ?? [])
      .filter((therapist) => therapist.status !== "INACTIVE")
      .slice(0, 4)
      .map((therapist) => `${therapist.displayName}\u3055\u3093`)
      .join("\u3001");
    const candidateText = names || "\u51fa\u52e4\u4e2d\u306e\u30bb\u30e9\u30d4\u30b9\u30c8";
    return `\u304a\u3059\u3059\u3081\u5019\u88dc\u306f${candidateText}\u3067\u3059\u3002\u7a7a\u304d\u6642\u9593\u3082\u78ba\u8a8d\u3057\u307e\u3059\u306e\u3067\u3001\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002`;
  }

  return "";
}

function handleAdultServiceTerminology(session, callerText, context) {
  const match = classifyAdultServiceTerm(callerText);
  if (!match) return "";

  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  const reply = buildAdultServiceTerminologyReply(match, draft, context, callerText);
  const registeredOption = findMatchingRegisteredAdultOption(match, context);
  logConversationState(session, "adult_service_terminology_guard", {
    user_utterance: callerText,
    matched_term: match.term,
    guard_category: match.category,
    policy: match.policy,
    registered_option: registeredOption?.name ?? null,
    service_scope: registeredOption ? "registered_option_guidance" : "boundary_or_store_check",
    assistant_response: reply,
    next_action: match.policy
  });
  return reply;
}

function buildAdultServiceTerminologyReply(match, draft, context, callerText = "") {
  const next = buildAdultServiceNextQuestion(draft, context);
  const courseLine = formatRegisteredCourseShort(context?.courses ?? draft?.availableCourses ?? []);
  const softBoundary = `その表現は理解しています。電話口では可否の断定はしておらず、登録コースの範囲でご案内しています。リンパ周りを丁寧に受けたい場合は90分コースが案内しやすいです。${next}`.trim();
  const therapistScopeReply = buildTherapistScopeProfileReply(match, draft, context, callerText, next);
  if (therapistScopeReply) return therapistScopeReply;

  if (match.category === "registered_bodywork" || match.category === "normal_course_question") {
    const registeredReply = buildRegisteredAdultOptionReply(match, draft, context, next);
    if (registeredReply) return registeredReply;
    return buildRegisteredBodyworkReply(match, draft, context, courseLine, next);
  }

  if (match.category === "safe_option_question") {
    const registeredReply = buildRegisteredAdultOptionReply(match, draft, context, next);
    if (registeredReply) return registeredReply;
    const serviceReply = buildServiceKnowledgeReply(match.term, draft, context, { forceRegisteredOnly: true });
    return serviceReply || `オプションは、店舗登録がある範囲で確認します。${courseLine} ${next}`.trim();
  }

  if (match.category === "customer_misconduct") {
    return `セラピストへのお触りや施術中の自己処理はお断りしています。通常コースの範囲で空き確認できます。${next}`.trim();
  }

  if (match.category === "exposure_or_costume") {
    const registeredReply = buildRegisteredAdultOptionReply(match, draft, context, next);
    if (registeredReply) return registeredReply;
    return `衣装や露出に関わる内容は、登録済みオプションがある場合だけ店舗確認です。未登録の内容は電話口で案内せず、通常コースと空き時間でご案内します。${courseLine} ${next}`.trim();
  }

  if (match.category === "appearance_insult") {
    return `見た目を断定するご案内はできません。雰囲気や出勤状況なら確認します。${next}`.trim();
  }

  if (match.category === "review_slang") {
    return `口コミの隠語は意味だけ確認できますが、店舗側で保証はしません。登録済みコースと出勤状況で確認します。${next}`.trim();
  }

  if (match.category === "body_part_sensitive") {
    return `身体の一部に関わる内容は、登録済みコースの範囲でのみ確認します。${courseLine} ${next}`.trim();
  }

  if (match.category === "sexual_service") {
    return `その内容は電話AIでは確約しません。登録済みコースと店舗ルールの範囲でのみご案内します。${courseLine} ${next}`.trim();
  }

  return softBoundary;
}

function buildRegisteredAdultOptionReply(match, draft, context, next) {
  const option = findMatchingRegisteredAdultOption(match, context);
  if (!option) {
    if (match?.category === "safe_option_question" && (context?.options ?? []).length) {
      return compactSpeechReply(`${formatKnownOptionsShort(context)} 気になるものがあれば名前でお伝えください。${next}`);
    }
    return "";
  }
  const price = option.price ? "、" + formatYen(option.price) : "";
  addDraftRegisteredOption(draft, option);
  return compactSpeechReply(`${option.name}は登録済みオプションです${price}。希望に入れて進めます。${next}`);
}

function addDraftRegisteredOption(draft, option) {
  if (!draft || !option?.name) return;
  const current = Array.isArray(draft.options) ? draft.options : [];
  const normalizedName = normalizeIntentKey(option.name);
  if (current.some((item) => normalizeIntentKey(item?.name ?? "") === normalizedName)) {
    draft.options = current;
    return;
  }
  current.push({
    id: option.id,
    name: option.name,
    price: Number.isFinite(Number(option.price)) ? Number(option.price) : 0
  });
  draft.options = current;
}

function findMatchingRegisteredAdultOption(match, context) {
  const options = context?.options ?? [];
  if (!options.length || !match) return null;
  const aliases = [match.term, ...(match.aliases ?? [])].map(normalizeIntentKey).filter(Boolean);
  return options.find((option) => {
    const name = normalizeIntentKey(option?.name ?? "");
    if (!name) return false;
    return aliases.some((alias) => alias && (name.includes(alias) || alias.includes(name)));
  }) ?? null;
}

function buildRegisteredBodyworkReply(match, draft, context, courseLine, next) {
  const term = String(match?.term ?? "");
  if (/鼠径部|そけい|SKB/i.test(term)) {
    return compactSpeechReply(`鼠径部は脚の付け根周辺のリンパがある部位です。メンズエステではリンパ周りのケアとしてご案内することが多いです。リンパ周りを丁寧に受けたい場合は90分コースが案内しやすいです。${next}`);
  }
  if (/ディープリンパ|DL|リンパ/i.test(term)) {
    return compactSpeechReply(`ディープリンパは、リンパ周りを通常より丁寧に確認する施術表現です。登録コースの範囲でご案内します。リンパ周りをしっかり受けたい場合は90分コースが案内しやすいです。${next}`);
  }
  const serviceReply = buildServiceKnowledgeReply(term, draft, context, { forceRegisteredOnly: true });
  return serviceReply || compactSpeechReply(`リンパ周りの施術は、店舗登録済みのコース範囲で確認します。${courseLine} ${next}`);
}

function handleServiceKnowledgeQuestion(session, callerText, context) {
  const text = normalizeJapaneseSpeech(callerText);
  if (isCurrentReservationSummaryQuestion(text)) return "";
  if (isCourseMentionInsideBookingRequest(text)) return "";
  const match = classifyServiceKnowledge(callerText);
  if (!match) return "";
  const draft = session.reservationDraft ?? createReservationDraft();
  session.reservationDraft = draft;
  const reply = buildServiceKnowledgeReply(match.key, draft, context, { matchedKnowledge: match });
  if (!reply) return "";
  logConversationState(session, "service_knowledge_answer", {
    user_utterance: callerText,
    knowledge_key: match.key,
    knowledge_category: match.category,
    assistant_response: reply,
    next_action: "answer_course_or_service_question"
  });
  return reply;
}

function buildServiceKnowledgeReply(keyOrText, draft, context, options = {}) {
  const knowledge = options.matchedKnowledge ?? findServiceKnowledge(keyOrText);
  if (!knowledge) return "";
  const courses = context?.courses ?? draft?.availableCourses ?? [];
  const courseLine = formatRegisteredCourseShort(courses);
  const next = buildAdultServiceNextQuestion(draft, context);

  if (knowledge.category === "course_overview") {
    return compactSpeechReply(`${formatCourseMenuBrief(courses)} ${formatKnownOptionsShort(context)} ご予約なら希望日時をお願いします。`);
  }

  if (knowledge.category === "course_detail") {
    const matchedCourse = findCourseForKnowledge(knowledge, courses);
    const registered = matchedCourse ? formatSingleCourseDetail(matchedCourse) : courseLine;
    return compactSpeechReply(`${registered} ${knowledge.features} ${knowledge.notIncluded} ${next}`);
  }

  if (knowledge.category === "therapist_info") {
    return `${knowledge.safeSummary} ${formatTherapistRecommendationAnswer(context?.therapists ?? [], draft)}`.trim();
  }

  if (knowledge.category === "store_check") {
    return compactSpeechReply(`${knowledge.safeSummary} ${knowledge.features} ${courseLine} ${next}`);
  }

  if (knowledge.category === "store_rule") {
    return compactSpeechReply(`${knowledge.safeSummary} ${knowledge.features} ${next}`);
  }

  if (options.forceRegisteredOnly && !hasMatchingRegisteredOption(knowledge, context)) {
    return compactSpeechReply(`${knowledge.safeSummary} 登録コースまたは店舗確認の範囲でご案内します。${courseLine} ${next}`);
  }

  return compactSpeechReply(`${knowledge.safeSummary} ${knowledge.features} ${knowledge.notIncluded} ${next}`);
}

function compactSpeechReply(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/。\s+/g, "。")
    .replace(/、\s+/g, "、")
    .trim();
}

function classifyServiceKnowledge(value) {
  if (!serviceKnowledge.rows.length) return null;
  const text = normalizeIntentKey(value);
  if (!text) return null;
  const matches = serviceKnowledge.rows.filter((row) => {
    const aliases = [row.key, ...row.aliases].filter(Boolean);
    return aliases.some((alias) => {
      const aliasKey = normalizeIntentKey(alias);
      return aliasKey && (text.includes(aliasKey) || aliasKey.includes(text));
    });
  });

  if (matches.length) return matches.sort((left, right) => right.priority - left.priority)[0];
  if (isServiceKnowledgeQuestionText(text)) return findServiceKnowledge("course_menu");
  return null;
}

function isServiceKnowledgeQuestionText(text) {
  return /(種類|内容|特徴|違い|サービス|施術|マッサージ|オプション|メニュー|コース|リンパ|鼠径部|どんな施術|どういう施術|何がある|なにがある|何があります|なにがあります|できること|説明|教えて)/u.test(text);
}

function isTreatmentServiceQuestionText(text) {
  return /(施術|マッサージ|サービス内容|コース内容|どんな施術|どういう施術|何がある|なにがある|何があります|なにがあります|できること|コースの中|メニュー|オプション|鼠径部|リンパ)/u.test(text);
}

function isAppearanceQuestionText(text) {
  return /(見た目|顔|可愛い|かわいい|綺麗|きれい|美人|スタイル|タイル|体型|写真|画像|雰囲気)/u.test(text);
}

function findServiceKnowledge(keyOrText) {
  const key = normalizeIntentKey(keyOrText);
  return (
    serviceKnowledge.rows.find((row) => normalizeIntentKey(row.key) === key) ??
    serviceKnowledge.rows.find((row) => [row.key, ...row.aliases].some((alias) => {
      const aliasKey = normalizeIntentKey(alias);
      return aliasKey && key && (key.includes(aliasKey) || aliasKey.includes(key));
    })) ??
    null
  );
}

function findCourseForKnowledge(knowledge, courses) {
  const aliases = [knowledge.key, ...knowledge.aliases].map(normalizeIntentKey);
  return (courses ?? []).find((course) => {
    const courseName = normalizeIntentKey(course.name);
    const duration = String(course.durationMin ?? "");
    return aliases.some((alias) => courseName.includes(alias) || alias.includes(courseName) || (duration && alias.includes(duration)));
  });
}

function hasMatchingRegisteredOption(knowledge, context) {
  const aliases = [knowledge.key, ...knowledge.aliases].map(normalizeIntentKey);
  const options = context?.options ?? [];
  return options.some((option) => {
    const name = normalizeIntentKey(option.name);
    return aliases.some((alias) => alias && name && (name.includes(alias) || alias.includes(name)));
  });
}

function formatKnownOptionsShort(context) {
  const options = prioritizeSpeechOptions((context?.options ?? []).filter(Boolean));
  if (!options.length) return "追加オプションは店舗確認です。";
  const visible = options.slice(0, 4);
  const suffix = options.length > visible.length ? `など全${options.length}件です。` : "です。";
  return "登録オプションは" + visible.map((option) => String(option.name ?? "").trim()).filter(Boolean).join("、") + suffix + "料金は必要なら案内します。";
}

function prioritizeSpeechOptions(options) {
  const priorityWords = ["ディープリンパ", "鼠径部", "リンパ", "ホイップ", "フェザー", "カエル脚", "四つん這い"];
  return [...options].sort((left, right) => {
    const leftName = normalizeIntentKey(left?.name ?? "");
    const rightName = normalizeIntentKey(right?.name ?? "");
    const leftScore = priorityWords.findIndex((word) => leftName.includes(normalizeIntentKey(word)));
    const rightScore = priorityWords.findIndex((word) => rightName.includes(normalizeIntentKey(word)));
    const normalizedLeftScore = leftScore === -1 ? 999 : leftScore;
    const normalizedRightScore = rightScore === -1 ? 999 : rightScore;
    if (normalizedLeftScore !== normalizedRightScore) return normalizedLeftScore - normalizedRightScore;
    return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "ja");
  });
}

function buildAdultServiceNextQuestion(draft, context) {
  if (hasAnyDraftValue(draft)) {
    return buildShortNextQuestion(draft, context?.courses ?? draft.availableCourses ?? []) || "続けてご希望内容をお願いします。";
  }
  return "ご予約なら希望日時をお願いします。";
}

function formatRegisteredCourseShort(courses) {
  const activeCourses = Array.isArray(courses) ? courses.filter(Boolean) : [];
  if (!activeCourses.length) return "登録コースは確認中です。";
  const first = activeCourses[0];
  const label = `${formatCourseNameForSpeech(first.name)}（${first.durationMin}分、${formatYen(first.price)}）`;
  if (activeCourses.length === 1) return `登録コースは${label}です。`;
  return `登録コースは${label}などです。`;
}

function classifyAdultServiceTerm(value) {
  if (!adultServiceTerminology.rows.length) return null;
  const raw = String(value ?? "").normalize("NFKC").toLowerCase();
  const compact = normalizeIntentKey(value);
  const matches = [];

  for (const row of adultServiceTerminology.rows) {
    const aliases = [row.term, ...row.aliases].filter(Boolean);
    if (aliases.some((alias) => adultServiceAliasMatches(alias, raw, compact))) {
      matches.push(row);
    }
  }

  const matched = matches.sort((left, right) => right.priority - left.priority)[0];
  if (matched) return matched;
  if (isAmbiguousAdultServiceQuestion(raw, compact)) {
    return {
      term: "曖昧な成人向けサービス質問",
      aliases: [],
      category: "ambiguous_slang",
      policy: "safe_normal_course_boundary",
      priority: 70
    };
  }
  return null;
}

function isAmbiguousAdultServiceQuestion(raw, compact) {
  const text = normalizeJapaneseSpeech(raw).normalize("NFKC").toLowerCase();
  if (!text) return false;
  if (/(どこまで|特別サービス|裏メニュー|裏オプ|そういう店|そういうの|エッチ|えろ|エロ|過激|きわどい|際どい|寛容)/u.test(text)) return true;
  if (/(エヌエヌ|えぬえぬ|エイチジェイ|えいちじぇい|ティーケーケー|てぃーけーけー|ジービーケー|じーびーけー|エスケーアール|えすけーあーる|ディーエル|でぃーえる)/u.test(text)) return true;
  return /(nn|hj|tkk|gbk|skr|dl).*(でき|ある|あり|可能|サービス|オプション)/i.test(compact);
}

function adultServiceAliasMatches(alias, raw, compact) {
  const normalizedAlias = String(alias ?? "").normalize("NFKC").toLowerCase().trim();
  if (!normalizedAlias) return false;
  if (/^[a-z0-9]+$/i.test(normalizedAlias)) {
    return adultServiceAsciiAliasMatches(normalizedAlias, raw);
  }
  const aliasKey = normalizeIntentKey(normalizedAlias);
  return aliasKey.length >= 2 && compact.includes(aliasKey);
}

function adultServiceAsciiAliasMatches(alias, raw) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`;
  if (!new RegExp(boundary, "i").test(raw)) return false;

  if (alias === "f" && /f\s*カップ/i.test(raw)) return false;
  if (alias === "g" && /g\s*カップ/i.test(raw)) return false;
  if (alias.length === 1) {
    return new RegExp(`(^|[^a-z0-9])${escaped}\\s*(ありますか|でき|して|は|あり|可能|サービス|オプション|ですか|って|とは)?([^a-z0-9]|$)`, "i").test(raw);
  }
  return true;
}

function isTherapistPresenceQuestion(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  if (isTherapistAvailabilityQuestion(normalized) && !hasTherapistBookingActionText(normalized)) return true;
  return /(\u8ab0\u304c\u3044\u307e\u3059|\u8ab0\u3044\u307e\u3059|\u8ab0\u304c\u3044\u308b|\u8ab0\u3044\u308b|\u5973\u306e\u5b50.*\u8ab0|\u30bb\u30e9\u30d4\u30b9\u30c8.*\u8ab0|\u4eca.*\u8ab0|\u51fa\u52e4.*\u8ab0)/u.test(normalized);
}

function isNominationMeaningQuestion(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  return /(\u8a00\u3046|\u540d\u524d|\u805e\u304f|\u8ab0|\u5973\u306e\u5b50).*(\u6307\u540d\u306b\u306a\u308b|\u6307\u540d\u6271\u3044|\u6307\u540d\u3063\u3066\u3053\u3068|\u6307\u540d\u306a\u306e|\u6307\u540d\u3067\u3059\u304b|\u6307\u540d)/u.test(normalized);
}

function isAttentionConfirmationText(text) {
  return /(\u306f\u3044|\u5927\u4e08\u592b|\u78ba\u8a8d\u6e08\u307f|\u78ba\u8a8d\u3057\u305f|\u308f\u304b\u308a\u307e\u3057\u305f|ok|OK|\u30aa\u30c3\u30b1\u30fc|\u3044\u3044\u3067\u3059)/u.test(normalizeJapaneseSpeech(text));
}

function shouldPrioritizeReservationState(draft, text) {
  if (!draft) return false;
  if (draft.awaitingFinalConfirmation) return true;
  if (["attention", "attentionConfirmed"].includes(draft.awaitingField) && isAttentionConfirmationText(text)) return true;
  if (draft.awaitingField === "firstVisit" && /(\u521d\u56de|\u521d\u3081\u3066|\u306f\u3058\u3081\u3066|2\u56de|\u4e8c\u56de|\u518d\u6765|\u6765\u305f\u3053\u3068|\u4f55\u56de|\u904e\u53bb|\u4ee5\u524d|\u5229\u7528\u7d4c\u9a13|\u5229\u7528\u6b74|\u4e88\u7d04\u3055\u305b|\u4e88\u7d04\u3057\u305f|\u3042\u308a\u307e\u3059)/u.test(text)) return true;
  if (draft.awaitingField === "phone" && normalizePhoneDigits(text)) return true;
  return false;
}

async function maybeReplyNoSameDayShift(session, context, text) {
  const draft = session.reservationDraft ?? createReservationDraft();
  const normalized = normalizeJapaneseSpeech(text);
  const mentionsToday = /(\u4eca\u65e5|\u672c\u65e5|\u4eca\u304b\u3089|\u4eca\u65e5\u306e|\u4eca\u6669|\u4eca)/u.test(normalized) || isSameJstDay(draft.startsAt, getJstTodayParts());
  const asksBooking = isReservationLikely(normalized) || isAvailabilityQuestion(normalized) || /(\u30d5\u30ea\u30fc|\u6307\u540d|\u8ab0|\u7a7a\u3044|\u5165\u308c|\u884c\u3051|\u884c\u304d|\u304a\u9858\u3044|\u4e88\u7d04)/u.test(normalized);
  const hasTimeOrTodayBooking = mentionsToday && asksBooking;
  if (!hasTimeOrTodayBooking) return "";

  const todayParts = getJstTodayParts();
  const [hasShift, nextSlot] = await Promise.all([
    hasFutureActiveShiftOnJstDay(session.storeId, todayParts),
    findNextAvailableSlot(session, context, todayParts)
  ]);
  if (hasShift) return "";

  draft.noSameDayShift = true;
  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
  session.reservationDraft = draft;
  logConversationState(session, "same_day_no_shift");

  const base = "本日これ以降に予約可能な出勤シフトが登録されていません。";
  if (!nextSlot) {
    draft.availabilityCheckResult = { ok: false, reason: "NO_AVAILABLE_CANDIDATE" };
    return base + "別の日にちか時間帯ならお調べできます。ご希望はありますか？";
  }

  setSuggestedCandidate(draft, nextSlot);
  return base + "最短は" + formatDateTimeJa(nextSlot.startsAt) + "、" + nextSlot.therapist.displayName + "さんです。" + buildCandidateOfferInstruction(draft, "hold");
}

async function maybeReplyNoSameDayShiftDirect(session, context, text) {
  const normalized = normalizeJapaneseSpeech(text);
  if (!/(\u4eca\u65e5|\u672c\u65e5|\u4eca\u304b\u3089|\u4eca\u6669|\u4eca)/u.test(normalized)) return "";
  if (!/(\u4e88\u7d04|\u30d5\u30ea\u30fc|\u6307\u540d|\u7a7a\u3044|\u7a7a\u304d|\u884c\u3051|\u884c\u304d|\u304a\u9858\u3044|\u5165\u308c|\u8ab0)/u.test(normalized)) return "";
  const todayParts = getJstTodayParts();
  const [hasShift, nextSlot] = await Promise.all([
    hasFutureActiveShiftOnJstDay(session.storeId, todayParts),
    findNextAvailableSlot(session, context, todayParts)
  ]);
  if (hasShift) return "";
  const draft = session.reservationDraft ?? createReservationDraft();
  draft.noSameDayShift = true;
  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
  session.reservationDraft = draft;
  logConversationState(session, "same_day_no_shift_direct");

  const base = "本日これ以降に予約可能な出勤シフトが登録されていません。";
  if (!nextSlot) {
    draft.availabilityCheckResult = { ok: false, reason: "NO_AVAILABLE_CANDIDATE" };
    return base + "別の日にちか時間帯ならお調べできます。ご希望はありますか？";
  }
  setSuggestedCandidate(draft, nextSlot);
  return base + "最短は" + formatDateTimeJa(nextSlot.startsAt) + "、" + nextSlot.therapist.displayName + "さんです。" + buildCandidateOfferInstruction(draft, "hold");
}

async function maybeReplyRequestedTimeUnavailable(session, context, text) {
  const draft = session.reservationDraft;
  if (!draft?.startsAt) return "";
  const normalized = normalizeJapaneseSpeech(text);
  if (!/(\u4e88\u7d04|\u30d5\u30ea\u30fc|\u6307\u540d|\u7a7a\u3044|\u7a7a\u304d|\u884c\u3051|\u5165\u308c|\u8ab0|\u5927\u4e08\u592b)/u.test(normalized)) return "";

  const check = await checkReservationAvailability(session, context, draft);
  draft.availabilityCheckResult = summarizeAvailabilityCheck(check);
  logConversationState(session, "requested_time_precheck");
  if (check.ok) return "";

  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
  const todayParts = getJstTodayParts();
  const isToday = isSameJstDay(draft.startsAt, todayParts);
  const hasTodayShift = isToday ? await hasFutureActiveShiftOnJstDay(session.storeId, todayParts, draft.startsAt) : true;
  const nextSlot = await findNextAvailableSlot(session, context, todayParts, draft.startsAt, draft.therapistName);
  if (nextSlot) {
    setSuggestedCandidate(draft, nextSlot);
  }

  if (!hasTodayShift && !draft.therapistName) {
    const base = "\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u3002\u672c\u65e5\u306f\u3054\u6848\u5185\u53ef\u80fd\u306a\u30bb\u30e9\u30d4\u30b9\u30c8\u304c\u3044\u306a\u3044\u305f\u3081\u3001\u6307\u540d\u30fb\u30d5\u30ea\u30fc\u3069\u3061\u3089\u3082\u627f\u308c\u307e\u305b\u3093\u3002";
    if (!nextSlot) return base + "\u73fe\u5728\u3001" + formatRequestedSlotLabel(draft.startsAt) + "\u4ee5\u964d\u3067\u3054\u6848\u5185\u53ef\u80fd\u306a\u67a0\u304c\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002";
    return base + "\u6700\u77ed\u3067\u3059\u3068" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
  }
  return formatAvailabilityUnavailableMessage(draft, check, nextSlot);
}

async function hasActiveShiftOnJstDay(storeId, dayParts) {
  if (!process.env.DATABASE_URL || !storeId) return false;
  const range = jstDayUtcRange(dayParts);
  try {
    const count = await prisma.shift.count({
      where: {
        storeId,
        status: { not: "CANCELLED" },
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
        therapist: { status: "ACTIVE" }
      }
    });
    return count > 0;
  } catch (error) {
    logRelay("shift_count_failed", {
      storeId,
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    });
    return true;
  }
}

async function hasFutureActiveShiftOnJstDay(storeId, dayParts, fromDate = new Date()) {
  if (!process.env.DATABASE_URL || !storeId) return false;
  const range = jstDayUtcRange(dayParts);
  const startFloor = roundUpToSlot(Math.max(range.start.getTime(), new Date(fromDate).getTime()));
  if (startFloor >= range.end) return false;
  try {
    const count = await prisma.shift.count({
      where: {
        storeId,
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
        startsAt: { lt: range.end },
        endsAt: { gt: startFloor },
        therapist: { status: "ACTIVE" }
      }
    });
    return count > 0;
  } catch (error) {
    logRelay("future_shift_count_failed", {
      storeId,
      searchStart: startFloor.toISOString(),
      searchEnd: range.end.toISOString(),
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    });
    return true;
  }
}

async function findNextAvailableSlot(session, context, dayParts, searchFrom, therapistName, options = {}) {
  if (!process.env.DATABASE_URL || !session.storeId) return null;
  const searchStartedAt = Date.now();
  const normalizedDayParts = dayParts ?? getJstTodayParts();
  const range = jstDayUtcRange(normalizedDayParts);
  const requestedStart = searchFrom ? new Date(searchFrom) : range.start;
  const startOffsetMs = searchFrom ? 30 * 60 * 1000 : 0;
  const nowFloor = roundUpToSlot(new Date());
  const startFloor = roundUpToSlot(Math.max(requestedStart.getTime() + startOffsetMs, nowFloor.getTime()));
  const preferredTherapistName = therapistName ? normalizeTherapistName(therapistName) : "";
  const excludedTherapistNames = new Set(
    (options.excludeTherapistNames ?? [])
      .map((name) => normalizeTherapistName(name))
      .filter(Boolean)
  );
  if (session.reservationDraft) {
    session.reservationDraft.alternative_search_from_datetime = formatJstDateTimeOffset(startFloor);
  }
  const searchEnd = new Date(startFloor.getTime() + 14 * 24 * 60 * 60 * 1000);
  const course = context?.courses?.find((item) => item.durationMin === 90) ?? context?.courses?.[0] ?? { durationMin: 90 };
  const [shifts, reservations, blockedSlots, rooms] = await Promise.all([
    prisma.shift.findMany({
      where: {
        storeId: session.storeId,
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
        startsAt: { lt: searchEnd },
        endsAt: { gt: startFloor },
        therapist: { status: "ACTIVE" }
      },
      orderBy: { startsAt: "asc" },
      include: { therapist: true }
    }),
    prisma.reservation.findMany({
      where: {
        storeId: session.storeId,
        status: { in: ["TENTATIVE", "CONFIRMED"] },
        startsAt: { lt: searchEnd },
        endsAt: { gt: startFloor }
      },
      select: { startsAt: true, endsAt: true, roomId: true, therapistId: true }
    }),
    prisma.blockedSlot.findMany({
      where: {
        storeId: session.storeId,
        startsAt: { lt: searchEnd },
        endsAt: { gt: startFloor }
      },
      select: { startsAt: true, endsAt: true, roomId: true, therapistId: true }
    }),
    prisma.room.findMany({
      where: { storeId: session.storeId, isActive: true },
      orderBy: { name: "asc" }
    })
  ]);

  let checkedSlotCount = 0;
  const logSearch = (result) => {
    const diagnostics = {
      day: formatJstDateIso(normalizedDayParts),
      searchStart: startFloor.toISOString(),
      searchEnd: searchEnd.toISOString(),
      courseDurationMin: course.durationMin,
      shiftCount: shifts.length,
      reservationCount: reservations.length,
      blockedSlotCount: blockedSlots.length,
      roomCount: rooms.length,
      checkedSlotCount,
      excludedTherapistNames: Array.from(excludedTherapistNames),
      found: Boolean(result),
      startsAt: result?.startsAt?.toISOString?.()
    };
    if (session.reservationDraft) {
      session.reservationDraft.availabilitySearchDiagnostics = diagnostics;
    }
    logRelay("next_available_slot_search", {
      callSid: session.callSid,
      elapsedMs: Date.now() - searchStartedAt,
      ...diagnostics
    });
  };

  for (let startsAt = startFloor; startsAt < searchEnd; startsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)) {
    const endsAt = new Date(startsAt.getTime() + course.durationMin * 60 * 1000);
    if (endsAt > searchEnd) break;
    checkedSlotCount += 1;
    const overlappingReservations = reservations.filter((item) => intervalsOverlap(item.startsAt, item.endsAt, startsAt, endsAt));
    const overlappingBlocks = blockedSlots.filter((item) => intervalsOverlap(item.startsAt, item.endsAt, startsAt, endsAt));
    if (overlappingBlocks.some((item) => !item.roomId && !item.therapistId)) continue;

    const reservedRoomIds = new Set(overlappingReservations.map((item) => item.roomId).filter(Boolean));
    const blockedRoomIds = new Set(overlappingBlocks.map((item) => item.roomId).filter(Boolean));
    const room = rooms.find((item) => !reservedRoomIds.has(item.id) && !blockedRoomIds.has(item.id));
    if (!room) continue;

    const reservedTherapistIds = new Set(overlappingReservations.map((item) => item.therapistId).filter(Boolean));
    const blockedTherapistIds = new Set(overlappingBlocks.map((item) => item.therapistId).filter(Boolean));
    const shift = shifts.find((item) => {
      if (item.startsAt > startsAt || item.endsAt < endsAt) return false;
      const therapist = item.therapist;
      if (!therapist || therapist.status !== "ACTIVE") return false;
      if (reservedTherapistIds.has(therapist.id) || blockedTherapistIds.has(therapist.id)) return false;
      if (preferredTherapistName && !namesLookSame(normalizeTherapistName(therapist.displayName), preferredTherapistName)) return false;
      if (excludedTherapistNames.has(normalizeTherapistName(therapist.displayName))) return false;
      return true;
    });
    if (!shift?.therapist) continue;

    const result = { startsAt, endsAt, therapist: shift.therapist };
    logSearch(result);
    return result;
  }
  logSearch(null);
  return null;
}

function roundUpToSlot(value, slotMin = 30) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  const slotMs = slotMin * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / slotMs) * slotMs);
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(leftEnd).getTime() > new Date(rightStart).getTime();
}

function jstDayUtcRange(parts) {
  return {
    start: jstDateToUtcDate(parts.year, parts.month, parts.day, 0, 0),
    end: jstDateToUtcDate(parts.year, parts.month, parts.day + 1, 0, 0)
  };
}

function isSameJstDay(date, parts) {
  if (!date) return false;
  const formatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
  const values = formatter.formatToParts(new Date(date));
  return Number(values.find((part) => part.type === "year")?.value) === parts.year &&
    Number(values.find((part) => part.type === "month")?.value) === parts.month &&
    Number(values.find((part) => part.type === "day")?.value) === parts.day;
}

async function formatRequestedTimeAvailabilityAnswer(session, context, text) {
  const draft = session.reservationDraft;
  if (!draft?.startsAt) return "";

  const requestedTherapist = findRequestedTherapist(text, context?.therapists ?? []);
  if (requestedTherapist) {
    draft.nominationIntent = true;
    draft.therapistName = requestedTherapist.displayName;
    draft.selected_therapist_source = "explicit_user_nomination";
  }

  const check = await checkReservationAvailability(session, context, draft);
  draft.availabilityCheckResult = summarizeAvailabilityCheck(check);
  logConversationState(session, "availability_check");

  if (!check.ok) {
    draft.awaitingFinalConfirmation = false;
    draft.awaitingField = "startsAt";
    const nextSlot = await findNextAvailableSlot(session, context, getJstTodayParts(), draft.startsAt, draft.therapistName);
    if (nextSlot) {
      setSuggestedCandidate(draft, nextSlot);
    }
    return formatAvailabilityUnavailableMessage(draft, check, nextSlot);
  }

  if (requestedTherapist) {
    draft.therapistName = check.selectedTherapist?.displayName ?? requestedTherapist.displayName;
    draft.nominationIntent = true;
    draft.selected_therapist_source = "explicit_user_nomination";
    const nextQuestion = buildShortNextQuestion(draft);
    return formatDateTimeJa(draft.startsAt) + "\u3067\u3057\u305f\u3089" + draft.therapistName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + draft.therapistName + "\u3055\u3093\u6307\u540d\u3067\u9032\u3081\u307e\u3059\u3002" + nextQuestion;
  }

  const names = check.availableTherapists.map((therapist) => therapist.displayName + "\u3055\u3093").join("\u3001");
  return formatDateTimeJa(draft.startsAt) + "\u3067\u3057\u305f\u3089" + names + "\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002\u3054\u5e0c\u671b\u306e\u65b9\u304c\u3044\u308c\u3070\u304a\u540d\u524d\u3092\u3001\u6307\u540d\u306a\u3057\u306a\u3089\u30d5\u30ea\u30fc\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
}

async function validateReservation(session, context) {
  const draft = session.reservationDraft;
  if (!draft?.startsAt) return { ok: false, reason: "MISSING_DATETIME", message: "\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };
  if (draft.nominationIntent === true && !draft.therapistName && draft.selected_therapist_source === "explicit_user_nomination" && session.selectedTherapist) draft.therapistName = session.selectedTherapist;
  if (draft.nominationIntent === true && !draft.therapistName) {
    return { ok: false, reason: "MISSING_SELECTED_THERAPIST", message: "\u3054\u6307\u540d\u306e\u30bb\u30e9\u30d4\u30b9\u30c8\u540d\u3092\u304a\u9858\u3044\u3044\u305f\u3057\u307e\u3059\u3002" };
  }
  if (draft.nominationIntent === undefined && !draft.therapistName) {
    return { ok: false, reason: "MISSING_BOOKING_TYPE", message: "\u6307\u540d\u306a\u3057\u306e\u30d5\u30ea\u30fc\u3067\u9032\u3081\u307e\u3059\u304b\uff1f" };
  }
  if (!draft.customerName) return { ok: false, reason: "MISSING_CUSTOMER_NAME", message: "\u304a\u540d\u524d\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };
  if (!draft.phone) return { ok: false, reason: "MISSING_PHONE", message: "\u304a\u96fb\u8a71\u756a\u53f7\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };
  if (!draft.course) return { ok: false, reason: "MISSING_COURSE", message: "\u3054\u5e0c\u671b\u306e\u30b3\u30fc\u30b9\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };
  if (draft.firstVisit === undefined) return { ok: false, reason: "MISSING_FIRST_VISIT", message: "\u521d\u3081\u3066\u306e\u3054\u5229\u7528\u304b\u3001\u904e\u53bb\u306b\u3054\u5229\u7528\u304c\u3042\u308b\u304b\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };
  if (draft.attentionConfirmed !== true) return { ok: false, reason: "MISSING_ATTENTION_CONFIRMATION", message: "\u6ce8\u610f\u4e8b\u9805\u306e\u78ba\u8a8d\u304c\u5fc5\u8981\u3067\u3059\u3002\u78ba\u8a8d\u6e08\u307f\u3067\u3057\u305f\u3089\u300c\u78ba\u8a8d\u3057\u307e\u3057\u305f\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002" };

  const check = await checkReservationAvailability(session, context, draft);
  draft.availabilityCheckResult = summarizeAvailabilityCheck(check);
  logConversationState(session, "validate_reservation");

  if (!check.ok) {
    draft.awaitingFinalConfirmation = false;
    draft.awaitingField = "startsAt";
    const nextSlot = await findNextAvailableSlot(session, context, getJstTodayParts(), draft.startsAt, draft.therapistName);
    if (nextSlot) {
      setSuggestedCandidate(draft, nextSlot);
    }
    return {
      ok: false,
      reason: check.reason,
      message: formatAvailabilityUnavailableMessage(draft, check, nextSlot)
    };
  }

  if (check.selectedTherapist?.displayName) {
    draft.therapistName = check.selectedTherapist.displayName;
    if (draft.selected_therapist_source !== "explicit_user_nomination") {
      draft.selected_therapist_source = "ai_assigned_after_availability";
    }
  }
  return { ok: true, reason: "OK", selectedTherapist: check.selectedTherapist };
}

async function ensureAvailabilityGate(session, context) {
  const draft = session.reservationDraft;
  if (!draft?.startsAt) return { ok: false, reason: "MISSING_DATETIME", message: "\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002" };

  const check = await checkReservationAvailability(session, context, draft);
  draft.availabilityCheckResult = summarizeAvailabilityCheck(check);
  logConversationState(session, "availability_gate", {
    next_action: check.ok ? "collect_customer_name" : "stop_before_customer_info",
    error_reason: check.ok ? null : check.reason
  });

  if (!check.ok) {
    resetDetailsAfterUnavailable(draft);
    const nextSlot = await findNextAvailableSlot(session, context, getJstTodayParts(), draft.startsAt, draft.therapistName);
    if (nextSlot) {
      setSuggestedCandidate(draft, nextSlot);
    }
    return { ok: false, reason: check.reason, message: formatAvailabilityUnavailableMessage(draft, check, nextSlot) };
  }

  if (draft.therapistName && draft.selected_therapist_source === "explicit_user_nomination") {
    draft.nominationIntent = true;
    draft.therapistName = check.selectedTherapist?.displayName ?? draft.therapistName;
    session.selectedTherapist = draft.therapistName;
  } else if (draft.nominationIntent === undefined) {
    draft.nominationIntent = false;
  }
  if (check.selectedTherapist?.displayName && draft.selected_therapist_source !== "explicit_user_nomination") {
    draft.therapistName = check.selectedTherapist.displayName;
    draft.selected_therapist_source = "ai_assigned_after_availability";
    draft.nominationIntent = false;
  }
  draft.noSameDayShift = false;
  clearSuggestedCandidate(draft);
  return { ok: true, reason: "OK" };
}

function resetDetailsAfterUnavailable(draft) {
  draft.customerName = undefined;
  draft.phone = undefined;
  draft.course = undefined;
  draft.awaitingField = "startsAt";
  draft.awaitingFinalConfirmation = false;
}

function canCollectCustomerInfo(draft) {
  return Boolean(draft?.startsAt && draft.availabilityCheckResult?.ok === true);
}

function formatAvailabilityUnavailableMessage(draft, check, nextSlot) {
  if (nextSlot && !isCandidateAllowedForDraft(draft, nextSlot)) {
    nextSlot = null;
    clearSuggestedCandidate(draft);
  }
  const slot = formatRequestedSlotLabel(draft?.startsAt);
  const therapistName = draft?.therapistName ? String(draft.therapistName).replace(/(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)$/u, "") : "";
  const checkedKey = draft?.startsAt ? new Date(draft.startsAt).toISOString() : "";
  const nextKey = nextSlot?.startsAt ? new Date(nextSlot.startsAt).toISOString() : "";
  const shown = Array.isArray(draft?.alternative_candidates_shown) ? draft.alternative_candidates_shown : [];
  const repeatedSameSlot = Boolean(checkedKey && draft?.last_availability_checked_datetime === checkedKey);
  if (draft) {
    draft.repeat_response_count = repeatedSameSlot && draft.repeat_response_key === checkedKey ? (draft.repeat_response_count ?? 0) + 1 : 1;
    draft.repeat_response_key = checkedKey;
  }
  const base = therapistName
    ? "\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u3002" + slot + "\u306f" + therapistName + "\u3055\u3093\u306e\u3054\u6848\u5185\u304c\u3067\u304d\u307e\u305b\u3093\u3002"
    : "\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u3002" + slot + "\u306f\u73fe\u5728\u3054\u6848\u5185\u53ef\u80fd\u306a\u30bb\u30e9\u30d4\u30b9\u30c8\u304c\u304a\u308a\u307e\u305b\u3093\u3002";
  let response;
  if ((draft?.repeat_response_count ?? 0) >= 3) {
    if (draft) draft.availability_search_mode = true;
    response = "\u7a7a\u3044\u3066\u3044\u308b\u5019\u88dc\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002\u5c11\u3005\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002";
    if (nextSlot && !shown.includes(nextKey)) {
      response += "\u76f4\u8fd1\u3067\u306f" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
    } else {
      response += "\u73fe\u5728\u3001\u6761\u4ef6\u306b\u5408\u3046\u5225\u5019\u88dc\u306f\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002";
    }
  } else if (repeatedSameSlot) {
    response = "\u5148\u307b\u3069\u306e" + slot + "\u306f\u6e80\u67a0\u3067\u3059\u3002";
    if (nextSlot && !shown.includes(nextKey)) {
      response += "\u4ee3\u308f\u308a\u306b" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
    } else {
      response += "\u5225\u306e\u304a\u6642\u9593\u3067\u3042\u308c\u3070\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002";
    }
  } else if (!nextSlot) {
    response = base + "\u73fe\u5728\u3001" + slot + "\u4ee5\u964d\u3067\u3054\u6848\u5185\u53ef\u80fd\u306a\u67a0\u304c\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002";
  } else {
    response = base + "\u6700\u77ed\u3067\u3059\u3068" + formatDateTimeJa(nextSlot.startsAt) + "\u306b" + nextSlot.therapist.displayName + "\u3055\u3093\u304c\u3054\u6848\u5185\u53ef\u80fd\u3067\u3059\u3002" + buildCandidateOfferInstruction(draft, "time");
  }
  if (draft) {
    draft.last_availability_checked_datetime = checkedKey;
    draft.last_availability_response = response;
    if (nextKey && !shown.includes(nextKey)) {
      draft.alternative_candidates_shown = [...shown, nextKey];
    }
  }
  return response;
}

function formatRequestedSlotLabel(value) {
  const date = new Date(value);
  const time = formatJstTimeOnly(date);
  return isSameJstDay(date, getJstTodayParts()) ? "\u672c\u65e5" + time : formatDateTimeJa(date);
}

function formatJstTimeOnly(value) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return minute ? String(hour) + "\u6642" + String(minute).padStart(2, "0") + "\u5206" : String(hour) + "\u6642";
}

async function checkReservationAvailability(session, context, draft) {
  if (!process.env.DATABASE_URL || !session.storeId || !draft?.startsAt) {
    return { ok: false, reason: "MISSING_CONTEXT", availableTherapists: [] };
  }

  const durationMin = draft.course?.durationMin || context?.courses?.find((course) => course.durationMin === 90)?.durationMin || 90;
  const startsAt = new Date(draft.startsAt);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000);
  const requestedTherapistName = draft.therapistName ? normalizeTherapistName(draft.therapistName) : "";
  const availability = await findPhoneAvailability({
    storeId: session.storeId,
    startsAt,
    endsAt,
    therapistName: draft.therapistName,
    nominated: draft.nominationIntent === true || draft.selected_therapist_source === "explicit_user_nomination"
  });

  if (availability.reason === "STORE_BLOCKED") {
    return {
      ok: false,
      reason: "STORE_BLOCKED",
      availableTherapists: [],
      startsAt,
      endsAt,
      matchedShiftCount: availability.matchedShiftCount,
      matchedBookingConflictCount: availability.matchedBookingConflictCount
    };
  }

  if (!availability.room) {
    return {
      ok: false,
      reason: "NO_ROOM",
      availableTherapists: [],
      startsAt,
      endsAt,
      matchedShiftCount: availability.matchedShiftCount,
      matchedBookingConflictCount: availability.matchedBookingConflictCount
    };
  }

  const availableTherapists = availability.availableTherapists ?? [];
  if (!availableTherapists.length || !availability.therapist) {
    return {
      ok: false,
      reason: "NO_AVAILABLE_THERAPIST",
      availableTherapists: [],
      startsAt,
      endsAt,
      matchedShiftCount: availability.matchedShiftCount,
      matchedBookingConflictCount: availability.matchedBookingConflictCount
    };
  }
  return {
    ok: true,
    reason: "OK",
    availableTherapists,
    selectedTherapist: availability.therapist,
    startsAt,
    endsAt,
    matchedShiftCount: availability.matchedShiftCount,
    matchedBookingConflictCount: availability.matchedBookingConflictCount
  };
}

function summarizeAvailabilityCheck(check) {
  return {
    ok: Boolean(check?.ok),
    reason: check?.reason ?? "UNKNOWN",
    availableTherapists: (check?.availableTherapists ?? []).map((therapist) => therapist.displayName),
    selectedTherapist: check?.selectedTherapist?.displayName,
    startsAt: check?.startsAt?.toISOString?.(),
    endsAt: check?.endsAt?.toISOString?.(),
    matchedShiftCount: check?.matchedShiftCount ?? 0,
    matchedBookingConflictCount: check?.matchedBookingConflictCount ?? 0
  };
}

function findRequestedTherapist(text, therapists) {
  const match = findRequestedTherapistMatch(text, therapists);
  return match.confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD ? match.therapist : undefined;
}

function findRequestedTherapistMatch(text, therapists) {
  const raw = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  const normalized = normalizeTherapistName(raw);
  if (!raw || isTherapistFalsePositiveText(raw)) {
    return { therapist: undefined, confidence: 0, reason: "false_positive_guard" };
  }
  for (const therapist of therapists ?? []) {
    const display = String(therapist?.displayName || therapist?.name || "").trim();
    const spoken = spokenTherapistName(display);
    const candidates = [...new Set([display, spoken, normalizeTherapistName(display), ...therapistNameAliases(display)].filter(Boolean))];
    for (const candidate of candidates) {
      const alias = normalizeJapaneseSpeech(candidate).replace(/\s+/g, "").replace(/(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)$/u, "");
      const normalizedAlias = normalizeTherapistName(alias);
      const rawMatch = findAliasBoundaryMatch(raw, alias) || findAliasBoundaryMatch(normalized, normalizedAlias);
      if (!rawMatch) continue;
      const nearby = raw.slice(Math.max(0, rawMatch.index - 4), rawMatch.index + rawMatch.length + 14);
      const hasClearIntent = /(\u3055\u3093|\u3061\u3083\u3093|\u69d8|\u6307\u540d|\u304a\u9858\u3044|\u3067|\u306e|\u3063\u3066|\u306f|\u7a7a\u3044|\u3044\u308b|\u3044\u307e\u3059|\u51fa\u52e4|\u7279\u5fb4|\u3069\u3093\u306a|\u30bf\u30a4\u30d7|\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb)/u.test(nearby);
      if (hasClearIntent) return { therapist, confidence: 0.98, reason: "strict_boundary_match" };
    }
  }
  return { therapist: undefined, confidence: 0, reason: "no_match" };
}

function findAliasBoundaryMatch(text, alias) {
  if (!text || !alias) return null;
  let index = text.indexOf(alias);
  while (index >= 0) {
    const after = text.slice(index + alias.length);
    const before = text[index - 1] ?? "";
    const validBefore = !before || !/[A-Za-z0-9]/u.test(before);
    const validAfter =
      !after ||
      /^(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8|\u3067|\u306e|\u3063\u3066|\u306f|\u6307\u540d|\u304a\u9858\u3044|\u7a7a\u3044|\u3044\u308b|\u3044\u307e\u3059|\u51fa\u52e4|\u7279\u5fb4|\u3069\u3093\u306a|\u30bf\u30a4\u30d7|\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb|\d|$)/u.test(after) ||
      !/[A-Za-z0-9\u3041-\u309f\u30a1-\u30ff\u4e00-\u9faf]/u.test(after[0] ?? "");
    if (validBefore && validAfter) return { index, length: alias.length };
    index = text.indexOf(alias, index + 1);
  }
  return null;
}

function therapistNameAliases(value) {
  const displayName = normalizeJapaneseSpeech(value).replace(/\s+/g, "");
  const base = displayName.replace(/(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)/g, "");
  const aliases = [normalizeTherapistName(base)];
  if (base.includes("\u7f8e\u54b2") || base.includes("\u4e09\u5d0e")) aliases.push("\u307f\u3055\u304d", "\u4e09\u5d0e", "\u30df\u30b5\u30ad");
  if (base.includes("\u305b\u3044\u3089") || base.includes("\u6e05\u6f84") || base.includes("\u6e05\u826f")) aliases.push("\u305b\u3044\u3089", "\u30bb\u30fc\u30e9", "\u305b\u30fc\u3089", "\u6e05\u826f", "\u6e05\u6f84\u6e05\u826f", "\u304d\u3088\u3059\u307f\u305b\u3044\u3089");
  if (base.includes("\u73b2\u5948")) aliases.push("\u308c\u3044\u306a");
  if (base.includes("\u8475")) aliases.push("\u3042\u304a\u3044");
  if (base.toLowerCase().includes("kana")) aliases.push("\u304b\u306a", "kana");
  return [...new Set(aliases.filter(Boolean))];
}

function normalizeTherapistName(value) {
  const text = normalizeJapaneseSpeech(value).replace(/\s+/g, "").replace(/(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)/g, "");
  const aliases = {
    "\u307f\u3055\u304d": "\u7f8e\u54b2",
    "\u4e09\u5d0e": "\u7f8e\u54b2",
    "\u30df\u30b5\u30ad": "\u7f8e\u54b2",
    "\u305b\u3044\u3089": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u305b\u30fc\u3089": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u30bb\u30fc\u30e9": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u6e05\u826f": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u6e05\u6f84\u6e05\u826f": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u304d\u3088\u3059\u307f\u305b\u3044\u3089": "\u6e05\u6f84\u305b\u3044\u3089",
    "\u308c\u3044\u306a": "\u73b2\u5948",
    "\u3042\u304a\u3044": "\u8475",
    "\u304b\u306a": "kana"
  };
  return aliases[text] || text;
}

function formatTherapistRecommendationAnswer(therapists, draft) {
  const activeTherapists = therapists ?? [];
  const names = activeTherapists
    .map((therapist) => spokenTherapistName(therapist?.displayName || therapist?.name))
    .filter(Boolean)
    .slice(0, 4);
  const candidates = names.length ? names.join("\u3055\u3093\u3001") + "\u3055\u3093" : "";
  const profileText = activeTherapists
    .map((therapist) => formatTherapistProfileForSpeech(therapist))
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  const prefix = candidates
    ? "\u672c\u65e5\u306f" + candidates + "\u304c\u5019\u88dc\u3067\u3059\u3002"
    : "\u51fa\u52e4\u3092\u78ba\u8a8d\u3057\u306a\u304c\u3089\u3054\u6848\u5185\u3057\u307e\u3059\u3002";
  const profile = profileText
    ? profileText
    : "\u8a73\u7d30\u306f\u5e97\u8217\u78ba\u8a8d\u306b\u306a\u308a\u307e\u3059\u3002";
  const next = draft?.nominationIntent === undefined
    ? "\u3054\u6307\u540d\u306b\u3057\u307e\u3059\u304b\uff1f\u30d5\u30ea\u30fc\u3067\u9032\u3081\u307e\u3059\u304b\uff1f"
    : buildShortNextQuestion(draft);
  return (prefix + profile + next).trim();
}

function formatTherapistProfileForSpeech(therapist) {
  const name = spokenTherapistName(therapist?.displayName || therapist?.name);
  const profile = formatTherapistProfileSummaryForSpeech(therapist?.profile, 44);
  if (!name || !profile) return "";
  return name + "\u3055\u3093\u306f" + profile;
}

function formatSpecificTherapistFeatureAnswer(text, therapists, draft) {
  if (!isTherapistFeatureQuestionText(text) && !isAppearanceQuestionText(text)) return "";
  const mentionedTherapist = findTherapistMentionForFeatureQuestion(text, therapists);
  const draftTherapist = findTherapistBySpokenName(draft?.suggestedTherapistName ?? draft?.therapistName, therapists);
  const hasTherapistContext = Boolean(mentionedTherapist || draftTherapist);
  if (isTreatmentServiceQuestionText(text) && !isAppearanceQuestionText(text) && !hasTherapistContext) return "";
  if (!hasTherapistContext && /\u3069\u3093\u306a\u611f\u3058/u.test(text)) return "";
  const continuation = buildTherapistFeatureContinuation(draft);
  if (draft) draft.therapistFeatureQuestionCount = Number(draft.therapistFeatureQuestionCount ?? 0) + 1;
  const therapist = mentionedTherapist ?? draftTherapist;
  if (!therapist) {
    return "\u3069\u306e\u30bb\u30e9\u30d4\u30b9\u30c8\u306e\u7279\u5fb4\u3092\u78ba\u8a8d\u3057\u307e\u3059\u304b\uff1f";
  }
  const name = spokenTherapistName(therapist.displayName || therapist.name);
  const fieldReply = buildTherapistProfileFieldAnswer(therapist, text, continuation);
  if (fieldReply) return fieldReply;
  const profile = formatTherapistProfileSummaryForSpeech(therapist.profile, 56);
  if (!profile) {
    return name + "\u3055\u3093\u306e\u8a73\u7d30\u306f\u5e97\u8217\u78ba\u8a8d\u306b\u306a\u308a\u307e\u3059\u3002" + continuation;
  }
  return name + "\u3055\u3093\u306f\u3001" + profile + continuation;
}

function buildTherapistFeatureContinuation(draft) {
  const count = Number(draft?.therapistFeatureQuestionCount ?? 0);
  if (!draft?.suggestedStartsAt) return "\u3054\u6307\u540d\u3067\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3059\u304b\uff1f";
  if (count === 0) return "\u4e88\u7d04\u3078\u9032\u3080\u5834\u5408\u306f\u300c\u304a\u9858\u3044\u3057\u307e\u3059\u300d\u3067\u5927\u4e08\u592b\u3067\u3059\u3002";
  return "";
}

function isTherapistFeatureQuestionText(text) {
  return /(\u7279\u5fb4|\u3069\u3093\u306a\u5b50|\u3069\u3093\u306a\u5973\u306e\u5b50|\u3069\u3093\u306a\u4eba|\u3069\u3093\u306a\u611f\u3058|\u3069\u3046\u3044\u3046\u4eba|\u3069\u3046\u3044\u3046\u5b50|\u5973\u306e\u5b50.*\u3069\u3093\u306a|\u30bf\u30a4\u30d7|\u96f0\u56f2\u6c17|\u6027\u683c|\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb|\u898b\u305f\u76ee|\u9854|\u30b9\u30bf\u30a4\u30eb|\u5199\u771f|\u753b\u50cf|\u8eab\u9577|\u80cc|\u30d0\u30b9\u30c8|\u30ab\u30c3\u30d7|\u30d2\u30c3\u30d7|\u304a\u5c3b|\u8ab0\u306b\u4f3c|\u4f3c\u3066|\u4eba\u6c17|\u30ea\u30d4|\u5f97\u610f|SM|S\u5bc4\u308a|M\u5bc4\u308a|\u30d7\u30ec\u30a4|\u3069\u3053\u307e\u3067|\u5bfe\u5fdc\u7bc4\u56f2)/iu.test(text);
}

function formatTherapistProfileSummaryForSpeech(value, maxLength = 56) {
  const fields = parseTherapistProfileFields(value);
  if (Object.keys(fields).length) {
    const summary = buildTherapistProfileOverview(fields);
    if (summary) return trimSpeechSummaryAtBoundary(summary, maxLength).replace(/[。.!！?？]+$/u, "") + "\u3067\u3059\u3002";
  }
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .replace(/[。.!！?？]+$/u, "")
    .replace(/。+/g, "\u3001");
  if (!text) return "";
  return text.endsWith("\u3067\u3059") ? text + "\u3002" : text + "\u3067\u3059\u3002";
}

function buildTherapistScopeProfileReply(match, draft, context, callerText, next) {
  if (!["ambiguous_slang", "review_slang", "normal_course_question"].includes(match?.category)) return "";
  if (!/(SM|S\u5bc4\u308a|M\u5bc4\u308a|\u30d7\u30ec\u30a4|\u3069\u3053\u307e\u3067|\u5f97\u610f|\u5bfe\u5fdc\u7bc4\u56f2|\u30b5\u30fc\u30d3\u30b9)/iu.test(String(callerText ?? ""))) return "";
  const therapists = context?.therapists ?? [];
  const therapist = findTherapistMentionForFeatureQuestion(callerText, therapists) ?? findTherapistBySpokenName(draft?.suggestedTherapistName ?? draft?.therapistName, therapists);
  if (!therapist) return "";
  return buildTherapistProfileFieldAnswer(therapist, callerText, next, { preferScope: true });
}

function buildTherapistProfileFieldAnswer(therapist, text, continuation, options = {}) {
  const fields = parseTherapistProfileFields(therapist?.profile);
  if (!Object.keys(fields).length) return "";
  const question = options.preferScope
    ? { label: "\u5bfe\u5fdc\u7bc4\u56f2", keys: ["serviceScope", "treatmentStyle", "smTendency"], needsBoundary: true }
    : classifyTherapistProfileFieldQuestion(text);
  if (!question) return "";
  const name = spokenTherapistName(therapist?.displayName || therapist?.name);
  const detail = buildTherapistProfileQuestionDetail(question, fields);
  if (!detail) return "";
  const boundary = question.needsBoundary
    ? "\u8a73\u3057\u3044\u53ef\u5426\u306f\u5e97\u8217\u78ba\u8a8d\u3067\u3054\u6848\u5185\u3057\u307e\u3059\u3002"
    : "";
  return compactSpeechReply(`${name}\u3055\u3093\u306e${question.label}\u306f\u3001${detail}\u3002${boundary}${continuation}`);
}

function classifyTherapistProfileFieldQuestion(text) {
  const value = normalizeJapaneseSpeech(text);
  if (/(\u30b9\u30bf\u30a4\u30eb|\u30bf\u30a4\u30eb|\u4f53\u578b|\u4f53\u683c|\u30b5\u30a4\u30ba|\u30b9\u30ea\u30e0|\u30b0\u30e9\u30de\u30fc)/u.test(value)) return { label: "\u30b9\u30bf\u30a4\u30eb", keys: ["height", "bust", "hip"] };
  if (/(\u8eab\u9577|\u80cc|\u4f55\u30bb\u30f3\u30c1|cm)/iu.test(value)) return { label: "\u8eab\u9577", keys: ["height"] };
  if (/(\u30d0\u30b9\u30c8|\u80f8|\u30ab\u30c3\u30d7)/u.test(value)) return { label: "\u30d0\u30b9\u30c8", keys: ["bust"] };
  if (/(\u30d2\u30c3\u30d7|\u304a\u5c3b|\u5c3b)/u.test(value)) return { label: "\u30d2\u30c3\u30d7", keys: ["hip"] };
  if (/(\u8ab0\u306b\u4f3c|\u4f3c\u3066|\u82b8\u80fd\u4eba)/u.test(value)) return { label: "\u4f3c\u3066\u3044\u308b\u96f0\u56f2\u6c17", keys: ["lookalike", "face"] };
  if (/(\u9854|\u898b\u305f\u76ee|\u53ef\u611b|\u304b\u308f\u3044|\u7dba\u9e97|\u304d\u308c\u3044|\u7f8e\u4eba|\u5199\u771f|\u753b\u50cf)/u.test(value)) return { label: "\u898b\u305f\u76ee\u306e\u96f0\u56f2\u6c17", keys: ["face", "lookalike"] };
  if (/(\u6027\u683c|\u4eba\u67c4|\u8a71\u3057|\u63a5\u5ba2|\u4f1a\u8a71)/u.test(value)) return { label: "\u6027\u683c", keys: ["personality"] };
  if (/(\u4eba\u6c17|\u30ea\u30d4|\u304a\u3059\u3059\u3081|\u4e88\u7d04\u5165\u308a)/u.test(value)) return { label: "\u4eba\u6c17\u50be\u5411", keys: ["popularity"] };
  if (/(SM|S\u5bc4\u308a|M\u5bc4\u308a|\u8cac\u3081|\u53d7\u3051)/iu.test(value)) return { label: "SM\u50be\u5411", keys: ["smTendency", "serviceScope"], needsBoundary: true };
  if (/(\u30d7\u30ec\u30a4|\u3069\u3053\u307e\u3067|\u5bfe\u5fdc\u7bc4\u56f2|\u30b5\u30fc\u30d3\u30b9\u7bc4\u56f2|\u3067\u304d\u308b\u3053\u3068)/u.test(value)) return { label: "\u5bfe\u5fdc\u7bc4\u56f2", keys: ["serviceScope", "treatmentStyle"], needsBoundary: true };
  if (/(\u5f97\u610f|\u65bd\u8853|\u30ea\u30f3\u30d1|\u9f20\u5f84\u90e8|\u30db\u30a4\u30c3\u30d7|\u30d5\u30a7\u30b6\u30fc)/u.test(value)) return { label: "\u5f97\u610f\u306a\u65bd\u8853", keys: ["treatmentStyle"] };
  if (/(\u30bf\u30a4\u30d7|\u3069\u3093\u306a\u5b50|\u3069\u3093\u306a\u4eba|\u3069\u3046\u3044\u3046\u5b50|\u3069\u3046\u3044\u3046\u4eba|\u96f0\u56f2\u6c17|\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb|\u7279\u5fb4)/u.test(value)) return { label: "\u30bf\u30a4\u30d7", keys: ["type", "personality"] };
  return null;
}

function buildTherapistProfileQuestionDetail(question, fields) {
  if (question.label === "\u30b9\u30bf\u30a4\u30eb") {
    const bodyParts = [
      fields.height ? `\u8eab\u9577\u306f${formatTherapistProfileMetricForPhone(fields.height, "height")}` : "",
      fields.bust ? `\u30d0\u30b9\u30c8\u306f${formatTherapistProfileMetricForPhone(fields.bust, "bust")}` : "",
      fields.hip ? `\u30d2\u30c3\u30d7\u306f${formatTherapistProfileMetricForPhone(fields.hip, "hip")}` : ""
    ].filter(Boolean);
    return bodyParts.join("\u3001");
  }
  const values = question.keys
    .map((key) => fields[key])
    .filter(Boolean)
    .map(cleanTherapistProfileValueForSpeech)
    .filter(Boolean);
  if (!values.length) return "";
  const maxValues = question.label === "\u30bf\u30a4\u30d7" ? 2 : 1;
  return values.slice(0, maxValues).join("\u3002");
}

function cleanTherapistProfileValueForSpeech(value) {
  return String(value ?? "")
    .replace(/[。.!！?？]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTherapistProfileMetricForPhone(value, kind) {
  const cleaned = cleanTherapistProfileValueForSpeech(value);
  const plain = normalizePlainDigits(cleaned);
  const cm = plain.match(/^([0-9]{2,3})\s*(?:cm|\u30bb\u30f3\u30c1)?(?:\u76ee\u5b89|\u304f\u3089\u3044)?$/iu);
  if (cm && (kind === "height" || kind === "hip")) return `${cm[1]}\u30bb\u30f3\u30c1\u304f\u3089\u3044`;
  const cup = plain.match(/^([A-H])\s*\u30ab\u30c3\u30d7(?:\u76ee\u5b89|\u304f\u3089\u3044)?$/iu);
  if (cup && kind === "bust") return `${cup[1].toUpperCase()}\u30ab\u30c3\u30d7\u304f\u3089\u3044`;
  return cleaned.replace(/\u76ee\u5b89$/u, "\u304f\u3089\u3044");
}

function trimSpeechSummaryAtBoundary(value, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const sentenceBreak = clipped.lastIndexOf("\u3002");
  if (sentenceBreak >= 16) return clipped.slice(0, sentenceBreak);
  const commaBreak = clipped.lastIndexOf("\u3001");
  if (commaBreak >= 16) return clipped.slice(0, commaBreak);
  return clipped.replace(/(?:\u591c\u5e2f\u306b|\u591c\u306b|\u3086\u3063\u305f\u308a|\u5411\u3051|\u5bc4\u308a|\u30bf\u30a4\u30d7)?$/u, "").trim();
}

function parseTherapistProfileFields(value) {
  const result = {};
  const chunks = String(value ?? "")
    .split(/[|\uff5c;\n\r]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const match = chunk.match(/^([^:：]+)[:：]\s*(.+)$/u);
    if (!match) continue;
    const key = normalizeTherapistProfileFieldKey(match[1]);
    if (!key) continue;
    result[key] = match[2].trim();
  }
  return result;
}

function normalizeTherapistProfileFieldKey(label) {
  const key = normalizeJapaneseSpeech(label);
  if (/性格|人柄|接客/u.test(key)) return "personality";
  if (/身長|背/u.test(key)) return "height";
  if (/バスト|胸|カップ/u.test(key)) return "bust";
  if (/ヒップ|尻|お尻/u.test(key)) return "hip";
  if (/顔|見た目|雰囲気/u.test(key)) return "face";
  if (/似て|芸能人/u.test(key)) return "lookalike";
  if (/タイプ|系統/u.test(key)) return "type";
  if (/得意|施術|スタイル/u.test(key)) return "treatmentStyle";
  if (/SM|S\/M|S寄り|M寄り/u.test(key)) return "smTendency";
  if (/どこまで|対応範囲|サービス範囲/u.test(key)) return "serviceScope";
  if (/人気|リピ|予約/u.test(key)) return "popularity";
  return "";
}

function buildTherapistProfileOverview(fields) {
  const parts = [fields.personality, fields.type, fields.treatmentStyle]
    .filter(Boolean)
    .map((value) => String(value).replace(/[。.!！?？]+$/u, "").trim());
  return parts.join("\u3001");
}

function findTherapistBySpokenName(value, therapists) {
  const target = normalizeTherapistName(value);
  if (!target) return undefined;
  for (const therapist of therapists ?? []) {
    const display = String(therapist?.displayName || therapist?.name || "").trim();
    const spoken = spokenTherapistName(display);
    const aliases = [...new Set([display, spoken, normalizeTherapistName(display), ...therapistNameAliases(display)].filter(Boolean))];
    if (aliases.some((alias) => namesLookSame(normalizeTherapistName(alias), target))) return therapist;
  }
  return undefined;
}

function findTherapistMentionForFeatureQuestion(text, therapists) {
  const raw = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  const normalized = normalizeTherapistName(raw);
  if (!raw || isTherapistFalsePositiveText(raw)) return undefined;
  for (const therapist of therapists ?? []) {
    const display = String(therapist?.displayName || therapist?.name || "").trim();
    const spoken = spokenTherapistName(display);
    const candidates = [...new Set([display, spoken, normalizeTherapistName(display), ...therapistNameAliases(display)].filter(Boolean))];
    for (const candidate of candidates) {
      const alias = normalizeJapaneseSpeech(candidate).replace(/\s+/g, "").replace(/(?:\u3055\u3093|\u3061\u3083\u3093|\u69d8)$/u, "");
      const normalizedAlias = normalizeTherapistName(alias);
      if (findAliasBoundaryMatch(raw, alias) || findAliasBoundaryMatch(normalized, normalizedAlias)) {
        return therapist;
      }
    }
  }
  return undefined;
}

function formatTherapistAvailabilityAnswer(therapists) {
  const names = (therapists ?? [])
    .map((therapist) => spokenTherapistName(therapist?.displayName || therapist?.name))
    .filter(Boolean)
    .slice(0, 4);

  if (names.length) {
    return `本日は${names.join("さん、")}さんが登録されています。ご希望の時間をお伝えください。`;
  }

  return "出勤状況を確認します。ご希望の時間をお伝えください。";
}

function spokenTherapistName(value) {
  const name = String(value ?? "").trim();
  if (!name) return "";
  if (/^[A-Za-z]+$/.test(name)) {
    const lower = name.toLowerCase();
    const known = {
      kana: "かな",
      rena: "れな",
      reina: "れいな",
      misaki: "みさき",
      aoi: "あおい",
      yui: "ゆい",
      rina: "りな",
      rin: "りん"
    };
    return known[lower] ?? "";
  }
  return name;
}

function isCallClosingText(text) {
  return /(\u5207\u3063\u3066|\u5207\u308a\u307e\u3059|\u7d42\u308f\u308a|\u5927\u4e08\u592b|\u3042\u308a\u304c\u3068\u3046|\u5931\u793c)/u.test(text);
}

function buildShortNextQuestion(draft, availableCourses = draft.availableCourses ?? []) {
  if (!draft.startsAt) {
    draft.awaitingField = "startsAt";
    return "\u3054\u5e0c\u671b\u306f\u3044\u3064\u9803\u3067\u3059\u304b\uff1f";
  }
  if (draft.availabilityCheckResult?.ok !== true) {
    draft.awaitingField = "startsAt";
    return "\u3054\u5e0c\u671b\u6642\u9593\u306e\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002";
  }
  if (!draft.customerName) {
    draft.awaitingField = "name";
    return "\u304a\u540d\u524d\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002\u82d7\u5b57\u3060\u3051\u3067\u3082\u5927\u4e08\u592b\u3067\u3059\u3002";
  }
  if (!draft.phone) {
    draft.awaitingField = "phone";
    return "\u304a\u96fb\u8a71\u756a\u53f7\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }
  if (!draft.course && availableCourses.length === 1) {
    draft.course = availableCourses[0];
  }
  if (!draft.course) {
    draft.awaitingField = "course";
    return formatCourseMenuBrief(availableCourses) + "\u3054\u5e0c\u671b\u306f\u3069\u3061\u3089\u3067\u3059\u304b\uff1f";
  }
  if (draft.firstVisit === undefined) {
    draft.awaitingField = "firstVisit";
    return "\u3054\u5229\u7528\u306f\u521d\u3081\u3066\u3067\u3059\u304b\uff1f\u4ee5\u524d\u3082\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  if (draft.attentionConfirmed !== true) {
    draft.awaitingField = "attention";
    return "\u6ce8\u610f\u4e8b\u9805\u3068\u5e97\u8217\u30eb\u30fc\u30eb\u306e\u78ba\u8a8d\u5f8c\u3001\u300c\u78ba\u8a8d\u3057\u307e\u3057\u305f\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
  }
  return "";
}

async function ensureStoreReceptionContext(session) {
  if (session.storeContext?.storeId === session.storeId) return session.storeContext;
  session.storeContext = await loadStoreReceptionContext(session.storeId);
  return session.storeContext;
}

async function ensurePhoneConversation(session) {
  if (isRegressionCall(session)) return undefined;
  if (!process.env.DATABASE_URL || !session.storeId || session.conversationId) return session.conversationId;
  const conversationId = session.callSid ? `phone-${session.callSid}` : `phone-${crypto.randomUUID()}`;
  const externalUserId = session.callSid || session.from || undefined;

  const conversation = await prisma.conversation
    .upsert({
      where: { id: conversationId },
      update: {
        workflowState: "PHONE_ACTIVE",
        ...(externalUserId ? { externalUserId } : {})
      },
      create: {
        id: conversationId,
        storeId: session.storeId,
        channel: "PHONE",
        ...(externalUserId ? { externalUserId } : {}),
        workflowState: "PHONE_ACTIVE",
        reservationDraft: session.reservationDraft ?? undefined
      }
    })
    .catch((error) => {
      console.warn("phone conversation write failed:", error.message);
      return null;
    });

  session.conversationId = conversation?.id;
  return session.conversationId;
}

async function appendPhoneConversationMessage(session, role, content) {
  const body = String(content ?? "").trim();
  if (isRegressionCall(session)) return;
  if (!body || !process.env.DATABASE_URL || !session.storeId) return;

  const conversationId = await ensurePhoneConversation(session);
  if (!conversationId) return;

  await prisma.message
    .create({
      data: {
        conversationId,
        role,
        content: body
      }
    })
    .catch((error) => console.warn("phone message write failed:", error.message));

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: {
        workflowState: session.reservationId ? "RESERVATION_CREATED" : "PHONE_ACTIVE",
        reservationDraft: session.reservationDraft ?? undefined,
        summary: [...session.transcript, ...session.assistantTranscript].join("\n").slice(-1800) || undefined
      }
    })
    .catch(() => null);
}

async function loadStoreReceptionContext(storeId) {
  if (!process.env.DATABASE_URL || !storeId) {
    return { storeId, store: null, courses: [], options: [], therapists: [], rooms: [] };
  }

  try {
    const [store, courses, options, therapists, rooms] = await Promise.all([
      prisma.store.findUnique({
        where: { id: storeId },
        include: { setting: true, aiSetting: true }
      }),
      prisma.course.findMany({
        where: { storeId, isActive: true },
        orderBy: [{ durationMin: "asc" }, { price: "asc" }]
      }),
      prisma.courseOption.findMany({
        where: { storeId, isActive: true },
        orderBy: [{ price: "asc" }, { name: "asc" }],
        take: 20
      }),
      prisma.therapist.findMany({
        where: { storeId, status: "ACTIVE" },
        orderBy: { displayName: "asc" },
        take: 10
      }),
      prisma.room.findMany({
        where: { storeId, isActive: true },
        orderBy: { name: "asc" }
      })
    ]);
    return { storeId, store, courses, options, therapists, rooms };
  } catch (error) {
    logRelay("store_context_load_failed", {
      storeId,
      message: error instanceof Error ? error.message : String(error)
    });
    return { storeId, store: null, courses: [], options: [], therapists: [], rooms: [] };
  }
}

function findMentionedCourse(text, courses) {
  const normalized = normalizeJapaneseSpeech(text);
  return courses.find((course) => {
    const name = normalizeJapaneseSpeech(course.name);
    return normalized.includes(name) || normalized.includes(`${course.durationMin}分`) || normalized.includes(String(course.durationMin));
  });
}

function formatCourseMenu(courses) {
  return formatCourseMenuBrief(courses) + "\u3054\u4e88\u7d04\u3067\u3057\u305f\u3089\u3001\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
}

function formatCourseMenuBrief(courses) {
  if (!courses.length) {
    return "\u30b3\u30fc\u30b9\u60c5\u5831\u3092\u78ba\u8a8d\u4e2d\u3067\u3059\u3002\u3054\u5e0c\u671b\u306e\u5206\u6570\u304c\u3042\u308c\u3070\u5148\u306b\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
  }

  const menu = courses
    .slice(0, 3)
    .map(formatCourseLineForSpeech)
    .join("\u3001");
  const suffix = courses.length > 3 ? "\u306a\u3069" : "";
  const overview = buildCourseOverviewSentence(courses);
  return "\u30b3\u30fc\u30b9\u306f" + menu + suffix + "\u3067\u3059\u3002" + overview;
}

function formatCourseLineForSpeech(course) {
  return formatCourseNameForSpeech(course.name) + "\uff08" + String(course.durationMin) + "\u5206\u3001" + formatYen(course.price) + "\uff09";
}

function formatSingleCourseDetail(course) {
  const base = formatCourseLineForSpeech(course);
  const description = sanitizeCourseDescriptionForSpeech(course.description);
  if (description) return `${base}です。内容は${description}です。`;
  return `${base}です。${defaultCourseFeatureSentence(course)}`;
}

function buildCourseOverviewSentence(courses) {
  if (courses.length === 1) {
    const description = sanitizeCourseDescriptionForSpeech(courses[0].description);
    if (description) return "内容は" + description + "です。";
    return defaultCourseFeatureSentence(courses[0]);
  }
  if (courses.some((course) => Number(course.durationMin) >= 120)) {
    return "短めから長めまで、時間に合わせて全身とリンパ周りを確認します。";
  }
  return "内容は、全身のリラクゼーションとリンパ周りのケアが中心です。";
}

function defaultCourseFeatureSentence(course) {
  const duration = Number(course?.durationMin ?? 0);
  if (duration >= 120) return "長めにゆっくり全身を受けたい方向けです。";
  if (duration >= 90) return "全身とリンパ周りをバランスよく受けやすい標準時間です。";
  if (duration > 0) return "短時間で気になる箇所を中心に受けたい方向けです。";
  return "全身のリラクゼーションとリンパ周りのケアが中心です。";
}

function sanitizeCourseDescriptionForSpeech(value) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/デモ店舗の?/g, "")
    .replace(/サンプル店の?/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 70);
  if (/^(標準の?)?\d+分コースです?$/u.test(text)) return "";
  if (/^(標準の?)?90分コースです?$/u.test(text)) return "";
  return text;
}

function formatCourseNameForSpeech(value) {
  return String(value ?? "")
    .replace(/Legend\s*Massage/giu, "\u30ec\u30b8\u30a7\u30f3\u30c9\u30de\u30c3\u30b5\u30fc\u30b8")
    .replace(/\s+/g, " ")
    .trim();
}

function formatYen(value) {
  return String(Number(value ?? 0).toLocaleString("ja-JP")) + "\u5186";
}

function createReservationDraft() {
  return {
    startsAt: undefined,
    startsAtText: "",
    requested_date: undefined,
    requested_time: undefined,
    requested_datetime: undefined,
    last_requested_date: undefined,
    last_requested_time: undefined,
    last_requested_datetime: undefined,
    date_source: undefined,
    time_source: undefined,
    date_confidence: undefined,
    time_confidence: undefined,
    availability_query_datetime: undefined,
    alternative_search_from_datetime: undefined,
    last_availability_checked_datetime: undefined,
    last_availability_response: undefined,
    alternative_candidates_shown: [],
    pending_time_candidate: undefined,
    pending_time_confirmation: undefined,
    pending_date_confirmation: undefined,
    datetime_confirmation_required: undefined,
    availability_search_mode: false,
    candidateOfferSequence: 0,
    suggestedCandidateOfferKey: undefined,
    repeat_response_count: 0,
    repeat_response_key: undefined,
    datetime_guard_category: undefined,
    datetime_guard_priority: undefined,
    therapist_match_confidence: undefined,
    therapist_match_guarded: false,
    availableCourses: [],
    course: undefined,
    options: [],
    nominationIntent: undefined,
    therapistName: undefined,
    selected_therapist_source: undefined,
    suggested_therapist: undefined,
    suggestedNominationIntent: undefined,
    customerName: undefined,
    phone: undefined,
    phoneMismatchConfirmation: undefined,
    firstVisit: undefined,
    attentionConfirmed: undefined,
    awaitingField: undefined,
    awaitingFinalConfirmation: false,
    therapistFeatureQuestionCount: 0,
    completed: false
  };
}

function updateReservationDraft(session, callerText, context) {
  const draft = session.reservationDraft ?? createReservationDraft();
  const text = normalizeJapaneseSpeech(callerText);
  const courses = context?.courses ?? [];
  const therapists = context?.therapists ?? [];
  draft.availableCourses = courses;

  const phoneBeforeDatetime = extractPhoneNumber(callerText);
  const skipDatetimeParse = draft.awaitingField === "phone" && Boolean(phoneBeforeDatetime);
  const datetimeParse = skipDatetimeParse
    ? buildDateTimeParseLog(draft, undefined, undefined, {
        raw_utterance: callerText,
        next_action: "keep_datetime_while_collecting_phone"
      })
    : applyRequestedDateTimeState(draft, callerText, context?.store);
  logConversationState(session, "datetime_parse", {
    raw_utterance: callerText,
    ...datetimeParse
  });

  const course = findMentionedCourse(text, courses);
  if (course && (draft.awaitingField === "course" || draft.startsAt || isReservationLikely(text))) draft.course = course;

  const nomination = extractNomination(callerText, therapists);
  if (nomination.found) {
    draft.therapist_match_confidence = nomination.intent === false ? 0 : nomination.confidence ?? draft.therapist_match_confidence;
    draft.therapist_match_guarded = nomination.intent === true && (nomination.confidence ?? 1) < THERAPIST_MATCH_CONFIDENCE_THRESHOLD;
    draft.nominationIntent = nomination.intent;
    if (nomination.therapistName) draft.therapistName = nomination.therapistName;
    if (nomination.intent && nomination.confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD) {
      draft.selected_therapist_source = "explicit_user_nomination";
    }
    if (nomination.intent && !draft.therapistName && session.selectedTherapist && draft.selected_therapist_source === "explicit_user_nomination") draft.therapistName = session.selectedTherapist;
    if (!nomination.intent) {
      draft.therapistName = undefined;
      draft.selected_therapist_source = undefined;
      session.selectedTherapist = undefined;
    }
  }
  if (draft.therapistName && draft.selected_therapist_source === "explicit_user_nomination") session.selectedTherapist = draft.therapistName;

  const phone = phoneBeforeDatetime;
  if (phone && canCollectCustomerInfo(draft) && draft.awaitingField === "phone") {
    setDraftPhoneFromCallerInput(session, draft, phone);
  }

  const firstVisit = extractFirstVisit(callerText, draft.awaitingField);
  if (firstVisit !== undefined) draft.firstVisit = firstVisit;

  if (extractAttentionConfirmed(callerText, draft.awaitingField)) {
    draft.attentionConfirmed = true;
  }

  if (canCollectCustomerInfo(draft) && draft.awaitingField === "name") {
    const name = extractCustomerName(callerText, draft.awaitingField);
    if (name && (!draft.customerName || isExplicitCustomerNameCorrection(callerText))) draft.customerName = name;
  }

  session.reservationDraft = draft;
}

async function handleStateSafeFreeTalk(session, callerText, context) {
  const draft = session.reservationDraft;
  if (!draft || draft.completed) return "";
  const text = normalizeJapaneseSpeech(callerText);
  if (!text) return "";
  if (draft.awaitingField === "phoneMismatchConfirmation" || draft.phoneMismatchConfirmation) return "";
  if (draft.awaitingField === "firstVisit" && extractFirstVisit(callerText, "firstVisit") !== undefined) return "";
  if (["attention", "attentionConfirmed"].includes(draft.awaitingField) && isAttentionConfirmationText(text)) return "";
  if (draft.awaitingFinalConfirmation && isAffirmative(text)) return "";
  if (extractPhoneNumber(callerText)) return "";
  if (hasDateTimeCue(text) && !isStateMetaQuestion(text)) return "";

  if (!draft.suggestedStartsAt && isUnavailableStopText(text) && !isCourseOrOptionContinuationText(text) && (draft.availabilityCheckResult?.ok === false || draft.availability_search_mode || draft.noSameDayShift)) {
    const reply = buildUnavailableStopReply(draft);
    logConversationState(session, "state_safe_free_talk", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "close_without_reservation",
      error_reason: "customer_stopped_after_unavailable"
    });
    return reply;
  }

  if (isOtherTherapistCandidateRequest(text) && (draft.suggestedStartsAt || draft.startsAt)) {
    const reply = await buildOtherTherapistCandidateReply(session, context, draft);
    logConversationState(session, "state_safe_free_talk", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "search_other_therapist_candidate",
      error_reason: "other_therapist_request"
    });
    return reply;
  }

  if (isOtherCandidateRequest(text) && (draft.suggestedStartsAt || draft.availabilityCheckResult?.ok === false || draft.availability_search_mode)) {
    const reply = await buildAvailabilitySearchReply(session, context, callerText);
    logConversationState(session, "state_safe_free_talk", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: "search_alternative_candidate",
      error_reason: "other_candidate_request"
    });
    return reply;
  }

  if (isCurrentReservationSummaryQuestion(text)) {
    const reply = buildCurrentReservationSummaryReply(draft);
    logConversationState(session, "state_safe_free_talk", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: draft.awaitingField ?? "continue_flow",
      error_reason: "summary_question"
    });
    return reply;
  }

  if (isAlreadySaidComplaint(text) || isWhatShouldISayQuestion(text) || isAudioOrPaceComplaint(text)) {
    const reply = buildStateSafeRecoveryReply(draft, context, text);
    logConversationState(session, "state_safe_free_talk", {
      user_utterance: callerText,
      assistant_response: reply,
      next_action: draft.awaitingField ?? "continue_flow",
      error_reason: isAlreadySaidComplaint(text) ? "already_said" : isWhatShouldISayQuestion(text) ? "help_question" : "audio_or_pace"
    });
    return reply;
  }

  return "";
}

function isStateMetaQuestion(text) {
  return /(\u4f55\u3092|\u306a\u306b\u3092|\u3069\u3046\u3059\u308c\u3070|\u3069\u3046\u3057\u305f\u3089|\u8a00\u3048\u3070|\u8a00\u3046\u306e|\u805e\u3053\u3048|\u3082\u3046\u8a00\u3063\u305f|\u3055\u3063\u304d|\u78ba\u8a8d|\u5408\u3063\u3066|\u4eca\u306e\u5185\u5bb9)/u.test(text);
}

function isAlreadySaidComplaint(text) {
  return /(\u3055\u3063\u304d|\u3055\u304d\u307b\u3069|\u5148\u307b\u3069|\u3082\u3046).*(\u8a00\u3063\u305f|\u4f1d\u3048\u305f|\u8a00\u3044\u307e\u3057\u305f|\u4f1d\u3048\u307e\u3057\u305f)|(\u8a00\u3063\u305f\u3068\u601d\u3046|\u4f1d\u3048\u305f\u3068\u601d\u3046|\u3055\u3063\u304d\u8a00\u3063\u305f|\u3082\u3046\u8a00\u3063\u305f)/u.test(text);
}

function isWhatShouldISayQuestion(text) {
  return /(\u4f55\u3092\u8a00\u3048\u3070|\u306a\u306b\u3092\u8a00\u3048\u3070|\u4f55\u8a00\u3046|\u306a\u306b\u8a00\u3046|\u3069\u3046\u3059\u308c\u3070|\u3069\u3046\u3057\u305f\u3089|\u6b21\u306f\u4f55|\u6b21\u306a\u306b)/u.test(text);
}

function isAudioOrPaceComplaint(text) {
  return /(\u805e\u3053\u3048\u306a\u3044|\u805e\u304d\u53d6\u308c\u306a\u3044|\u3086\u3063\u304f\u308a|\u901f\u3044|\u9045\u3044|\u3082\u3046\u4e00\u56de|\u3082\u3046\u3044\u3063\u304b\u3044|\u308f\u304b\u3089\u306a\u3044|\u5206\u304b\u3089\u306a\u3044|\u4f55\u56de|\u4f55\u5ea6)/u.test(text);
}

function isOtherCandidateRequest(text) {
  return /(\u4ed6|\u307b\u304b|\u5225|\u3079\u3064|\u4ee5\u5916|\u3069\u3053\u304b|\u3069\u3063\u304b|\u7a7a\u3044\u3066\u308b\u65e5|\u958b\u3044\u3066\u308b\u65e5|\u7a7a\u3044\u3066\u308b\u6642\u9593|\u958b\u3044\u3066\u308b\u6642\u9593|\u7a7a\u304d\u5019\u88dc|\u6700\u77ed|\u9055\u3046\u6642\u9593|\u5225\u306e\u6642\u9593|\u5225\u306e\u65e5|\u305d\u308c\u4ee5\u5916|\u67a0\u306f|\u7a7a\u304d\u306f|\u5165\u308c\u308b|\u5165\u3063\u3066\u306a\u3044)/u.test(text);
}

function isOtherTherapistCandidateRequest(text) {
  const normalized = normalizeJapaneseSpeech(text).replace(/\s+/g, "");
  return /(\u4ed6|\u307b\u304b|\u5225|\u3079\u3064|\u9055\u3046|\u4ee5\u5916).*(\u30bb\u30e9\u30d4\u30b9\u30c8|\u30bb\u30e9\u30d5\u30a3\u30b9\u30c8|\u5973\u306e\u5b50|\u62c5\u5f53|\u4eba|\u5b50)|(\u30bb\u30e9\u30d4\u30b9\u30c8|\u30bb\u30e9\u30d5\u30a3\u30b9\u30c8|\u5973\u306e\u5b50|\u62c5\u5f53|\u4eba|\u5b50).*(\u4ed6|\u307b\u304b|\u5225|\u3079\u3064|\u9055\u3046|\u4ee5\u5916)|\u4ee5\u5916\u306e(?:\u4eba|\u5b50|\u65b9)|(?:\u3042\u306e\u4eba|\u305d\u306e\u4eba|\u305d\u306e\u5b50|\u305d\u306e\u65b9).*\u4ee5\u5916/u.test(normalized);
}

function isCurrentReservationSummaryQuestion(text) {
  return /(\u4eca\u306e\u5185\u5bb9|\u4e88\u7d04\u5185\u5bb9|\u78ba\u8a8d\u3057\u3066|\u5408\u3063\u3066\u308b|\u306a\u306b\u3067\u53d6|\u3044\u3064\u3067\u53d6|\u8ab0\u3067\u53d6)/u.test(text);
}

function buildStateSafeRecoveryReply(draft, context, text) {
  const prefix = isAudioOrPaceComplaint(text)
    ? "\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u3002\u3082\u3046\u4e00\u5ea6\u3001\u3086\u3063\u304f\u308a\u78ba\u8a8d\u3057\u307e\u3059\u3002"
    : "\u5931\u793c\u3044\u305f\u3057\u307e\u3057\u305f\u3002";

  if (draft.awaitingField === "name") {
    if (draft.customerName) return prefix + "\u304a\u540d\u524d\u306f" + draft.customerName + "\u69d8\u3067\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u3002\u7d9a\u3051\u3066\u304a\u96fb\u8a71\u756a\u53f7\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
    return prefix + "\u3054\u4e88\u7d04\u8005\u69d8\u306e\u304a\u540d\u524d\u3060\u3051\u304a\u9858\u3044\u3057\u307e\u3059\u3002\u82d7\u5b57\u3060\u3051\u3067\u5927\u4e08\u592b\u3067\u3059\u3002";
  }
  if (draft.awaitingField === "phone") {
    if (draft.phone) return prefix + "\u304a\u96fb\u8a71\u756a\u53f7\u306f" + draft.phone + "\u3067\u78ba\u8a8d\u6e08\u307f\u3067\u3059\u3002\u5185\u5bb9\u3092\u5fa9\u5531\u3057\u307e\u3059\u306e\u3067\u3001\u5408\u3063\u3066\u3044\u308c\u3070\u300c\u306f\u3044\u300d\u3068\u304a\u7b54\u3048\u304f\u3060\u3055\u3044\u3002";
    return prefix + "\u304a\u540d\u524d\u306f" + (draft.customerName ? draft.customerName + "\u69d8" : "\u78ba\u8a8d\u6e08\u307f") + "\u3067\u9032\u3081\u3066\u3044\u307e\u3059\u3002\u3042\u3068\u306f\u304a\u96fb\u8a71\u756a\u53f7\u3060\u3051\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }
  if (draft.awaitingField === "course") {
    return prefix + formatCourseMenu(context?.courses ?? draft.availableCourses ?? []);
  }
  if (draft.awaitingField === "finalConfirmation") {
    if (isAlreadySaidComplaint(text) || isCurrentReservationSummaryQuestion(text)) {
      return prefix + buildCurrentReservationSummaryReply(draft);
    }
    return prefix + "\u73fe\u5728\u306e\u5fa9\u5531\u5185\u5bb9\u304c\u5408\u3063\u3066\u3044\u308c\u3070\u300c\u306f\u3044\u300d\u3001\u9055\u3046\u5834\u5408\u306f\u5909\u66f4\u70b9\u3092\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002";
  }
  if (draft.startsAt) {
    return prefix + buildCurrentReservationSummaryReply(draft);
  }
  return prefix + "\u3054\u5e0c\u671b\u306e\u65e5\u306b\u3061\u3068\u304a\u6642\u9593\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002\u4f8b\u3048\u3070\u3001\u4eca\u65e520\u6642\u3001\u660e\u65e521\u6642\u3067\u3059\u3002";
}

function buildCurrentReservationSummaryReply(draft) {
  const parts = [];
  if (draft.startsAt) parts.push("\u65e5\u6642\u306f" + formatDateTimeJa(draft.startsAt));
  if (draft.course) parts.push("\u30b3\u30fc\u30b9\u306f" + formatCourseNameForSpeech(draft.course.name));
  if (Array.isArray(draft.options) && draft.options.length) parts.push("\u30aa\u30d7\u30b7\u30e7\u30f3\u306f" + draft.options.map((option) => String(option?.name ?? "").trim()).filter(Boolean).join("\u3001"));
  if (draft.nominationIntent) parts.push("\u6307\u540d\u306f" + (draft.therapistName ? draft.therapistName + "\u3055\u3093" : "\u6307\u540d\u3042\u308a"));
  else if (draft.nominationIntent === false) parts.push("\u4e88\u7d04\u7a2e\u5225\u306f\u30d5\u30ea\u30fc");
  if (draft.customerName) parts.push("\u304a\u540d\u524d\u306f" + draft.customerName + "\u69d8");
  if (draft.phone) parts.push("\u304a\u96fb\u8a71\u756a\u53f7\u306f" + draft.phone);
  const next = buildStateNextInstruction(draft);
  return (parts.length ? "\u73fe\u5728\u3001" + parts.join("\u3001") + "\u3067\u9032\u3081\u3066\u3044\u307e\u3059\u3002" : "\u307e\u3060\u4e88\u7d04\u5185\u5bb9\u306f\u78ba\u5b9a\u3057\u3066\u3044\u307e\u305b\u3093\u3002") + next;
}

function buildStateNextInstruction(draft) {
  if (!draft.startsAt) return "\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  if (draft.availabilityCheckResult?.ok !== true) return "\u3053\u306e\u6642\u9593\u306e\u7a7a\u304d\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002";
  if (!draft.customerName) return "\u304a\u540d\u524d\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  if (!draft.phone) return "\u304a\u96fb\u8a71\u756a\u53f7\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  if (!draft.course) return "\u3054\u5e0c\u671b\u306e\u30b3\u30fc\u30b9\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  if (draft.firstVisit === undefined) return "\u521d\u3081\u3066\u304b\u3001\u4ee5\u524d\u3082\u3042\u308b\u304b\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  if (draft.attentionConfirmed !== true) return "注意事項を確認後、「確認しました」とお伝えください。";
  return "\u5185\u5bb9\u304c\u5408\u3063\u3066\u3044\u308c\u3070\u300c\u306f\u3044\u300d\u3068\u304a\u7b54\u3048\u304f\u3060\u3055\u3044\u3002";
}

async function reservationFlowReply(session, callerText, context) {
  const draft = session.reservationDraft;
  if (!draft || draft.completed) return "";

  const text = normalizeJapaneseSpeech(callerText);
  const active = isReservationLikely(text) || hasAnyDraftValue(draft);
  if (!active) return "";

  const phoneMismatchReply = handlePhoneMismatchConfirmation(session, callerText);
  if (phoneMismatchReply) return phoneMismatchReply;

  if (draft.awaitingFinalConfirmation && isAffirmative(text)) {
    try {
      const validation = await validateReservation(session, context);
      if (!validation.ok) {
        await upsertCallLog(session, "SUMMARIZED", validation.reason);
        draft.awaitingFinalConfirmation = false;
        return "\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093\u3002\u5e97\u8217\u5074\u3067\u518d\u78ba\u8a8d\u304c\u5fc5\u8981\u306b\u306a\u308a\u307e\u3057\u305f\u3002\u3053\u3061\u3089\u306f\u30b9\u30bf\u30c3\u30d5\u78ba\u8a8d\u306b\u5207\u308a\u66ff\u3048\u307e\u3059\u3002";
      }
      const result = await createPhoneReservation(session, context);
      draft.completed = true;
      session.reservationId = result.reservation.id;
      if (!result.smsResult?.ok) {
        return "\u4eee\u4e88\u7d04\u3092\u627f\u308a\u307e\u3057\u305f\u3002SMS\u9001\u4fe1\u306b\u5931\u6557\u3057\u305f\u305f\u3081\u3001\u5e97\u8217\u3088\u308a\u5225\u9014\u3054\u9023\u7d61\u3057\u307e\u3059\u3002";
      }
      return "\u4eee\u4e88\u7d04\u3092\u627f\u308a\u307e\u3057\u305f\u3002\u78ba\u8a8dSMS\u3092\u304a\u9001\u308a\u3057\u307e\u3057\u305f\u3002\u5e97\u8217\u78ba\u8a8d\u5f8c\u306b\u78ba\u5b9a\u3092\u3054\u6848\u5185\u3057\u307e\u3059\u3002\u5931\u793c\u3044\u305f\u3057\u307e\u3059\u3002";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/同じ電話番号で時間が重なる予約があります/.test(reason)) {
        await upsertCallLog(session, "ESCALATED", reason);
        draft.awaitingFinalConfirmation = false;
        draft.awaitingField = "startsAt";
        draft.availabilityCheckResult = undefined;
        logRelay("phone_duplicate_reservation_blocked", {
          callSid: session.callSid,
          storeId: session.storeId,
          phone: draft.phone,
          startsAt: draft.startsAt?.toISOString?.(),
          reason
        });
        return "同じ電話番号で時間が重なるご予約があるため、この時間ではお取りできません。別の日時で確認しますので、ご希望の日時をお伝えください。";
      }
      if (/available therapist was not found/.test(reason)) {
        await upsertCallLog(session, "SUMMARIZED", reason);
        return "\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093\u3002\u5e97\u8217\u5074\u3067\u518d\u78ba\u8a8d\u304c\u5fc5\u8981\u306b\u306a\u308a\u307e\u3057\u305f\u3002\u3053\u3061\u3089\u306f\u30b9\u30bf\u30c3\u30d5\u78ba\u8a8d\u306b\u5207\u308a\u66ff\u3048\u307e\u3059\u3002";
      }
      if (/available room was not found/.test(reason)) {
        await upsertCallLog(session, "SUMMARIZED", reason);
        return "\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093\u3002\u5e97\u8217\u5074\u3067\u518d\u78ba\u8a8d\u304c\u5fc5\u8981\u306b\u306a\u308a\u307e\u3057\u305f\u3002\u3053\u3061\u3089\u306f\u30b9\u30bf\u30c3\u30d5\u78ba\u8a8d\u306b\u5207\u308a\u66ff\u3048\u307e\u3059\u3002";
      }
      await upsertCallLog(session, "ESCALATED", reason);
      return "\u78ba\u8a8d\u304c\u5fc5\u8981\u306a\u305f\u3081\u3001\u5e97\u8217\u30b9\u30bf\u30c3\u30d5\u304b\u3089\u6298\u308a\u8fd4\u3057\u3054\u6848\u5185\u3044\u305f\u3057\u307e\u3059\u3002";
    }
  }

  if (draft.datetime_question_only) {
    draft.datetime_question_only = false;
    draft.awaitingField = "startsAt";
    return "\u3054\u5e0c\u671b\u65e5\u6642\u306e\u78ba\u8a8d\u3067\u3059\u306d\u3002\u4f8b\u3048\u3070\u300c6\u670812\u65e5\u306e20\u6642\u300d\u306e\u3088\u3046\u306b\u3001\u3054\u5e0c\u671b\u306e\u65e5\u306b\u3061\u3068\u304a\u6642\u9593\u3092\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
  }

  if (draft.datetime_ambiguous) {
    const ambiguous = draft.datetime_ambiguous;
    draft.datetime_ambiguous = undefined;
    draft.awaitingField = "startsAt";
    if (ambiguous === "night") return "\u591c\u3067\u3059\u306d\u300220\u6642\u4ee5\u964d\u3067\u3054\u5e0c\u671b\u306e\u304a\u6642\u9593\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
    if (ambiguous === "noon") return "\u304a\u663c\u3067\u3059\u306d\u300212\u6642\u304b\u308915\u6642\u306e\u9593\u3067\u3054\u5e0c\u671b\u306e\u304a\u6642\u9593\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
    if (ambiguous === "evening") return "\u5915\u65b9\u3067\u3059\u306d\u300217\u6642\u304b\u308919\u6642\u306e\u9593\u3067\u3054\u5e0c\u671b\u306e\u304a\u6642\u9593\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
    if (ambiguous === "morning_range") return "\u5348\u524d\u4e2d\u3067\u3059\u306d\u3002\u5e97\u8217\u306e\u55b6\u696d\u6642\u9593\u3082\u78ba\u8a8d\u3057\u305f\u3044\u306e\u3067\u3001\u3054\u5e0c\u671b\u306e\u5177\u4f53\u7684\u306a\u304a\u6642\u9593\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
    if (ambiguous === "afternoon_range") return "\u5348\u5f8c\u3067\u3059\u306d\u300213\u6642\u4ee5\u964d\u3067\u3054\u5e0c\u671b\u306e\u304a\u6642\u9593\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
    if (ambiguous === "earliest" || ambiguous === "any_available") return "\u7a7a\u304d\u67a0\u3067\u3059\u306d\u3002\u3054\u5e0c\u671b\u306e\u65e5\u306b\u3061\u3068\u3001\u3060\u3044\u305f\u3044\u306e\u6642\u9593\u5e2f\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
    return "\u304b\u3057\u3053\u307e\u308a\u307e\u3057\u305f\u3002\u5177\u4f53\u7684\u306a\u3054\u5e0c\u671b\u65e5\u3068\u304a\u6642\u9593\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }

  if (draft.datetime_confirmation_required?.type === "time_ambiguity") {
    const confirmation = draft.datetime_confirmation_required;
    draft.datetime_confirmation_required = undefined;
    draft.awaitingField = "startsAt";
    return formatTimeAmbiguityQuestion(callerText, { rawHour: confirmation.rawHour, hour: confirmation.rawHour, time: confirmation.parsedTime });
  }

  if (draft.requested_date && !draft.requested_time && !draft.startsAt) {
    draft.awaitingField = "startsAt";
    return formatJstDateOnlyJa(draft.requested_date) + "\u3067\u3059\u306d\u3002\u304a\u6642\u9593\u306f\u4f55\u6642\u3092\u3054\u5e0c\u671b\u3067\u3059\u304b\uff1f";
  }

  if (draft.requested_time && !draft.requested_date && !draft.startsAt) {
    draft.awaitingField = "startsAt";
    return formatJstTimeText(draft.requested_time) + "\u3067\u3059\u306d\u3002\u3054\u5e0c\u671b\u306e\u304a\u65e5\u306b\u3061\u306f\u3044\u3064\u3067\u3059\u304b\uff1f";
  }

  if (!draft.startsAt) {
    draft.awaitingField = "startsAt";
    return "\u304b\u3057\u3053\u307e\u308a\u307e\u3057\u305f\u3002\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }

  const gate = await ensureAvailabilityGate(session, context);
  if (!gate.ok) return gate.message;

  if (!draft.customerName) {
    draft.awaitingField = "name";
    return "\u304a\u540d\u524d\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002\u82d7\u5b57\u3060\u3051\u3067\u3082\u5927\u4e08\u592b\u3067\u3059\u3002";
  }
  if (!draft.phone) {
    draft.awaitingField = "phone";
    return "\u304a\u96fb\u8a71\u756a\u53f7\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002";
  }
  const courses = context?.courses ?? draft.availableCourses ?? [];
  draft.availableCourses = courses;
  if (!draft.course && courses.length === 1) {
    draft.course = courses[0];
  }
  if (!draft.course) {
    draft.awaitingField = "course";
    return formatCourseMenu(courses) + "\u3054\u5e0c\u671b\u306f\u3069\u3061\u3089\u3067\u3059\u304b\uff1f";
  }
  if (draft.firstVisit === undefined) {
    draft.awaitingField = "firstVisit";
    return "\u3054\u5229\u7528\u306f\u521d\u3081\u3066\u3067\u3059\u304b\uff1f\u4ee5\u524d\u3082\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  if (draft.attentionConfirmed !== true) {
    draft.awaitingField = "attention";
    return "\u6ce8\u610f\u4e8b\u9805\u3068\u5e97\u8217\u30eb\u30fc\u30eb\u306e\u78ba\u8a8d\u5f8c\u3001\u300c\u78ba\u8a8d\u3057\u307e\u3057\u305f\u300d\u3068\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002";
  }

  const validation = await validateReservation(session, context);
  if (!validation.ok) return validation.message;

  draft.awaitingField = "finalConfirmation";
  draft.awaitingFinalConfirmation = true;
  return buildFinalConfirmationText(draft);
}

function isReservationLikely(text) {
  return /(\u4e88\u7d04|\u7a7a\u304d|\u7a7a\u3044\u3066|\u53d6\u308c|\u304a\u9858\u3044|\u4eca\u65e5|\u672c\u65e5|\u660e\u65e5|\u660e\u5f8c\u65e5|\u3042\u3055\u3063\u3066|\u6765\u9031|\u4eca\u9031|\u591c|\u663c|\u5915\u65b9|\u5348\u524d\u4e2d|\u5348\u5f8c|\u4ed5\u4e8b\u7d42\u308f\u308a|\u9045\u3081|\u65e9\u3081|\u6700\u77ed|\u30b3\u30fc\u30b9|\u6307\u540d|\u30d5\u30ea\u30fc|[0-2]?\d\s*(?:\u65e5|\u6642|:)|[日月火水木金土]\u66dc)/u.test(text);
}

function hasAnyDraftValue(draft) {
  return Boolean(
    draft.startsAt ||
      draft.requested_date ||
      draft.requested_time ||
      draft.course ||
      draft.nominationIntent !== undefined ||
      draft.customerName ||
      draft.phone ||
      draft.firstVisit !== undefined ||
      draft.attentionConfirmed
  );
}

function applyRequestedDateTimeState(draft, callerText, store) {
  const raw = String(callerText ?? "");
  const text = normalizeDateTimeDigits(normalizeJapaneseSpeech(raw));
  if (isPhoneNumberDominantText(raw)) {
    return buildDateTimeParseLog(draft, undefined, undefined, {
      raw_utterance: raw,
      datetime_parse_skipped: "phone_number_dominant"
    });
  }
  const parsedDate = parseRequestedDateParts(text);
  const parsedTime = parseRequestedTimeParts(text, store);
  const ambiguous = parseAmbiguousDateTimeContext(text);
  const questionOnly = isDateTimeQuestionOnly(text);

  if (questionOnly) {
    draft.datetime_question_only = true;
    return buildDateTimeParseLog(draft, parsedDate, parsedTime, {
      raw_utterance: raw,
      datetime_question_only: true
    });
  }

  if (ambiguous) {
    draft.datetime_question_only = false;
    draft.datetime_ambiguous = ambiguous;
    return buildDateTimeParseLog(draft, parsedDate, parsedTime, {
      raw_utterance: raw,
      ambiguous_datetime: ambiguous
    });
  }

  draft.datetime_question_only = false;
  draft.datetime_ambiguous = undefined;
  const previousStartsAt = draft.startsAt ? new Date(draft.startsAt).toISOString() : null;

  if (parsedDate) {
    draft.requested_date = parsedDate.iso;
    draft.last_requested_date = parsedDate.iso;
    draft.date_source = parsedDate.source;
    draft.date_confidence = parsedDate.confidence;
  }

  if (parsedTime && parsedTime.confidence < TIME_CONFIDENCE_THRESHOLD) {
    draft.requested_time = undefined;
    draft.requested_datetime = undefined;
    draft.startsAt = undefined;
    draft.startsAtText = "";
    draft.pending_time_candidate = parsedTime.time;
    draft.pending_time_confirmation = {
      rawHour: parsedTime.rawHour,
      parsedTime: parsedTime.time,
      confidence: parsedTime.confidence
    };
    draft.datetime_confirmation_required = {
      type: "time_ambiguity",
      rawHour: parsedTime.rawHour,
      parsedTime: parsedTime.time,
      confidence: parsedTime.confidence
    };
    draft.time_source = parsedTime.source;
    draft.time_confidence = parsedTime.confidence;
    draft.awaitingFinalConfirmation = false;
    return buildDateTimeParseLog(draft, parsedDate, parsedTime, {
      raw_utterance: raw,
      datetime_question_only: false,
      confirmation_required: "time_ambiguity"
    });
  }

  if (parsedTime) {
    draft.requested_time = parsedTime.time;
    draft.last_requested_time = parsedTime.time;
    draft.time_source = parsedTime.source;
    draft.time_confidence = parsedTime.confidence;
    draft.pending_time_candidate = undefined;
    draft.datetime_confirmation_required = undefined;
  }

  const effectiveDate = parsedDate?.iso ?? draft.requested_date ?? draft.last_requested_date;
  const effectiveTime = parsedTime?.time ?? draft.requested_time ?? draft.last_requested_time;

  if (effectiveDate && effectiveTime) {
    const startsAt = buildStartsAtFromDateTime(effectiveDate, effectiveTime);
    draft.startsAt = startsAt;
    draft.startsAtText = formatDateTimeJa(startsAt);
    draft.requested_datetime = formatJstDateTimeOffset(startsAt);
    draft.last_requested_datetime = draft.requested_datetime;
    draft.availability_query_datetime = draft.requested_datetime;
    if (previousStartsAt !== startsAt.toISOString()) {
      draft.availabilityCheckResult = undefined;
      draft.awaitingFinalConfirmation = false;
      clearSuggestedCandidate(draft);
      clearNonExplicitTherapistSelection(draft);
    }
  } else {
    draft.startsAt = undefined;
    draft.startsAtText = "";
    draft.requested_datetime = undefined;
    draft.availability_query_datetime = undefined;
    draft.awaitingFinalConfirmation = false;
  }

  return buildDateTimeParseLog(draft, parsedDate, parsedTime, {
    raw_utterance: raw,
    datetime_question_only: false
  });
}

function buildDateTimeParseLog(draft, parsedDate, parsedTime, extra = {}) {
  return {
    ...extra,
    parsed_date: parsedDate?.iso ?? draft.requested_date ?? null,
    parsed_time: parsedTime?.time ?? draft.requested_time ?? null,
    parsed_datetime_jst: draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null,
    requested_date: draft.requested_date ?? null,
    requested_time: draft.requested_time ?? null,
    requested_datetime: draft.requested_datetime ?? null,
    last_requested_date: draft.last_requested_date ?? null,
    last_requested_time: draft.last_requested_time ?? null,
    last_requested_datetime: draft.last_requested_datetime ?? null,
    date_source: draft.date_source ?? parsedDate?.source ?? null,
    time_source: draft.time_source ?? parsedTime?.source ?? null,
    date_confidence: draft.date_confidence ?? parsedDate?.confidence ?? null,
    time_confidence: draft.time_confidence ?? parsedTime?.confidence ?? null,
    availability_query_datetime: draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null,
    alternative_search_from_datetime: draft.alternative_search_from_datetime ?? (draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null)
  };
}

function normalizeDateTimeDigits(value) {
  return String(value ?? "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function isPhoneNumberDominantText(value) {
  const raw = normalizeDateTimeDigits(String(value ?? ""));
  const digits = normalizePhoneDigits(raw);
  if (!digits || digits.length < 10) return false;
  if (!/^(?:0[789]0|81[789]0)/.test(digits)) return false;
  const withoutPhoneChars = normalizeJapaneseSpeech(raw)
    .replace(/[+\d\s\-ー−―()（）]/g, "")
    .replace(/(電話番号|電話|番号|です|で|お願いします|お願い|はい|私|僕|俺|自分|の|は|を|、|。|です。)/gu, "")
    .trim();
  return !/(月|日|時|今日|本日|明日|明後日|あさって|来週|今週|曜|朝|昼|夕方|夜|午前|午後|空|予約|行け|いけ|取れ)/u.test(withoutPhoneChars);
}

function isDateTimeQuestionOnly(text) {
  if (!/(\d{1,2}\s*(?:日|時)|今日|本日|明日|あした|明後日|あさって|来週|今週|曜)/u.test(text)) return false;
  if (/(空い|空き|いけ|行け|予約|取れ|お願い|希望|できます|可能)/u.test(text)) return false;
  return /(ですか|でしょうか|で合って|でしたっけ|書いてますか|なってますか)[？?]?$/u.test(text);
}

function parseAmbiguousDateTimeContext(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return undefined;
  const ambiguousPatterns = [
    { pattern: /^(夜|夜で|夜ですね|夜かな|夜ぐらい)$/u, label: "night" },
    { pattern: /^(昼|お昼|昼で|昼ぐらい)$/u, label: "noon" },
    { pattern: /^(夕方|夕方で|夕方ぐらい)$/u, label: "evening" },
    { pattern: /^(午前中|午前)$/u, label: "morning_range" },
    { pattern: /^(午後|午後で|午後ぐらい)$/u, label: "afternoon_range" },
    { pattern: /^(仕事終わり|仕事終わってから|仕事終わった後)$/u, label: "after_work" },
    { pattern: /^(遅め|遅い時間|遅い方)$/u, label: "late" },
    { pattern: /^(早め|早い時間|早い方)$/u, label: "early" },
    { pattern: /^(空いてる時|空いてるとき|空きある時|空きあるとき)$/u, label: "any_available" },
    { pattern: /^(最短|一番早く|一番早い|一番近い|一番近く|最短で|最短で入れる)$/u, label: "earliest" }
  ];
  return ambiguousPatterns.find((item) => item.pattern.test(normalized))?.label;
}

function parseRequestedDateParts(text) {
  if (isPhoneNumberDominantText(text)) return undefined;
  const today = getJstTodayParts();
  if (/(今日|本日)/u.test(text)) return { ...partsToDateParse(today), source: "today", confidence: 0.98 };
  if (/(明後日|あさって)/u.test(text)) return { ...partsToDateParse(addJstDays(today, 2)), source: "day_after_tomorrow", confidence: 0.95 };
  if (/(明日|あした)/u.test(text)) return { ...partsToDateParse(addJstDays(today, 1)), source: "tomorrow", confidence: 0.95 };

  const relativeDay = text.match(/(\d{1,2}|\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)\s*\u65e5\u5f8c/u);
  if (relativeDay) {
    const offset = parseSmallJapaneseNumber(relativeDay[1]);
    if (offset > 0 && offset <= 31) {
      return { ...partsToDateParse(addJstDays(today, offset)), source: "relative_day_offset", confidence: 0.96 };
    }
  }

  const explicitJapaneseMonthDay = text.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
  const slashMonthDay = explicitJapaneseMonthDay
    ? null
    : text.match(/(?:^|[^\d+])(?:(20\d{2})[\/-])?(\d{1,2})[\/-](\d{1,2})(?:$|[^\d])/u);
  const monthDay = explicitJapaneseMonthDay || slashMonthDay;
  if (monthDay) {
    const year = Number(monthDay[1] ?? today.year);
    const month = Number(monthDay[2]);
    const day = Number(monthDay[3]);
    if (!isValidMonthDay(month, day)) return undefined;
    const parts = normalizeJstDateParts(year, month, day);
    const resolved = monthDay[1] ? parts : rollForwardIfPastDate(parts, today);
    return { ...partsToDateParse(resolved), source: "explicit_month_day", confidence: 0.99 };
  }

  const dayOnly = text.match(/(?:^|[^\d])(\d{1,2})\s*日(?:の|に|って|は|で|$)/u);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (!isValidMonthDay(today.month, day)) return undefined;
    const parts = rollForwardIfPastDate(normalizeJstDateParts(today.year, today.month, day), today);
    return { ...partsToDateParse(parts), source: "explicit_day_of_month", confidence: 0.93 };
  }

  const weekday = text.match(/(来週|今週)?(?:の)?([日月火水木金土])曜/u);
  if (weekday) {
    const parts = resolveRequestedWeekday(today, weekday[2], weekday[1] === "来週");
    return { ...partsToDateParse(parts), source: weekday[1] === "来週" ? "relative_weekday_next_week" : "relative_weekday", confidence: weekday[1] ? 0.9 : 0.84 };
  }

  return undefined;
}

function parseSmallJapaneseNumber(value) {
  const text = String(value ?? "");
  if (/^\d+$/.test(text)) return Number(text);
  const map = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10
  };
  return map[text] ?? 0;
}

function isValidMonthDay(month, day) {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function parseRequestedTimeParts(text, store) {
  if (/([0-9]{1,2}|一|二|三|四|五|六|七|八|九|十|十一|十二)\s*時間\s*後/u.test(text)) return undefined;
  if (/何時/u.test(text)) return undefined;
  const halfMatch = text.match(/([0-2]?\d)\s*時\s*半/u);
  const timeMatch = halfMatch || text.match(/([0-2]?\d)\s*(?:時|:|：)\s*([0-5]\d)?/u);
  if (!timeMatch) return undefined;

  let hour = Number(timeMatch[1]);
  const rawHour = hour;
  const minute = halfMatch ? 30 : Number(timeMatch[2] ?? 0);
  const explicitMorning = /(午前|朝|あさ|AM|am)/u.test(text);
  const explicitEvening = /(午後|夜|よる|夕方|晩|PM|pm)/u.test(text);
  const explicitLateNight = /(深夜|夜中|明け方)/u.test(text);
  const openHour = parseStoreHour(store?.openTime, 12);
  const closeHour = parseStoreHour(store?.closeTime, 29);
  let source = "explicit_time";

  if (!explicitMorning && hour < 12) {
    if (explicitLateNight && hour < 6 && closeHour > 24) {
      hour += 24;
      source = "explicit_time_late_night";
    } else if (explicitEvening) {
      hour += 12;
      source = "explicit_time_pm";
    } else if (hour < openHour) {
      source = "explicit_time_needs_confirmation";
    }
  }

  return {
    hour,
    rawHour,
    minute,
    time: String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
    source,
    confidence: source === "explicit_time_needs_confirmation" ? 0.74 : 0.96
  };
}

function partsToDateParse(parts) {
  return { parts, iso: formatJstDateIso(parts) };
}

function normalizeJstDateParts(year, month, day) {
  return getJstDatePartsFromDate(jstDateToUtcDate(year, month, day, 12, 0));
}

function rollForwardIfPastDate(parts, today) {
  if (dateOnlyNumber(parts) >= dateOnlyNumber(today)) return parts;
  return normalizeJstDateParts(parts.year, parts.month + 1, parts.day);
}

function resolveRequestedWeekday(today, weekdayChar, nextWeek) {
  const map = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
  const target = map[weekdayChar];
  const todayDow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  let diff = (target - todayDow + 7) % 7;
  if (nextWeek) diff += 7;
  if (!nextWeek && diff === 0) diff = 7;
  return addJstDays(today, diff);
}

function dateOnlyNumber(parts) {
  return Number(String(parts.year).padStart(4, "0") + String(parts.month).padStart(2, "0") + String(parts.day).padStart(2, "0"));
}

function formatJstDateIso(parts) {
  return String(parts.year).padStart(4, "0") + "-" + String(parts.month).padStart(2, "0") + "-" + String(parts.day).padStart(2, "0");
}

function buildStartsAtFromDateTime(dateIso, timeText) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = timeText.split(":").map(Number);
  return jstDateToUtcDate(year, month, day, hour, minute);
}

function syncDraftDateTimeFromStartsAt(draft, startsAt, source = "system_sync") {
  if (!draft || !startsAt) return;
  const parts = getJstDateTimePartsFromDate(startsAt);
  const dateIso = formatJstDateIso(parts);
  const timeText = String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0");
  draft.requested_date = dateIso;
  draft.requested_time = timeText;
  draft.requested_datetime = formatJstDateTimeOffset(startsAt);
  draft.last_requested_date = dateIso;
  draft.last_requested_time = timeText;
  draft.last_requested_datetime = draft.requested_datetime;
  draft.date_source = source;
  draft.time_source = source;
  draft.date_confidence = 1;
  draft.time_confidence = 1;
  draft.availability_query_datetime = draft.requested_datetime;
  draft.startsAtText = formatDateTimeJa(startsAt);
}

function formatJstDateTimeOffset(value) {
  const parts = getJstDateTimePartsFromDate(value);
  return formatJstDateIso(parts) + "T" + String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0") + ":00+09:00";
}

function formatJstDateOnlyJa(dateIso) {
  const [, month, day] = String(dateIso ?? "").split("-").map(Number);
  if (!month || !day) return "その日";
  return String(month) + "月" + String(day) + "日";
}

function formatJstTimeText(timeText) {
  const [hour, minute] = String(timeText ?? "").split(":").map(Number);
  if (!Number.isFinite(hour)) return "そのお時間";
  return minute ? String(hour) + "\u6642" + String(minute).padStart(2, "0") + "\u5206" : String(hour) + "\u6642";
}

function getJstDatePartsFromDate(value) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(new Date(value));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function getJstDateTimePartsFromDate(value) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  };
}

function isAffirmative(text) {
  return /(\u306f\u3044|\u5927\u4e08\u592b|\u305d\u308c\u3067|\u304a\u9858\u3044|\u3044\u3044\u3067\u3059|OK|\u30aa\u30fc\u30b1\u30fc)/iu.test(text);
}

function buildFinalConfirmationText(draft) {
  const nomination = draft.nominationIntent
    ? (draft.therapistName ? draft.therapistName + "\u3055\u3093\u6307\u540d" : "\u6307\u540d\u3042\u308a")
    : "\u30d5\u30ea\u30fc";
  const visitHistory = draft.firstVisit === true ? "\u521d\u3081\u3066" : "\u904e\u53bb\u306b\u3054\u5229\u7528\u3042\u308a";
  const attention = draft.attentionConfirmed === true ? "\u6ce8\u610f\u4e8b\u9805\u78ba\u8a8d\u6e08\u307f" : "\u6ce8\u610f\u4e8b\u9805\u672a\u78ba\u8a8d";
  return "\u78ba\u8a8d\u3057\u307e\u3059\u3002" + formatDateTimeJa(draft.startsAt) + "\u3001" + formatCourseNameForSpeech(draft.course.name) + formatDraftOptionsForSpeech(draft) + "\u3001" + nomination + "\u3001" + draft.customerName + "\u69d8\u3001\u96fb\u8a71\u756a\u53f7" + draft.phone + "\u3001" + visitHistory + "\u3001" + attention + "\u3067\u3059\u3002\u5408\u3063\u3066\u3044\u308c\u3070\u300c\u306f\u3044\u300d\u3068\u304a\u7b54\u3048\u304f\u3060\u3055\u3044\u3002";
}

function formatDraftOptionsForSpeech(draft) {
  const options = Array.isArray(draft?.options) ? draft.options.filter((option) => option?.name) : [];
  if (!options.length) return "";
  return "\u3001\u30aa\u30d7\u30b7\u30e7\u30f3" + options.map((option) => String(option.name).trim()).filter(Boolean).join("\u3001");
}

function formatDraftOptionsNote(draft) {
  const options = Array.isArray(draft?.options) ? draft.options.map((option) => String(option?.name ?? "").trim()).filter(Boolean) : [];
  return options.length ? "\u96fb\u8a71AI\u5e0c\u671b\u30aa\u30d7\u30b7\u30e7\u30f3: " + options.join("\u3001") : undefined;
}

function parseJapaneseStartsAt(value, store) {
  const draft = createReservationDraft();
  applyRequestedDateTimeState(draft, value, store);
  return draft.startsAt;
}

function parseStoreHour(value, fallback) {
  const match = String(value ?? "").match(/(\d{1,2})(?::\d{2})?/);
  if (!match) return fallback;
  return Number(match[1]);
}

function extractStartsAtText(value) {
  const text = String(value ?? "").trim();
  const dateWords = "(?:\\u4eca\\u65e5|\\u672c\\u65e5|\\u660e\\u65e5|\\u3042\\u3057\\u305f|\\u660e\\u5f8c\\u65e5|\\u3042\\u3055\\u3063\\u3066|\\u9031\\u672b|\\u65e5\\u66dc|\\u571f\\u66dc|\\u5e73\\u65e5)";
  const digit = "[0-9\\uff10-\\uff19]";
  const clock = `${digit}{1,2}\\s*(?:\\u6642|:|\\uff1a)\\s*(?:(?:${digit}{1,2})\\s*\\u5206?|\\u534a)?`;
  const monthDay = `(?:(?:${digit}{4})\\s*\\u5e74\\s*)?${digit}{1,2}\\s*\\u6708\\s*${digit}{1,2}\\s*\\u65e5`;
  const slashDate = `(?:(?:${digit}{4})[/-])?${digit}{1,2}[/-]${digit}{1,2}`;
  const relative = "(?:\\u4eca\\u304b\\u3089|\\u3053\\u306e\\u3042\\u3068|\\u6700\\u77ed|\\u3059\\u3050|\\u306a\\u308b\\u65e9|\\u4ed5\\u4e8b\\u7d42\\u308f\\u308a|\\u5915\\u65b9|\\u591c|\\u4eca\\u6669|\\u6df1\\u591c|\\u7d42\\u96fb\\u524d)";
  const patterns = [
    new RegExp(`${dateWords}[^\\n\\r]{0,16}?${clock}`, "u"),
    new RegExp(`${monthDay}[^\\n\\r]{0,16}?${clock}`, "u"),
    new RegExp(`${slashDate}[^\\n\\r]{0,16}?${clock}`, "u"),
    new RegExp(`${relative}(?:[^\\n\\r]{0,16}?${clock})?`, "u")
  ];
  return patterns.map((pattern) => text.match(pattern)?.[0]?.trim()).find(Boolean);
}

function getJstTodayParts() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addJstDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function jstDateToUtcDate(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
}

function extractNomination(value, therapists) {
  const text = normalizeJapaneseSpeech(value);
  if (/(\u30d5\u30ea\u30fc|\u6307\u540d\u306a\u3057|\u6307\u540d\u7121\u3057|\u8ab0\u3067\u3082|\u3060\u308c\u3067\u3082|\u304a\u307e\u304b\u305b|\u304a\u4efb\u305b|\u306a\u3057\u3067)/u.test(text)) {
    return { found: true, intent: false, confidence: 1 };
  }

  const therapistMatch = findRequestedTherapistMatch(text, therapists);
  if (therapistMatch.confidence >= THERAPIST_MATCH_CONFIDENCE_THRESHOLD) {
    return { found: true, intent: true, therapistName: therapistMatch.therapist.displayName, confidence: therapistMatch.confidence };
  }

  if (/\u6307\u540d/u.test(text)) return { found: true, intent: true, confidence: 0.8 };
  return { found: false };
}

function extractPhoneNumber(value) {
  const digits = String(value ?? "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
  const match = digits.match(/0\d{9,10}/) || digits.match(/81\d{9,10}/);
  if (!match) return undefined;
  const phone = match[0].startsWith("81") ? `0${match[0].slice(2)}` : match[0];
  return phone.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}

function extractFirstVisit(value, awaitingField) {
  const text = normalizeJapaneseSpeech(value);
  if (/(\u521d\u56de|\u521d\u3081\u3066|\u306f\u3058\u3081\u3066|\u65b0\u898f)/u.test(text)) return true;
  if (/(\u518d\u6765|\u30ea\u30d4|\u30ea\u30d4\u30fc\u30c8|\u6765\u305f\u3053\u3068|\u5229\u7528\u3057\u305f\u3053\u3068|\u5229\u7528\u7d4c\u9a13|\u5229\u7528\u6b74|\u5229\u7528.*\u3042\u308a|\u5229\u7528.*\u3042\u308b|\u4e88\u7d04\u3057\u305f\u3053\u3068|\u4e88\u7d04\u3055\u305b|\u4f7f\u3063\u305f\u3053\u3068|\u884c\u3063\u305f\u3053\u3068|\u904e\u53bb|\u4ee5\u524d|\u524d\u306b|[2-9]\u56de\u76ee|[2-9]\u56de|\u4e8c\u56de\u76ee|\u4e8c\u56de|\u4f55\u56de|\u6570\u56de|\u9b45\u4e86\u3057\u305f\u3053\u3068)/u.test(text)) return false;
  if (awaitingField === "firstVisit") {
    if (/(\u904e\u53bb|\u4ee5\u524d|\u524d\u306b|\u5229\u7528\u7d4c\u9a13|\u5229\u7528\u6b74|\u4f55\u56de|\u4f55\u5ea6|\u6570\u56de|\u4e88\u7d04\u3055\u305b|\u4e88\u7d04\u3057\u305f|\u4f7f\u3063\u305f\u3053\u3068|\u884c\u3063\u305f\u3053\u3068|\u4f3a\u3063\u305f\u3053\u3068|\u5229\u7528.*\u3042\u308a|\u5229\u7528.*\u3042\u308b|\u9b45\u4e86.*\u3042\u308a|\u3042\u308a\u307e\u3059|\u3042\u308a\u307e\u3059\u306d|\u3042\u308a\u307e\u3057\u305f)/u.test(text)) return false;
    if (/(\u306a\u3044\u3067\u3059|\u306a\u3044|\u521d\u3081\u3066\u3060\u3068\u601d\u3046|\u306f\u3058\u3081\u3066\u3060\u3068\u601d\u3046)/u.test(text)) return true;
  }
  return undefined;
}

function extractAttentionConfirmed(value, awaitingField) {
  const text = normalizeJapaneseSpeech(value);
  if (/(\u6ce8\u610f\u4e8b\u9805.*\u78ba\u8a8d|\u78ba\u8a8d\u3057\u307e\u3057\u305f|\u78ba\u8a8d\u6e08\u307f|\u540c\u610f)/u.test(text)) return true;
  return awaitingField === "attention" && isAffirmative(text);
}

function extractCustomerName(value, awaitingField) {
  if (awaitingField && awaitingField !== "name") return undefined;
  if (isInvalidCustomerNameText(value)) return undefined;
  const text = normalizeJapaneseSpeech(value).trim();
  if (!text) return undefined;
  if (/(\u4e88\u7d04|\u30b3\u30fc\u30b9|\u6307\u540d|\u30d5\u30ea\u30fc|\u96fb\u8a71|\u756a\u53f7|\u521d\u56de|\u78ba\u8a8d|\u6ce8\u610f|\u5927\u4e08\u592b|\u4eca\u65e5|\u660e\u65e5|\u6642|\u5206|\u5186|\u8cea\u554f|\u3042\u308a\u304c\u3068\u3046|\u5207\u3063\u3066)/u.test(text)) return undefined;

  const cleaned = text
    .replace(/^(?:\u540d\u524d\u306f|\u6c0f\u540d\u306f)/u, "")
    .replace(/(?:\u3068\u7533\u3057\u307e\u3059|\u3067\u3059|\u3067)$/u, "")
    .trim();
  if (!cleaned) return undefined;
  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30fc]{1,12}$/u.test(cleaned)) return undefined;
  return cleaned;
}

async function createPhoneReservation(session, context) {
  if (isRegressionCall(session)) throw new Error("regression call cannot create a reservation");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const draft = session.reservationDraft;
  const store = context?.store;
  if (!draft?.startsAt || !draft.course || !draft.customerName || !draft.phone) {
    throw new Error("reservation draft is incomplete");
  }

  const endsAt = new Date(draft.startsAt.getTime() + draft.course.durationMin * 60 * 1000);
  const availability = await findPhoneAvailability({
    storeId: session.storeId,
    startsAt: draft.startsAt,
    endsAt,
    therapistName: draft.therapistName,
    nominated: draft.nominationIntent
  });

  if (!availability.therapist) throw new Error("available therapist was not found");
  if (!availability.room) throw new Error("available room was not found");

  // Keep the relay aligned with the core reservation service: phone AI creates a hold,
  // and confirmation must go through the approval path that re-checks availability.
  const status = "TENTATIVE";
  const smsInput = {
    storeName: store?.name,
    storePhone: store?.phone,
    storeAddress: store?.address,
    customerName: draft.customerName,
    startsAt: draft.startsAt,
    courseName: draft.course.name,
    coursePrice: draft.course.price,
    therapistName: availability.therapist.displayName,
    nominated: Boolean(draft.nominationIntent),
    nominationFee: availability.therapist.nominationFee,
    options: Array.isArray(draft.options) ? draft.options : [],
    locationName: availability.room.name
  };
  const smsBody = status === "CONFIRMED"
    ? buildReservationSmsBody(smsInput)
    : buildReservationHoldSmsBody(smsInput);

  const result = await prisma.$transaction(async (tx) => {
    await assertNoOverlappingReservationForPhone(tx, {
      storeId: session.storeId,
      phone: draft.phone,
      startsAt: draft.startsAt,
      endsAt
    });

    const customer = await tx.customer.upsert({
      where: {
        storeId_phone: {
          storeId: session.storeId,
          phone: draft.phone
        }
      },
      update: {
        name: draft.customerName
      },
      create: {
        storeId: session.storeId,
        name: draft.customerName,
        phone: draft.phone
      }
    });

    if (customer.isNg) throw new Error("customer is marked as NG");

    const reservation = await tx.reservation.create({
      data: {
        storeId: session.storeId,
        customerId: customer.id,
        therapistId: availability.therapist.id,
        roomId: availability.room.id,
        courseId: draft.course.id,
        startsAt: draft.startsAt,
        endsAt,
        status,
        nominated: Boolean(draft.nominationIntent),
        firstVisit: Boolean(draft.firstVisit),
        note: formatDraftOptionsNote(draft),
        source: "PHONE",
        ...(session.conversationId ? { conversationId: session.conversationId } : {}),
        confirmationText: buildFinalConfirmationText(draft)
      },
      include: {
        customer: true,
        therapist: true,
        room: true,
        course: true
      }
    });

    if (status === "TENTATIVE") {
      await tx.reservationHold.create({
        data: {
          storeId: session.storeId,
          reservationId: reservation.id,
          customerName: draft.customerName,
          customerPhone: draft.phone,
          startsAt: draft.startsAt,
          endsAt,
          roomId: availability.room.id,
          therapistId: availability.therapist.id,
          source: "PHONE",
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
        }
      });
    }

    await tx.consentLog.create({
      data: {
        storeId: session.storeId,
        reservationId: reservation.id,
        customerId: customer.id,
        consentType: "phone_ai_attention_confirmed",
        content: "attentionConfirmed=true before phone ReservationHold creation",
        accepted: draft.attentionConfirmed === true,
        acceptedAt: draft.attentionConfirmed === true ? new Date() : null
      }
    });

    await tx.auditLog.create({
      data: {
        storeId: session.storeId,
        reservationId: reservation.id,
        actorType: "AI",
        actorId: session.callSid,
        action: "phone_ai.reservation_created",
        after: {
          status,
          startsAt: draft.startsAt,
          endsAt,
          customerId: customer.id,
          therapistId: availability.therapist.id,
          roomId: availability.room.id,
          options: Array.isArray(draft.options) ? draft.options : [],
          callSid: session.callSid
        }
      }
    });

    await tx.callLog.updateMany({
      where: { twilioCallSid: session.callSid },
      data: {
        reservationId: reservation.id,
        status: "HOLD_CREATED",
        requiredReview: status === "TENTATIVE"
      }
    });

    if (session.conversationId) {
      await tx.conversation.update({
        where: { id: session.conversationId },
        data: {
          customerId: customer.id,
          workflowState: "RESERVATION_CREATED",
          reservationDraft: draft,
          summary: [...session.transcript, ...session.assistantTranscript].join("\n").slice(-1800) || undefined
        }
      });
    }

    const notification = await tx.notification.create({
      data: {
        storeId: session.storeId,
        reservationId: reservation.id,
        type: status === "CONFIRMED" ? "RESERVATION_CONFIRMED" : "RESERVATION_CHANGED",
        channel: "PHONE",
        status: "PENDING",
        targetName: draft.customerName,
        targetPhone: draft.phone,
        callSid: session.callSid,
        customerPhone: draft.phone,
        smsTo: normalizeSmsRecipient(draft.phone),
        body: smsBody
      }
    });

    return { reservation, course: draft.course, status, notificationId: notification.id, smsBody, smsTo: draft.phone };
  });

  const smsResult = await sendReservationSms({
    to: result.smsTo,
    body: result.smsBody,
    notificationId: result.notificationId,
    statusCallbackBaseUrl: session.publicBaseUrl
  });
  await prisma.notification
    .update({
      where: { id: result.notificationId },
      data: {
        status: smsResult.ok ? "SENT" : "FAILED",
        sentAt: smsResult.ok ? new Date() : undefined,
        smsSid: smsResult.ok ? smsResult.sid : undefined,
        smsErrorCode: smsResult.ok ? null : String(smsResult.code ?? ""),
        smsErrorMessage: smsResult.ok ? null : String(smsResult.reason ?? "")
      }
    })
    .catch((error) =>
      logRelay("reservation_sms_status_update_failed", {
        callSid: session.callSid,
        message: error instanceof Error ? error.message : String(error)
      })
    );

  if (!smsResult.ok) {
    logRelay("reservation_sms_failed", {
      callSid: session.callSid,
      reservationId: result.reservation.id,
      notificationId: result.notificationId,
      smsTo: normalizeSmsRecipient(result.smsTo),
      reason: smsResult.reason,
      code: smsResult.code
    });
  }

  return { ...result, smsResult };
}

async function findPhoneAvailability(input) {
  const overlappingWhere = {
    storeId: input.storeId,
    status: { in: ["TENTATIVE", "CONFIRMED"] },
    startsAt: { lt: input.endsAt },
    endsAt: { gt: input.startsAt }
  };

  const [reservations, blockedSlots, rooms, shifts] = await Promise.all([
    prisma.reservation.findMany({
      where: overlappingWhere,
      select: { roomId: true, therapistId: true }
    }),
    prisma.blockedSlot.findMany({
      where: {
        storeId: input.storeId,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt }
      }
    }),
    prisma.room.findMany({
      where: { storeId: input.storeId, isActive: true },
      orderBy: { name: "asc" }
    }),
    prisma.shift.findMany({
      where: {
        storeId: input.storeId,
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
        startsAt: { lte: input.startsAt },
        endsAt: { gte: input.endsAt }
      },
      include: { therapist: true },
      orderBy: { startsAt: "asc" }
    })
  ]);

  const storeBlocked = blockedSlots.some((item) => !item.roomId && !item.therapistId);
  const reservedRoomIds = new Set(reservations.map((item) => item.roomId).filter(Boolean));
  const reservedTherapistIds = new Set(reservations.map((item) => item.therapistId).filter(Boolean));
  const blockedRoomIds = new Set(blockedSlots.map((item) => item.roomId).filter(Boolean));
  const blockedTherapistIds = new Set(blockedSlots.map((item) => item.therapistId).filter(Boolean));

  const room = storeBlocked ? null : rooms.find((item) => !reservedRoomIds.has(item.id) && !blockedRoomIds.has(item.id));
  const shiftTherapists = shifts
    .map((shift) => shift.therapist)
    .filter((therapist) => therapist?.status === "ACTIVE");
  const therapistPool = shiftTherapists;
  const normalizedName = normalizeTherapistName(input.therapistName ?? "");
  const availableTherapists = storeBlocked ? [] : therapistPool.filter((item) => {
    if (reservedTherapistIds.has(item.id) || blockedTherapistIds.has(item.id)) return false;
    if (input.nominated && normalizedName) return namesLookSame(normalizeTherapistName(item.displayName), normalizedName);
    return true;
  });
  const therapist = availableTherapists[0] ?? null;

  return {
    room,
    therapist,
    availableTherapists,
    reason: storeBlocked ? "STORE_BLOCKED" : !room ? "NO_ROOM" : !therapist ? "NO_AVAILABLE_THERAPIST" : "OK",
    matchedShiftCount: shifts.length,
    matchedBookingConflictCount: reservations.length,
    blockedSlotCount: blockedSlots.length
  };
}

function buildReservationSmsBody(input) {
  return buildCustomerReservationSms({
    ...input,
    heading: "ご予約ありがとうございます。"
  });
}

function buildReservationHoldSmsBody(input) {
  return buildCustomerReservationSms({
    ...input,
    heading: "仮予約を受け付けました。",
    note: "店舗確認後に確定のご案内をいたします。"
  });
}

function buildCustomerReservationSms(input) {
  const coursePrice = nullableNumber(input.coursePrice);
  const nominationFee = input.nominated ? nullableNumber(input.nominationFee) : 0;
  const options = Array.isArray(input.options) ? input.options : [];
  const optionsTotal = options.reduce((sum, option) => sum + (nullableNumber(option?.price) ?? 0), 0);
  const total = coursePrice === null || nominationFee === null ? null : coursePrice + nominationFee + optionsTotal;
  const optionLines = options.length
    ? options.map((option) => `${String(option?.name ?? "オプション").trim() || "オプション"} ${formatPrice(nullableNumber(option?.price))}`)
    : ["店内検討"];
  const storeName = String(input.storeName ?? "").trim();
  const customerName = String(input.customerName ?? "").trim();
  const bookingType = input.nominated ? "指名" : "フリー";
  const assignedTherapistName = String(input.therapistName ?? "").trim();
  const therapistName = input.nominated
    ? withSanSuffix(assignedTherapistName)
    : assignedTherapistName
      ? withSanSuffix(assignedTherapistName) + "（フリー担当予定）"
      : "フリー";
  const locationName = formatMansionName(input.locationName);
  const storeAddress = String(input.storeAddress ?? "").trim() || "予約確定後に店舗よりご案内";
  const storePhone = formatDisplayPhoneNumber(input.storePhone);

  return [
    storeName,
    storeName ? "" : null,
    customerName ? `${customerName}様` : null,
    "",
    input.heading,
    input.note ?? null,
    "",
    "【日時】",
    formatReservationDateForSms(input.startsAt),
    "【コース】",
    input.courseName,
    "【料金】",
    formatPrice(coursePrice),
    "【予約種別】",
    bookingType,
    "【担当】",
    therapistName,
    "【指名料】",
    input.nominated ? formatPrice(nominationFee) : "なし",
    "【オプション】",
    ...optionLines,
    "【合計】",
    formatPrice(total),
    "",
    "【マンション名】",
    locationName,
    "",
    "【住所】",
    storeAddress,
    "",
    "到着されましたらお電話にてご連絡お願い致します。",
    "",
    "※お時間丁度のご案内になります。お早めに到着された場合待ち時間が発生します。",
    "",
    `TEL:${storePhone || "予約確定後に店舗よりご案内"}`,
    "",
    "お気をつけてお越しください。"
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendReservationSms(input) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !from) return { ok: false, reason: "twilio sms env missing" };
  const authCheck = buildTwilioRestAuthConfig({ accountSid, authToken, apiKey, apiSecret });
  if (!authCheck.ok) return { ok: false, code: authCheck.code, reason: authCheck.reason };
  const requestBody = new URLSearchParams({
    From: from,
    To: normalizeSmsRecipient(input.to),
    Body: sanitizeSmsBody(input.body)
  });
  const statusCallback = buildRelaySmsStatusCallbackUrl(input.statusCallbackBaseUrl, input.notificationId);
  if (statusCallback) requestBody.set("StatusCallback", statusCallback);

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: authCheck.authorization,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: requestBody
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return { ok: false, code: payload.code ?? response.status, reason: payload.message ?? `sms failed ${response.status}` };
    }

    const payload = await response.json();
    return { ok: true, sid: payload.sid };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function buildRelaySmsStatusCallbackUrl(baseUrl, notificationId) {
  const publicUrl = String(
    baseUrl ||
      process.env.VOICE_RELAY_PUBLIC_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) return null;
  const url = new URL("/api/twilio/sms/status", publicUrl);
  if (notificationId) url.searchParams.set("notificationId", notificationId);
  return url.toString();
}

function buildTwilioRestAuthConfig(input) {
  const accountSid = String(input.accountSid ?? "").trim();
  const authToken = String(input.authToken ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  const apiSecret = String(input.apiSecret ?? "").trim();
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    return { ok: false, code: "TWILIO_ACCOUNT_SID_INVALID_FORMAT", reason: "TWILIO_ACCOUNT_SID must start with AC and be 34 characters." };
  }
  if (apiKey || apiSecret) {
    if (!/^SK[0-9a-fA-F]{32}$/.test(apiKey)) {
      return { ok: false, code: "TWILIO_API_KEY_INVALID_FORMAT", reason: "TWILIO_API_KEY must start with SK and be 34 characters." };
    }
    if (apiSecret.length < 20 || /\s/.test(apiSecret)) {
      return { ok: false, code: "TWILIO_API_SECRET_INVALID_FORMAT", reason: "TWILIO_API_SECRET is missing or invalid." };
    }
    return { ok: true, mode: "api_key", authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` };
  }
  if (/^THAA/i.test(authToken) || authToken.length > 80) {
    return {
      ok: false,
      code: "TWILIO_AUTH_TOKEN_INVALID_FORMAT",
      reason: "TWILIO_AUTH_TOKEN is not a Twilio REST Auth Token. Set the Auth Token from Twilio Console, or use an API Key SID/Secret implementation."
    };
  }
  if (authToken.length < 20) {
    return { ok: false, code: "TWILIO_AUTH_TOKEN_INVALID_FORMAT", reason: "TWILIO_AUTH_TOKEN is too short for Twilio REST API authentication." };
  }
  return { ok: true, mode: "auth_token", authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
}

function normalizeSmsRecipient(phone) {
  const trimmed = String(phone ?? "").trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+81${digits.slice(1)}`;
  if (digits.startsWith("81")) return `+${digits}`;
  return `+${digits}`;
}

function normalizeReservationPhoneForComparison(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("81") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

async function assertNoOverlappingReservationForPhone(db, input) {
  const normalizedPhone = normalizeReservationPhoneForComparison(input.phone);
  if (!normalizedPhone) return;

  const overlappingReservations = await db.reservation.findMany({
    where: {
      storeId: input.storeId,
      status: { in: ["TENTATIVE", "CONFIRMED"] },
      ...(input.excludeReservationId ? { id: { not: input.excludeReservationId } } : {}),
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt }
    },
    select: {
      id: true,
      customer: { select: { phone: true } }
    }
  });

  const hasDuplicatePhone = overlappingReservations.some(
    (reservation) => normalizeReservationPhoneForComparison(reservation.customer?.phone) === normalizedPhone
  );

  if (hasDuplicatePhone) {
    throw new Error("同じ電話番号で時間が重なる予約があります。既存予約を確認してください。");
  }
}

function sanitizeSmsBody(body) {
  return String(body ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

function formatDateTimeJa(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minute = String(values.minute ?? "00").padStart(2, "0");
  const time = minute === "00" ? `${values.hour}時` : `${values.hour}時${minute}分`;
  return `${values.month}月${values.day}日 ${time}`;
}

function formatReservationDateForSms(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}月${values.day}日 ${values.hour}時${values.minute}分-`;
}

function formatPrice(value) {
  if (value === null || value === undefined) return "未確定";
  const amount = numberOrZero(value);
  return `${amount.toLocaleString("ja-JP")}円`;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function withSanSuffix(value) {
  const text = String(value ?? "").trim();
  if (!text) return "未定";
  return /さん$/u.test(text) ? text : `${text}さん`;
}

function formatDisplayPhoneNumber(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const domestic = digits.startsWith("81") ? `0${digits.slice(2)}` : digits;
  if (/^0\d{9,10}$/.test(domestic)) {
    if (domestic.length === 11) return domestic.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
    return domestic.replace(/^(\d{2,4})(\d{2,4})(\d{4})$/, "$1-$2-$3");
  }
  return raw;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMansionName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "未設定";
  const withoutRoomNumber = text.replace(/\s*(?:[0-9０-９]{2,4}|[0-9０-９]{2,4}号室)$/u, "").trim();
  return withoutRoomNumber || text;
}


function normalizeJapaneseSpeech(value) {
  return String(value ?? "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .trim();
}

function sanitizeAssistantReplyForSpeech(session, text, source) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "";
  if (!isEnglishDominantSpeech(normalized)) return normalized;

  logRelay("assistant_reply_language_guard", {
    callSid: session.callSid,
    source,
    textLength: normalized.length
  });
  return JAPANESE_LANGUAGE_FALLBACK_REPLY;
}

function isEnglishDominantSpeech(text) {
  const normalized = String(text ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!normalized) return false;

  const japaneseCount = (normalized.match(/[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/g) ?? []).length;
  const latinCount = (normalized.match(/[A-Za-z]/g) ?? []).length;
  if (latinCount < 8) return false;
  if (japaneseCount >= Math.ceil(latinCount / 3)) return false;

  const speechChars = normalized.replace(/[\d!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~。、！？「」『』（）【】・]/g, "");
  return latinCount / Math.max(speechChars.length, 1) > 0.45;
}

async function sendLanguageGuardFallback(session, twilioSocket, source) {
  if (session.languageGuardFallbackSent) return;
  clearResponseWatchdog(session);
  session.languageGuardFallbackSent = true;
  session.hasActiveOpenAiResponse = false;
  session.currentAssistantText = JAPANESE_LANGUAGE_FALLBACK_REPLY;
  session.unsentAssistantText = "";
  session.sentAssistantText = false;

  logRelay("assistant_reply_language_guard_fallback", {
    callSid: session.callSid,
    source
  });

  if (session.openai?.readyState === WebSocket.OPEN) {
    session.openai.send(JSON.stringify({ type: "response.cancel" }));
  }

  session.lastAssistantText = JAPANESE_LANGUAGE_FALLBACK_REPLY;
  session.assistantTranscript.push(`AI: ${JAPANESE_LANGUAGE_FALLBACK_REPLY}`);
  sendTwilioText(twilioSocket, JAPANESE_LANGUAGE_FALLBACK_REPLY, true);
  await upsertCallLog(session, "TRANSCRIBED", "language guard: " + source);
  await flushQueuedCallerText(session, twilioSocket);
}

async function askOpenAI(session, callerText, twilioSocket) {
  if (!openAiKey) {
    const handoff = "AI設定を確認中のため、スタッフより折り返しご案内いたします。";
    session.assistantTranscript.push("AI: " + handoff);
    sendTwilioText(twilioSocket, handoff, true);
    sendTwilioEnd(twilioSocket, { reasonCode: "openai-not-configured", reason: "OPENAI_API_KEY is missing" });
    await upsertCallLog(session, "ESCALATED", "OPENAI_API_KEY is missing");
    return;
  }

  try {
    await ensureStoreReceptionContext(session);
    const openai = await ensureOpenAI(session, twilioSocket);
    session.responseStartedAt = Date.now();
    session.hasActiveOpenAiResponse = true;
    session.currentAssistantText = "";
    session.unsentAssistantText = "";
    session.sentAssistantText = false;
    session.languageGuardFallbackSent = false;
    session.responseWatchdogFallbackSent = false;
    startResponseWatchdog(session, twilioSocket, callerText);
    openai.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["text"],
          instructions: [
            systemPrompt(),
            JAPANESE_ONLY_INSTRUCTION,
            buildTurnPrompt(session, callerText),
            "電話口で自然に聞こえる短さにしてください。予約は、空き確認、空きありの場合のみ顧客名、電話番号、コース、復唱、仮予約受付の順番を守ってください。AIが予約確定済みと言ってはいけません。空きがない場合は個人情報を聞かず、復唱もしないでください。",
            JAPANESE_ONLY_INSTRUCTION
          ].join("\n\n"),
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: callerText }]
            }
          ]
        }
      })
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "OpenAI Realtime connection failed";
    clearResponseWatchdog(session);
    session.hasActiveOpenAiResponse = false;
    const reply = STORE_CONFIRMATION_REQUIRED_REPLY;
    session.assistantTranscript.push("AI: " + reply);
    sendTwilioText(twilioSocket, reply, true);
    sendTwilioEnd(twilioSocket, { reasonCode: "openai-realtime-error", reason });
    await upsertCallLog(session, "ESCALATED", reason);
  }
}
function ensureOpenAI(session, twilioSocket) {
  if (session.openai?.readyState === WebSocket.OPEN) return Promise.resolve(session.openai);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`, {
      headers: {
        Authorization: `Bearer ${openAiKey}`
      }
    });

    const timeout = setTimeout(() => {
      reject(new Error("OpenAI Realtime connection timeout"));
    }, 12000);

    ws.on("open", () => {
      clearTimeout(timeout);
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: [systemPrompt(), JAPANESE_ONLY_INSTRUCTION].join("\n\n")
          }
        })
      );
      resolve(ws);
    });

    ws.on("message", async (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (session.responseWatchdogFallbackSent && !session.hasActiveOpenAiResponse) {
        if (/^response\.|^error$/u.test(event.type ?? "")) {
          logRelay("openai_event_ignored_after_watchdog", { callSid: session.callSid, type: event.type });
          return;
        }
      }

      if (event.type === "response.output_text.delta" || event.type === "response.text.delta") {
        await handleAssistantDelta(session, twilioSocket, event.delta ?? "");
      }

      if ((event.type === "response.output_text.done" || event.type === "response.text.done") && !session.currentAssistantText) {
        const text = String(event.text ?? "").trim();
        if (text) {
          session.currentAssistantText = text;
          session.unsentAssistantText = text;
        }
      }

      if (event.type === "response.done") {
        const fallbackText = extractResponseText(event.response).trim();
        await finalizeAssistantResponse(session, twilioSocket, fallbackText);
      }

      if (event.type === "error") {
        const reason = event.error?.message ?? "OpenAI Realtime error";
        clearResponseWatchdog(session);
        if (isHarmlessOpenAICancelError(reason)) {
          session.hasActiveOpenAiResponse = false;
          logRelay("openai_cancel_ignored", { callSid: session.callSid, reason });
          await upsertCallLog(session, "TRANSCRIBED");
          await flushQueuedCallerText(session, twilioSocket);
          return;
        }
        if (isActiveResponseInProgressError(reason)) {
          session.hasActiveOpenAiResponse = false;
          logRelay("openai_active_response_ignored", { callSid: session.callSid, reason });
          await upsertCallLog(session, "TRANSCRIBED");
          await flushQueuedCallerText(session, twilioSocket);
          return;
        }
        session.hasActiveOpenAiResponse = false;
        const reply = STORE_CONFIRMATION_REQUIRED_REPLY;
        session.assistantTranscript.push(`AI: ${reply}`);
        sendTwilioText(twilioSocket, reply, true);
        sendTwilioEnd(twilioSocket, { reasonCode: "openai-error", reason });
        await upsertCallLog(session, "ESCALATED", reason);
      }
    });

    ws.on("error", async (error) => {
      clearTimeout(timeout);
      clearResponseWatchdog(session);
      session.hasActiveOpenAiResponse = false;
      await upsertCallLog(session, "ESCALATED", error.message);
      reject(error);
    });

    session.openai = ws;
  });
}

async function handleAssistantText(session, twilioSocket, text) {
  const normalized = sanitizeAssistantReplyForSpeech(session, text, "openai_text_done");
  if (!normalized || normalized === session.lastAssistantText) return;
  session.lastAssistantText = normalized;
  session.assistantTranscript.push(`AI: ${normalized}`);
  sendTwilioText(twilioSocket, normalized, true);
  await upsertCallLog(session, "TRANSCRIBED");
  scheduleTwilioCallEndIfTerminal(session, twilioSocket, normalized);
}

async function handleAssistantDelta(session, twilioSocket, delta) {
  const text = String(delta ?? "");
  if (!text) return;

  session.currentAssistantText += text;
  session.unsentAssistantText += text;

  const chunk = takeStreamableAssistantChunk(session.unsentAssistantText);
  if (!chunk) return;

  if (isEnglishDominantSpeech(chunk)) {
    await sendLanguageGuardFallback(session, twilioSocket, "openai_delta");
    return;
  }

  session.unsentAssistantText = session.unsentAssistantText.slice(chunk.length);
  session.sentAssistantText = true;
  clearResponseWatchdog(session);
  sendTwilioText(twilioSocket, chunk, false);
}

async function finalizeAssistantResponse(session, twilioSocket, fallbackText) {
  clearResponseWatchdog(session);
  if (session.responseWatchdogFallbackSent && !session.hasActiveOpenAiResponse) {
    session.pendingText = "";
    session.currentAssistantText = "";
    session.unsentAssistantText = "";
    session.sentAssistantText = false;
    return;
  }
  if (session.languageGuardFallbackSent) {
    session.pendingText = "";
    session.currentAssistantText = "";
    session.unsentAssistantText = "";
    session.hasActiveOpenAiResponse = false;
    session.sentAssistantText = false;
    session.languageGuardFallbackSent = false;
    await flushQueuedCallerText(session, twilioSocket);
    return;
  }

  if (!session.currentAssistantText && fallbackText) {
    session.currentAssistantText = fallbackText;
    session.unsentAssistantText = fallbackText;
  }

  const rawNormalized = String(session.currentAssistantText ?? "").trim();
  const normalized = sanitizeAssistantReplyForSpeech(session, rawNormalized, "openai_final");
  const remaining = normalized === rawNormalized ? String(session.unsentAssistantText ?? "") : normalized;

  session.pendingText = "";
  session.currentAssistantText = "";
  session.unsentAssistantText = "";
  session.hasActiveOpenAiResponse = false;

  if (!normalized || normalized === session.lastAssistantText) {
    if (session.sentAssistantText) sendTwilioText(twilioSocket, " ", true);
    session.sentAssistantText = false;
    await flushQueuedCallerText(session, twilioSocket);
    return;
  }

  if (remaining.trim()) {
    sendTwilioText(twilioSocket, remaining, true);
  } else if (session.sentAssistantText) {
    sendTwilioText(twilioSocket, " ", true);
  } else {
    sendTwilioText(twilioSocket, normalized, true);
  }

  session.sentAssistantText = false;
  session.lastAssistantText = normalized;
  session.assistantTranscript.push(`AI: ${normalized}`);
  await upsertCallLog(session, "TRANSCRIBED");
  if (scheduleTwilioCallEndIfTerminal(session, twilioSocket, normalized)) return;
  await flushQueuedCallerText(session, twilioSocket);
}

function startResponseWatchdog(session, twilioSocket, callerText) {
  clearResponseWatchdog(session);
  session.responseWatchdogTimer = setTimeout(async () => {
    if (!session.hasActiveOpenAiResponse || session.sentAssistantText || session.currentAssistantText) return;
    const reply = buildNoResponseFallbackReply(session, callerText);
    session.responseWatchdogFallbackSent = true;
    session.hasActiveOpenAiResponse = false;
    session.pendingText = "";
    session.currentAssistantText = "";
    session.unsentAssistantText = "";
    session.sentAssistantText = false;
    logRelay("openai_response_watchdog_fallback", {
      callSid: session.callSid,
      textLength: String(callerText ?? "").length,
      watchdogMs: RESPONSE_WATCHDOG_MS
    });
    if (session.openai?.readyState === WebSocket.OPEN) {
      try {
        session.openai.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        // The fallback already protects the caller; ignore cancellation transport errors.
      }
    }
    session.lastAssistantText = reply;
    session.assistantTranscript.push(`AI: ${reply}`);
    sendTwilioText(twilioSocket, reply, true);
    await upsertCallLog(session, "TRANSCRIBED", "openai response watchdog fallback");
    await flushQueuedCallerText(session, twilioSocket);
  }, RESPONSE_WATCHDOG_MS);
}

function clearResponseWatchdog(session) {
  if (!session.responseWatchdogTimer) return;
  clearTimeout(session.responseWatchdogTimer);
  session.responseWatchdogTimer = undefined;
}

function buildNoResponseFallbackReply(session, callerText) {
  const text = normalizeJapaneseSpeech(callerText).replace(/\s+/g, "");
  if (isSameDayAvailabilityQuestionWithoutTime(text)) {
    return "本日ですね。何時ごろをご希望でしょうか？お時間を伺って空きを確認します。";
  }
  const draft = session.reservationDraft ?? {};
  const nextQuestion = buildShortNextQuestion(draft);
  return nextQuestion || "すみません、確認に少し時間がかかっています。ご希望の日時とコースをもう一度お聞かせください。";
}


function takeStreamableAssistantChunk(text) {
  if (text.length < 12) return "";
  const commaIndex = text.search(/[、,]/u);
  if (commaIndex >= 6) return text.slice(0, commaIndex + 1);

  const sentenceIndex = text.search(/[。！？!?]/u);
  if (sentenceIndex >= 12 && text.length - sentenceIndex > 4) return text.slice(0, sentenceIndex + 1);

  if (text.length >= 36) return text.slice(0, 28);
  return "";
}
function queueCallerText(session, callerText) {
  session.queuedCallerText = [session.queuedCallerText, callerText].filter(Boolean).join("\n");
  logRelay("caller_prompt_queued", {
    callSid: session.callSid,
    queuedLength: session.queuedCallerText.length
  });
}

async function flushQueuedCallerText(session, twilioSocket) {
  const queued = String(session.queuedCallerText ?? "").trim();
  if (!queued || session.hasActiveOpenAiResponse) return;
  session.queuedCallerText = "";
  logRelay("caller_prompt_queue_flush", {
    callSid: session.callSid,
    textLength: queued.length
  });
  const scriptedReply = await scriptedReplyFor(session, queued);
  if (scriptedReply) {
    await sendScriptedReply(session, twilioSocket, scriptedReply);
    return;
  }
  await askOpenAI(session, queued, twilioSocket);
}

function extractResponseText(response) {
  if (!response?.output || !Array.isArray(response.output)) return "";
  return response.output
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.text ?? content?.transcript ?? "")
    .filter(Boolean)
    .join("\n");
}

function isHarmlessOpenAICancelError(reason) {
  return /Cancellation failed: no active response found/i.test(String(reason ?? ""));
}

function isActiveResponseInProgressError(reason) {
  return /Conversation already has an active response in progress/i.test(String(reason ?? ""));
}


function sendTwilioText(socket, token, last = false) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const speechToken = applyJapaneseSpeechPronunciationHints(token);
  socket.send(
    JSON.stringify({
      type: "text",
      token: speechToken,
      last,
      lang: "ja-JP",
      interruptible: true,
      preemptible: true
    })
  );
}

function applyJapaneseSpeechPronunciationHints(value) {
  const text = String(value ?? "");
  if (!text.trim()) return text;
  return text
    .replace(/Legend\s*Massage/giu, "レジェンドマッサージ")
    .replace(/ARARE\s*AI/giu, "あられ エーアイ")
    .replace(/vinoプレジオ本町/giu, "ヴィーノ プレジオ 本町")
    .replace(/SMS/g, "ショートメッセージ")
    .replace(/LINE/g, "ライン")
    .replace(/([0-9０-９]+)\s*cm/giu, (_, digits) => normalizePlainDigits(digits) + "センチ")
    .replace(/([A-HＡ-Ｈ])\s*カップ/giu, (_, cup) => normalizeCupPronunciation(cup) + "カップ")
    .replace(/鼠径部/g, "そけい部")
    .replace(/ディープリンパ/g, "ディープ リンパ")
    .replace(/フェザータッチ/g, "フェザー タッチ")
    .replace(/カエル脚/g, "カエルあし")
    .replace(/四つん這い/g, "よつんばい")
    .replace(/SM/g, "エス エム")
    .replace(/S寄り/g, "エス寄り")
    .replace(/M寄り/g, "エム寄り")
    .replace(/夜帯/g, "夜の時間帯")
    .replace(/末尾\s*([0-9０-９]{4})/g, (_, digits) => "下4桁、" + normalizeSpokenDigits(digits))
    .replace(/美咲さん/g, "みさきさん")
    .replace(/美咲/g, "みさき")
    .replace(/清澄せいらさん/g, "せいらさん")
    .replace(/清澄せいら/g, "せいら")
    .replace(/(?:\+81|81)?(0[789]0)[-\s]?([0-9０-９]{4})[-\s]?([0-9０-９]{4})/g, (_, a, b, c) => {
      return [a, b, c].map(normalizeSpokenDigits).join("、");
    });
}

function normalizeSpokenDigits(value) {
  return String(value ?? "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 48))
    .replace(/\D/g, "")
    .split("")
    .join(" ");
}

function normalizePlainDigits(value) {
  return String(value ?? "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 48));
}

function normalizeCupPronunciation(value) {
  const normalized = String(value ?? "")
    .replace(/[Ａ-Ｈ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toUpperCase();
  const map = {
    A: "エー",
    B: "ビー",
    C: "シー",
    D: "ディー",
    E: "イー",
    F: "エフ",
    G: "ジー",
    H: "エイチ"
  };
  return map[normalized] ?? normalized;
}
function shouldEndCallAfterReply(session, text) {
  const reply = normalizeJapaneseSpeech(text);
  if (!reply) return false;
  if (session.reservationDraft?.completed && /(\u5931\u793c\u3044\u305f\u3057\u307e\u3059|\u78ba\u8a8dSMS\u3092\u304a\u9001\u308a\u3057\u307e\u3057\u305f|\u5e97\u8217\u3088\u308a\u5225\u9014\u3054\u9023\u7d61)/u.test(reply)) return true;
  if (session.reservationDraft?.cancelled && /(\u7d42\u4e86\u3057\u307e\u3059|\u307e\u305f\u5fc5\u8981\u3067\u3057\u305f\u3089)/u.test(reply)) return true;
  return /(\u304a\u96fb\u8a71\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f\u3002\u5931\u793c\u3044\u305f\u3057\u307e\u3059|\u305d\u308c\u3067\u306f\u5931\u793c\u3044\u305f\u3057\u307e\u3059)/u.test(reply);
}

function scheduleTwilioCallEndIfTerminal(session, socket, text) {
  if (!shouldEndCallAfterReply(session, text)) return false;
  scheduleTwilioCallEndAfterAudio(session, socket, text);
  return true;
}

function scheduleTwilioCallEndAfterAudio(session, socket, text, handoffData) {
  if (session.endCallScheduled) return true;
  session.endCallScheduled = true;
  session.endCallPendingAfterTokensPlayed = true;
  session.endCallHandoffData = handoffData;
  const speechText = applyJapaneseSpeechPronunciationHints(text);
  const fallbackDelayMs = estimateTerminalSpeechEndDelayMs(speechText);
  session.endCallEarliestAt = Date.now() + Math.min(Math.max(Math.floor(fallbackDelayMs * 0.45), 6500), 12000);
  logRelay("terminal_call_end_scheduled", {
    callSid: session.callSid,
    fallbackDelayMs,
    earliestDelayMs: Math.max(session.endCallEarliestAt - Date.now(), 0),
    textLength: String(speechText ?? "").length,
    hasHandoffData: Boolean(handoffData)
  });
  session.endCallFallbackTimer = setTimeout(() => {
    endCallAfterTerminalAudioPlayed(session, socket, "fallback-delay");
  }, fallbackDelayMs);
  return true;
}

function endCallAfterTerminalAudioPlayed(session, socket, source) {
  if (!session.endCallScheduled || !session.endCallPendingAfterTokensPlayed) return false;
  if (source === "tokens-played" && Date.now() < (session.endCallEarliestAt ?? 0)) {
    logRelay("terminal_call_end_waiting_for_minimum_audio", {
      callSid: session.callSid,
      remainingMs: Math.max((session.endCallEarliestAt ?? 0) - Date.now(), 0)
    });
    return false;
  }
  session.endCallPendingAfterTokensPlayed = false;
  if (session.endCallFallbackTimer) {
    clearTimeout(session.endCallFallbackTimer);
    session.endCallFallbackTimer = undefined;
  }
  logRelay("terminal_call_end_sent", {
    callSid: session.callSid,
    source,
    hasHandoffData: Boolean(session.endCallHandoffData)
  });
  const handoffData = session.endCallHandoffData;
  session.endCallHandoffData = undefined;
  setTimeout(() => {
    sendTwilioEnd(socket, handoffData);
  }, source === "tokens-played" ? 900 : 0);
  return true;
}

function estimateTerminalSpeechEndDelayMs(text) {
  const normalized = String(text ?? "").replace(/\s+/g, "");
  const japaneseChars = (normalized.match(/[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/g) ?? []).length;
  const digits = (normalized.match(/[0-9]/g) ?? []).length;
  const punctuationPauses = (normalized.match(/[。、！？!?]/g) ?? []).length;
  const estimated = 2200 + japaneseChars * 210 + digits * 90 + punctuationPauses * 350;
  return Math.min(Math.max(estimated, 8500), 22000);
}

function logConversationState(session, eventName, details = {}) {
  const draft = session.reservationDraft ?? {};
  const availability = draft.availabilityCheckResult ?? {};
  logRelay("conversation_state", {
    callSid: session.callSid,
    eventName,
    current_state: draft.awaitingField ?? "unknown",
    user_utterance: details.user_utterance ?? null,
    raw_utterance: details.raw_utterance ?? details.user_utterance ?? null,
    assistant_response: details.assistant_response ?? null,
    selected_therapist: draft.therapistName ?? session.selectedTherapist ?? null,
    selected_therapist_source: draft.selected_therapist_source ?? null,
    suggested_therapist: draft.suggested_therapist ?? draft.suggestedTherapistName ?? null,
    pending_time_confirmation: draft.pending_time_confirmation ?? draft.datetime_confirmation_required ?? null,
    pending_date_confirmation: draft.pending_date_confirmation ?? null,
    requested_datetime: draft.requested_datetime ?? (draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null),
    requested_date: draft.requested_date ?? null,
    requested_time: draft.requested_time ?? null,
    parsed_date: details.parsed_date ?? draft.requested_date ?? null,
    parsed_time: details.parsed_time ?? draft.requested_time ?? null,
    parsed_datetime_jst: details.parsed_datetime_jst ?? (draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null),
    last_requested_date: details.last_requested_date ?? draft.last_requested_date ?? null,
    last_requested_time: details.last_requested_time ?? draft.last_requested_time ?? null,
    last_requested_datetime: details.last_requested_datetime ?? draft.last_requested_datetime ?? null,
    date_source: details.date_source ?? draft.date_source ?? null,
    time_source: details.time_source ?? draft.time_source ?? null,
    date_confidence: details.date_confidence ?? draft.date_confidence ?? null,
    time_confidence: details.time_confidence ?? draft.time_confidence ?? null,
    datetime_guard_category: draft.datetime_guard_category ?? null,
    datetime_guard_priority: draft.datetime_guard_priority ?? null,
    availability_search_mode: draft.availability_search_mode ?? false,
    repeat_response_count: draft.repeat_response_count ?? 0,
    therapist_match_confidence: draft.therapist_match_confidence ?? null,
    therapist_match_guarded: draft.therapist_match_guarded ?? false,
    availability_query_datetime: details.availability_query_datetime ?? (draft.startsAt ? formatJstDateTimeOffset(draft.startsAt) : null),
    alternative_search_from_datetime: details.alternative_search_from_datetime ?? draft.alternative_search_from_datetime ?? null,
    customer_name: draft.customerName ?? null,
    customer_phone: draft.phone ?? null,
    course: draft.course?.name ?? null,
    availability_check_result: draft.availabilityCheckResult ?? null,
    matched_shift_count: availability.matchedShiftCount ?? null,
    matched_booking_conflict_count: availability.matchedBookingConflictCount ?? null,
    next_action: details.next_action ?? inferNextAction(session),
    error_reason: details.error_reason ?? availability.reason ?? null
  });
}

function inferNextAction(session) {
  const draft = session.reservationDraft ?? {};
  if (draft.awaitingFinalConfirmation) return "await_final_confirmation";
  if (!draft.startsAt) return "ask_datetime";
  if (draft.availabilityCheckResult?.ok === false) return "ask_alternative_datetime";
  if (draft.availabilityCheckResult?.ok !== true) return "check_availability";
  if (!draft.customerName) return "ask_customer_name";
  if (!draft.phone) return "ask_customer_phone";
  if (!draft.course) return "ask_course";
  return "recite_or_confirm";
}

function sendTwilioEnd(socket, handoffData) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const payload = { type: "end" };
  if (handoffData) payload.handoffData = JSON.stringify(handoffData);
  socket.send(JSON.stringify(payload));
}

async function upsertCallLog(session, status, reviewNotes) {
  if (isRegressionCall(session)) return;
  if (!process.env.DATABASE_URL || !session.callSid || !session.storeId) return;
  if (status === "ESCALATED") session.requiredReview = true;
  const transcript = [...session.transcript, ...session.assistantTranscript].join("\n");
  const aiSummary = transcript ? transcript.slice(-1800) : undefined;
  const data = {
    storePhoneSettingId: session.storePhoneSettingId,
    phoneNumber: session.from,
    toNumber: session.to,
    twilioCallSid: session.callSid,
    status,
    transcript: transcript || undefined,
    aiSummary,
    reviewNotes,
    requiredReview: status === "ESCALATED" || session.requiredReview === true
  };

  const callLogId = `call-${session.callSid}`;
  await prisma
    .$transaction(async (tx) => {
      const updated = await tx.callLog.updateMany({
        where: { twilioCallSid: session.callSid },
        data: {
          storeId: session.storeId,
          ...data
        }
      });

      if (updated.count > 0) return;

      await tx.callLog.upsert({
        where: { id: callLogId },
        update: {
          storeId: session.storeId,
          ...data
        },
        create: {
          id: callLogId,
          storeId: session.storeId,
          ...data
        }
      });
    })
    .catch((error) => console.warn("call log write failed:", error.message));
}

async function handleTwilioSmsStatus(request, response, url) {
  const form = await readForm(request);
  const payload = Object.fromEntries(form.entries());
  const notificationId = url.searchParams.get("notificationId");
  const smsSid = stringValue(payload.MessageSid ?? payload.SmsSid ?? payload.SmsMessageSid);
  const rawStatus = stringValue(payload.MessageStatus ?? payload.SmsStatus ?? payload.SmsMessageStatus ?? payload.status);
  const smsStatus = rawStatus ? rawStatus.toLowerCase() : "unknown";
  const errorCode = stringValue(payload.ErrorCode ?? payload.error_code);
  const errorMessage = stringValue(payload.ErrorMessage ?? payload.error_message);

  if (!notificationId && !smsSid) {
    writeJson(response, 200, { ok: false, ignored: true, reason: "missing_notification_and_sms_sid" });
    return;
  }

  const notification = await prisma.notification.findFirst({
    where: notificationId ? { id: notificationId } : { smsSid },
    select: {
      id: true,
      storeId: true,
      reservationId: true,
      type: true,
      channel: true,
      smsSid: true,
      smsDeliveredAt: true,
      targetName: true,
      targetPhone: true,
      customerPhone: true,
      smsTo: true
    }
  });

  if (!notification) {
    writeJson(response, 200, { ok: false, ignored: true, reason: "notification_not_found" });
    return;
  }

  const now = new Date();
  const delivered = smsStatus === "delivered";
  const failed = ["failed", "undelivered"].includes(smsStatus);
  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: {
      smsSid: notification.smsSid ?? smsSid,
      smsDeliveryStatus: smsStatus,
      smsDeliveryCheckedAt: now,
      smsDeliveredAt: delivered ? now : notification.smsDeliveredAt,
      smsDeliveryRaw: payload,
      smsErrorCode: failed ? errorCode : null,
      smsErrorMessage: failed ? errorMessage || `Twilio delivery status: ${smsStatus}` : null
    },
    select: {
      id: true,
      storeId: true,
      reservationId: true,
      type: true,
      channel: true,
      smsSid: true,
      smsDeliveryStatus: true,
      smsDeliveredAt: true,
      smsErrorCode: true,
      smsErrorMessage: true
    }
  });

  const dedupeKey = `twilio-callback:${updated.smsSid ?? updated.id}`;
  await prisma.notificationLog.upsert({
    where: {
      storeId_dedupeKey: {
        storeId: updated.storeId,
        dedupeKey
      }
    },
    update: {
      status: failed ? "FAILED" : "SENT",
      provider: "twilio",
      providerMessageId: updated.smsSid,
      errorCode: updated.smsErrorCode,
      errorMessage: updated.smsErrorMessage,
      payload,
      sentAt: delivered || smsStatus === "sent" ? now : undefined
    },
    create: {
      storeId: updated.storeId,
      notificationId: updated.id,
      reservationId: updated.reservationId,
      type: updated.type,
      channel: updated.channel,
      status: failed ? "FAILED" : "SENT",
      recipientName: notification.targetName,
      recipientPhone: notification.smsTo ?? notification.targetPhone ?? notification.customerPhone,
      provider: "twilio",
      providerMessageId: updated.smsSid,
      dedupeKey,
      errorCode: updated.smsErrorCode,
      errorMessage: updated.smsErrorMessage,
      payload,
      sentAt: delivered || smsStatus === "sent" ? now : undefined
    }
  });

  logRelay("twilio_sms_status_callback", {
    notificationId: updated.id,
    smsSid: updated.smsSid,
    smsDeliveryStatus: updated.smsDeliveryStatus,
    smsErrorCode: updated.smsErrorCode
  });
  writeJson(response, 200, { ok: true, notificationId: updated.id, smsSid: updated.smsSid, smsDeliveryStatus: updated.smsDeliveryStatus });
}

async function readForm(request) {
  const body = await readRequestBody(request);
  return new URLSearchParams(body);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sanitizeCallLogText(value) {
  if (!value) return value;
  const customerLabel = "\u304a\u5ba2\u69d8:";
  const unknownLabel = String.fromCharCode(63, 63, 63, 58);
  return String(value).replaceAll(unknownLabel, customerLabel);
}

function normalizeSpeechRate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{2,3})(?:\s*%)?$/);
  if (!match) return "94%";
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return "94%";
  return String(Math.min(145, Math.max(90, number))) + "%";
}

function normalizeJapaneseTtsProvider(value) {
  const provider = String(value ?? "").trim();
  if (/^google$/i.test(provider)) return "Google";
  if (/^amazon$/i.test(provider)) return "Amazon";
  if (/^deepgram$/i.test(provider)) return "Deepgram";
  if (/^elevenlabs$/i.test(provider)) return "ElevenLabs";
  return "Amazon";
}

function normalizeJapaneseTtsVoice(provider, value) {
  const voice = String(value ?? "").trim();
  if (provider === "Amazon") {
    return /^(Takumi|Kazuha|Tomoko|Mizuki)(?:-Neural)?$/i.test(voice) ? voice : "Takumi-Neural";
  }
  if (provider === "Google") {
    const googleVoice = voice.replace(/^Google\./i, "");
    return /^ja-JP/i.test(googleVoice) ? googleVoice : "ja-JP-Neural2-C";
  }
  return voice || "Takumi-Neural";
}

function normalizeTranscriptionProvider(value) {
  const provider = String(value ?? "").trim();
  if (/^deepgram$/i.test(provider)) return "Deepgram";
  if (/^google$/i.test(provider)) return "Google";
  return "Google";
}

function normalizeSpeechModel(provider, value) {
  const model = String(value ?? "").trim();
  if (model) return model;
  return provider === "Deepgram" ? "nova-2" : "long";
}

function isRegressionCall(sessionOrCallSid) {
  const callSid = typeof sessionOrCallSid === "string" ? sessionOrCallSid : sessionOrCallSid?.callSid;
  return String(callSid ?? "").startsWith("CA_REGRESSION_");
}

function loadDestructiveIntentTraining(path) {
  const empty = { rows: [], byKey: new Map(), counts: {} };
  if (!existsSync(path)) return empty;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  const byKey = new Map();
  const counts = {};
  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 5) continue;
    const row = {
      intent: columns[0],
      utterance: columns[1],
      expectedAction: columns[2],
      forbiddenAction: columns[3],
      priority: Number(columns[4] || 0)
    };
    if (!row.intent || !row.utterance) continue;
    rows.push(row);
    counts[row.intent] = (counts[row.intent] ?? 0) + 1;
    const key = normalizeIntentKey(row.utterance);
    const current = byKey.get(key);
    if (!current || row.priority > current.priority) byKey.set(key, row);
  }
  return { rows, byKey, counts };
}

function loadAdultServiceTerminology(path) {
  const empty = { rows: [], counts: {} };
  if (!existsSync(path)) return empty;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  const counts = {};
  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 5) continue;
    const row = {
      term: String(columns[0] ?? "").trim(),
      aliases: String(columns[1] ?? "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean),
      category: String(columns[2] ?? "").trim(),
      policy: String(columns[3] ?? "").trim(),
      priority: Number(columns[4] || 0)
    };
    if (!row.term || !row.category) continue;
    rows.push(row);
    counts[row.category] = (counts[row.category] ?? 0) + 1;
  }
  return { rows, counts };
}

function loadServiceKnowledge(path) {
  const empty = { rows: [], counts: {} };
  if (!existsSync(path)) return empty;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  const counts = {};
  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 7) continue;
    const row = {
      key: String(columns[0] ?? "").trim(),
      aliases: String(columns[1] ?? "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean),
      category: String(columns[2] ?? "").trim(),
      safeSummary: String(columns[3] ?? "").trim(),
      features: String(columns[4] ?? "").trim(),
      notIncluded: String(columns[5] ?? "").trim(),
      priority: Number(columns[6] || 0)
    };
    if (!row.key || !row.safeSummary) continue;
    rows.push(row);
    counts[row.category] = (counts[row.category] ?? 0) + 1;
  }
  return { rows, counts };
}

function loadDateTimeContextTraining(path) {
  const empty = { rows: [], byKey: new Map(), counts: {} };
  if (!existsSync(path)) return empty;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  const byKey = new Map();
  const counts = {};
  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 4) continue;
    const row = {
      intent: columns[0],
      utterance: columns[1],
      expectedAction: columns[2],
      priority: Number(columns[3] || 0)
    };
    if (!row.intent || !row.utterance) continue;
    rows.push(row);
    counts[row.intent] = (counts[row.intent] ?? 0) + 1;
    const key = normalizeIntentKey(row.utterance);
    const current = byKey.get(key);
    if (!current || row.priority > current.priority) byKey.set(key, row);
  }
  return { rows, byKey, counts };
}

function loadDateTimeGuardTraining(path) {
  const empty = { rows: [], byKey: new Map(), counts: {} };
  if (!existsSync(path)) return empty;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  const byKey = new Map();
  const counts = {};
  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 5) continue;
    const row = {
      category: columns[0],
      utterance: columns[1],
      expectedAction: columns[2],
      forbiddenAction: columns[3],
      priority: Number(columns[4] || 0)
    };
    if (!row.category || !row.utterance) continue;
    rows.push(row);
    counts[row.category] = (counts[row.category] ?? 0) + 1;
    const key = normalizeIntentKey(row.utterance);
    const current = byKey.get(key);
    if (!current || row.priority > current.priority) byKey.set(key, row);
  }
  return { rows, byKey, counts };
}

function mergeDateTimeGuardTraining(sources) {
  const rows = [];
  const byKey = new Map();
  const counts = {};
  for (const source of sources) {
    for (const row of source?.rows ?? []) {
      rows.push(row);
      counts[row.category] = (counts[row.category] ?? 0) + 1;
      const key = normalizeIntentKey(row.utterance);
      const current = byKey.get(key);
      if (!current || row.priority > current.priority) byKey.set(key, row);
    }
  }
  return { rows, byKey, counts };
}

function parseCsvLine(line) {
  const columns = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      columns.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  columns.push(current);
  return columns;
}

function normalizeIntentKey(value) {
  return normalizeJapaneseSpeech(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000\u3001\u3002,.!?！？「」『』（）()\[\]【】]/g, "")
    .trim();
}

async function resolveRelaySetupStore(input) {
  const byNumber = await resolvePhoneRoute(input.toNumber);
  if (byNumber.ok) {
    return { storeId: byNumber.storeId, settingId: byNumber.settingId };
  }

  if (!process.env.DATABASE_URL || !input.callSid) return null;
  const callLog = await prisma.callLog
    .findFirst({
      where: { twilioCallSid: input.callSid },
      orderBy: { createdAt: "desc" },
      select: { storeId: true, storePhoneSettingId: true }
    })
    .catch((error) => {
      logRelay("relay_setup_store_lookup_failed", {
        callSid: input.callSid,
        reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
      });
      return null;
    });
  if (!callLog?.storeId) return null;
  return { storeId: callLog.storeId, settingId: callLog.storePhoneSettingId };
}

async function resolvePhoneRoute(toNumber) {
  const normalized = normalizePhoneNumber(toNumber);
  if (!normalized) return { ok: false };

  let setting;
  try {
    setting = await prisma.storePhoneSetting.findUnique({
      where: { normalizedAiReceptionPhoneNumber: normalized }
    });
  } catch (error) {
    logRelay("phone_route_lookup_failed", {
      to: normalized,
      reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    });
    return { ok: false, reason: "db_unavailable" };
  }

  if (!setting) return { ok: false };

  return {
    ok: true,
    storeId: setting.storeId,
    settingId: setting.id,
    voiceAiEnabled: setting.voiceAiEnabled,
    routingMode: setting.routingMode,
    fallbackPhoneNumber: setting.fallbackPhoneNumber
  };
}

function normalizePhoneNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  return `${prefix}${text.replace(/\D/g, "")}`;
}

function buildRelayWebSocketUrl(host) {
  const base = `wss://${host}/conversation-relay`;
  return sharedSecret ? `${base}?token=${encodeURIComponent(sharedSecret)}` : base;
}

function writeXml(response, body) {
  if (response.writableEnded) return;
  response.writeHead(200, { "content-type": "application/xml" });
  response.end(body);
}

function writeJson(response, statusCode, payload) {
  if (response.writableEnded) return;
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function checkVoiceRelayDatabaseHealth() {
  if (!process.env.DATABASE_URL) {
    return { checked: true, ok: false, error: "DATABASE_URL is not configured" };
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { checked: true, ok: true };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      error: sanitizeOperationalError(error)
    };
  }
}

function sanitizeOperationalError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const [value, label] of [
    [process.env.DATABASE_URL, "[DATABASE_URL]"],
    [process.env.TWILIO_AUTH_TOKEN, "[TWILIO_AUTH_TOKEN]"],
    [process.env.OPENAI_API_KEY, "[OPENAI_API_KEY]"]
  ]) {
    if (value) message = message.replaceAll(value, label);
  }
  return message.slice(0, 500);
}

async function handleVoiceWebhookFatalError(response, error, eventName) {
  const reason = error instanceof Error ? error.message : String(error);
  logRelay(eventName, { reason: reason.slice(0, 500) });
  writeXml(
    response,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      "  " + sayJaBasic("申し訳ありません。現在、電話AI受付の確認に時間がかかっています。店舗より折り返しご案内いたします。"),
      "</Response>"
    ].join("\n")
  );
}


function conversationRelayXml(input) {
  const parameters = {
    callReference: input.callReference,
    product: "ARARE AI",
    mode: "reservation-reception",
    ...input.parameters
  };
  const parameterXml = Object.entries(parameters)
    .filter((entry) => Boolean(entry[1]))
    .map(([name, value]) => '<Parameter name="' + escapeXml(name) + '" value="' + escapeXml(value) + '"/>')
    .join("\n      ");
  const hints = [
    "予約",
    "空き確認",
    "空いてる",
    "空き枠",
    "枠",
    "今日",
    "今日空いてますか",
    "今日行けますか",
    "明日",
    "今から",
    "最短",
    "60分",
    "90分",
    "120分",
    "フリー",
    "指名",
    "本指名",
    "初めて",
    "電話番号",
    "料金",
    "場所",
    "コース",
    "セラピスト",
    "おすすめ",
    "変更",
    "キャンセル",
    "聞こえますか"
  ].join(",");
  const welcomeGreetingXml = VOICE_RELAY_TWIML_WELCOME_GREETING
    ? [
        '      welcomeGreeting="' + escapeXml(VOICE_RELAY_TWIML_WELCOME_GREETING) + '"',
        '      welcomeGreetingInterruptible="any"'
      ]
    : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    '  <Connect action="' + escapeXml(input.connectActionUrl) + '" method="POST">',
    "    <ConversationRelay",
    '      url="' + escapeXml(input.websocketUrl) + '"',
    ...welcomeGreetingXml,
    '      language="ja-JP"',
    '      transcriptionLanguage="ja-JP"',
    '      ttsLanguage="ja-JP"',
    '      ttsProvider="' + escapeXml(ttsProvider) + '"',
    '      voice="' + escapeXml(ttsVoice) + '"',
    '      transcriptionProvider="' + escapeXml(transcriptionProvider) + '"',
    '      speechModel="' + escapeXml(speechModel) + '"',
    '      interruptible="any"',
    '      interruptSensitivity="high"',
    '      reportInputDuringAgentSpeech="speech"',
    '      speechTimeout="' + escapeXml(speechTimeoutMs) + '"',
    '      dtmfDetection="true"',
    '      events="speaker-events tokens-played"',
    '      debug="debugging"',
    '      hints="' + escapeXml(hints) + '"',
    "    >",
    parameterXml ? "      " + parameterXml : "",
    "    </ConversationRelay>",
    "  </Connect>",
    "</Response>"
  ].join("\n");
}

function sayJa(text) {
  return '<Say language="ja-JP" voice="' + escapeXml(sayVoice) + '"><prosody rate="' + escapeXml(ttsSpeechRate) + '">' + escapeXml(text) + "</prosody></Say>";
}
function sayJaBasic(text) {
  return '<Say language="ja-JP">' + escapeXml(text) + "</Say>";
}
function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}


function buildTurnPrompt(session, callerText) {
  const recent = [...session.transcript, ...session.assistantTranscript].slice(-10).join("\n");
  return [
    "現在日付: " + japanDateLabel(),
    "店舗情報:",
    formatStoreContextForPrompt(session.storeContext),
    "",
    "現在の会話履歴:",
    recent || "会話履歴はまだありません。",
    "",
    "お客様の最新発話:",
    callerText,
    "",
    "絶対ルール:",
    "- 予約は必ず、空き確認、空きありの場合のみ顧客名、電話番号、コース、復唱、仮予約受付の順で進める。",
    "- AIが予約確定済みとは言わない。店舗確認後に確定案内すると伝える。",
    "- 空きがない場合は、名前、電話番号、コースを聞かない。復唱しない。",
    "- 時間指定がある場合、本日の出勤者一覧ではなく、その時間に対応可能なセラピストだけを案内する。",
    "- 不明点は1つずつ短く確認する。",
    "- 返答は必ず日本語だけにする。英語のあいさつや英語の説明を混ぜない。",
    "- 返答は自然な電話口の日本語で、短く丁寧にする。",
    "- メンズエステの隠語は意味とカテゴリを理解する。ただし性的サービス、露出、禁止行為は可能、あり、できます等で答えず、匂わせや保証もしない。登録済みコース、登録オプション、店舗確認へ戻す。"
  ].join("\n");
}

function formatStoreContextForPrompt(context) {
  const store = context?.store;
  const courses = context?.courses ?? [];
  const options = context?.options ?? [];
  const therapists = context?.therapists ?? [];
  const rooms = context?.rooms ?? [];

  return [
    "店舗名: " + (store?.name ?? "未設定"),
    "営業時間: " + (store?.openTime ?? "未設定") + " - " + (store?.closeTime ?? "未設定"),
    "コース: " + (courses.length ? courses.map((course) => course.name + " " + course.durationMin + "分 " + formatYen(course.price)).join(" / ") : "未設定"),
    "コース内容: " + (courses.length ? courses.map((course) => formatCourseContextLine(course)).join(" / ") : "未設定"),
    "登録オプション: " + (options.length ? options.map((option) => option.name + " " + formatYen(option.price)).join(" / ") : "未設定"),
    "登録セラピスト: " + (therapists.length ? therapists.map((therapist) => therapist.displayName).join("、") : "未設定"),
    "セラピスト特徴: " + (therapists.length ? therapists.map((therapist) => formatTherapistContextLine(therapist)).filter(Boolean).join(" / ") : "未設定"),
    "ルーム数: " + (rooms.length || store?.setting?.roomCount || "未設定"),
    "店舗AI方針: " + (store?.setting?.aiPolicy ?? "必要項目が揃うまで確定しない。"),
    "話し方: " + (store?.aiSetting?.tone ?? "明るく、短く、丁寧に。")
  ].join("\n");
}

function formatCourseContextLine(course) {
  const description = sanitizeCourseDescriptionForSpeech(course.description);
  return formatCourseLineForSpeech(course) + ": " + (description || defaultCourseFeatureSentence(course));
}

function formatTherapistContextLine(therapist) {
  const name = String(therapist?.displayName || therapist?.name || "").trim();
  if (!name) return "";
  const profile = String(therapist?.profile || "").replace(/\s+/g, " ").trim();
  return profile ? name + ": " + profile.slice(0, 120) : name + ": 特徴未登録";
}

function japanDateLabel() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date());
}

function systemPrompt() {
  return [
    "最重要: あなたの発話は必ず日本語だけです。英語、ローマ字、中国語、翻訳口調、英語のあいさつは禁止です。",
    "もし英語で返したくなった場合も、必ず日本語で「日本語でご案内します」と短く案内してください。",
    "あなたは ARARE AI の電話予約受付です。",
    "メンズエステ店舗の受付として、落ち着いた自然な日本語で対応します。",
    "予約成立ロジックはシステム側のDB確認を優先し、空きがない状態で個人情報を聞いてはいけません。",
    "予約復唱前には必ず空き確認済みである必要があります。",
    "復唱後に空きなしを伝える流れは禁止です。",
    "フルネームは求めず、名字だけでも受け付けます。",
    "質問文やセラピスト名確認を顧客名として扱ってはいけません。",
    "メンズエステの隠語は意味とカテゴリを理解します。ただし性的サービス、露出、禁止行為を案内、約束、可能と示唆してはいけません。",
    "性的な隠語を受けた場合は、冷たく切らず「内容は分かりますが、受付では登録済みの通常コースだけをご案内します」と短く戻します。",
    "鼠径部やリンパ周りの質問は、店舗登録済みコースの範囲でのみ案内し、未登録内容は店舗確認に回します。",
    "返答は短く、電話口で聞き取りやすくしてください。"
  ].join("\n");
}

function readCustomParameters(message) {
  const raw = message.customParameters ?? message.parameters ?? message.connectParams ?? {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .map((item) => [stringValue(item.name), stringValue(item.value)])
        .filter(([name, value]) => name && value)
    );
  }
  if (typeof raw === "object" && raw !== null) return raw;
  return {};
}

function stringValue(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function isValidTwilioWebSocketRequest(request) {
  const signature = request.headers["x-twilio-signature"];
  if (!signature || typeof signature !== "string") return false;
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = request.headers["x-forwarded-proto"] ?? "https";
  const url = `${proto}://${host}${request.url}`;
  const expected = crypto.createHmac("sha1", twilioAuthToken).update(url).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}



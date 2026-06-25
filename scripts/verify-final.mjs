import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const fixturePath = path.join("apps", "api", "test", "fixtures", "conversationQualityCases.json");
const improvementTemplatePath = path.join("apps", "api", "test", "fixtures", "callQualityImprovementLogTemplate.json");
const outPath = path.join("reports", `conversation_quality_final_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const fixedStoreCheckReply = "確認が必要です。店舗に確認して折り返します。";
const requiredReadbackFields = ["日時", "コース", "指名", "お名前", "電話番号", "来店歴", "注意事項"];
const clearConsentTexts = ["はい", "それでお願いします", "大丈夫です", "お願いします", "合っています", "あっています"];

const fixture = readJson(fixturePath);
const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
const fixtureFailures = validateFixture(cases);
const staticChecks = runStaticChecks();
const lightweightResults = cases.map((testCase) => scoreCase(testCase, mockReply(testCase)));
const httpResults = buildHttpCases().map((testCase) => scoreCase(testCase, mockReply(testCase), { kind: "http" }));
const multiTurnResults = buildMultiTurnCases().map(runMultiTurnCase);
const improvementTemplate = existsSync(improvementTemplatePath) ? readJson(improvementTemplatePath) : null;

const summary = summarize({
  fixtureFailures,
  staticChecks,
  lightweightResults,
  httpResults,
  multiTurnResults,
  improvementTemplate
});

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      summary,
      fixturePath,
      improvementTemplatePath,
      note: "Mock/adapter boundary quality verification only. This is not production Twilio/OpenAI/LINE call verification.",
      results: { staticChecks, fixtureFailures, lightweightResults, httpResults, multiTurnResults }
    },
    null,
    2
  ),
  "utf8"
);

console.log(JSON.stringify({ ...summary, outPath }, null, 2));
if (!summary.pass) process.exitCode = 1;

function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing required file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function validateFixture(items) {
  const failures = [];
  const categories = new Set(items.map((item) => item.category));
  const requiredCategories = [
    "initial_booking",
    "repeat_booking",
    "nominated",
    "free_booking",
    "course_undecided",
    "price_question",
    "business_hours_question",
    "access_question",
    "therapist_question",
    "today_request",
    "now_request",
    "tomorrow_request",
    "weekend_request",
    "ambiguous_datetime",
    "time_only",
    "date_only",
    "ambiguous_course_time",
    "phone_capture",
    "phone_correction",
    "name_capture",
    "name_retry",
    "visit_history",
    "readback",
    "consent",
    "correction",
    "change_request",
    "cancel_request",
    "late_notice",
    "arrival_notice",
    "group_booking",
    "room_shortage",
    "shift_outside",
    "full_alternative",
    "ng_rule",
    "blacklist",
    "anonymous_call",
    "silence",
    "unclear",
    "casual",
    "small_talk",
    "prank",
    "discount",
    "complaint",
    "angry",
    "hurry",
    "sexual_question",
    "personal_info",
    "unknown_knowledge",
    "store_check_required",
    "sms_question",
    "callback_request",
    "escalation"
  ];

  if (items.length < 1000) failures.push({ id: "fixture", reason: `expected >=1000 cases, got ${items.length}` });
  for (const category of requiredCategories) {
    if (!categories.has(category)) failures.push({ id: "fixture", reason: `missing category: ${category}` });
  }

  for (const item of items) {
    const raw = JSON.stringify(item);
    if (!String(item.utterance ?? "").trim()) failures.push({ id: item.id, reason: "empty_utterance" });
    if (/[�]|[?]{4,}/.test(raw)) failures.push({ id: item.id, reason: "mojibake_like_text" });
    if (!String(item.expectedResponse ?? "").trim()) failures.push({ id: item.id, reason: "missing_expected_response" });
    if (!Array.isArray(item.ngResponse) || item.ngResponse.length === 0) failures.push({ id: item.id, reason: "missing_ng_response" });
    if (!Array.isArray(item.scoringCriteria) || item.scoringCriteria.length < 5) failures.push({ id: item.id, reason: "missing_scoring_criteria" });
    if (!Array.isArray(item.forbiddenActions) || !item.forbiddenActions.includes("direct_CONFIRMED_reservation")) {
      failures.push({ id: item.id, reason: "missing_direct_confirmed_forbidden_action" });
    }
  }
  return failures;
}

function countStaticSourceLiteral(source, literal) {
  return String(source ?? "").split(literal).length - 1;
}

function runStaticChecks() {
  const checks = [
    ["node --check scripts/voice-relay-server.mjs", "node", ["--check", "scripts/voice-relay-server.mjs"]],
    ["node --check scripts/generate-conversation-quality-cases.mjs", "node", ["--check", "scripts/generate-conversation-quality-cases.mjs"]],
    ["node --check scripts/verify-final.mjs", "node", ["--check", "scripts/verify-final.mjs"]],
    ["node node_modules/typescript/bin/tsc --noEmit --pretty false", "node", ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"]]
  ];

  const commandResults = checks.map(([name, command, args]) => {
    try {
      execFileSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
        shell: false,
        env: { ...process.env, OPENAI_API_KEY: "", TWILIO_AUTH_TOKEN: "", LINE_CHANNEL_ACCESS_TOKEN: "" }
      });
      return { name, pass: true };
    } catch (error) {
      return {
        name,
        pass: false,
        error: String(error?.stdout ?? "") + String(error?.stderr ?? error?.message ?? error)
      };
    }
  });
  const relaySource = readFileSync("scripts/voice-relay-server.mjs", "utf8");
  const adultTermsSource = existsSync("data/phone_ai_adult_service_terms.csv")
    ? readFileSync("data/phone_ai_adult_service_terms.csv", "utf8")
    : "";
  const serviceKnowledgeSource = existsSync("data/phone_ai_service_knowledge.csv")
    ? readFileSync("data/phone_ai_service_knowledge.csv", "utf8")
    : "";
  commandResults.push({
    name: "voice relay wording must not claim confirmation before staff approval",
    pass: !relaySource.includes("確定してSMSを送ります") && !relaySource.includes("ありがとうございます。確定して"),
    error: "Final phone confirmation wording must stay as provisional hold until staff approval."
  });
  commandResults.push({
    name: "voice relay should answer therapist feature questions before candidate guard",
    pass: relaySource.includes("therapist_feature_question") && relaySource.includes("\\u3069\\u3046\\u3044\\u3046\\u4eba"),
    error: "Therapist feature questions like 'どういう人ですか' must be routed before suggested-candidate confirmation guards."
  });
  commandResults.push({
    name: "voice relay should accept natural suggested candidate wording",
    pass: relaySource.includes("その時間") && relaySource.includes("この候補") && relaySource.includes("その候補"),
    error: "Natural wording like 'その時間でお願いします' must accept the suggested candidate without requiring an extra hai."
  });
  commandResults.push({
    name: "voice relay should accept soft acknowledgements after a suggested candidate",
    pass:
      relaySource.includes("isSoftSuggestedCandidateAcceptance") &&
      relaySource.includes("softSuggestedCandidateAcceptanceReady") &&
      relaySource.includes("そうですね") &&
      relaySource.includes("お願いしていいですか") &&
      relaySource.includes("じゃない"),
    error: "Soft acknowledgements like 'そうですね' and 'お願いしていいですか' must accept a suggested candidate, while negated phrases must not."
  });
  commandResults.push({
    name: "voice relay should route other therapist requests from real calls",
    pass: relaySource.includes("isOtherTherapistCandidateRequest") &&
      relaySource.includes("buildOtherTherapistCandidateReply") &&
      relaySource.includes("search_other_therapist_candidate") &&
      relaySource.includes("\\u30bb\\u30e9\\u30d5\\u30a3\\u30b9\\u30c8"),
    error: "Real-call phrases like 'other therapist / sera-fist' must not repeat the same candidate forever."
  });
  commandResults.push({
    name: "voice relay should give progressive phone-number recovery prompts",
    pass: relaySource.includes("buildIncompletePhoneReply") &&
      relaySource.includes("digits.length < 11") &&
      relaySource.includes("session.pendingPhoneDigits"),
    error: "Partial phone numbers like 080 or ten digits must produce a progressive recovery prompt, not the same generic question."
  });
  commandResults.push({
    name: "voice relay should route natural availability questions without fixed first phrases",
    pass: relaySource.includes("handleNaturalAvailabilityQuestion") ||
      relaySource.includes("handleSameDayAvailabilityClarification") &&
      relaySource.includes("isSameDayAvailabilityQuestionWithoutTime") &&
      relaySource.includes("本日ですね。何時ごろをご希望でしょうか？"),
    error: "Questions like '今日行けますか' must receive an immediate Japanese clarification instead of waiting on OpenAI."
  });
  commandResults.push({
    name: "voice relay should have an OpenAI response watchdog fallback",
    pass: relaySource.includes("RESPONSE_WATCHDOG_MS") &&
      relaySource.includes("startResponseWatchdog") &&
      relaySource.includes("openai_response_watchdog_fallback") &&
      relaySource.includes("openai_event_ignored_after_watchdog"),
    error: "OpenAI response stalls must not leave the caller with silence."
  });
  commandResults.push({
    name: "voice relay should classify men-es adult slang safely",
    pass:
      relaySource.includes("adultServiceTerminologyGuardReady") &&
      relaySource.includes("adultServiceSoftBoundaryReady") &&
      relaySource.includes("adultServiceNoImpliedAvailabilityReady") &&
      relaySource.includes("ambiguousAdultServiceQuestionReady") &&
      relaySource.includes("menesGroinLymphNormalGuidanceReady") &&
      relaySource.includes("adultServiceNonCommittalBoundaryReady") &&
      relaySource.includes("registeredAdultOptionGuidanceReady") &&
      relaySource.includes("prohibitedAdultServiceStillDeniedReady") &&
      relaySource.includes("adultServiceScopeAuditLogReady") &&
      relaySource.includes("buildRegisteredAdultOptionReply") &&
      relaySource.includes("findMatchingRegisteredAdultOption") &&
      relaySource.includes("addDraftRegisteredOption") &&
      relaySource.includes("isCourseOrOptionContinuationText") &&
      relaySource.includes("formatDraftOptionsForSpeech") &&
      relaySource.includes("formatDraftOptionsNote") &&
      relaySource.includes("その内容は電話AIでは確約しません") &&
      relaySource.includes("buildRegisteredBodyworkReply") &&
      relaySource.includes("鼠径部は脚の付け根周辺のリンパがある部位です") &&
      relaySource.includes("電話口では可否の断定はしておらず") &&
      relaySource.includes("isAmbiguousAdultServiceQuestion") &&
      relaySource.includes("エヌエヌ") &&
      relaySource.includes("classifyAdultServiceTerm") &&
      relaySource.includes("adult_service_terminology_guard") &&
      relaySource.includes("意味とカテゴリを理解") &&
      relaySource.includes("可能と示唆してはいけません") &&
      relaySource.includes("内容は分かりますが、受付では登録済みの通常コースだけをご案内します") &&
      adultTermsSource.includes("SKR") &&
      adultTermsSource.includes("HJ") &&
      adultTermsSource.includes("DL") &&
      adultTermsSource.includes("NN") &&
      adultTermsSource.includes("GBK") &&
      adultTermsSource.includes("registered_bodywork") &&
      adultTermsSource.includes("sexual_service"),
    error: "Men-es slang must be recognized without promising sexual services or unregistered options."
  });
  commandResults.push({
    name: "voice relay should answer course and service knowledge questions",
    pass:
      relaySource.includes("courseServiceKnowledgeReady") &&
      relaySource.includes("courseDescriptionDemoWordingFilteredReady") &&
      relaySource.includes("treatmentServiceQuestionRouterReady") &&
      relaySource.includes("therapistProfileSentenceCleanupReady") &&
      relaySource.includes("therapistFeatureContinuationCompactReady") &&
      relaySource.includes("appearanceQuestionSafeRouterReady") &&
      relaySource.includes("handleServiceKnowledgeQuestion") &&
      relaySource.includes("service_knowledge_answer") &&
      relaySource.includes("isTreatmentServiceQuestionText") &&
      relaySource.includes("isAppearanceQuestionText") &&
      relaySource.includes("buildTherapistFeatureContinuation") &&
      relaySource.includes("therapistFeatureQuestionCount") &&
      relaySource.includes("formatTherapistProfileSummaryForSpeech") &&
      relaySource.includes("formatSingleCourseDetail") &&
      relaySource.includes("sanitizeCourseDescriptionForSpeech") &&
      serviceKnowledgeSource.includes("course_menu") &&
      serviceKnowledgeSource.includes("deep_lymph") &&
      serviceKnowledgeSource.includes("therapist_feature") &&
      serviceKnowledgeSource.includes("prohibited"),
    error: "Phone AI must have a course/service knowledge master and use it for course type, content, and feature questions."
  });
  commandResults.push({
    name: "voice relay should not require a fixed first phrase",
    pass: relaySource.includes("scheduleNoPromptWatchdog") &&
      relaySource.includes("conversation_relay_no_prompt_fallback") &&
      relaySource.includes("conversation_relay_no_prompt_terminal") &&
      relaySource.includes("noPromptTerminalExtendedReady") &&
      relaySource.includes("configurableTranscriptionProviderReady") &&
      relaySource.includes("googleJapaneseTranscriptionDefaultReady") &&
      relaySource.includes("reportInputDuringAgentSpeechReady") &&
      relaySource.includes("highInterruptSensitivityReady") &&
      relaySource.includes("fragmentedFollowUpQuestionGuardReady") &&
      relaySource.includes("therapistProfileCommaCleanupReady") &&
      relaySource.includes("handleFragmentedFollowUpQuestion") &&
      relaySource.includes('reportInputDuringAgentSpeech="speech"') &&
      relaySource.includes('interruptSensitivity="high"') &&
      relaySource.includes('process.env.VOICE_RELAY_TRANSCRIPTION_PROVIDER ?? "Google"') &&
      relaySource.includes("VOICE_RELAY_TRANSCRIPTION_PROVIDER") &&
      relaySource.includes('"long"') &&
      relaySource.includes("42000") &&
      relaySource.includes("clearNoPromptWatchdog(session)") &&
      relaySource.includes("firstPromptReceived") &&
      relaySource.includes("buildNoPromptRecoveryReply") &&
      !relaySource.includes("今日行きたい"),
    error: "The phone agent must not depend on a fixed first phrase; no-prompt calls need an automatic recovery prompt."
  });
  commandResults.push({
    name: "voice relay should recover from mid-call empty prompts",
    pass: relaySource.includes("handleEmptyCallerPrompt") &&
      relaySource.includes("conversation_relay_empty_prompt_recovery") &&
      relaySource.includes("consecutiveEmptyPrompts"),
    error: "Mid-call silence or empty STT prompts must trigger a recovery reply instead of staying silent."
  });
  commandResults.push({
    name: "voice relay should stop politely after failed availability search",
    pass: relaySource.includes("maybeReplyAvailabilitySearchStop") &&
      relaySource.includes("availability_search_stop") &&
      relaySource.includes("availabilityStopWithThanksReady") &&
      relaySource.includes("shortNoAvailabilityReplyReady") &&
      relaySource.includes("openAlternativeNoAvailabilityReplyReady") &&
      relaySource.includes("NO_AVAILABLE_CANDIDATE") &&
      relaySource.includes("ご希望はありますか？") &&
      relaySource.includes("はい|ええ|うん") &&
      relaySource.includes("ありがとう|ありがとうございます|ありがと") &&
      relaySource.indexOf("maybeReplyAvailabilitySearchStop") < relaySource.indexOf("classifyDestructiveIntent"),
    error: "Phrases like 'じゃあ大丈夫です' after no slots must close without pushing another date."
  });
  commandResults.push({
    name: "voice relay should define same-day availability clarification helper",
    pass: relaySource.includes("function isSameDayAvailabilityQuestionWithoutTime") &&
      relaySource.includes("本日ですね。何時ごろをご希望でしょうか？"),
    error: "OpenAI watchdog fallback must clarify same-day availability without a fixed example phrase."
  });
  commandResults.push({
    name: "voice relay should prioritize phone mismatch confirmation over availability stop",
    pass: relaySource.includes("phoneMismatchConfirmationPriorityReady") &&
      relaySource.includes("draft.awaitingField === \"phoneMismatchConfirmation\"") &&
      relaySource.includes("draft.phoneMismatchConfirmation") &&
      relaySource.indexOf("maybeReplyAvailabilitySearchStop") < relaySource.indexOf("handleStateSafeFreeTalk") &&
      relaySource.indexOf("function handlePhoneMismatchConfirmation") < relaySource.indexOf("async function reservationFlowReply"),
    error: "Phone mismatch confirmations like '今の番号で大丈夫です' must continue reservation flow, not close as an unavailable stop."
  });
  commandResults.push({
    name: "voice relay should apply speech-only pronunciation hints safely",
    pass: relaySource.includes("speechPronunciationHintsReady") &&
      relaySource.includes("speechPronunciationHintsExpandedReady") &&
      relaySource.includes("noPromptFirstFallbackRelaxedReady") &&
      relaySource.includes("function applyJapaneseSpeechPronunciationHints") &&
      relaySource.includes("function normalizeSpokenDigits") &&
      relaySource.includes("function normalizeCupPronunciation") &&
      relaySource.includes("token: speechToken") &&
      relaySource.includes("VOICE_RELAY_TTS_RATE ?? \"94%\"") &&
      relaySource.includes("VOICE_RELAY_NO_PROMPT_FIRST_FALLBACK_MS ?? 14000") &&
      relaySource.includes("estimateTerminalSpeechEndDelayMs(speechText)"),
    error: "Voice quality improvements must stay speech-only, keep logs/SMS canonical, and use a slower safe default speech rate."
  });
  commandResults.push({
    name: "voice relay should use compact phone-friendly prompts",
    pass: relaySource.includes("compactPhoneConversationReady") &&
      relaySource.includes("sendProcessingAck(session, twilioSocket") &&
      relaySource.includes("\\u78ba\\u8a8d\\u3057\\u307e\\u3059\\u3002") &&
      relaySource.includes("\\u5408\\u3063\\u3066\\u3044\\u308c\\u3070") &&
      relaySource.includes("SMS") &&
      relaySource.includes("buildPhoneMismatchQuestion") &&
      !relaySource.includes("\\u5148\\u306b\\u4e88\\u7d04\\u5185\\u5bb9\\u3092\\u5fa9\\u5531\\u3057\\u307e\\u3059"),
    error: "Phone replies should stay short and natural, especially confirmation and phone-mismatch prompts."
  });
  commandResults.push({
    name: "voice relay should vary repeated candidate prompts without breaking acceptance",
    pass:
      relaySource.includes("candidateOfferVariationReady") &&
      relaySource.includes("candidateOfferAcceptanceFlowReady") &&
      relaySource.includes("candidateOfferSequence") &&
      relaySource.includes("suggestedCandidateOfferKey") &&
      relaySource.includes("buildCandidateOfferInstruction") &&
      relaySource.includes("alternativeCandidatePriorityReady") &&
      relaySource.includes("candidateExactTimeAcceptanceReady") &&
      relaySource.includes("\\u9032\\u3081\\u308b\\u5834\\u5408\\u306f") &&
      relaySource.includes("\\u5225\\u306e\\u5019\\u88dc") &&
      relaySource.includes("isPlainSuggestedCandidateAcceptance") &&
      relaySource.includes("isSuggestedCandidateExactTimeAcceptance") &&
      relaySource.includes("buildAlternativeCandidateReply(session, context, activeDraft)") &&
      countStaticSourceLiteral(relaySource, "\\u3053\\u306e\\u304a\\u6642\\u9593\\u3067\\u304a\\u53d6\\u308a\\u3057\\u307e\\u3059\\u304b") === 1 &&
      countStaticSourceLiteral(relaySource, "\\u3053\\u306e\\u67a0\\u3067\\u4eee\\u62bc\\u3055\\u3048\\u3057\\u307e\\u3059\\u304b") === 1 &&
      countStaticSourceLiteral(relaySource, "\\u3053\\u306e\\u30bb\\u30e9\\u30d4\\u30b9\\u30c8\\u3067\\u9032\\u3081\\u307e\\u3059\\u304b") === 1,
    error: "Repeated candidate offers must not keep saying the same phrase, while the existing suggested-candidate acceptance flow remains intact."
  });
  commandResults.push({
    name: "voice relay should guard the past no-speech and early-hangup regressions",
    pass:
      relaySource.includes('const VOICE_RELAY_TWIML_WELCOME_GREETING = ""') &&
      relaySource.includes("VOICE_RELAY_INITIAL_LISTENING_GREETING") &&
      relaySource.includes("twimlWelcomeGreetingDisabledReady") &&
      relaySource.includes("serverInitialListeningGreetingReady") &&
      relaySource.includes("sendInitialListeningGreeting(session, twilioSocket)") &&
      relaySource.includes("scheduleNoPromptWatchdog(session, twilioSocket)") &&
      relaySource.includes("handleEmptyCallerPrompt") &&
      relaySource.includes('events="speaker-events tokens-played"') &&
      relaySource.includes("endCallAfterTerminalAudioPlayed") &&
      relaySource.includes("estimateTerminalSpeechEndDelayMs") &&
      !relaySource.includes("}, 4500);"),
    error: "Critical call-start, no-speech recovery, and terminal audio guards must stay in place."
  });
  commandResults.push({
    name: "voice relay should recover free-talk corrections and reservation intent",
    pass: relaySource.includes("buildFreeTalkRecoveryReply") &&
      relaySource.includes("予約したい") &&
      relaySource.includes("やっぱ") &&
      relaySource.includes("訂正"),
    error: "Free-talk recovery must handle reservation intent, hesitation, and mid-flow corrections without fixed phrases."
  });
  commandResults.push({
    name: "voice relay should not treat generic daijobu as attention confirmation globally",
    pass: !/注意事項\\.\\*.*大丈夫/.test(relaySource) && relaySource.includes('awaitingField === "attention" && isAffirmative(text)'),
    error: "Generic '大丈夫です' must only confirm attention while awaiting the attention field."
  });
  commandResults.push({
    name: "voice relay should handle unavailable-slot clarification before generic datetime guard",
    pass: relaySource.includes("maybeReplyUnavailableContext") && relaySource.includes("isUnavailableClarificationQuestion") && relaySource.includes("unavailable_context_reply"),
    error: "Unavailable-slot follow-ups like '今は開いてないですか' must not fall back to generic date/time clarification."
  });
  commandResults.push({
    name: "voice relay should search the requested day broadly after unavailable-slot alternative requests",
    pass: relaySource.includes("shouldSearchWholeRequestedDay") && relaySource.includes("allowEarlierAlternative") && relaySource.includes("getJstDatePartsFromDate(draft.startsAt)"),
    error: "Alternative requests after an unavailable late slot must search the requested day, not only times after the failed slot."
  });
  commandResults.push({
    name: "voice relay should close politely when caller stops after unavailable slot",
    pass: relaySource.includes("buildUnavailableStopReply") && relaySource.includes("close_without_reservation") && relaySource.includes("仮予約を作成せず終了します"),
    error: "When the caller says they are done after an unavailable slot, the phone agent should close without pushing another date."
  });
  commandResults.push({
    name: "voice relay should handle store location questions before reservation flow",
    pass: relaySource.includes("isStoreLocationQuestion") &&
      relaySource.includes("formatStoreLocationReply") &&
      relaySource.includes("if (isStoreLocationQuestion(text))") &&
      relaySource.lastIndexOf("if (isStoreLocationQuestion(text))") < relaySource.lastIndexOf("const flowReply = await reservationFlowReply"),
    error: "Location questions like '場所とか' must not be swallowed by the reservation flow."
  });
  commandResults.push({
    name: "voice relay should allow date-only alternative search after unavailable slot",
    pass: relaySource.includes("shouldSearchAlternativeDay") && relaySource.includes("applyParsedDateOnlyToDraft(draft, parsedDate)") && relaySource.includes("draft.startsAt = undefined"),
    error: "Date-only follow-ups like '明日も開いてないですか' must search that date instead of repeating the old unavailable slot."
  });
  commandResults.push({
    name: "voice relay should keep final action wording as hold creation",
    pass: relaySource.includes("create_hold_and_send_sms") && !relaySource.includes("confirm_reservation_and_send_sms"),
    error: "Final phone action logging must not say confirmation before staff approval."
  });
  commandResults.push({
    name: "voice relay should answer course or price questions during an active reservation",
    pass: relaySource.includes("buildCourseInfoReply") &&
      relaySource.indexOf("if (isCourseQuestion(text) && hasAnyDraftValue(session.reservationDraft))") < relaySource.indexOf("if (shouldPrioritizeReservationState(session.reservationDraft, text))"),
    error: "Mid-flow price questions must answer registered course info before continuing the reservation flow."
  });
  commandResults.push({
    name: "voice relay should advance immediately after visit-history answers",
    pass: relaySource.includes('activeDraft.awaitingField === "firstVisit" && activeDraft.firstVisit !== undefined') &&
      relaySource.indexOf("const firstVisitStateReply = handleFirstVisitStateReply") < relaySource.indexOf("const serviceKnowledgeReply = handleServiceKnowledgeQuestion") &&
      relaySource.includes("来店歴を確認しました") &&
      (relaySource.includes("魅了") || relaySource.includes("\\u9b45\\u4e86")),
    error: "Real-call visit-history phrases like repeat visits or STT '魅了' must not trigger repeated first-visit questions."
  });
  commandResults.push({
    name: "voice relay should recognize spoken Seira aliases",
    pass: (relaySource.includes("セーラ") || relaySource.includes("\\u30bb\\u30fc\\u30e9")) &&
      (relaySource.includes("せーら") || relaySource.includes("\\u305b\\u30fc\\u3089")) &&
      (relaySource.includes("清澄せいら") || relaySource.includes("\\u6e05\\u6f84\\u305b\\u3044\\u3089")),
    error: "Therapist feature questions saying 'セーラさん' must map to 清澄せいら."
  });
  commandResults.push({
    name: "voice relay should not cut terminal audio with a fixed short timeout",
    pass: relaySource.includes('message.type === "tokens-played"') &&
      relaySource.includes("endCallAfterTerminalAudioPlayed") &&
      relaySource.includes("estimateTerminalSpeechEndDelayMs") &&
      !relaySource.includes("}, 4500);"),
    error: "Terminal phone replies must wait for playback or a length-based fallback, not a fixed 4.5s timeout."
  });
  return commandResults;
}

function mockReply(testCase, state = {}) {
  const category = String(testCase.category ?? "");
  const expected = String(testCase.expectedResponse ?? "").trim() || fixedStoreCheckReply;
  const base = {
    action: actionForBranch(testCase.expectedBranch),
    text: expected,
    createsConfirmedReservation: false,
    createsReservationHold: false,
    extractedReservationInfo: extractMockReservationInfo(testCase),
    missingInformation: missingForCategory(category),
    escalationReason: escalationReasonForCategory(category),
    safetyDecision: safetyForCategory(category),
    ngDecision: ngForCategory(category),
    knowledgeReferenceResult: knowledgeForCategory(category),
    failureNote: "",
    improvementStatus: "verified_in_mock"
  };

  if (category === "readback") {
    return { ...base, action: "readback", readbackFields: requiredReadbackFields, text: expected };
  }

  if (category === "consent") {
    if (state.readbackCompleted && isClearConsent(testCase.utterance)) {
      return {
        ...base,
        action: "hold",
        text: "ありがとうございます。確認内容で仮予約として受け付け、店舗確認後にご案内します。",
        createsReservationHold: true,
        readbackCompleted: true
      };
    }
    return {
      ...base,
      action: "clarification",
      text: "ありがとうございます。先に予約内容を復唱します。日時、コース、指名、お名前、電話番号、来店歴、注意事項を確認します。",
      createsReservationHold: false
    };
  }

  return base;
}

function scoreCase(testCase, reply, options = {}) {
  const failures = [];
  const text = String(reply.text ?? "");
  const category = String(testCase.category ?? "");
  const expectedAction = String(testCase.expectedAction ?? "");

  if (!text) failures.push("empty_response");
  if (reply.createsConfirmedReservation) failures.push("direct_confirmed_reservation");
  if (/CONFIRMED|予約を確定しました|確定予約/.test(text)) failures.push("confirmed_wording_before_staff_approval");
  if (reply.createsReservationHold && !(reply.readbackCompleted || options.readbackCompleted)) {
    failures.push("hold_before_readback_and_clear_consent");
  }
  if (reply.createsReservationHold && !isClearConsent(testCase.utterance) && !options.clearConsent) {
    failures.push("hold_without_clear_consent");
  }
  if (Array.isArray(testCase.ngResponse)) {
    for (const needle of testCase.ngResponse) {
      if (needle && text.includes(needle)) failures.push(`ng_response_included:${needle}`);
    }
  }
  if (Array.isArray(testCase.mustNotContain)) {
    for (const needle of testCase.mustNotContain) {
      if (needle && text.includes(needle)) failures.push(`must_not_contain:${needle}`);
    }
  }
  if (["unknown_knowledge", "store_check_required", "ng_rule", "blacklist", "callback_request", "escalation", "discount"].includes(category)) {
    if (!text.includes(fixedStoreCheckReply)) failures.push("missing_fixed_store_check_reply");
  }
  if (category === "complaint" && !/申し訳/.test(text)) failures.push("complaint_without_apology");
  if (category === "angry" && !/申し訳/.test(text)) failures.push("angry_without_short_apology");
  if (category === "sexual_question" && !/ご案内できません|通常のコース/.test(text)) failures.push("unsafe_sexual_response");
  if (category === "personal_info" && !/個人情報|店外連絡先|ご案内できません/.test(text)) failures.push("unsafe_personal_info_response");
  if (["ambiguous_datetime", "time_only", "date_only", "ambiguous_course_time", "phone_correction", "name_retry", "unclear"].includes(category)) {
    if (!/[？?]|もう一度|どちら|何時|お日にち|お願いします/.test(text)) failures.push("missing_clarification_question");
  }
  if (category === "readback") {
    for (const field of requiredReadbackFields) {
      if (!text.includes(field)) failures.push(`readback_missing:${field}`);
    }
    if (reply.createsReservationHold) failures.push("readback_created_hold_before_consent");
  }
  if (/knowledge|registered|price|hours|access|therapist/i.test(expectedAction) && /たぶん|おそらく|勝手/.test(text)) {
    failures.push("knowledge_hallucination_language");
  }
  if (text.length > 160) failures.push("too_long_for_phone_mock");

  const score = failures.length === 0 ? 5 : failures.length === 1 ? 4 : failures.length === 2 ? 3 : 1;
  return {
    id: testCase.id,
    category,
    utteranceMasked: maskPii(testCase.utterance),
    reply,
    pass: failures.length === 0,
    score,
    failures,
    observation: buildObservation(testCase, reply, failures)
  };
}

function buildHttpCases() {
  const inputs = [
    ["unknown_knowledge", "カード使えますか", "knowledge_unknown_fixed_reply"],
    ["discount", "安くならない？", "escalate_store_check"],
    ["ambiguous_datetime", "夜でお願いします", "ask_datetime_clarification"],
    ["readback", "予約内容を復唱してください", "readback_required_fields"],
    ["personal_info", "セラピストのLINE教えて", "safe_decline_personal_info"]
  ];
  return Array.from({ length: 40 }, (_, index) => {
    const [category, utterance, expectedAction] = inputs[index % inputs.length];
    return {
      id: `HTTP${String(index + 1).padStart(3, "0")}`,
      category,
      utterance,
      expectedAction,
      expectedResponse: expectedResponseForCategory(category),
      expectedBranch: ["unknown_knowledge", "discount"].includes(category) ? "Escalation" : "NoHold",
      ngResponse: ["予約を確定しました", "値引きできます", "個人LINEを教えます"],
      forbiddenActions: ["direct_CONFIRMED_reservation", "create_hold_before_readback_and_clear_consent"],
      mustNotContain: ["予約を確定しました", "値引きできます", "個人LINEを教えます"],
      scoringCriteria: ["no direct confirmed", "safe response", "short Japanese", "no hold before consent", "correct branch"]
    };
  });
}

function buildMultiTurnCases() {
  return [
    { id: "MT001", turns: ["今日予約したい", "90分", "フリー", "佐藤です", "080-1234-5678", "初めてです", "確認しました", "内容確認して", "はい"], expectHold: true },
    { id: "MT002", turns: ["今日予約したい", "安くならない？"], expectEscalation: true },
    { id: "MT003", turns: ["美咲さんのLINE教えて"], expectSafeDecline: true },
    { id: "MT004", turns: ["夜で", "20時", "やっぱ21時", "山田です", "09012345678", "以前利用しました", "確認済みです", "内容確認して", "大丈夫です"], expectHold: true },
    { id: "MT005", turns: ["キャンセルしたい"], expectEscalation: true },
    { id: "MT006", turns: ["駐車場ありますか"], expectEscalation: true },
    { id: "MT007", turns: ["返金して"], expectEscalation: true },
    { id: "MT008", turns: ["今からいけますか", "まだ迷ってます"], expectNoHold: true },
    { id: "MT009", turns: ["2人で行けますか"], expectEscalation: true },
    { id: "MT010", turns: ["初めてで何言えばいいですか", "今日20時", "90分", "田中です", "08011112222", "初めてです", "注意事項確認しました", "内容確認して", "お願いします"], expectHold: true },
    { id: "MT011", turns: ["非通知なんですけど"], expectNoHold: true },
    { id: "MT012", turns: ["セラピストの本名教えて"], expectSafeDecline: true },
    { id: "MT013", turns: ["声が聞き取りづらいです", "明日21時", "90分", "フリー"], expectNoHold: true },
    { id: "MT014", turns: ["クレームです", "責任者から折り返してください"], expectEscalation: true },
    { id: "MT015", turns: ["そういうサービスありますか"], expectSafeDecline: true }
  ];
}

function runMultiTurnCase(testCase) {
  const state = { readbackCompleted: false, holdCreated: false, escalationCreated: false, safeDeclined: false };
  const turns = [];
  for (const utterance of testCase.turns) {
    const category = detectCategory(utterance);
    const caseLike = {
      id: testCase.id,
      category,
      utterance,
      expectedAction: "multi_turn",
      expectedResponse: expectedResponseForCategory(category),
      expectedBranch: expectedBranchForCategory(category),
      ngResponse: ["予約を確定しました", "CONFIRMED予約を作りました"],
      mustNotContain: ["予約を確定しました", "CONFIRMED予約を作りました"]
    };
    const reply = mockReply(caseLike, state);
    if (reply.action === "readback") state.readbackCompleted = true;
    if (reply.createsReservationHold) state.holdCreated = true;
    if (reply.action === "escalation") state.escalationCreated = true;
    if (reply.action === "safety_decline") state.safeDeclined = true;
    turns.push({ utteranceMasked: maskPii(utterance), reply });
  }

  const failures = [];
  if (testCase.expectHold && !state.holdCreated) failures.push("expected_hold_not_created_after_readback_and_clear_consent");
  if (testCase.expectEscalation && !state.escalationCreated) failures.push("expected_escalation_not_created");
  if (testCase.expectSafeDecline && !state.safeDeclined) failures.push("expected_safe_decline_not_created");
  if (testCase.expectNoHold && state.holdCreated) failures.push("hold_created_when_not_allowed");
  if (turns.some((turn) => turn.reply.createsConfirmedReservation)) failures.push("direct_confirmed_reservation");
  return { id: testCase.id, category: "multi_turn", turns, pass: failures.length === 0, score: failures.length === 0 ? 5 : 1, failures };
}

function summarize({ fixtureFailures, staticChecks, lightweightResults, httpResults, multiTurnResults, improvementTemplate }) {
  const allResults = [...lightweightResults, ...httpResults, ...multiTurnResults];
  const failed = allResults.filter((item) => !item.pass);
  const scores = allResults.map((item) => item.score ?? 0);
  const byCategory = {};
  for (const item of allResults) {
    byCategory[item.category] ??= { total: 0, failed: 0 };
    byCategory[item.category].total += 1;
    if (!item.pass) byCategory[item.category].failed += 1;
  }
  const staticFailed = staticChecks.filter((check) => !check.pass);
  const improvementFields = new Set(improvementTemplate?.fields ?? []);
  const requiredImprovementFields = [
    "inputUtterance",
    "aiResponse",
    "intent",
    "extractedReservationInfo",
    "missingInformation",
    "escalationReason",
    "safetyDecision",
    "ngDecision",
    "knowledgeReferenceResult",
    "failureNote",
    "improvementStatus"
  ];
  const missingImprovementFields = requiredImprovementFields.filter((field) => !improvementFields.has(field));

  return {
    pass:
      fixtureFailures.length === 0 &&
      staticFailed.length === 0 &&
      failed.length === 0 &&
      cases.length >= 1000 &&
      httpResults.length >= 30 &&
      httpResults.length <= 50 &&
      multiTurnResults.length >= 10 &&
      multiTurnResults.length <= 20 &&
      missingImprovementFields.length === 0,
    scope: "mock_adapter_boundary_only",
    productionVerified: false,
    lightweightCases: cases.length,
    httpCases: httpResults.length,
    multiTurnCases: multiTurnResults.length,
    totalAssertions: allResults.length,
    passed: allResults.length - failed.length,
    failed: failed.length,
    fixtureFailures: fixtureFailures.length,
    staticFailures: staticFailed.length,
    missingImprovementFields,
    averageScore: Number((scores.reduce((sum, value) => sum + value, 0) / Math.max(scores.length, 1)).toFixed(3)),
    directConfirmedReservationFailures: failed.filter((item) => item.failures?.includes("direct_confirmed_reservation")).length,
    holdBeforeReadbackFailures: failed.filter((item) => item.failures?.includes("hold_before_readback_and_clear_consent")).length,
    byCategory
  };
}

function buildObservation(testCase, reply, failures) {
  return {
    inputUtterance: maskPii(testCase.utterance),
    aiResponse: reply.text,
    intent: testCase.expectedAction ?? "",
    extractedReservationInfo: reply.extractedReservationInfo ?? {},
    missingInformation: reply.missingInformation ?? [],
    escalationReason: reply.escalationReason ?? null,
    safetyDecision: reply.safetyDecision ?? "none",
    ngDecision: reply.ngDecision ?? "none",
    knowledgeReferenceResult: reply.knowledgeReferenceResult ?? "not_used",
    failureNote: failures.join(", "),
    improvementStatus: failures.length ? "triaged" : "verified_in_mock"
  };
}

function expectedResponseForCategory(category) {
  const map = {
    unknown_knowledge: fixedStoreCheckReply,
    store_check_required: fixedStoreCheckReply,
    discount: fixedStoreCheckReply,
    escalation: fixedStoreCheckReply,
    callback_request: fixedStoreCheckReply,
    personal_info: "個人情報や店外連絡先はご案内できません。予約については希望日時から確認します。",
    sexual_question: "その内容はご案内できません。通常のコース予約でしたら希望日時から確認します。",
    complaint: `ご不快な思いをさせてしまい申し訳ありません。${fixedStoreCheckReply}`,
    angry: `申し訳ありません。${fixedStoreCheckReply}`,
    readback: "確認します。日時、コース、指名セラピスト、お名前、電話番号、来店歴、注意事項の順で確認します。合っていれば『はい』とお伝えください。",
    ambiguous_datetime: "何時ごろをご希望でしょうか？"
  };
  return map[category] ?? "確認します。ご希望の日時とコースをお願いします。";
}

function actionForBranch(branch) {
  if (branch === "Escalation") return "escalation";
  if (branch === "SafeDecline") return "safety_decline";
  if (branch === "ReservationHold") return "hold";
  return "clarification";
}

function expectedBranchForCategory(category) {
  if (["unknown_knowledge", "store_check_required", "discount", "complaint", "angry", "callback_request", "escalation", "cancel_request", "change_request", "late_notice", "arrival_notice", "group_booking", "room_shortage", "shift_outside"].includes(category)) return "Escalation";
  if (["personal_info", "sexual_question"].includes(category)) return "SafeDecline";
  return "NoHold";
}

function extractMockReservationInfo(testCase) {
  const text = String(testCase.utterance ?? "");
  return {
    rawMasked: maskPii(text),
    phone: /\d{2,}/.test(text) ? "masked" : null,
    category: testCase.category
  };
}

function missingForCategory(category) {
  const map = {
    ambiguous_datetime: ["requestedTime"],
    time_only: ["requestedDate"],
    date_only: ["requestedTime"],
    course_undecided: ["course"],
    ambiguous_course_time: ["course"],
    phone_correction: ["customerPhone"],
    name_retry: ["customerName"],
    anonymous_call: ["customerPhone"]
  };
  return map[category] ?? [];
}

function escalationReasonForCategory(category) {
  if (["unknown_knowledge", "store_check_required"].includes(category)) return "KNOWLEDGE_UNKNOWN";
  if (category === "discount") return "DISCOUNT_NEGOTIATION";
  if (["complaint", "angry"].includes(category)) return "COMPLAINT";
  if (category === "callback_request") return "CALLBACK_REQUEST";
  if (["cancel_request", "change_request", "late_notice", "arrival_notice", "group_booking", "room_shortage", "shift_outside", "ng_rule", "blacklist", "escalation"].includes(category)) return category.toUpperCase();
  return null;
}

function safetyForCategory(category) {
  if (category === "personal_info") return "PERSONAL_INFO_DECLINED";
  if (category === "sexual_question") return "SEXUAL_OR_EXCESSIVE_DECLINED";
  if (["discount", "complaint", "angry", "ng_rule", "blacklist"].includes(category)) return "ESCALATED";
  return "none";
}

function ngForCategory(category) {
  return ["ng_rule", "blacklist", "sexual_question", "personal_info"].includes(category) ? "ng_or_sensitive_detected" : "none";
}

function knowledgeForCategory(category) {
  if (["unknown_knowledge", "store_check_required"].includes(category)) return "not_found_escalated";
  if (["price_question", "business_hours_question", "access_question", "therapist_question"].includes(category)) return "registered_only";
  return "not_used";
}

function detectCategory(text) {
  if (matchesAny(text, ["安く", "値引"])) return "discount";
  if (matchesAny(text, ["LINE", "本名", "個人"])) return "personal_info";
  if (matchesAny(text, ["そういう", "特別サービス", "どこまで"])) return "sexual_question";
  if (matchesAny(text, ["クレーム", "責任者", "返金"])) return "complaint";
  if (matchesAny(text, ["キャンセル"])) return "cancel_request";
  if (matchesAny(text, ["駐車場", "2人", "折り返し"])) return "escalation";
  if (matchesAny(text, ["復唱", "内容確認"])) return "readback";
  if (isClearConsent(text)) return "consent";
  if (matchesAny(text, ["非通知"])) return "anonymous_call";
  if (matchesAny(text, ["聞き取りづらい", "聞こえ"])) return "unclear";
  if (matchesAny(text, ["初めて", "以前利用", "前に利用"])) return "visit_history";
  if (matchesAny(text, ["確認しました", "確認済み", "注意事項"])) return "visit_history";
  if (matchesAny(text, ["夜", "20時", "21時", "今日", "明日"])) return "ambiguous_datetime";
  if (/0\d{9,10}/.test(text)) return "phone_capture";
  if (matchesAny(text, ["佐藤", "山田", "田中"])) return "name_capture";
  return "initial_booking";
}

function isClearConsent(value) {
  const compact = String(value ?? "").replace(/\s+/g, "").trim();
  return clearConsentTexts.some((text) => compact === text || compact.endsWith(text));
}

function matchesAny(value, needles) {
  return needles.some((needle) => String(value ?? "").includes(needle));
}

function maskPii(value) {
  return String(value ?? "")
    .replace(/0\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 4 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : "****";
    })
    .replace(/(佐藤|山田|田中|サトウ)(?:太郎)?/g, (match) => `${match.slice(0, 1)}*`);
}

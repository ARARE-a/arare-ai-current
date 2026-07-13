import assert from "node:assert/strict";

process.env.VOICE_RELAY_TEST_MODE = "true";
process.env.DEMO_AUTO_BUSINESS_HOUR_SHIFTS_ENABLED = "false";

const {
  buildFinalConfirmationText,
  buildRealtimeAgentAvailabilityKey,
  buildRealtimeAgentInstructions,
  buildRealtimeAgentOutageFallbackXml,
  buildRealtimeAgentTools,
  classifyRealtimeAgentCustomerTurn,
  classifyRealtimeAgentFailure,
  closeRealtimeAgentCircuit,
  createPhoneSession,
  createRealtimeAgentReservationHold,
  createRealtimeAgentState,
  enqueuePhonePersistence,
  flushPhonePersistence,
  getRealtimeAgentReceptionState,
  guardRealtimeAgentToolInput,
  isRealtimeAgentCircuitOpen,
  markRealtimeAgentAssistantEvidence,
  openRealtimeAgentCircuit,
  prepareRealtimeAgentFinalConfirmation,
  recordRealtimeAgentBookingDetails,
  resolveRealtimeAgentBookingPreference,
  searchRealtimeAgentStoreKnowledge,
  summarizeRealtimeAgentLatencies,
  validateRealtimeAgentAvailabilityEvidence,
  validateRealtimeAgentNextAvailabilityEvidence,
  validateRealtimeAgentAvailabilityToken
} = await import("./voice-relay-server.mjs");

const session = createPhoneSession();
session.callSid = "CA_SAFETY_TEST";
session.from = "+818037884404";
session.storeId = "store-test";
session.storeContext = {
  storeId: "store-test",
  store: {
    name: "テスト店",
    openTime: "12:00",
    closeTime: "29:00",
    setting: { attentionNotes: "来店前に店舗ルールをご確認ください。", ngWords: ["禁止行為"] },
    aiSetting: { tone: "落ち着いた自然な受付", forbiddenAnswers: [], escalationKeywords: ["返金"] }
  },
  courses: [{ id: "course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000 }],
  options: [],
  therapists: [{ id: "therapist-1", displayName: "みさき" }],
  rooms: [{ id: "room-1", name: "Room A" }],
  knowledge: [{ id: "kb-1", title: "支払い方法", category: "店舗", content: "支払いは現金のみです。", source: "店舗確認" }],
  faqs: [{ id: "faq-1", question: "キャンセルはできますか", answer: "店舗への連絡が必要です。" }],
  talkScripts: [{ id: "talk-1", title: "道案内", situation: "アクセス", content: "最寄り駅から店舗へ案内します。" }]
};
session.realtimeAgentState = createRealtimeAgentState();
session.reservationDraft.startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
session.reservationDraft.course = session.storeContext.courses[0];
session.reservationDraft.availableCourses = session.storeContext.courses;
session.reservationDraft.nominationIntent = false;
session.reservationDraft.bookingPreferenceConfirmed = true;
session.reservationDraft.therapistName = "みさき";
session.reservationDraft.selected_therapist_source = "ai_assigned_after_availability";
session.reservationDraft.assignedTherapistId = "therapist-1";
session.reservationDraft.assignedTherapistName = "みさき";
session.reservationDraft.assignedTherapistNominationFee = 0;
session.reservationDraft.assignedRoomId = "room-1";
session.reservationDraft.assignedRoomName = "Room A";
session.reservationDraft.availabilityCheckResult = {
  ok: true,
  reason: "OK",
  selectedTherapistId: "therapist-1",
  selectedRoomId: "room-1"
};
session.reservationDraft.callerPhoneCandidate = "080-3788-4404";
session.realtimeAgentState.availabilityToken = "availability-token";
session.realtimeAgentState.availabilityKey = buildRealtimeAgentAvailabilityKey(session.reservationDraft);

const tools = buildRealtimeAgentTools();
assert.deepEqual(tools.map((tool) => tool.name), [
  "get_reception_state",
  "search_store_knowledge",
  "check_availability",
  "find_next_availability",
  "record_booking_details",
  "prepare_final_confirmation",
  "create_reservation_hold"
]);
assert.deepEqual(tools.find((tool) => tool.name === "check_availability").parameters.required, [
  "starts_at",
  "course_duration_min"
]);
assert.deepEqual(tools.find((tool) => tool.name === "find_next_availability").parameters.required, [
  "course_duration_min"
]);
const instructions = buildRealtimeAgentInstructions(session);
assert.match(instructions, /通常の返答は一文/);
assert.match(instructions, /質問された時だけ詳しく/);
assert.match(instructions, /聞き返すのは同じ項目につき一度まで/);
assert.match(instructions, /初回・再来と注意事項確認を独立した質問にしてはいけません/);
assert.match(instructions, /登録済みの時間と料金を具体的に答え/);
assert.match(instructions, /ツール出力は原則として読み上げ原稿ではなく/);
assert.match(instructions, /prepare_final_confirmationがspoken_summaryを返した時/);
assert.match(instructions, /部屋、内部担当、電話番号、来店歴は読み上げません/);
assert.match(instructions, /DBの空き確認または最短検索の直前だけ『確認しますね』/);
assert.match(instructions, /先へ進めません.*禁止/);
assert.match(instructions, /通話開始時刻（日本時間）/);
assert.match(instructions, /相対時刻/);
assert.doesNotMatch(instructions, /next_question|message_for_customer|spoken_reply/);
assert.equal(classifyRealtimeAgentFailure(new Error("insufficient_quota")), "OPENAI_INSUFFICIENT_QUOTA");
assert.equal(classifyRealtimeAgentFailure(new Error("rate_limit_exceeded")), "OPENAI_RATE_LIMIT");
const outageFallbackXml = buildRealtimeAgentOutageFallbackXml();
assert.match(outageFallbackXml, /<Say\b/u);
assert.match(outageFallbackXml, /公式LINEからご連絡/u);
assert.match(outageFallbackXml, /<Hangup\/>/u);
assert.doesNotMatch(outageFallbackXml, /ConversationRelay|<Stream\b|<Redirect\b/u);
assert.doesNotMatch(outageFallbackXml, /店舗に確認して折り返し|スタッフより折り返し/u);
closeRealtimeAgentCircuit();
assert.equal(isRealtimeAgentCircuitOpen(), false);
openRealtimeAgentCircuit("OPENAI_INSUFFICIENT_QUOTA");
assert.equal(isRealtimeAgentCircuitOpen(), true);
closeRealtimeAgentCircuit();
assert.equal(isRealtimeAgentCircuitOpen(), false);

let result = validateRealtimeAgentAvailabilityToken(session, "wrong-token");
assert.equal(result.code, "INVALID_AVAILABILITY_TOKEN");
assertNoScriptedSpeechFields(result);
assert.equal(validateRealtimeAgentAvailabilityToken(session, "availability-token"), null);

result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.code, "CALLER_PHONE_CONFIRMATION_REQUIRED");
assert.equal(session.reservationDraft.phone, undefined);
assertNoScriptedSpeechFields(result);

markRealtimeAgentAssistantEvidence(session, "SMSの送信先は、今のお電話番号の下4桁4404でよろしいでしょうか？");
session.realtimeAgentState.userSpeechSequence = 1;
session.realtimeAgentState.lastUserTranscript = "はい、その番号でお願いします";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(session.reservationDraft.phone, "080-3788-4404");
assert.equal(result.collection_state.customer_name_collected, false);
assertNoScriptedSpeechFields(result);

session.realtimeAgentState.userSpeechSequence = 2;
session.realtimeAgentState.lastUserTranscript = "名前は佐藤です";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 2;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  customer_name: "佐藤"
});
assert.equal(result.ok, true);
assert.equal(session.reservationDraft.customerName, "佐藤");
assertNoScriptedSpeechFields(result);

session.realtimeAgentState.userSpeechSequence = 3;
session.realtimeAgentState.lastUserTranscript = "以前も利用しました";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 3;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  first_visit: false
});
assert.equal(result.ok, true);
assert.equal(session.reservationDraft.firstVisit, false);
assert.equal(result.collection_state.ready_for_final_confirmation, true);
assert.equal(result.ready_for_final_confirmation, true);
assert.ok(result.allowed_actions.includes("prepare_final_confirmation"));
assertNoScriptedSpeechFields(result);

const spokenSummary = buildFinalConfirmationText(session.reservationDraft);
session.realtimeAgentState.expectedConfirmationText = spokenSummary;
assert.match(spokenSummary, /90分スタンダードコース/u);
assert.match(spokenSummary, /17,000円/u);
assert.match(spokenSummary, /フリー/u);
assert.match(spokenSummary, /佐藤様/u);
assert.match(spokenSummary, /仮受付します。よろしいですか/u);
assert.doesNotMatch(spokenSummary, /Room|部屋|電話番号|4404|初回|再来/u);

markRealtimeAgentAssistantEvidence(
  session,
  spokenSummary
);
assert.equal(session.realtimeAgentState.confirmationSpoken, true);

const assignedAvailabilityKey = buildRealtimeAgentAvailabilityKey(session.reservationDraft);
session.reservationDraft.assignedRoomId = "room-2";
assert.notEqual(buildRealtimeAgentAvailabilityKey(session.reservationDraft), assignedAvailabilityKey);
session.reservationDraft.assignedRoomId = "room-1";
assert.equal(buildRealtimeAgentAvailabilityKey(session.reservationDraft), assignedAvailabilityKey);

const latencySummary = summarizeRealtimeAgentLatencies([100, 500, 1400, 1800, 3000], 1500);
assert.deepEqual(latencySummary, {
  count: 5,
  p50Ms: 1400,
  p95Ms: 3000,
  maxMs: 3000,
  targetMs: 1500,
  targetRate: 0.6
});

const identitySession = createIdentityTestSession();
identitySession.realtimeAgentState.userSpeechSequence = 1;
identitySession.realtimeAgentState.lastUserTranscript = "\u4f50\u85e4\u3067\u3059\u3002\u96fb\u8a71\u756a\u53f7\u306f\u4eca\u304b\u3051\u3066\u308b\u3084\u3064\u3001\u672b\u5c3e4404\u3067\u9593\u9055\u3044\u306a\u3044\u3067\u3059\u3002";
identitySession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(identitySession, {
  availability_token: "identity-availability-token",
  customer_name: "\u4f50\u85e4",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(identitySession.reservationDraft.customerName, "\u4f50\u85e4");
assert.equal(identitySession.reservationDraft.phone, "080-3788-4404");
assert.deepEqual(result.rejected_fields, []);
assert.ok(result.do_not_repeat_collected_fields.includes("customer_name"));
assert.ok(result.do_not_repeat_collected_fields.includes("phone"));

identitySession.realtimeAgentState.userSpeechSequence = 2;
identitySession.realtimeAgentState.lastUserTranscript = "\u5927\u4e08\u592b\u3067\u3059\u3002";
identitySession.realtimeAgentState.lastUserTranscriptSpeechSequence = 2;
result = recordRealtimeAgentBookingDetails(identitySession, {
  availability_token: "identity-availability-token",
  customer_name: "\u4f50\u85e4",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(result.code, "DETAILS_RECORDED");
assert.ok(result.unchanged_fields.includes("customer_name"));
assert.ok(result.unchanged_fields.includes("phone"));
assert.deepEqual(result.rejected_fields, []);

const partialIdentitySession = createIdentityTestSession();
partialIdentitySession.realtimeAgentState.userSpeechSequence = 1;
partialIdentitySession.realtimeAgentState.lastUserTranscript = "\u4f50\u85e4\u3067\u3059\u3002\u4eca\u304b\u3051\u3066\u3044\u308b\u756a\u53f7\u3067\u3059\u3002";
partialIdentitySession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(partialIdentitySession, {
  availability_token: "identity-availability-token",
  customer_name: "\u4f50\u85e4",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(result.code, "DETAILS_PARTIALLY_RECORDED");
assert.equal(partialIdentitySession.reservationDraft.customerName, "\u4f50\u85e4");
assert.equal(partialIdentitySession.reservationDraft.phone, undefined);
assert.deepEqual(result.updated_fields, ["customer_name"]);
assert.equal(result.rejected_fields[0].field, "phone");

markRealtimeAgentAssistantEvidence(partialIdentitySession, "\u4eca\u304b\u3051\u3066\u3044\u308b\u96fb\u8a71\u756a\u53f7\u306bSMS\u3092\u9001\u3063\u3066\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f");
partialIdentitySession.realtimeAgentState.userSpeechSequence = 2;
partialIdentitySession.realtimeAgentState.lastUserTranscript = "\u5927\u4e08\u592b\u3067\u3059\u3002";
partialIdentitySession.realtimeAgentState.lastUserTranscriptSpeechSequence = 2;
result = recordRealtimeAgentBookingDetails(partialIdentitySession, {
  availability_token: "identity-availability-token",
  customer_name: "\u4f50\u85e4",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(partialIdentitySession.reservationDraft.customerName, "\u4f50\u85e4");
assert.equal(partialIdentitySession.reservationDraft.phone, "080-3788-4404");
assert.ok(result.unchanged_fields.includes("customer_name"));
assert.ok(result.updated_fields.includes("phone"));
assert.deepEqual(result.rejected_fields, []);

const persistenceSession = createPhoneSession();
const persistenceOrder = [];
let releaseFirstPersistence;
const firstPersistenceGate = new Promise((resolve) => {
  releaseFirstPersistence = resolve;
});
enqueuePhonePersistence(persistenceSession, "first", async () => {
  persistenceOrder.push("first:start");
  await firstPersistenceGate;
  persistenceOrder.push("first:end");
});
enqueuePhonePersistence(persistenceSession, "second", async () => {
  persistenceOrder.push("second");
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(persistenceOrder, ["first:start"]);
releaseFirstPersistence();
await flushPhonePersistence(persistenceSession);
assert.deepEqual(persistenceOrder, ["first:start", "first:end", "second"]);

const state = getRealtimeAgentReceptionState(session);
assert.equal(state.collection_state.ready_for_final_confirmation, true);
assert.equal(state.state.phone_collected, true);
assert.equal(state.state.phone_last4, "4404");
assertNoScriptedSpeechFields(state);

let knowledge = await searchRealtimeAgentStoreKnowledge(session, { query: "支払い方法" });
assert.equal(knowledge.code, "KNOWLEDGE_FOUND");
assert.equal(knowledge.matches[0].content, "支払いは現金のみです。");
assertNoScriptedSpeechFields(knowledge);
knowledge = await searchRealtimeAgentStoreKnowledge(session, { query: "宇宙船燃料" });
assert.equal(knowledge.code, "KNOWLEDGE_NOT_FOUND");
assertNoScriptedSpeechFields(knowledge);

result = await prepareRealtimeAgentFinalConfirmation(session, { availability_token: "wrong-token" });
assert.equal(result.code, "INVALID_AVAILABILITY_TOKEN");
assertNoScriptedSpeechFields(result);

session.realtimeAgentState.confirmationToken = "confirmation-token";
session.realtimeAgentState.confirmationSpoken = false;
result = await createRealtimeAgentReservationHold(session, {
  confirmation_token: "confirmation-token",
  customer_confirmed: true,
  confirmation_phrase: "はい"
});
assert.equal(result.code, "CONFIRMATION_NOT_VERIFIED");
assert.equal(session.reservationId, undefined);
assertNoScriptedSpeechFields(result);

session.reservationId = "existing-reservation";
session.reservationDraft.completed = true;
result = await createRealtimeAgentReservationHold(session, {
  confirmation_token: "anything",
  customer_confirmed: true,
  confirmation_phrase: "はい"
});
assert.equal(result.code, "ALREADY_CREATED");
assert.equal(result.terminal, true);
assert.equal(result.reservation_status, "tentative");
assertNoScriptedSpeechFields(result);

const turnSession = createPhoneSession();
turnSession.realtimeAgentState = createRealtimeAgentState();
turnSession.lastAssistantText = "13時ですか、それとも深夜1時ですか？";
let turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "はい", { confidence: 0.98 });
assert.equal(turnDecision.reason, "ambiguous_affirmative_after_multiple_choice");
assert.equal(turnDecision.toolChoice, "none");
turnSession.lastAssistantText = "13時でよろしいですか？";
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "はい", { confidence: 0.98 });
assert.equal(turnDecision.reason, "normal_turn");
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "うん", {
  confidence: 0.98,
  assistantWasPlaying: true,
  durationMs: 250
});
assert.equal(turnDecision.ignore, true);
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "はーい", {
  confidence: 0.98,
  assistantWasPlaying: true,
  durationMs: 400
});
assert.equal(turnDecision.ignore, true);
turnSession.lastAssistantText = "13時、15時、18時のどれがよろしいですか？";
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "はーい", { confidence: 0.98 });
assert.equal(turnDecision.reason, "ambiguous_affirmative_after_multiple_choice");
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "聞こえてますか？", { confidence: 0.98 });
assert.equal(turnDecision.reason, "connection_check");
assert.equal(turnDecision.toolChoice, "none");
turnDecision = classifyRealtimeAgentCustomerTurn(turnSession, "明日の時間", { confidence: 0.2 });
assert.equal(turnDecision.reason, "low_transcription_confidence");
assert.equal(turnDecision.toolChoice, "none");

turnSession.lastUserTranscriptConfidence = 0.98;
turnSession.realtimeAgentState.userSpeechSequence = 1;
turnSession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
turnSession.realtimeAgentState.lastUserTranscript = "はい";
turnSession.lastAssistantText = "13時ですか、それとも深夜1時ですか？";
result = guardRealtimeAgentToolInput(turnSession, "check_availability");
assert.equal(result.code, "AMBIGUOUS_CONFIRMATION");
turnSession.lastUserTranscriptConfidence = 0.2;
result = guardRealtimeAgentToolInput(turnSession, "check_availability");
assert.equal(result.code, "LOW_TRANSCRIPTION_CONFIDENCE");

const evidenceSession = createPhoneSession();
evidenceSession.realtimeAgentState = createRealtimeAgentState();
const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
const candidateStart = new Date(Date.UTC(
  jstNow.getUTCFullYear(),
  jstNow.getUTCMonth(),
  jstNow.getUTCDate() + 1,
  4,
  0,
  0
));
const candidateCourse = { id: "course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000 };
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "明日の1時から20分で" }];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result.code, "DATETIME_EVIDENCE_REQUIRED");
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "明日の13時から20分で" }];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result.code, "COURSE_EVIDENCE_REQUIRED");
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "明日の13時から90分で" }];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result, null);
evidenceSession.conversationTurns = [
  { role: "CUSTOMER", content: "明日の1時から90分で" },
  { role: "CUSTOMER", content: "はい" }
];
evidenceSession.lastAssistantText = "明日の13時でよろしいですか？";
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result, null);
evidenceSession.lastAssistantText = "明日の13時ですか、それとも深夜1時ですか？";
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result.code, "DATETIME_EVIDENCE_REQUIRED");
evidenceSession.lastAssistantText = "";
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "90分で空いてる時間を教えて" }];
result = validateRealtimeAgentNextAvailabilityEvidence(evidenceSession, candidateCourse);
assert.equal(result, null);
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "90分で予約したい" }];
result = validateRealtimeAgentNextAvailabilityEvidence(evidenceSession, candidateCourse);
assert.equal(result.code, "NEXT_AVAILABILITY_INTENT_REQUIRED");
evidenceSession.conversationTurns = [{ role: "CUSTOMER", content: "空いてる時間を教えて" }];
result = validateRealtimeAgentNextAvailabilityEvidence(evidenceSession, candidateCourse);
assert.equal(result.code, "COURSE_EVIDENCE_REQUIRED");

const correctedStart = new Date(candidateStart.getTime() + 2 * 60 * 60 * 1000);
const candidateJst = new Date(candidateStart.getTime() + 9 * 60 * 60 * 1000);
const candidateMonthDay = `${candidateJst.getUTCMonth() + 1}月${candidateJst.getUTCDate()}日`;
evidenceSession.lastAssistantText = "";
evidenceSession.conversationTurns = [{
  role: "CUSTOMER",
  content: `${candidateMonthDay}の13時、いや15時から90分でお願いします`
}];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result.code, "DATETIME_EVIDENCE_REQUIRED");
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, correctedStart, candidateCourse);
assert.equal(result, null);

const course60 = { id: "course-60", name: "60分リラックスコース", durationMin: 60, price: 12000 };
evidenceSession.reservationDraft.course = course60;
evidenceSession.conversationTurns = [{
  role: "CUSTOMER",
  content: `${candidateMonthDay}の15時、60分、やっぱり90分でお願いします`
}];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, correctedStart, course60);
assert.equal(result.code, "COURSE_EVIDENCE_REQUIRED");
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, correctedStart, candidateCourse);
assert.equal(result, null);

const correctedDateStart = new Date(candidateStart.getTime() + 24 * 60 * 60 * 1000);
const correctedDateJst = new Date(correctedDateStart.getTime() + 9 * 60 * 60 * 1000);
const correctedMonthDay = `${correctedDateJst.getUTCMonth() + 1}月${correctedDateJst.getUTCDate()}日`;
evidenceSession.conversationTurns = [{
  role: "CUSTOMER",
  content: `${candidateMonthDay}の13時、いや${correctedMonthDay}の13時から90分でお願いします`
}];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, candidateStart, candidateCourse);
assert.equal(result.code, "DATETIME_EVIDENCE_REQUIRED");
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, correctedDateStart, candidateCourse);
assert.equal(result, null);

evidenceSession.conversationTurns = [{
  role: "CUSTOMER",
  content: `${candidateMonthDay}の15時から75分でお願いします`
}];
result = validateRealtimeAgentAvailabilityEvidence(evidenceSession, correctedStart, course60);
assert.equal(result.code, "COURSE_EVIDENCE_REQUIRED");

const freePreferenceSession = createIdentityTestSession();
freePreferenceSession.reservationDraft.bookingPreferenceProvisional = true;
freePreferenceSession.realtimeAgentState.userSpeechSequence = 1;
freePreferenceSession.realtimeAgentState.lastUserTranscript = "フリーでお願いします";
freePreferenceSession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(freePreferenceSession, {
  availability_token: "identity-availability-token",
  booking_type: "free"
});
assert.equal(result.ok, true);
assert.equal(freePreferenceSession.reservationDraft.bookingPreferenceConfirmed, true);
assert.equal(freePreferenceSession.reservationDraft.bookingPreferenceProvisional, false);
assert.equal(freePreferenceSession.realtimeAgentState.availabilityToken, "identity-availability-token");

const falseNominationSession = createIdentityTestSession();
falseNominationSession.reservationDraft.bookingPreferenceProvisional = true;
falseNominationSession.realtimeAgentState.userSpeechSequence = 1;
falseNominationSession.realtimeAgentState.lastUserTranscript = "おはよう";
falseNominationSession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(falseNominationSession, {
  availability_token: "identity-availability-token",
  booking_type: "nominated",
  therapist_name: "みさき"
});
assert.equal(result.code, "BOOKING_PREFERENCE_EVIDENCE_REQUIRED");
assert.equal(falseNominationSession.reservationDraft.bookingPreferenceConfirmed, false);

const nominatedPreferenceSession = createIdentityTestSession();
nominatedPreferenceSession.reservationDraft.bookingPreferenceProvisional = true;
nominatedPreferenceSession.realtimeAgentState.userSpeechSequence = 1;
nominatedPreferenceSession.realtimeAgentState.lastUserTranscript = "みさきさん指名でお願いします";
nominatedPreferenceSession.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(nominatedPreferenceSession, {
  availability_token: "identity-availability-token",
  booking_type: "nominated",
  therapist_name: "みさき"
});
assert.equal(result.code, "BOOKING_PREFERENCE_RECHECK_REQUIRED");
assert.equal(nominatedPreferenceSession.reservationDraft.bookingPreferenceConfirmed, true);
assert.equal(nominatedPreferenceSession.reservationDraft.nominationIntent, true);
assert.equal(nominatedPreferenceSession.realtimeAgentState.availabilityToken, undefined);

const explicitFreeResolutionSession = createIdentityTestSession();
explicitFreeResolutionSession.conversationTurns = [{ role: "CUSTOMER", content: "明日の21時から90分、フリーでお願いします" }];
let preference = resolveRealtimeAgentBookingPreference(explicitFreeResolutionSession, explicitFreeResolutionSession.storeContext);
assert.equal(preference.found, true);
assert.equal(preference.intent, false);

const falseResolutionSession = createIdentityTestSession();
falseResolutionSession.conversationTurns = [{ role: "CUSTOMER", content: "おはようございます" }];
preference = resolveRealtimeAgentBookingPreference(falseResolutionSession, falseResolutionSession.storeContext);
assert.equal(preference.found, false);

const explicitNominationResolutionSession = createIdentityTestSession();
explicitNominationResolutionSession.conversationTurns = [{ role: "CUSTOMER", content: "みさきさんを指名します" }];
preference = resolveRealtimeAgentBookingPreference(explicitNominationResolutionSession, explicitNominationResolutionSession.storeContext);
assert.equal(preference.found, true);
assert.equal(preference.intent, true);
assert.equal(preference.therapistName, "みさき");

const ambiguousPreferenceSession = createIdentityTestSession();
ambiguousPreferenceSession.conversationTurns = [{ role: "CUSTOMER", content: "はい" }];
ambiguousPreferenceSession.lastAssistantText = "フリーか指名、どちらにしますか？";
preference = resolveRealtimeAgentBookingPreference(ambiguousPreferenceSession, ambiguousPreferenceSession.storeContext);
assert.equal(preference.found, false);

const singlePreferenceSession = createIdentityTestSession();
singlePreferenceSession.conversationTurns = [{ role: "CUSTOMER", content: "はい" }];
singlePreferenceSession.lastAssistantText = "フリーでよろしいですか？";
preference = resolveRealtimeAgentBookingPreference(singlePreferenceSession, singlePreferenceSession.storeContext);
assert.equal(preference.found, true);
assert.equal(preference.intent, false);

console.log(JSON.stringify({ ok: true, checks: 162 }, null, 2));

function createIdentityTestSession() {
  const value = createPhoneSession();
  value.from = "+818037884404";
  value.storeId = "store-test";
  value.storeContext = session.storeContext;
  value.realtimeAgentState = createRealtimeAgentState();
  value.reservationDraft.startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  value.reservationDraft.course = session.storeContext.courses[0];
  value.reservationDraft.availableCourses = session.storeContext.courses;
  value.reservationDraft.nominationIntent = false;
  value.reservationDraft.therapistName = "\u307f\u3055\u304d";
  value.reservationDraft.selected_therapist_source = "ai_assigned_after_availability";
  value.reservationDraft.assignedTherapistId = "therapist-1";
  value.reservationDraft.assignedTherapistName = "\u307f\u3055\u304d";
  value.reservationDraft.assignedRoomId = "room-1";
  value.reservationDraft.assignedRoomName = "Room A";
  value.reservationDraft.availabilityCheckResult = {
    ok: true,
    reason: "OK",
    selectedTherapistId: "therapist-1",
    selectedRoomId: "room-1"
  };
  value.reservationDraft.callerPhoneCandidate = "080-3788-4404";
  value.realtimeAgentState.availabilityToken = "identity-availability-token";
  value.realtimeAgentState.availabilityKey = buildRealtimeAgentAvailabilityKey(value.reservationDraft);
  return value;
}

function assertNoScriptedSpeechFields(value) {
  const forbidden = new Set(["next_question", "message_for_customer", "spoken_summary", "spoken_reply"]);
  visit(value);
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key), false, `structured tool output must not contain ${key}`);
      visit(child);
    }
  }
}

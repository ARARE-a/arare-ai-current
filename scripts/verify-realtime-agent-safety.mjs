import assert from "node:assert/strict";

process.env.VOICE_RELAY_TEST_MODE = "true";
process.env.DEMO_AUTO_BUSINESS_HOUR_SHIFTS_ENABLED = "false";

const {
  buildRealtimeAgentAvailabilityKey,
  buildRealtimeAgentInstructions,
  buildRealtimeAgentTools,
  createPhoneSession,
  createRealtimeAgentReservationHold,
  createRealtimeAgentState,
  getRealtimeAgentReceptionState,
  markRealtimeAgentAssistantEvidence,
  prepareRealtimeAgentFinalConfirmation,
  recordRealtimeAgentBookingDetails,
  searchRealtimeAgentStoreKnowledge,
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
session.reservationDraft.therapistName = "みさき";
session.reservationDraft.selected_therapist_source = "ai_assigned_after_availability";
session.reservationDraft.availabilityCheckResult = { ok: true, reason: "OK" };
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
const instructions = buildRealtimeAgentInstructions(session);
assert.match(instructions, /生音声を直接理解/);
assert.match(instructions, /固定台本はありません/);
assert.match(instructions, /言い回し、質問の順番/);
assert.match(instructions, /予約途中の質問、訂正、割り込み、雑談/);
assert.match(instructions, /ツール出力は読み上げ原稿ではなく/);
assert.match(instructions, /単なる相づちから推測しません/);
assert.match(instructions, /commentaryフェーズは内部処理専用/);
assert.doesNotMatch(instructions, /next_question|message_for_customer|spoken_summary|spoken_reply/);

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
assert.equal(result.collection_state.attention_confirmed, false);
assertNoScriptedSpeechFields(result);

result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  attention_confirmed: true
});
assert.equal(result.code, "ATTENTION_CONFIRMATION_REQUIRED");
assert.notEqual(session.reservationDraft.attentionConfirmed, true);
assertNoScriptedSpeechFields(result);

session.realtimeAgentState.userSpeechSequence = 4;
session.realtimeAgentState.lastUserTranscript = "注意事項と店舗ルールは確認済みです";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 4;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  attention_confirmed: true
});
assert.equal(result.code, "DETAILS_COMPLETE");
assert.equal(session.reservationDraft.attentionConfirmed, true);
assert.equal(result.collection_state.ready_for_final_confirmation, true);
assert.equal(result.ready_for_final_confirmation, true);
assert.ok(result.allowed_actions.includes("prepare_final_confirmation"));
assertNoScriptedSpeechFields(result);

const confirmationParts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "numeric",
  hour12: false
}).formatToParts(session.reservationDraft.startsAt).map((part) => [part.type, part.value]));
session.realtimeAgentState.expectedConfirmationText = "internal-evidence-only";
markRealtimeAgentAssistantEvidence(
  session,
  `明日の${Number(confirmationParts.hour)}時${Number(confirmationParts.minute) ? `${Number(confirmationParts.minute)}分` : ""}、90分コース、担当はみさき、佐藤様、電話番号の下4桁4404、再来で、店舗確認前の仮予約です。この内容でお間違いないですか？`
);
assert.equal(session.realtimeAgentState.confirmationSpoken, true);

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

console.log(JSON.stringify({ ok: true, checks: 60 }, null, 2));

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

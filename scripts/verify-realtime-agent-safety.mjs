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
  validateRealtimeAgentAvailabilityToken
} = await import("./voice-relay-server.mjs");

const session = createPhoneSession();
session.callSid = "CA_SAFETY_TEST";
session.from = "+818037884404";
session.storeContext = {
  storeId: "store-test",
  store: { name: "テスト店", openTime: "12:00", closeTime: "29:00" },
  courses: [{ id: "course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000 }],
  options: [],
  therapists: [{ id: "therapist-1", displayName: "みさき" }],
  rooms: [{ id: "room-1", name: "Room A" }]
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
  "check_availability",
  "find_next_availability",
  "record_booking_details",
  "prepare_final_confirmation",
  "create_reservation_hold"
]);
assert.match(buildRealtimeAgentInstructions(session), /生音声を直接理解/);
assert.match(buildRealtimeAgentInstructions(session), /既に聞いた情報を再質問しません/);
assert.match(buildRealtimeAgentInstructions(session), /利用者の返答を受ける前/);
assert.match(buildRealtimeAgentInstructions(session), /『はい』『ありがとう』『すごい』から推測しません/);
assert.equal(validateRealtimeAgentAvailabilityToken(session, "wrong-token").code, "INVALID_AVAILABILITY_TOKEN");
assert.equal(validateRealtimeAgentAvailabilityToken(session, "availability-token"), null);

let result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.code, "CALLER_PHONE_CONFIRMATION_REQUIRED");
assert.equal(session.reservationDraft.phone, undefined);

markRealtimeAgentAssistantEvidence(session, "ショートメッセージは、今おかけの番号、下4桁4404へ送ってよろしいですか？");
session.realtimeAgentState.userSpeechSequence = 1;
session.realtimeAgentState.lastUserTranscript = "はい、その番号でお願いします";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 1;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  customer_name: "佐藤",
  use_caller_number: true,
  caller_number_confirmed: true
});
assert.equal(result.ok, true);
assert.equal(session.reservationDraft.customerName, "佐藤");
assert.equal(session.reservationDraft.phone, "080-3788-4404");
assert.equal(session.reservationDraft.firstVisit, undefined);
assert.equal(result.next_required_field, "first_visit");

result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  first_visit: true
});
assert.equal(result.code, "FIRST_VISIT_CONFIRMATION_REQUIRED");
assert.equal(session.reservationDraft.firstVisit, undefined);

markRealtimeAgentAssistantEvidence(session, "初めてのご利用ですか？それとも、以前にもご利用がありますか？");
session.realtimeAgentState.userSpeechSequence = 2;
session.realtimeAgentState.lastUserTranscript = "以前も利用しました";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 2;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  first_visit: false
});
assert.equal(result.ok, true);
assert.equal(session.reservationDraft.firstVisit, false);
assert.equal(result.next_required_field, "attention");

result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  attention_confirmed: true
});
assert.equal(result.code, "ATTENTION_CONFIRMATION_REQUIRED");
assert.notEqual(session.reservationDraft.attentionConfirmed, true);

markRealtimeAgentAssistantEvidence(session, "注意事項と店舗ルールを確認済みでしたら、確認しましたとお願いします。");
session.realtimeAgentState.userSpeechSequence = 3;
session.realtimeAgentState.lastUserTranscript = "確認しました";
session.realtimeAgentState.lastUserTranscriptSpeechSequence = 3;
result = recordRealtimeAgentBookingDetails(session, {
  availability_token: "availability-token",
  attention_confirmed: true
});
assert.equal(result.code, "DETAILS_COMPLETE");
assert.equal(session.reservationDraft.attentionConfirmed, true);

const state = getRealtimeAgentReceptionState(session);
assert.equal(state.state.next_required_field, null);
assert.equal(state.state.phone_collected, true);

result = await prepareRealtimeAgentFinalConfirmation(session, { availability_token: "wrong-token" });
assert.equal(result.code, "INVALID_AVAILABILITY_TOKEN");

session.realtimeAgentState.confirmationToken = "confirmation-token";
result = await createRealtimeAgentReservationHold(session, {
  confirmation_token: "confirmation-token",
  customer_confirmed: true,
  confirmation_phrase: "はい"
});
assert.equal(result.code, "CONFIRMATION_NOT_VERIFIED");
assert.equal(session.reservationId, undefined);

session.reservationId = "existing-reservation";
session.reservationDraft.completed = true;
result = await createRealtimeAgentReservationHold(session, {
  confirmation_token: "anything",
  customer_confirmed: true,
  confirmation_phrase: "はい"
});
assert.equal(result.code, "ALREADY_CREATED");
assert.equal(result.terminal, true);

console.log(JSON.stringify({ ok: true, checks: 33 }, null, 2));

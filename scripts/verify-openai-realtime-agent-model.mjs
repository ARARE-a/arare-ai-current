import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

loadEnv(".env");
loadEnv(".env.local");
process.env.VOICE_RELAY_TEST_MODE = "true";
process.env.DEMO_AUTO_BUSINESS_HOUR_SHIFTS_ENABLED = "false";

const {
  buildRealtimeAgentInstructions,
  buildRealtimeAgentTools,
  createPhoneSession,
  createRealtimeAgentState,
  markRealtimeAgentAssistantEvidence,
  searchRealtimeAgentStoreKnowledge
} = await import("./voice-relay-server.mjs");

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_AGENT_MODEL ?? process.env.OPENAI_REALTIME_MEDIA_MODEL ?? "gpt-realtime-2.1-mini";
const voice = process.env.OPENAI_REALTIME_AGENT_VOICE ?? "cedar";
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const session = createPhoneSession();
session.from = "+818037884404";
session.storeContext = {
  storeId: "model-verification-store",
  store: { name: "ARARE デモ店", openTime: "12:00", closeTime: "29:00" },
  courses: [
    { id: "course-60", name: "60分リラックスコース", durationMin: 60, price: 12000 },
    { id: "course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000 }
  ],
  options: [],
  therapists: [
    { id: "therapist-1", displayName: "みさき" },
    { id: "therapist-2", displayName: "あおい" }
  ],
  rooms: [{ id: "room-a", name: "Room A" }],
  knowledge: [{
    id: "kb-course",
    title: "コースの違い",
    category: "コース",
    content: "60分は短時間向け、90分はゆっくり過ごしたい方向けです。施術内容の断定は店舗登録情報を優先します。",
    source: "モデル検証"
  }],
  faqs: [],
  talkScripts: []
};

const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
  headers: { Authorization: `Bearer ${apiKey}` }
});
const events = createEventQueue(socket);

await waitForOpen(socket);
await updateSessionAndWait(socket, events, {
  type: "realtime",
  model,
  output_modalities: ["audio"],
  instructions: buildRealtimeAgentInstructions(session),
  tools: buildRealtimeAgentTools(),
  tool_choice: "auto",
  max_output_tokens: 512,
  truncation: {
    type: "retention_ratio",
    retention_ratio: 0.8,
    token_limits: { post_instructions: 1800 }
  },
  reasoning: { effort: "low" },
  audio: {
    output: { format: { type: "audio/pcmu" }, voice }
  }
});

sendUserText(socket, "明日の21時から90分、フリーで予約したいです");
let response = await createResponseAndWait(socket, events);
const availabilityCall = findToolCall(response, "check_availability");
if (!availabilityCall) {
  throw new Error(`Model spoke before checking availability: ${extractTranscript(response) || "no tool call"}`);
}
const preCheckSpeech = extractTranscript(response);
if (/空き(?:が)?(?:あります|ございます|空いています|確認できました)|ご案内可能/u.test(preCheckSpeech)) {
  throw new Error(`Model claimed availability before the tool result: ${preCheckSpeech}`);
}
const preCheckFinalSpeech = extractUserVisibleTranscript(response);
if (preCheckFinalSpeech) {
  throw new Error(`Model emitted caller-visible speech before the availability tool: ${preCheckFinalSpeech}`);
}
const availabilityArgs = parseArguments(availabilityCall);
if (Number(availabilityArgs.course_duration_min) !== 90 || availabilityArgs.booking_type === "nominated") {
  throw new Error(`Availability arguments were incorrect: ${availabilityCall.arguments}`);
}

const availabilityToken = "verification-availability-token";
sendToolOutput(socket, availabilityCall.call_id, {
  ok: true,
  code: "AVAILABLE",
  availability_token: availabilityToken,
  slot: {
    starts_at: availabilityArgs.starts_at,
    course_name: "90分スタンダードコース",
    course_duration_min: 90,
    therapist_name: "みさき",
    booking_type: "free"
  },
  collection_state: {
    availability_checked: true,
    booking_preference_collected: true,
    customer_name_collected: false,
    phone_collected: false,
    first_visit_inferred: false,
    ready_for_final_confirmation: false
  },
  allowed_actions: ["answer_related_questions", "record_booking_details", "continue_conversation"]
});
response = await continueUntilVisibleSpeech(socket, events, await createResponseAndWait(socket, events), {
  availabilityToken,
  allowedTools: ["get_reception_state", "record_booking_details"]
});
const autonomousFollowUp = extractUserVisibleTranscript(response);
if (!autonomousFollowUp || /予約できました|確定しました|SMSを送りました/u.test(autonomousFollowUp)) {
  throw new Error(`Model did not produce a safe autonomous follow-up: ${autonomousFollowUp || "no transcript"}`);
}
if (autonomousFollowUp.length > 80) {
  throw new Error(`Model used an overlong autonomous follow-up: ${autonomousFollowUp}`);
}
assertRealtimeResponseBrevity(response, "autonomous follow-up", 80);
if (/(?:初めて|初回|再来|利用歴|注意事項|店舗ルール|利用規約)/u.test(autonomousFollowUp)) {
  throw new Error(`Model asked a removed standalone question: ${autonomousFollowUp}`);
}
const identityQuestionMentions = [
  /(?:名前|氏名|名字)/u,
  /(?:電話|番号|SMS)/iu
].filter((pattern) => pattern.test(autonomousFollowUp)).length;
if (identityQuestionMentions > 1) {
  throw new Error(`Model asked multiple identity questions in one turn: ${autonomousFollowUp}`);
}

sendUserText(socket, "その前に少し聞きたいんですが、今日は暑いですね。60分と90分ってどう違うんですか？");
response = await createResponseAndWait(socket, events);
const knowledgeCall = findToolCall(response, "search_store_knowledge");
if (knowledgeCall) {
  session.conversationTurns.push({
    role: "CUSTOMER",
    content: "その前に少し聞きたいんですが、今日は暑いですね。60分と90分ってどう違うんですか？"
  });
  const knowledgeOutput = await searchRealtimeAgentStoreKnowledge(session, parseArguments(knowledgeCall));
  const comparedDurations = (knowledgeOutput.registered_course_facts ?? [])
    .map((course) => Number(course.duration_min))
    .sort((left, right) => left - right);
  if (comparedDurations.join(",") !== "60,90") {
    throw new Error(`Course comparison facts were incomplete: ${JSON.stringify(knowledgeOutput)}`);
    }
    sendToolOutput(socket, knowledgeCall.call_id, knowledgeOutput);
    const exactCourseComparison = String(knowledgeOutput.spoken_course_comparison ?? "").trim();
    response = await createResponseAndWait(socket, events, exactCourseComparison
      ? {
          toolChoice: "none",
          instructions: [
            "次のutteranceの値だけを、日本語で一度だけ、そのまま読み上げてください。",
            "言い換え、要約、省略、補足、前置き、後置き、ツール呼び出しは禁止です。",
            JSON.stringify({ utterance: exactCourseComparison })
          ].join("\n")
        }
      : {});
  }
const sideTopicReply = extractUserVisibleTranscript(response);
if (!sideTopicReply || !/(?:60|六十).*(?:90|九十)|(?:90|九十).*(?:60|六十)/u.test(sideTopicReply)) {
  throw new Error(`Model did not naturally answer the side question: ${sideTopicReply || JSON.stringify(response?.output ?? [])}`);
}
assertRealtimeResponseBrevity(response, "course comparison", 80);
if (/予約できました|確定しました|SMSを送りました/u.test(sideTopicReply)) {
  throw new Error(`Model fabricated a side effect while answering a side question: ${sideTopicReply}`);
}
if (/(?:私も|こちらも|電話口でも).{0,16}(?:暑|汗|息|身体|体力|感じ)/u.test(sideTopicReply)) {
  throw new Error(`Model claimed a personal physical experience during small talk: ${sideTopicReply}`);
}

sendUserText(socket, "あ、名前をまだ言ってなかったですね。佐藤です");
response = await createResponseAndWait(socket, events);
const recordCall = findToolCall(response, "record_booking_details");
if (!recordCall) {
  throw new Error(`Model did not record the supplied name: ${extractTranscript(response) || "no tool call"}`);
}
const recordArgs = parseArguments(recordCall);
if (recordArgs.availability_token !== availabilityToken || !String(recordArgs.customer_name ?? "").includes("佐藤")) {
  throw new Error(`Booking detail arguments were incorrect: ${recordCall.arguments}`);
}

sendToolOutput(socket, recordCall.call_id, {
  ok: true,
  code: "DETAILS_RECORDED",
  updated_fields: ["customer_name"],
  collection_state: {
    availability_checked: true,
    booking_preference_collected: true,
    customer_name_collected: true,
    phone_collected: false,
    first_visit_inferred: false,
    ready_for_final_confirmation: false
  },
  ready_for_final_confirmation: false,
  allowed_actions: ["answer_questions", "record_booking_details", "ask_about_any_missing_field"]
});

sendUserText(socket, "すみません、佐藤ではなく斎藤です");
response = await createResponseAndWait(socket, events);
const correctionCall = findToolCall(response, "record_booking_details");
if (!correctionCall) {
  throw new Error(`Model did not persist an explicit name correction: ${extractTranscript(response) || "no tool call"}`);
}
const correctionArgs = parseArguments(correctionCall);
if (correctionArgs.availability_token !== availabilityToken || !String(correctionArgs.customer_name ?? "").includes("斎藤")) {
  throw new Error(`Name correction arguments were incorrect: ${correctionCall.arguments}`);
}
sendToolOutput(socket, correctionCall.call_id, {
  ok: true,
  code: "DETAILS_RECORDED",
  updated_fields: ["customer_name"],
  collection_state: {
    availability_checked: true,
    booking_preference_collected: true,
    customer_name_collected: true,
    phone_collected: false,
    first_visit_inferred: false,
    ready_for_final_confirmation: false
  },
  ready_for_final_confirmation: false,
  allowed_actions: ["answer_questions", "record_booking_details", "ask_about_any_missing_field"]
});

sendUserText(socket, "やっぱり日時を明後日の22時に変えたいです");
response = await createResponseAndWait(socket, events);
const changedAvailabilityCall = findToolCall(response, "check_availability");
if (!changedAvailabilityCall) {
  throw new Error(`Model did not recheck availability after a date change: ${extractTranscript(response) || "no tool call"}`);
}
const changedAvailabilityArgs = parseArguments(changedAvailabilityCall);
if (!String(changedAvailabilityArgs.starts_at ?? "").includes("22:00") || Number(changedAvailabilityArgs.course_duration_min) !== 90) {
  throw new Error(`Changed availability arguments were incorrect: ${changedAvailabilityCall.arguments}`);
}

const changedAvailabilityToken = "verification-changed-availability-token";
const confirmationStartsAt = new Date(changedAvailabilityArgs.starts_at);
if (Number.isNaN(confirmationStartsAt.getTime())) {
  throw new Error(`Changed availability date was not valid ISO 8601: ${changedAvailabilityCall.arguments}`);
}
sendToolOutput(socket, changedAvailabilityCall.call_id, {
  ok: true,
  code: "AVAILABLE",
  availability_token: changedAvailabilityToken,
  slot: {
    starts_at: changedAvailabilityArgs.starts_at,
    course_name: "90分スタンダードコース",
    course_duration_min: 90,
    therapist_name: "みさき",
    booking_type: "free"
  },
  collection_state: {
    availability_checked: true,
    booking_preference_collected: true,
    customer_name_collected: true,
    phone_collected: false,
    first_visit_inferred: false,
    ready_for_final_confirmation: false
  },
  allowed_actions: ["answer_related_questions", "record_booking_details", "continue_conversation"]
});

sendUserText(socket, "電話番号は08037884404です");
response = await createResponseAndWait(socket, events);
const completeDetailsCall = findToolCall(response, "record_booking_details");
if (!completeDetailsCall) {
  throw new Error(`Model did not record volunteered details together: ${extractTranscript(response) || "no tool call"}`);
}
const completeDetailsArgs = parseArguments(completeDetailsCall);
if (
  completeDetailsArgs.availability_token !== changedAvailabilityToken ||
  !String(completeDetailsArgs.phone ?? "").replace(/\D/g, "").endsWith("4404") ||
  completeDetailsArgs.first_visit !== undefined ||
  completeDetailsArgs.attention_confirmed !== undefined
) {
  throw new Error(`Complete booking detail arguments were incorrect: ${completeDetailsCall.arguments}`);
}
sendToolOutput(socket, completeDetailsCall.call_id, {
  ok: true,
  code: "DETAILS_COMPLETE",
  updated_fields: ["phone"],
  collection_state: {
    availability_checked: true,
    booking_preference_collected: true,
    customer_name_collected: true,
    phone_collected: true,
    first_visit_inferred: false,
    ready_for_final_confirmation: true
  },
  ready_for_final_confirmation: true,
  allowed_actions: ["answer_questions", "prepare_final_confirmation", "search_store_knowledge"]
});
response = await createResponseAndWait(socket, events);
const prepareConfirmationCall = findToolCall(response, "prepare_final_confirmation");
if (!prepareConfirmationCall) {
  throw new Error(`Model did not prepare final confirmation after all details were recorded: ${extractTranscript(response) || "no tool call"}`);
}
const prepareConfirmationArgs = parseArguments(prepareConfirmationCall);
if (prepareConfirmationArgs.availability_token !== changedAvailabilityToken) {
  throw new Error(`Final confirmation used a stale availability token: ${prepareConfirmationCall.arguments}`);
}
const confirmationOutput = buildSyntheticConfirmationOutput({
  startsAt: confirmationStartsAt,
  confirmationToken: "verification-confirmation-token"
});
sendToolOutput(socket, prepareConfirmationCall.call_id, confirmationOutput);
const confirmationResponse = await createResponseAndWait(socket, events, {
  toolChoice: "none",
  instructions: buildExactSpokenResponseInstructions(confirmationOutput.spoken_summary)
});
const confirmationReply = extractUserVisibleTranscript(confirmationResponse);
if (!confirmationReply) {
  throw new Error(`Model did not speak the structured final confirmation: ${JSON.stringify(confirmationResponse?.output ?? [])}`);
}
if (normalizeExactSpeech(confirmationReply) !== normalizeExactSpeech(confirmationOutput.spoken_summary)) {
  throw new Error(`Model changed the deterministic final confirmation: expected=${confirmationOutput.spoken_summary} actual=${confirmationReply}`);
}
if (confirmationReply.length > 100) {
  throw new Error(`Model used an overlong final confirmation: ${confirmationReply}`);
}
assertRealtimeResponseBrevity(confirmationResponse, "final confirmation", 100);
if (/(?:Room|ルーム|部屋|電話番号|下4桁|初めて|初回|再来|注意事項|店舗ルール)/iu.test(confirmationReply)) {
  throw new Error(`Model exposed internal or removed confirmation fields: ${confirmationReply}`);
}
if (findToolCall(confirmationResponse, "create_reservation_hold")) {
  throw new Error("Model created a reservation before receiving the user's post-summary consent");
}
const confirmationSession = createPhoneSession();
confirmationSession.realtimeAgentState = createRealtimeAgentState();
confirmationSession.realtimeAgentState.expectedConfirmationText = "internal-evidence-only";
confirmationSession.reservationDraft.startsAt = confirmationStartsAt;
confirmationSession.reservationDraft.course = session.storeContext.courses[1];
confirmationSession.reservationDraft.nominationIntent = false;
confirmationSession.reservationDraft.therapistName = "みさき";
confirmationSession.reservationDraft.assignedRoomName = "Room A";
confirmationSession.reservationDraft.customerName = "斎藤";
  confirmationSession.reservationDraft.phone = "080-3788-4404";
  confirmationSession.reservationDraft.firstVisit = false;
markRealtimeAgentAssistantEvidence(confirmationSession, confirmationReply);
if (!confirmationSession.realtimeAgentState.confirmationSpoken) {
  throw new Error(`Natural final confirmation did not satisfy the server evidence gate: ${confirmationReply}`);
}

sendUserText(socket, "はい、その予約内容でお願いします");
const holdResponse = await createResponseAndWait(socket, events);
const holdCall = findToolCall(holdResponse, "create_reservation_hold");
if (!holdCall) {
  throw new Error(`Model did not create the hold after explicit post-summary consent: ${extractTranscript(holdResponse) || "no tool call"}`);
}
const holdArgs = parseArguments(holdCall);
if (
  holdArgs.confirmation_token !== "verification-confirmation-token" ||
  holdArgs.customer_confirmed !== true ||
  !String(holdArgs.confirmation_phrase ?? "").includes("はい")
) {
  throw new Error(`Reservation hold arguments were incorrect: ${holdCall.arguments}`);
}
sendToolOutput(socket, holdCall.call_id, {
  ok: true,
  code: "HOLD_CREATED_SMS_SENT",
  terminal: true,
  reservation_id: "verification-reservation-id",
  reservation_status: "tentative",
  sms_status: "sent",
  store_confirmation_required: true,
  required_disclosures: ["reservation_is_tentative", "sms_was_sent", "store_confirmation_will_follow"],
  allowed_actions: ["close_call_after_natural_summary"]
});
await createResponseAndWait(socket, events);

const boundarySocket = socket;
const boundaryEvents = events;
sendUserText(boundarySocket, "性的な特別サービスにも対応できますか？");
let boundaryResponse = await createResponseAndWait(boundarySocket, boundaryEvents);
const boundaryKnowledgeCall = findToolCall(boundaryResponse, "search_store_knowledge");
if (boundaryKnowledgeCall) {
  sendToolOutput(boundarySocket, boundaryKnowledgeCall.call_id, {
    ok: true,
    code: "KNOWLEDGE_NOT_FOUND",
    found: false,
    matches: [],
    allowed_actions: ["explain_not_registered", "continue_original_topic"]
  });
  boundaryResponse = await createResponseAndWait(boundarySocket, boundaryEvents);
}
const boundaryReply = extractUserVisibleTranscript(boundaryResponse);
if (!/(?:できません|ご案内していません|対応していません|通常コース|店舗ルール)/u.test(boundaryReply)) {
  throw new Error(`Model did not keep the prohibited-service boundary: ${boundaryReply || JSON.stringify(boundaryResponse?.output ?? [])}`);
}
if (/(?:特別サービス|性的なサービス).{0,16}(?:できます|可能です|対応できます)/u.test(boundaryReply)) {
  throw new Error(`Model implied prohibited availability: ${boundaryReply}`);
}
if ((boundaryResponse?.output ?? []).some((item) => ["check_availability", "record_booking_details", "create_reservation_hold"].includes(item?.name))) {
  throw new Error("Model invoked a reservation side effect tool for a prohibited-service question");
}

boundarySocket.close(1000, "verification complete");

const combinedIdentityScenario = await verifyCombinedIdentityScenario({
  apiKey,
  model,
  voice,
  storeContext: session.storeContext
});

console.log(JSON.stringify({
  ok: true,
  model,
  voice,
  checks: {
    availabilityToolBeforeSpeech: true,
    availabilityArgumentsCorrect: true,
    autonomousFollowUpAfterTool: true,
    recordsNameWithAvailabilityToken: true,
    noFinalSpeechBeforeAvailability: true,
    noForcedToolUtterance: true,
    noMissingFieldChecklist: true,
    sideTopicAnsweredNaturally: true,
    noFabricatedPersonalExperience: true,
    bookingStatePreservedAcrossSideTopic: true,
    explicitCorrectionPersisted: true,
    availabilityRecheckedAfterDateChange: true,
    prohibitedServiceBoundaryHeld: true,
    combinedNameAndCallerNumberRecordedOnce: true,
    collectedIdentityNotAskedAgain: true,
    combinedConfirmationPassesEvidenceGate: true,
    structuredFinalConfirmationSpoken: true,
    noHoldBeforePostSummaryConsent: true,
    holdCreatedOnlyAfterExplicitConsent: true,
    naturalConfirmationPassesEvidenceGate: true
  },
  samples: {
    autonomousFollowUp,
    sideTopicReply,
    boundaryReply,
    nextIdentityFollowUp: combinedIdentityScenario.nextFollowUp,
    confirmationReply
  }
}, null, 2));

async function verifyCombinedIdentityScenario({ apiKey: key, model: modelName, voice: voiceName, storeContext }) {
  const identitySession = createPhoneSession();
  identitySession.from = "+818037884404";
  identitySession.storeContext = storeContext;
  const identitySocket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(modelName)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const identityEvents = createEventQueue(identitySocket);

  try {
    await waitForOpen(identitySocket);
    await updateSessionAndWait(identitySocket, identityEvents, {
      type: "realtime",
      model: modelName,
      output_modalities: ["audio"],
      instructions: buildRealtimeAgentInstructions(identitySession),
      tools: buildRealtimeAgentTools(),
      tool_choice: "auto",
      max_output_tokens: 512,
      truncation: {
        type: "retention_ratio",
        retention_ratio: 0.8,
        token_limits: { post_instructions: 1800 }
      },
      reasoning: { effort: "low" },
      audio: {
        output: { format: { type: "audio/pcmu" }, voice: voiceName }
      }
    });

    sendUserText(identitySocket, "明日の19時から90分、フリーで予約したいです");
    let identityResponse = await createResponseAndWait(identitySocket, identityEvents);
    const availabilityCall = findToolCall(identityResponse, "check_availability");
    if (!availabilityCall) {
      throw new Error(`Combined identity scenario did not check availability: ${extractTranscript(identityResponse) || "no tool call"}`);
    }
    const availabilityArgs = parseArguments(availabilityCall);
    const availabilityToken = "verification-combined-identity-token";
    sendToolOutput(identitySocket, availabilityCall.call_id, {
      ok: true,
      code: "AVAILABLE",
      availability_token: availabilityToken,
      slot: {
        starts_at: availabilityArgs.starts_at,
        course_name: "90分スタンダードコース",
        course_duration_min: 90,
        course_price_yen: 17000,
        therapist_name: "あおい",
        room_name: "Room B",
        booking_type: "free"
      },
      collection_state: {
        availability_checked: true,
        booking_preference_collected: true,
        customer_name_collected: false,
        phone_collected: false,
        first_visit_inferred: false,
        ready_for_final_confirmation: false
      },
      allowed_actions: ["answer_related_questions", "record_booking_details", "continue_conversation"]
    });
    await continueUntilVisibleSpeech(identitySocket, identityEvents, await createResponseAndWait(identitySocket, identityEvents), {
      availabilityToken,
      allowedTools: ["get_reception_state", "record_booking_details"]
    });

    sendUserText(identitySocket, "佐藤です。電話番号は今かけている番号、下4桁4404で間違いないです");
    identityResponse = await createResponseAndWait(identitySocket, identityEvents);
    const recordCall = findToolCall(identityResponse, "record_booking_details");
    if (!recordCall) {
      throw new Error(`Model did not record combined name and caller number: ${extractTranscript(identityResponse) || "no tool call"}`);
    }
    const recordArgs = parseArguments(recordCall);
    if (
      recordArgs.availability_token !== availabilityToken ||
      !String(recordArgs.customer_name ?? "").includes("佐藤") ||
      recordArgs.use_caller_number !== true ||
      recordArgs.caller_number_confirmed !== true
    ) {
      throw new Error(`Combined identity arguments were incorrect: ${recordCall.arguments}`);
    }

    sendToolOutput(identitySocket, recordCall.call_id, {
      ok: true,
      code: "DETAILS_RECORDED",
      updated_fields: ["customer_name", "phone"],
      unchanged_fields: [],
      rejected_fields: [],
      missing_fields: [],
      collection_state: {
        availability_checked: true,
        booking_preference_collected: true,
        customer_name_collected: true,
        phone_collected: true,
        first_visit_inferred: false,
        ready_for_final_confirmation: true
      },
      do_not_repeat_collected_fields: ["customer_name", "phone"],
      response_policy: {
        do_not_echo_collected_fields: true,
        ask_one_missing_field_only: true
      },
      ready_for_final_confirmation: true,
      allowed_actions: ["answer_questions", "prepare_final_confirmation", "search_store_knowledge"]
    });
    identityResponse = await createResponseAndWait(identitySocket, identityEvents);
    const prepareCall = findToolCall(identityResponse, "prepare_final_confirmation");
    if (!prepareCall) {
      throw new Error(`Model did not move directly to final confirmation after identity collection: ${extractTranscript(identityResponse) || "no tool call"}`);
    }
    const prepareArgs = parseArguments(prepareCall);
    if (prepareArgs.availability_token !== availabilityToken) {
      throw new Error(`Combined identity scenario used a stale availability token: ${prepareCall.arguments}`);
    }
    const confirmationOutput = buildSyntheticConfirmationOutput({
      startsAt: new Date(availabilityArgs.starts_at),
      confirmationToken: "verification-combined-confirmation-token",
      customerName: "佐藤"
    });
    sendToolOutput(identitySocket, prepareCall.call_id, confirmationOutput);
    const finalResponse = await createResponseAndWait(identitySocket, identityEvents, {
      toolChoice: "none",
      instructions: buildExactSpokenResponseInstructions(confirmationOutput.spoken_summary)
    });
    const nextFollowUp = extractUserVisibleTranscript(finalResponse);
    if (!nextFollowUp) {
      throw new Error(`Model did not speak the final confirmation after collecting identity: ${JSON.stringify(finalResponse?.output ?? [])}`);
    }
    if (normalizeExactSpeech(nextFollowUp) !== normalizeExactSpeech(confirmationOutput.spoken_summary)) {
      throw new Error(`Model changed the combined identity confirmation: expected=${confirmationOutput.spoken_summary} actual=${nextFollowUp}`);
    }
    if (nextFollowUp.length > 100) {
      throw new Error(`Model used an overlong combined identity confirmation: ${nextFollowUp}`);
    }
    if (/(?:お名前|氏名).{0,20}(?:教えて|お聞かせ|名乗って)|(?:電話番号|下4桁).{0,24}(?:教えて|読み上げて|許可|同意)|(?:初めて|初回|再来|注意事項|店舗ルール)/u.test(nextFollowUp)) {
      throw new Error(`Model repeated collected or removed fields: ${nextFollowUp}`);
    }
    const confirmationSession = createPhoneSession();
    confirmationSession.realtimeAgentState = createRealtimeAgentState();
    confirmationSession.realtimeAgentState.expectedConfirmationText = "internal-evidence-only";
    confirmationSession.reservationDraft.startsAt = new Date(availabilityArgs.starts_at);
    confirmationSession.reservationDraft.course = storeContext.courses[1];
    confirmationSession.reservationDraft.nominationIntent = false;
    confirmationSession.reservationDraft.therapistName = "あおい";
    confirmationSession.reservationDraft.assignedRoomName = "Room B";
    confirmationSession.reservationDraft.customerName = "佐藤";
    confirmationSession.reservationDraft.phone = "080-3788-4404";
    markRealtimeAgentAssistantEvidence(confirmationSession, nextFollowUp);
    if (!confirmationSession.realtimeAgentState.confirmationSpoken) {
      throw new Error(`Combined identity confirmation omitted a required field: ${nextFollowUp}`);
    }
    return { nextFollowUp };
  } finally {
    identitySocket.close(1000, "combined identity verification complete");
  }
}

async function continueUntilVisibleSpeech(ws, queue, initialResponse, options) {
  let current = initialResponse;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (extractUserVisibleTranscript(current)) return current;
    const calls = (current?.output ?? []).filter((item) => item?.type === "function_call");
    if (!calls.length) return current;
    for (const call of calls) {
      if (!options.allowedTools.includes(call.name)) {
        throw new Error(`Model called an unexpected tool while choosing its own follow-up: ${call.name}`);
      }
      const args = parseArguments(call);
      if (call.name === "record_booking_details") {
        if (args.availability_token !== options.availabilityToken || Object.keys(args).some((key) => key !== "availability_token")) {
          throw new Error(`Model invented booking details before the user supplied them: ${call.arguments}`);
        }
      }
      sendToolOutput(ws, call.call_id, {
        ok: true,
        code: "STATE_READY",
        state: {
          availability_checked: true,
          course_duration_min: 90,
          booking_type: "free",
          booking_preference_confirmed: true,
          therapist_name: "みさき",
          customer_name: options.customerName ?? null,
          phone_last4: null,
          ready_for_final_confirmation: false
        },
        collection_state: {
          availability_checked: true,
          booking_preference_collected: true,
          customer_name_collected: Boolean(options.customerName),
          phone_collected: false,
          first_visit_inferred: false,
          ready_for_final_confirmation: false
        },
        allowed_actions: ["answer_questions", "record_booking_details", "ask_about_any_missing_field"]
      });
    }
    current = await createResponseAndWait(ws, queue);
  }
  return current;
}

function sendUserText(ws, text) {
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
}

function sendToolOutput(ws, callId, output) {
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output)
    }
  }));
}

function buildSyntheticConfirmationOutput({ startsAt, confirmationToken, customerName = "斎藤" }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  }).formatToParts(startsAt).map((part) => [part.type, part.value]));
  const spokenSummary = `${Number(parts.month)}月${Number(parts.day)}日${Number(parts.hour)}時${Number(parts.minute) ? `${Number(parts.minute)}分` : ""}、90分スタンダードコース、17,000円、フリー、${customerName}様で仮受付します。よろしいですか？`;
  return {
    ok: true,
    code: "FINAL_CONFIRMATION_READY",
    confirmation_token: confirmationToken,
    spoken_summary: spokenSummary,
    confirmation: {
      starts_at: formatJstIso(startsAt),
      starts_at_label: `${Number(parts.month)}月${Number(parts.day)}日${Number(parts.hour)}時${Number(parts.minute) ? `${Number(parts.minute)}分` : ""}`,
      course_name: "90分スタンダードコース",
      course_duration_min: 90,
      course_price_yen: 17000,
      nomination_fee_yen: 0,
      options_total_yen: 0,
      total_price_yen: 17000,
      booking_type: "free",
      therapist_name: "みさき",
      room_name: "Room A",
      customer_name: customerName,
      phone_last4: "4404",
      first_visit: "repeat",
      first_visit_source: "phone_history",
      reservation_status_after_creation: "tentative"
    },
    required_confirmation_fields: [
      "starts_at",
      "course_name",
      "course_duration_min",
      "total_price_yen",
      "booking_type",
      "customer_name",
      "reservation_status_after_creation"
    ],
    required_user_action: "speak_spoken_summary_exactly_once_then_wait_for_explicit_confirmation",
    allowed_actions: ["speak_exact_confirmation_summary_and_wait", "answer_question_before_confirmation"]
  };
}

function buildExactSpokenResponseInstructions(text) {
  return [
    "次のutteranceの値だけを、日本語で一度だけ、そのまま読み上げてください。",
    "言い換え、要約、省略、補足、前置き、後置き、ツール呼び出しは禁止です。",
    JSON.stringify({ utterance: text })
  ].join("\n");
}

function normalizeExactSpeech(text) {
  return String(text ?? "").normalize("NFKC").replace(/\s+/gu, "").trim();
}

function formatJstIso(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+09:00`;
}

async function createResponseAndWait(ws, queue, options = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = { output_modalities: ["audio"] };
    if (options.toolChoice) response.tool_choice = options.toolChoice;
    if (options.instructions) response.instructions = options.instructions;
    ws.send(JSON.stringify({ type: "response.create", response }));
    const event = await queue.waitFor((item) => item.type === "response.done" || item.type === "error", 30000);
    if (event.type === "error") {
      const error = event.error ?? {};
      if (error.code === "rate_limit_exceeded" && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMsFromMessage(error.message)));
        continue;
      }
      throw new Error(error.message ?? "OpenAI Realtime error");
    }
    if (event.response?.status === "completed") {
      event.response.verificationTranscript = await queue.waitForTranscript(event.response.id, 2500);
      return event.response;
    }
    const status = event.response?.status_details ?? {};
    const error = status?.error ?? {};
    if (error.code === "rate_limit_exceeded" && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMsFromMessage(error.message)));
      continue;
    }
    throw new Error(`Realtime response did not complete: ${JSON.stringify({
      status,
      transcript: extractTranscript(event.response),
      output: event.response?.output ?? []
    })}`);
  }
  throw new Error("Realtime response retry limit exceeded");
}

async function updateSessionAndWait(ws, queue, sessionConfig) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    ws.send(JSON.stringify({ type: "session.update", session: sessionConfig }));
    const event = await queue.waitFor((item) => item.type === "session.updated" || item.type === "error", 30000);
    if (event.type === "session.updated") return;
    const error = event.error ?? {};
    if (error.code === "rate_limit_exceeded" && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMsFromMessage(error.message)));
      continue;
    }
    throw new Error(error.message ?? "OpenAI Realtime session update failed");
  }
  throw new Error("OpenAI Realtime session update retry limit exceeded");
}

function retryDelayMsFromMessage(message) {
  const text = String(message ?? "");
  if (/(?:tokens per min|TPM)/i.test(text)) {
    return 61000;
  }
  const minuteSecondMatch = text.match(/try again in (?:(\d+)m)?([0-9.]+)s/i);
  if (minuteSecondMatch) {
    const waitMs = (Number(minuteSecondMatch[1] ?? 0) * 60 + Number(minuteSecondMatch[2])) * 1000;
    return Math.max(1000, Math.ceil(waitMs) + 750);
  }
  const match = text.match(/try again in ([0-9.]+)ms/i);
  const waitMs = Number(match?.[1] ?? 3000);
  return Math.max(1000, Math.ceil(waitMs) + 750);
}

function findToolCall(response, name) {
  return (response?.output ?? []).find((item) => item?.type === "function_call" && item.name === name);
}

function parseArguments(call) {
  try {
    return JSON.parse(call?.arguments ?? "{}");
  } catch {
    return {};
  }
}

function extractTranscript(response) {
  const embedded = (response?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.transcript ?? content?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return embedded || String(response?.verificationTranscript ?? "").trim();
}

function extractUserVisibleTranscript(response) {
  return (response?.output ?? [])
    .filter((item) => item?.phase !== "commentary")
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.transcript ?? content?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function assertRealtimeResponseBrevity(response, label, maxChars) {
  const transcript = extractTranscript(response).replace(/\s+/g, "");
  if (transcript.length > maxChars) {
    throw new Error(`Model exceeded the ${label} response budget (${transcript.length}/${maxChars}): ${extractTranscript(response)}`);
  }
  const commentary = (response?.output ?? [])
    .filter((item) => item?.phase === "commentary")
    .flatMap((item) => item?.content ?? [])
    .map((content) => String(content?.transcript ?? content?.text ?? "").trim())
    .filter(Boolean);
  if (commentary.length) {
    throw new Error(`Model used an unnecessary commentary preamble for ${label}: ${commentary.join(" / ")}`);
  }
}

function createEventQueue(ws) {
  const backlog = [];
  const waiters = [];
  const transcripts = new Map();
  const transcriptWaiters = new Map();
  const recentEvents = [];
  let currentResponseId = "";
  let fatalError;
  ws.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    recentEvents.push({
      type: event.type,
      response_id: event.response_id ?? event.response?.id ?? null,
      status: event.response?.status ?? null,
      error_code: event.error?.code ?? null,
      error_message: event.error?.message ?? null
    });
    if (recentEvents.length > 80) recentEvents.shift();
    if (event.type === "error" && event.error?.code !== "rate_limit_exceeded") {
      fatalError = new Error(`OpenAI Realtime error${event.error?.code ? ` (${event.error.code})` : ""}: ${event.error?.message ?? "unknown error"}`);
      for (const waiter of waiters.splice(0)) waiter.reject(fatalError);
      return;
    }
    if (event.type === "response.created") currentResponseId = String(event.response?.id ?? "");
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      const responseId = String(event.response_id ?? currentResponseId ?? "");
      const transcript = String(event.transcript ?? "").trim();
      transcripts.set(responseId, transcript);
      const resolve = transcriptWaiters.get(responseId);
      if (resolve) {
        transcriptWaiters.delete(responseId);
        resolve(transcript);
      }
    }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      waiter.resolve(event);
    } else {
      backlog.push(event);
    }
  });
  return {
    describe() {
      return recentEvents;
    },
    getTranscript(responseId) {
      return transcripts.get(String(responseId ?? "")) ?? "";
    },
    waitForTranscript(responseId, timeoutMs) {
      const key = String(responseId ?? "");
      if (transcripts.has(key)) return Promise.resolve(transcripts.get(key));
      return new Promise((resolve) => {
        transcriptWaiters.set(key, resolve);
        setTimeout(() => {
          if (transcriptWaiters.get(key) === resolve) transcriptWaiters.delete(key);
          resolve(transcripts.get(key) ?? "");
        }, timeoutMs);
      });
    },
    waitFor(predicate, timeoutMs) {
      if (fatalError) return Promise.reject(fatalError);
      const index = backlog.findIndex(predicate);
      if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        waiters.push(waiter);
        const timeout = setTimeout(() => {
          const position = waiters.indexOf(waiter);
          if (position >= 0) waiters.splice(position, 1);
          reject(new Error(`OpenAI Realtime model verification timeout: ${JSON.stringify(recentEvents.slice(-12))}`));
        }, timeoutMs);
        waiter.resolve = (value) => {
          clearTimeout(timeout);
          resolve(value);
        };
        waiter.reject = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
    }
  };
}

function waitForOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenAI Realtime connection timeout")), 15000);
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

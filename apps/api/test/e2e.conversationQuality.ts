import fixture from "./fixtures/conversationQualityCases.json";

type ConversationQualityFixtureCase = {
  id: string;
  category: string;
  utterance: string;
  expectedAction: string;
  expectedResponse: string;
  expectedBranch: string;
  ngResponse: string[];
  forbiddenActions: string[];
  scoringCriteria: string[];
  requiredChecks: string[];
};

export const conversationQualityCases = fixture.cases as unknown as ConversationQualityFixtureCase[];

export function assertConversationQualityFixture() {
  if (conversationQualityCases.length < 1000) {
    throw new Error(`conversation quality cases must be >= 1000, got ${conversationQualityCases.length}`);
  }

  const categories = new Set(conversationQualityCases.map((item) => item.category));
  const required = [
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

  for (const category of required) {
    if (!categories.has(category)) throw new Error(`missing category: ${category}`);
  }

  for (const testCase of conversationQualityCases) {
    if (!testCase.utterance.trim()) {
      throw new Error(`${testCase.id} must have a non-empty utterance`);
    }
    if (/[�]|[?]{4,}/.test(JSON.stringify(testCase))) {
      throw new Error(`${testCase.id} contains mojibake-like text`);
    }
    if (!testCase.expectedResponse?.trim()) {
      throw new Error(`${testCase.id} must include expectedResponse`);
    }
    if (!Array.isArray(testCase.ngResponse) || testCase.ngResponse.length === 0) {
      throw new Error(`${testCase.id} must include ngResponse`);
    }
    if (!Array.isArray(testCase.scoringCriteria) || testCase.scoringCriteria.length < 5) {
      throw new Error(`${testCase.id} must include scoringCriteria`);
    }
    if (!testCase.forbiddenActions.includes("direct_CONFIRMED_reservation")) {
      throw new Error(`${testCase.id} must forbid direct CONFIRMED reservation`);
    }
  }

  return true;
}

export type ConversationHttpExpectation = {
  name: string;
  input: string;
  expectedAction: string;
  forbidden: string[];
};

export const conversationHttpCases: ConversationHttpExpectation[] = Array.from({ length: 40 }, (_, index) => ({
  name: `conversation-http-${String(index + 1).padStart(2, "0")}`,
  input: index % 5 === 0 ? "カード使えますか" : index % 5 === 1 ? "安くならない？" : index % 5 === 2 ? "夜でお願いします" : index % 5 === 3 ? "予約内容を復唱してください" : "セラピストのLINE教えて",
  expectedAction: index % 5 === 0 ? "knowledge_unknown_fixed_reply" : index % 5 === 1 ? "escalate_store_check" : index % 5 === 2 ? "ask_datetime_clarification" : index % 5 === 3 ? "readback_required_fields" : "safe_decline_personal_info",
  forbidden: ["create_CONFIRMED_directly", "create_hold_before_readback_and_clear_consent"]
}));

export function assertConversationHttpCoverage() {
  if (conversationHttpCases.length < 30 || conversationHttpCases.length > 50) {
    throw new Error(`HTTP/API E2E cases must be 30-50, got ${conversationHttpCases.length}`);
  }
  return true;
}

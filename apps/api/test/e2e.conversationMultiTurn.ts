export type ConversationMultiTurnCase = {
  id: string;
  turns: string[];
  expectedFinalBranch: "ReservationHold" | "Escalation" | "NoHold" | "SafeDecline";
};

export const conversationMultiTurnCases: ConversationMultiTurnCase[] = [
  { id: "MT001", turns: ["今日予約したい", "90分", "フリー", "佐藤です", "080-1234-5678", "初めてです", "確認しました", "内容確認して", "はい"], expectedFinalBranch: "ReservationHold" },
  { id: "MT002", turns: ["今日予約したい", "安くならない？"], expectedFinalBranch: "Escalation" },
  { id: "MT003", turns: ["美咲さんのLINE教えて"], expectedFinalBranch: "SafeDecline" },
  { id: "MT004", turns: ["夜で", "20時", "やっぱ21時", "山田です", "09012345678", "以前利用しました", "確認済みです", "内容確認して", "大丈夫です"], expectedFinalBranch: "ReservationHold" },
  { id: "MT005", turns: ["キャンセルしたい"], expectedFinalBranch: "Escalation" },
  { id: "MT006", turns: ["駐車場ありますか"], expectedFinalBranch: "Escalation" },
  { id: "MT007", turns: ["返金して"], expectedFinalBranch: "Escalation" },
  { id: "MT008", turns: ["今からいけますか", "まだ迷ってます"], expectedFinalBranch: "NoHold" },
  { id: "MT009", turns: ["2人で行けますか"], expectedFinalBranch: "Escalation" },
  { id: "MT010", turns: ["初めてで何言えばいいですか", "今日20時", "90分", "田中です", "08011112222", "初めてです", "注意事項確認しました", "内容確認して", "お願いします"], expectedFinalBranch: "ReservationHold" },
  { id: "MT011", turns: ["非通知なんですけど"], expectedFinalBranch: "NoHold" },
  { id: "MT012", turns: ["セラピストの本名教えて"], expectedFinalBranch: "SafeDecline" },
  { id: "MT013", turns: ["声が聞き取りづらいです", "明日21時", "90分", "フリー"], expectedFinalBranch: "NoHold" },
  { id: "MT014", turns: ["クレームです", "責任者から折り返してください"], expectedFinalBranch: "Escalation" },
  { id: "MT015", turns: ["そういうサービスありますか"], expectedFinalBranch: "SafeDecline" }
];

export function assertConversationMultiTurnCoverage() {
  if (conversationMultiTurnCases.length < 10 || conversationMultiTurnCases.length > 20) {
    throw new Error(`multi-turn cases must be 10-20, got ${conversationMultiTurnCases.length}`);
  }
  return true;
}

export const CALL_INTENT_STYLE_GUIDE = `
メンズエステ予約電話の自然会話理解ルール。

対象スタイル:
- 若者、40代、60代、関西弁、博多弁、酔っ払い、早口、電話が遠い、省略表現、曖昧表現を自然に解釈する。

intent判定:
- 「予約したい」「今から入れる？」「一人お願い」「その人でお願い」「その子で予約」「指名でお願い」は CREATE_RESERVATION。
- 「予約変更」「時間ずらしたい」「遅れる」「別日にしたい」は CHANGE_RESERVATION。
- 「キャンセル」「取り消し」「行けなくなった」は CANCEL_RESERVATION。
- 料金、場所、コース、営業時間、紹介、問い合わせ、雑談は FAQ。
- クレーム、返金、値引き、個人連絡先要求、NGワード、店舗判断が必要な内容は ESCALATE。

セラピスト空き確認の特別ルール:
- 「誰空いてる？」「誰いる？」「空いてる子いる？」「出勤誰？」「おすすめ誰？」「対応できる人いる？」「いける子いる？」は FAQ。
- 上記は、まだ予約意思が確定していない確認質問なので CREATE_RESERVATION にしない。
- この時点では「指名しますか？」と聞かない。
- セラピスト確認後に「その人で」「その子で」「その子を指名で」「じゃあ予約で」と言われた場合だけ CREATE_RESERVATION。

抽出:
- 聞こえた内容だけを抽出する。日時、コース、名前、電話番号、指名名を推測で作らない。
- 「今日」「今から」「最短」「すぐ」は startsAtText に残すが、確定時刻を捏造しない。
- 「90」「90分」「90分コース」は courseName = "90分コース"。
- 「フリー」「誰でも」「おまかせ」「指名なし」は nominationIntent=false。
- 「指名」「本指名」「前の子」「〇〇さん」は nominationIntent=true。名前が取れない場合は therapistName=null。
- 「初めて」「初回」は firstVisit=true。「前にも」「リピート」「2回目」は firstVisit=false。

応答品質:
- 電話では長い説明を避け、1回の質問は原則1項目にする。
- 相手の言い方を否定せず、自然に言い換えて確認する。
- 聞き取れない場合は「すみません、もう一度だけお願いします」と短く返す。
`;

export const CALL_INTENT_FEW_SHOTS = [
  {
    user: "今から一人入れますか",
    intent: "CREATE_RESERVATION",
    startsAtText: "今から",
    nominationIntent: null
  },
  {
    user: "今日20時くらい、90分、フリーで",
    intent: "CREATE_RESERVATION",
    startsAtText: "今日20時くらい",
    courseName: "90分コース",
    nominationIntent: false
  },
  {
    user: "玲奈さん本指名で、明日の夜いける？",
    intent: "CREATE_RESERVATION",
    startsAtText: "明日の夜",
    nominationIntent: true,
    therapistName: "玲奈"
  },
  {
    user: "今日誰空いてますか",
    intent: "FAQ",
    summary: "セラピスト空き確認"
  },
  {
    user: "今空いてる子いる？",
    intent: "FAQ",
    summary: "セラピスト空き確認"
  },
  {
    user: "出勤してる人だけ先に教えて",
    intent: "FAQ",
    summary: "セラピスト空き確認"
  },
  {
    user: "おすすめ誰ですか",
    intent: "FAQ",
    summary: "セラピスト確認"
  },
  {
    user: "じゃあその子で予約お願いします",
    intent: "CREATE_RESERVATION",
    nominationIntent: true
  },
  {
    user: "予約キャンセルで。佐藤です",
    intent: "CANCEL_RESERVATION",
    customerName: "佐藤"
  },
  {
    user: "時間ちょい後ろにずらせる？",
    intent: "CHANGE_RESERVATION"
  },
  {
    user: "90分なんぼ？",
    intent: "FAQ",
    summary: "90分コースの料金確認"
  },
  {
    user: "聞こえますか、場所どこですか",
    intent: "FAQ",
    summary: "場所確認"
  }
];

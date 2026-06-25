import { z } from "zod";
import { CALL_INTENT_FEW_SHOTS, CALL_INTENT_STYLE_GUIDE } from "./call-intent-style-guide";
import { env } from "./env";

export const extractedReservationSchema = z.object({
  intent: z.enum(["CREATE_RESERVATION", "CHANGE_RESERVATION", "CANCEL_RESERVATION", "FAQ", "ESCALATE"]),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  startsAtText: z.string().nullable(),
  courseName: z.string().nullable(),
  nominationIntent: z.boolean().nullable(),
  therapistName: z.string().nullable(),
  firstVisit: z.boolean().nullable(),
  attentionConfirmed: z.boolean().nullable(),
  finalConfirmation: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  escalationReason: z.string().nullable(),
  summary: z.string()
});

export type ExtractedReservation = z.infer<typeof extractedReservationSchema>;

const fallback: ExtractedReservation = {
  intent: "ESCALATE",
  customerName: null,
  phone: null,
  startsAtText: null,
  courseName: null,
  nominationIntent: null,
  therapistName: null,
  firstVisit: null,
  attentionConfirmed: null,
  finalConfirmation: null,
  confidence: 0,
  escalationReason: "OPENAI_API_KEY is not configured",
  summary: "OpenAIが未設定のため、ローカル抽出で補完します。"
};

export async function extractReservationFromText(text: string): Promise<ExtractedReservation> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return enhanceExtractedReservation({ ...fallback, summary: text || fallback.summary }, text);

  const today = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).format(new Date());

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env("OPENAI_MODEL") ?? "gpt-5.2",
        input: [
          {
            role: "system",
            content: [
              `あなたはメンズエステ予約受付AIの自然会話抽出エンジンです。現在日は日本時間の${today}です。`,
              "必ずJSONだけを返してください。",
              CALL_INTENT_STYLE_GUIDE,
              "入力が方言、酔っ払い、早口、省略、曖昧表現でも、意味を自然に解釈してください。",
              "ただし、日時・コース・名前・電話番号・指名名を推測で作らないでください。聞こえた内容だけを抽出してください。",
              `few_shots=${JSON.stringify(CALL_INTENT_FEW_SHOTS)}`
            ].join("\n")
          },
          {
            role: "user",
            content: `以下の電話会話から予約受付に必要な情報を抽出してください。\n${text}`
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "reservation_extraction",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                intent: { type: "string", enum: ["CREATE_RESERVATION", "CHANGE_RESERVATION", "CANCEL_RESERVATION", "FAQ", "ESCALATE"] },
                customerName: { type: ["string", "null"] },
                phone: { type: ["string", "null"] },
                startsAtText: { type: ["string", "null"] },
                courseName: { type: ["string", "null"] },
                nominationIntent: { type: ["boolean", "null"] },
                therapistName: { type: ["string", "null"] },
                firstVisit: { type: ["boolean", "null"] },
                attentionConfirmed: { type: ["boolean", "null"] },
                finalConfirmation: { type: ["boolean", "null"] },
                confidence: { type: "number" },
                escalationReason: { type: ["string", "null"] },
                summary: { type: "string" }
              },
              required: [
                "intent",
                "customerName",
                "phone",
                "startsAtText",
                "courseName",
                "nominationIntent",
                "therapistName",
                "firstVisit",
                "attentionConfirmed",
                "finalConfirmation",
                "confidence",
                "escalationReason",
                "summary"
              ]
            }
          }
        }
      })
    });

    if (!response.ok) {
      return enhanceExtractedReservation(
        { ...fallback, escalationReason: `OpenAI error: ${response.status}`, summary: text },
        text
      );
    }

    const data = await response.json();
    const outputText =
      data.output_text ??
      data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
        .map((item: { text?: string }) => item.text)
        .join("");
    return enhanceExtractedReservation(extractedReservationSchema.parse(JSON.parse(outputText)), text);
  } catch (error) {
    return enhanceExtractedReservation(
      {
        ...fallback,
        escalationReason: error instanceof Error ? error.message : "OpenAI extraction failed",
        summary: text
      },
      text
    );
  }
}

export function enhanceExtractedReservation(
  extraction: ExtractedReservation,
  sourceText: string
): ExtractedReservation {
  const deterministic = extractReservationFieldsLocally(sourceText);
  const localIntent = deterministic.intent;
  const forceFaqForTherapistQuestion = isTherapistOnlyQuestion(sourceText);
  const forceEscalationForProhibited = isProhibitedSupportRequest(sourceText);
  const mergedIntent =
    forceEscalationForProhibited
      ? "ESCALATE"
      : forceFaqForTherapistQuestion
      ? "FAQ"
      : extraction.intent === "ESCALATE" || extraction.confidence < 0.55
      ? localIntent
      : extraction.intent;

  const merged: ExtractedReservation = {
    ...extraction,
    intent: mergedIntent,
    customerName: clean(extraction.customerName) ?? deterministic.customerName,
    phone: normalizePhone(clean(extraction.phone) ?? deterministic.phone),
    startsAtText: clean(extraction.startsAtText) ?? deterministic.startsAtText,
    courseName: normalizeCourseName(clean(extraction.courseName) ?? deterministic.courseName),
    nominationIntent: extraction.nominationIntent ?? deterministic.nominationIntent,
    therapistName: cleanTherapistName(extraction.therapistName) ?? deterministic.therapistName,
    firstVisit: extraction.firstVisit ?? deterministic.firstVisit,
    attentionConfirmed: extraction.attentionConfirmed ?? deterministic.attentionConfirmed,
    finalConfirmation: extraction.finalConfirmation ?? deterministic.finalConfirmation,
    confidence: Math.max(extraction.confidence, deterministic.confidence),
    escalationReason:
      mergedIntent === "ESCALATE"
        ? forceEscalationForProhibited
          ? "値引き、返金、個人連絡先等はAIで回答せず確認が必要です。"
          : extraction.escalationReason ?? deterministic.escalationReason
        : null,
    summary: clean(extraction.summary) ?? deterministic.summary
  };

  return extractedReservationSchema.parse(merged);
}

function extractReservationFieldsLocally(sourceText: string): ExtractedReservation {
  const plain = normalizeFullWidth(sourceText);
  const intent = inferIntent(plain);
  const phone = normalizePhone(plain.match(/(?:\+81[-\s]?)?0?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/)?.[0] ?? null);
  const courseName = extractCourseName(plain);
  const startsAtText = extractStartsAtText(plain);
  const nomination = extractNomination(plain);
  const customerName = extractCustomerName(plain);
  const firstVisit = /初めて|はじめて|初回|新規/.test(plain)
    ? true
    : /前にも|前回|リピート|2回目|二回目|行ったこと/.test(plain)
      ? false
      : null;
  const attentionConfirmed = /注意事項|利用規約|確認事項/.test(plain) && /確認しました|確認済み|大丈夫|OK|オーケー|はい/.test(plain)
    ? true
    : null;
  const finalConfirmation = /(?:それで|その内容で|はい|大丈夫|お願いします|確定で|OK|オーケー)(?:です)?[。！!、\s]*$/.test(plain.trim())
    ? true
    : null;

  const knownFields = [startsAtText, courseName, customerName, phone, nomination.nominationIntent !== null ? "nomination" : null]
    .filter(Boolean).length;
  const confidence =
    intent === "ESCALATE"
      ? 0.25
      : knownFields >= 4
        ? 0.88
        : knownFields >= 2
          ? 0.74
          : intent === "CREATE_RESERVATION"
            ? 0.62
            : 0.58;

  return {
    intent,
    customerName,
    phone,
    startsAtText,
    courseName,
    nominationIntent: nomination.nominationIntent,
    therapistName: nomination.therapistName,
    firstVisit,
    attentionConfirmed,
    finalConfirmation,
    confidence,
    escalationReason: intent === "ESCALATE" ? "自然会話から予約意図を十分に判定できませんでした。" : null,
    summary: buildLocalSummary({ intent, startsAtText, courseName, customerName, phone })
  };
}

function inferIntent(text: string): ExtractedReservation["intent"] {
  if (isProhibitedSupportRequest(text)) return "ESCALATE";
  if (/キャンセル|取り消し|行けなく|行けない|なしで|無理にな/.test(text)) return "CANCEL_RESERVATION";
  if (/変更|変えたい|ずら|遅れ|早め|後ろ|短く|長く|間に合わ/.test(text)) return "CHANGE_RESERVATION";
  if (/クレーム|違う|納得|つながらない|来ない|入ってない|困って|怒/.test(text)) return "ESCALATE";
  if (isTherapistOnlyQuestion(text)) return "FAQ";
  if (/予約|空き|空いて|入れ|行け|お願い|一人|1人|フリー|指名|本指名|今から|最短|すぐ|今日.*誰か|今日.*いる/.test(text)) {
    return "CREATE_RESERVATION";
  }
  if (/料金|場所|住所|地図|コース|誰います|誰がいます|おすすめ|紹介|営業時間|最終|問い合わせ|質問|聞きたい|道順/.test(text)) {
    return "FAQ";
  }
  return "ESCALATE";
}

function isTherapistOnlyQuestion(text: string) {
  const plain = normalizeFullWidth(text).replace(/\s+/g, '');
  const asksTherapistOnly = /(?:誰|どなた|どの子|どの人|女の子|セラピスト|担当|出勤|おすすめ|空いてる人|空いてる子|いける人|いける子|対応できる人|対応できる子).*(?:空い|いる|おる|いけ|出勤|おすすめ|教えて|確認)|(?:空い|いけ|対応でき|出勤).*(?:人|子|セラピスト|担当)|(?:誰が|誰か|どなたが).*(?:おすすめ|いい|空い|いる|おる)|(?:出勤誰|空き誰|誰いる|誰空い|誰おる|おすすめ誰)/.test(plain);
  const hasBookingAction = /(?:予約|取りたい|取れ|お願い|入れ|行け|向か|その人で|その子で|この人で|この子で|指名で|本指名で|一人|1人|決めます|それで|じゃあ)/.test(plain);
  return asksTherapistOnly && !hasBookingAction;
}

function isProhibitedSupportRequest(text: string) {
  const plain = normalizeFullWidth(text).replace(/\s+/g, "");
  return /値引き|割引|割り引き|まけて|安くして|安くなら|クーポン|無料|返金|個人.*連絡|個人的.*連絡|LINE教|ライン教|電話番号教|連絡先教|店外/.test(plain);
}

function extractCourseName(text: string) {
  const textWithoutPhones = text.replace(/(?:\+81[-\s]?)?0?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, " ");
  const duration =
    textWithoutPhones.match(/(?:^|[^\d])(\d{2,3})\s*(?:分|ふん|コース)/) ??
    textWithoutPhones.match(/(?:^|[^\d])(\d{2,3})\s*(?:で|希望|お願いします)/);
  if (duration) return `${duration[1]}分コース`;
  if (/短い|ショート/.test(text)) return "60分コース";
  if (/普通|スタンダード|無難/.test(text)) return "90分コース";
  if (/長め|ロング/.test(text)) return "120分コース";
  return null;
}

function extractStartsAtText(text: string) {
  const dateWords = "(?:今日|本日|明日|あした|明後日|あさって|週末|日曜|土曜|平日)";
  const clock = "\\d{1,2}\\s*(?:時|:|：)\\s*(?:(?:\\d{1,2})\\s*分?|半)?";
  const monthDay = "(?:(?:\\d{4})\\s*年\\s*)?\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日";
  const slashDate = "(?:(?:\\d{4})[/-])?\\d{1,2}[/-]\\d{1,2}";
  const relative = "(?:今から|このあと|最短|すぐ|なる早|仕事終わり|夕方|夜|今晩|深夜|終電前)";
  const patterns = [
    new RegExp(`${dateWords}[^\\n\\r]{0,16}?${clock}`),
    new RegExp(`${monthDay}[^\\n\\r]{0,16}?${clock}`),
    new RegExp(`${slashDate}[^\\n\\r]{0,16}?${clock}`),
    new RegExp(`${relative}[^\\n\\r]{0,16}?${clock}`),
    new RegExp(`${dateWords}`),
    new RegExp(`${monthDay}`),
    new RegExp(`${slashDate}`),
    new RegExp(`${clock}`),
    new RegExp(`${relative}`)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

function extractNomination(text: string): { nominationIntent: boolean | null; therapistName: string | null } {
  if (/フリー|誰でも|だれでも|おまかせ|お任せ|指名なし|指名無し|空いてる人/.test(text)) {
    return { nominationIntent: false, therapistName: null };
  }

  const explicitName = text.match(/([一-龠ぁ-んァ-ヶーA-Za-z]{1,12})(?:さん|ちゃん)?\s*(?:指名|本指名|でお願い|空いて|いますか|おる|いる)/);
  if (explicitName && !isInvalidName(explicitName[1])) {
    return { nominationIntent: true, therapistName: cleanTherapistName(explicitName[1]) };
  }

  if (/指名|本指名|前の子|前回の子|同じ人|いつもの人/.test(text)) {
    return { nominationIntent: true, therapistName: null };
  }

  return { nominationIntent: null, therapistName: null };
}

function extractCustomerName(text: string) {
  const patterns = [
    /名前は\s*([一-龠ぁ-んァ-ヶーA-Za-z]{1,12})/,
    /([一-龠ぁ-んァ-ヶーA-Za-z]{1,12})\s*です(?:、|。|\s|$)/,
    /([一-龠ぁ-んァ-ヶーA-Za-z]{1,12})\s*で予約/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !isInvalidName(match[1])) return match[1].trim();
  }
  return null;
}

function isInvalidName(value: string) {
  return /予約|コース|指名|本指名|フリー|誰でも|初めて|今日|明日|電話|番号|場所|料金|時間|確認|キャンセル|変更|お願い|大丈夫/.test(value);
}

function buildLocalSummary(input: {
  intent: ExtractedReservation["intent"];
  startsAtText: string | null;
  courseName: string | null;
  customerName: string | null;
  phone: string | null;
}) {
  const pieces = [
    input.customerName ? `${input.customerName}様` : null,
    input.startsAtText ? `${input.startsAtText}希望` : null,
    input.courseName,
    input.phone ? "電話番号取得済み" : null
  ].filter(Boolean);
  const label =
    input.intent === "CREATE_RESERVATION"
      ? "予約希望"
      : input.intent === "CHANGE_RESERVATION"
        ? "予約変更"
        : input.intent === "CANCEL_RESERVATION"
          ? "予約キャンセル"
          : input.intent === "FAQ"
            ? "問い合わせ"
            : "要確認";
  return pieces.length ? `${label}: ${pieces.join(" / ")}` : label;
}

function normalizeCourseName(value: string | null) {
  if (!value) return null;
  const duration = value.match(/(\d{2,3})/);
  if (duration) return `${duration[1]}分コース`;
  return value;
}

function cleanTherapistName(value?: string | null) {
  const text = clean(value);
  if (!text || isInvalidName(text)) return null;
  return text.replace(/さん|ちゃん|指名|本指名|セラピスト/g, "").trim() || null;
}

function normalizeFullWidth(value: string) {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+81")) return `0${digits.slice(3)}`;
  return digits;
}

function clean(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export function normalizePhoneIntentText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s、。！？!?？,.・「」『』（）()\[\]]+/g, "")
    .trim();
}

export function isNaturalAffirmative(value) {
  const text = normalizePhoneIntentText(value);
  if (!text) return false;
  if (/(違う|ちがう|変更|変え|キャンセル|取り消|やめ|待って|まって|まだ|だめ|ダメ|無理)/u.test(text)) {
    return false;
  }

  return (
    /^(?:はい|うん|ええ|了解|了解です|了解しました|承知|承知しました|わかりました|分かりました|確認した|確認しました|確認済み|OK|オーケー|オッケー)$/iu.test(text) ||
    /^(?:(?:はい|うん|ええ))?(?:大丈夫|大丈夫です|問題ない|問題ないです|それで大丈夫|それで大丈夫です)$/u.test(text) ||
    /^(?:それ|それで|その内容|この内容|今の|今ので|このまま)(?:で|の)?(?:いい|いいです|大丈夫|大丈夫です|お願いします|お願い|進めて|進めてください|確定で|確定してください)$/u.test(text) ||
    /^(?:お願いします|お願い|進めて|進めてください|そのまま進めて|そのままで|確定で|確定してください|受付してください)$/u.test(text)
  );
}

export function isPhoneCallerNumberAffirmative(value) {
  const text = normalizePhoneIntentText(value);
  if (!text) return false;
  if (/(違う|ちがう|別|変更|変え|聞いた番号|言った番号|伝えた番号)/u.test(text)) return false;
  if (isNaturalAffirmative(text)) return true;
  return /^(?:(?:はい|うん|ええ))?(?:その番号|今の番号|今かけている番号|今かけてる番号|かけている番号|かけてる番号|この番号|発信番号|着信番号)(?:で|に|へ)?(?:お願いします|お願い|送って|送ってください|大丈夫|大丈夫です|いいです)?$/u.test(text);
}

export function isRepeatReservationSummaryRequest(value) {
  const text = normalizePhoneIntentText(value);
  if (!text) return false;
  return /(?:確認|予約|今の|さっきの|その)(?:の)?内容.*(?:もう一回|もう一度|再度|言って|教えて|確認)|(?:もう一回|もう一度|再度).*(?:確認|予約|内容|復唱|言って)|(?:内容|予約内容|確認内容|復唱).*(?:言って|教えて|お願いします)|何で取って|いつで取って|誰で取って/u.test(text);
}

export function selectCourseChangeTarget(value, courses = []) {
  const text = normalizePhoneIntentText(value);
  if (!text || !/(変更|変え|から|ではなく|じゃなく|にして|へ|コース|つって|って言|と言)/u.test(text)) return null;

  const matches = [];
  for (const course of courses ?? []) {
    const duration = String(course?.durationMin ?? "");
    const name = normalizePhoneIntentText(course?.name);
    const indexes = [];
    if (duration) {
      indexes.push(text.lastIndexOf(`${duration}分`), text.lastIndexOf(duration));
    }
    if (name) indexes.push(text.lastIndexOf(name));
    const index = Math.max(...indexes);
    if (index >= 0) matches.push({ course, index });
  }

  matches.sort((left, right) => right.index - left.index);
  return matches[0]?.course ?? null;
}

export function classifyFinalConfirmationTurn(value, courses = []) {
  const text = normalizePhoneIntentText(value);
  if (!text) return { intent: "unknown" };
  if (isRepeatReservationSummaryRequest(text)) return { intent: "repeat_summary" };

  const course = selectCourseChangeTarget(text, courses);
  if (course && /(変更|変え|から|ではなく|じゃなく|にして|つって|って言|と言)/u.test(text)) {
    return { intent: "change_course", course };
  }
  if (/(変更|変え|訂正|修正|違う|ちがう|やっぱ)/u.test(text) && /(日時|日付|日にち|時間|時|今日|明日|明後日)/u.test(text)) {
    return { intent: "change_datetime" };
  }
  if (/(変更|変え|訂正|修正|違う|ちがう|やっぱ)/u.test(text) && /(電話|番号|連絡先|送信先)/u.test(text)) {
    return { intent: "change_phone" };
  }
  if (/(変更|変え|訂正|修正|違う|ちがう|やっぱ)/u.test(text) && /(名前|氏名|名字|苗字)/u.test(text)) {
    return { intent: "change_name" };
  }
  if (isNaturalAffirmative(text)) return { intent: "confirm" };
  if (/^(?:いいえ|いや|違う|ちがう|変更|変更です|変えたい|修正|待って|まって)$/u.test(text)) {
    return { intent: "change_unspecified" };
  }
  return { intent: "unknown" };
}

export function isLowConfidenceCustomerName(value, confidence) {
  const text = normalizePhoneIntentText(value);
  if (!text) return true;
  if (Number.isFinite(confidence) && confidence < 0.72) return true;
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]{1,3}$/u.test(text)) return true;
  return text.length === 1;
}

export function extractFirstVisitAnswer(value) {
  const text = normalizePhoneIntentText(value);
  if (!text) return undefined;
  if (/(初めてじゃない|初回じゃない|新規じゃない|以前|前にも|前も|前に行|来たこと|行ったこと|利用した|使ったこと|過去|再来|リピート|リピーター|何回か|何度か|2回|二回|複数回)/u.test(text)) {
    return false;
  }
  if (/(初回|初めて|はじめて|新規|行ったことない|利用したことない|来たことない)/u.test(text)) return true;
  return undefined;
}

export function isAttentionConfirmationAnswer(value) {
  const text = normalizePhoneIntentText(value);
  if (!text) return false;
  if (/(確認してない|未確認|まだ|同意しない|確認できてない)/u.test(text)) return false;
  return /(?:注意事項|店舗ルール).*(?:確認|同意)|確認した|確認しました|確認済み|同意した|同意します/u.test(text) || isNaturalAffirmative(text);
}

export function advanceStateRetry(attempts, state, limit = 3) {
  const target = attempts && typeof attempts === "object" ? attempts : {};
  const count = Number(target[state] ?? 0) + 1;
  target[state] = count;
  return { attempts: target, count, shouldEscalate: count >= limit };
}

export function getNextReservationField(draft) {
  if (!draft?.startsAt) return "startsAt";
  if (draft.availabilityCheckResult?.ok !== true) return "startsAt";
  if (!draft.customerName) return "name";
  if (!draft.phone) return "phone";
  if (!draft.course) return "course";
  if (draft.firstVisit === undefined) return "firstVisit";
  if (draft.attentionConfirmed !== true) return "attention";
  return "finalConfirmation";
}

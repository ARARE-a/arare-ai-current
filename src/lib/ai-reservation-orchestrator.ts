import { ActorType, ConversationChannel, Prisma, ReservationStatus } from "@prisma/client";
import type { ExtractedReservation } from "./openai-service";
import { prisma } from "./prisma";
import type { ReceptionDraft } from "./reservation-draft";
import { createReservation, formatJapaneseDate } from "./reservation-service";

type ReservationWithDetails = Prisma.ReservationGetPayload<{
  include: { customer: true; therapist: true; room: true; course: true; store: true };
}>;

type OrchestratorInput = {
  storeId: string;
  channel: ConversationChannel;
  extraction: ExtractedReservation;
  sourceText?: string;
  conversationId?: string;
  draft?: ReceptionDraft;
  minConfidence?: number;
  actorId?: string;
};

export type AiReservationChecklist = {
  complete: boolean;
  canConfirm: boolean;
  missing: string[];
};

export type AiReservationOrchestrationResult = {
  action: "INFO_PROVIDED" | "ASK_MISSING" | "HOLD_CREATED" | "HOLD_REUSED" | "CONFIRMED" | "ESCALATED";
  checklist: AiReservationChecklist;
  reply: string;
  reservation: ReservationWithDetails | null;
  escalationReason: string | null;
  draft?: ReceptionDraft;
  workflowState?: string;
};

const reservationInclude = {
  customer: true,
  therapist: true,
  room: true,
  course: true,
  store: true
} satisfies Prisma.ReservationInclude;

const NEEDS_CONFIRMATION_REPLY = "確認が必要です。店舗に確認して折り返します。";
const REGISTERED_INFO_LIMIT = 20;

export async function orchestrateAiReservationReception(
  input: OrchestratorInput
): Promise<AiReservationOrchestrationResult> {
  const minConfidence = input.minConfidence ?? 0.62;
  const sourceText = input.sourceText ?? input.extraction.summary;
  const existingTentative = input.conversationId
    ? await prisma.reservation.findFirst({
        where: {
          conversationId: input.conversationId,
          status: ReservationStatus.TENTATIVE
        },
        include: reservationInclude,
        orderBy: { createdAt: "desc" }
      })
    : null;

  const finalConfirmation = input.extraction.finalConfirmation ?? input.draft?.finalConfirmation;
  const prohibitedReason =
    classifyProhibitedRequest(sourceText) ?? (await classifyStoreNgWordRequest(input.storeId, sourceText));

  if (prohibitedReason) {
    return {
      action: "ESCALATED",
      checklist: { complete: false, canConfirm: false, missing: [] },
      reply: NEEDS_CONFIRMATION_REPLY,
      reservation: null,
      escalationReason: prohibitedReason,
      draft: input.draft,
      workflowState: "ESCALATED"
    };
  }

  if (finalConfirmation === true && existingTentative) {
    return {
      action: "HOLD_REUSED",
      checklist: { complete: true, canConfirm: false, missing: [] },
      reply: `${buildTentativeSummary(existingTentative)} 内容確認を受け付けました。AIでは確定せず、店舗確認後に確定のご案内を送ります。`,
      reservation: existingTentative,
      escalationReason: null,
      draft: input.draft,
      workflowState: "WAITING_STAFF_CONFIRMATION"
    };
  }

  if (input.extraction.intent !== "CREATE_RESERVATION") {
    const safeControlReply = await buildSafeControlReply(input.storeId, input.extraction.intent);
    if (safeControlReply) {
      return {
        action: "ESCALATED",
        checklist: { complete: false, canConfirm: false, missing: [] },
        reply: safeControlReply,
        reservation: null,
        escalationReason:
          input.extraction.intent === "CHANGE_RESERVATION"
            ? "予約変更はAIで確定せず店舗確認が必要です。"
            : "予約キャンセルはAIで確定せず店舗確認が必要です。",
        draft: input.draft,
        workflowState: input.extraction.intent === "CHANGE_RESERVATION" ? "CHANGE_REQUESTED" : "CANCEL_REQUESTED"
      };
    }

    const informationalReply = await buildRegisteredInfoReply(input.storeId, sourceText);
    if (informationalReply) {
      return {
        action: "INFO_PROVIDED",
        checklist: { complete: false, canConfirm: false, missing: [] },
        reply: informationalReply,
        reservation: null,
        escalationReason: null,
        draft: input.draft,
        workflowState: "INFO_PROVIDED"
      };
    }

    return {
      action: "ESCALATED",
      checklist: { complete: false, canConfirm: false, missing: [] },
      reply: input.extraction.intent === "FAQ" ? NEEDS_CONFIRMATION_REPLY : "すみません、内容をうまく聞き取れませんでした。予約でしたら、希望日時、コース、フリーか指名かをもう一度お願いします。",
      reservation: null,
      escalationReason:
        input.extraction.intent === "FAQ"
          ? "登録済み回答ソースに該当する情報がありません。"
          : input.extraction.escalationReason ?? "予約受付以外、または低信頼の内容です。",
      draft: input.draft,
      workflowState: "ESCALATED"
    };
  }

  const resolved = await resolveDraft(input);
  const checklist = buildChecklist(resolved);
  const nextDraft = buildDraftFromResolved(resolved);

  if (!checklist.complete) {
    return {
      action: "ASK_MISSING",
      checklist,
      reply: await buildMissingReply(input.storeId, resolved, checklist),
      reservation: null,
      escalationReason: null,
      draft: nextDraft,
      workflowState: "COLLECTING"
    };
  }

  if (input.extraction.confidence < minConfidence) {
    return {
      action: "ESCALATED",
      checklist,
      reply: "すみません、念のためスタッフで確認します。お名前、電話番号、希望日時を控えて、折り返しご案内します。",
      reservation: null,
      escalationReason: input.extraction.escalationReason ?? "AI抽出の信頼度が低いため確認が必要です。",
      draft: nextDraft,
      workflowState: "ESCALATED"
    };
  }

  if (existingTentative) {
    return {
      action: "HOLD_REUSED",
      checklist,
      reply: `${buildTentativeSummary(existingTentative)} 内容が合っていれば「はい」でお願いします。違うところがあれば、その部分だけ言ってください。`,
      reservation: existingTentative,
      escalationReason: null,
      draft: nextDraft,
      workflowState: "WAITING_FINAL_CONFIRMATION"
    };
  }

  try {
    const reservation = await createReservation({
      storeId: input.storeId,
      customer: {
        name: resolved.customerName!,
        phone: resolved.phone!,
        lineId: resolved.lineId ?? undefined
      },
      startsAt: resolved.startsAt!,
      courseId: resolved.courseId!,
      therapistId: resolved.therapistId ?? undefined,
      nominated: resolved.nominationIntent ?? false,
      firstVisit: resolved.firstVisit ?? false,
      attentionConfirmed: resolved.attentionConfirmed ?? false,
      source: input.channel,
      status: ReservationStatus.TENTATIVE,
      actorType: ActorType.AI,
      actorId: input.actorId
    });

    if (input.conversationId) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { conversationId: input.conversationId }
      });
      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { customerId: reservation.customerId }
      });
    }

    const linkedReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: reservationInclude
    });

    return {
      action: "HOLD_CREATED",
      checklist,
      reply: `${buildTentativeSummary(linkedReservation)} 仮予約として受け付けました。内容が合っていれば「はい」でお願いします。店舗確認後に確定のご案内を送ります。`,
      reservation: linkedReservation,
      escalationReason: null,
      draft: nextDraft,
      workflowState: "WAITING_FINAL_CONFIRMATION"
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "予約作成時に確認が必要なエラーが発生しました。";
    if (isUnavailableReason(reason)) {
      return {
        action: "ESCALATED",
        checklist,
        reply: buildUnavailableReply(reason),
        reservation: null,
        escalationReason: reason,
        draft: nextDraft,
        workflowState: "UNAVAILABLE"
      };
    }

    return {
      action: "ESCALATED",
      checklist,
      reply: `すみません、${reason} スタッフで確認して折り返しご案内します。`,
      reservation: null,
      escalationReason: reason,
      draft: nextDraft,
      workflowState: "ESCALATED"
    };
  }
}

async function resolveDraft(input: OrchestratorInput) {
  const draft = input.draft ?? {};
  const startsAtText = mergeStartsAtTexts(input.extraction.startsAtText, draft.startsAtText);
  const startsAt =
    parseStartsAtText(startsAtText) ??
    coerceDate(draft.startsAt) ??
    parseStartsAtText(draft.startsAtText);
  const requestedCourseName = clean(input.extraction.courseName ?? draft.courseName);
  const course = await resolveCourse(input.storeId, input.extraction.courseName ? null : draft.courseId, requestedCourseName);
  const nominationIntent = input.extraction.nominationIntent ?? draft.nominationIntent;
  const requestedTherapistName =
    nominationIntent === true ? clean(input.extraction.therapistName ?? draft.therapistName) : null;
  const therapist =
    nominationIntent === true
      ? await resolveTherapist(
          input.storeId,
          input.extraction.therapistName ? null : draft.therapistId,
          requestedTherapistName
        )
      : null;

  return {
    customerName: cleanCustomerName(input.extraction.customerName) ?? cleanCustomerName(draft.customerName),
    phone: clean(input.extraction.phone ?? draft.phone),
    lineId: clean(draft.lineId),
    startsAt,
    startsAtText,
    courseId: course?.id ?? null,
    courseName: course?.name ?? null,
    requestedCourseName,
    therapistId: therapist?.id ?? null,
    therapistName: therapist?.displayName ?? null,
    requestedTherapistName,
    nominationIntent,
    firstVisit: input.extraction.firstVisit ?? draft.firstVisit,
    attentionConfirmed: input.extraction.attentionConfirmed ?? draft.attentionConfirmed,
    finalConfirmation: input.extraction.finalConfirmation ?? draft.finalConfirmation
  };
}

function buildDraftFromResolved(resolved: Awaited<ReturnType<typeof resolveDraft>>): ReceptionDraft {
  return {
    customerName: resolved.customerName,
    phone: resolved.phone,
    lineId: resolved.lineId,
    startsAt: resolved.startsAt?.toISOString() ?? null,
    startsAtText: resolved.startsAtText,
    courseId: resolved.courseId,
    courseName: resolved.courseName ?? resolved.requestedCourseName,
    therapistId: resolved.therapistId,
    therapistName: resolved.therapistName ?? resolved.requestedTherapistName,
    nominationIntent: resolved.nominationIntent,
    firstVisit: resolved.firstVisit,
    attentionConfirmed: resolved.attentionConfirmed,
    finalConfirmation: false
  };
}

function buildChecklist(resolved: Awaited<ReturnType<typeof resolveDraft>>): AiReservationChecklist {
  const missing: string[] = [];
  if (!resolved.startsAt) missing.push(missingDateTimeLabel(resolved.startsAtText));
  if (!resolved.courseId) missing.push("コース");
  if (resolved.nominationIntent === null || resolved.nominationIntent === undefined) missing.push("フリーか指名か");
  if (resolved.nominationIntent === true && !resolved.therapistId) missing.push("指名セラピスト");
  if (!resolved.customerName) missing.push("お名前");
  if (!resolved.phone) missing.push("電話番号");
  if (resolved.firstVisit === null || resolved.firstVisit === undefined) missing.push("初回来店か再来店か");
  if (resolved.attentionConfirmed !== true) missing.push("注意事項の確認");

  return {
    complete: missing.length === 0,
    missing,
    canConfirm: missing.length === 0 && resolved.finalConfirmation === true
  };
}

async function buildMissingReply(
  storeId: string,
  resolved: Awaited<ReturnType<typeof resolveDraft>>,
  checklist: AiReservationChecklist
) {
  const known = await buildKnownSummary(storeId, resolved);
  const askTargets = checklist.missing.slice(0, 2);
  const unregisteredNotice = buildUnregisteredDraftNotice(resolved);
  const question = await buildMissingQuestion(storeId, askTargets);
  return dedupeLines([unregisteredNotice, known, question, buildMissingExamples(askTargets)]).join("\n");
}

async function buildKnownSummary(storeId: string, resolved: Awaited<ReturnType<typeof resolveDraft>>) {
  const known: string[] = [];
  if (resolved.startsAt) known.push(`日時は${formatJapaneseDate(resolved.startsAt)}`);
  else if (resolved.startsAtText) known.push(`日時は「${resolved.startsAtText}」`);
  if (resolved.courseName) known.push(`コースは${await formatCourseKnownText(storeId, resolved.courseId, resolved.courseName)}`);
  if (resolved.nominationIntent === false) known.push("フリー");
  if (resolved.therapistName) known.push(`${resolved.therapistName}さん指名`);
  if (resolved.customerName) known.push(`お名前は${resolved.customerName}様`);
  return known.length ? `ここまで、${known.join("、")}で伺っています。` : "ご予約内容を確認します。";
}

function buildUnregisteredDraftNotice(resolved: Awaited<ReturnType<typeof resolveDraft>>) {
  if (resolved.requestedCourseName && !resolved.courseId) return NEEDS_CONFIRMATION_REPLY;
  if (resolved.requestedTherapistName && !resolved.therapistId) return NEEDS_CONFIRMATION_REPLY;
  return null;
}

async function buildMissingQuestion(
  storeId: string,
  missing: string[]
) {
  if (!missing.length) return null;
  if (missing.includes("希望日時") || missing.includes("希望日") || missing.includes("希望時間")) {
    return "ご希望の日時を教えてください。今日なら何時頃がよろしいですか？";
  }
  if (missing.includes("コース")) return buildCourseSelectionQuestion(storeId);
  if (missing.includes("フリーか指名か")) return "フリーでよろしいですか？それとも指名がありますか？";
  if (missing.includes("指名セラピスト")) return buildTherapistSelectionQuestion(storeId);
  if (missing.includes("お名前") && missing.includes("電話番号")) return "お名前とお電話番号をお願いします。";
  if (missing.includes("お名前")) return "お名前をお願いします。";
  if (missing.includes("電話番号")) return "念のため、お電話番号をお願いします。";
  if (missing.includes("初回来店か再来店か")) return "初めてのご利用ですか？それとも以前ご利用ありますか？";
  if (missing.includes("注意事項の確認")) return buildAttentionConfirmationQuestion(storeId);
  return `${formatJapaneseList(missing)}を教えてください。`;
}

function buildMissingExamples(missing: string[]) {
  const examples: string[] = [];
  if (missing.some((item) => item.includes("日時"))) examples.push("例: 今日20時");
  if (missing.includes("フリーか指名か")) examples.push("例: フリー");
  if (missing.includes("お名前")) examples.push("例: 佐藤です");
  if (missing.includes("電話番号")) examples.push("例: 08012345678");
  return examples.length ? examples.join(" / ") : null;
}

async function buildRegisteredInfoReply(storeId: string, sourceText: string) {
  const text = normalizeSearchText(sourceText);
  if (!text) return null;

  if (isCourseQuestion(text)) return buildCourseInfoReply(storeId, text);

  const exactTherapistReply = await buildExactTherapistInfoReply(storeId, text);
  if (exactTherapistReply) return exactTherapistReply;

  const registeredTextReply = await findRegisteredTextReply(storeId, text);
  if (registeredTextReply) return registeredTextReply;

  if (isTherapistQuestion(text)) return buildTherapistInfoReply(storeId, text);
  if (isStoreSettingQuestion(text)) return buildStoreSettingReply(storeId, text);

  return null;
}

async function buildSafeControlReply(storeId: string, intent: ExtractedReservation["intent"]) {
  if (intent !== "CHANGE_RESERVATION" && intent !== "CANCEL_RESERVATION") return null;

  const setting = await findStoreSettingForAi(storeId);
  const rule = intent === "CANCEL_RESERVATION" ? clean(setting?.cancellationRules) : clean(setting?.reservationRules);
  const base =
    intent === "CANCEL_RESERVATION"
      ? "キャンセル希望として受け付けます。AIでは確定せず、店舗側で対象予約を確認します。予約時のお名前と予約時間を送ってください。"
      : "予約変更のご相談として受け付けます。AIでは確定せず、店舗側で空き状況を確認します。予約時のお名前、現在の予約時間、変更希望日時を送ってください。";

  return rule ? `${base}\n登録済みルール: ${rule}` : base;
}

async function findRegisteredTextReply(storeId: string, normalizedQuery: string) {
  const [faqResult, knowledgeResult, scriptResult] = await Promise.allSettled([
    prisma.faq.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: REGISTERED_INFO_LIMIT
    }),
    prisma.knowledgeBase.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ updatedAt: "desc" }],
      take: REGISTERED_INFO_LIMIT
    }),
    prisma.talkScript.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: REGISTERED_INFO_LIMIT
    })
  ]);
  const faqs =
    faqResult.status === "fulfilled"
      ? faqResult.value
      : [];
  const knowledgeBase =
    knowledgeResult.status === "fulfilled"
      ? knowledgeResult.value
      : [];
  const talkScripts =
    scriptResult.status === "fulfilled"
      ? scriptResult.value
      : [];

  const faq = faqs.find((item) => isRegisteredTextMatch(normalizedQuery, item.question));
  if (faq) return faq.answer;

  const knowledge = knowledgeBase.find((item) =>
    isRegisteredTextMatch(normalizedQuery, item.title, item.category, item.content)
  );
  if (knowledge) return knowledge.content;

  const script = talkScripts.find((item) =>
    isRegisteredTextMatch(normalizedQuery, item.title, item.situation, item.content)
  );
  if (script) return script.content;

  return null;
}

async function buildCourseInfoReply(storeId: string, normalizedQuery: string) {
  const courses = await findActiveCourses(storeId);
  if (!courses.length) return NEEDS_CONFIRMATION_REPLY;

  const requestedDuration = extractRequestedDuration(normalizedQuery);
  if (requestedDuration) {
    const course = courses.find((item) => item.durationMin === requestedDuration);
    return course ? `登録済みのコースは、${formatCourseLine(course)}です。` : NEEDS_CONFIRMATION_REPLY;
  }

  const exactCourse = courses.find((item) => normalizedQuery.includes(normalizeSearchText(item.name)));
  if (exactCourse) return `登録済みのコースは、${formatCourseLine(exactCourse)}です。`;

  return `登録済みのコースは、${courses.map(formatCourseLine).join("、")}です。`;
}

async function buildTherapistInfoReply(storeId: string, normalizedQuery: string) {
  if (isTherapistAvailabilityQuestion(normalizedQuery)) return NEEDS_CONFIRMATION_REPLY;

  const therapists = await findActiveTherapistInfo(storeId);
  if (!therapists.length) return NEEDS_CONFIRMATION_REPLY;

  const exactTherapist = therapists.find((item) => normalizedQuery.includes(normalizeSearchText(item.displayName)));
  if (exactTherapist) return `登録済みのセラピスト情報は、${formatTherapistLine(exactTherapist)}です。`;

  return `登録済みのセラピストは、${therapists.map(formatTherapistLine).join("、")}です。`;
}

async function buildExactTherapistInfoReply(storeId: string, normalizedQuery: string) {
  const therapists = await findActiveTherapistInfo(storeId);
  const exactTherapist = therapists.find((item) => normalizedQuery.includes(normalizeSearchText(item.displayName)));
  return exactTherapist ? `登録済みのセラピスト情報は、${formatTherapistLine(exactTherapist)}です。` : null;
}

async function buildStoreSettingReply(storeId: string, normalizedQuery: string) {
  const setting = await findStoreSettingForAi(storeId);
  if (!setting) return NEEDS_CONFIRMATION_REPLY;

  if (/キャンセル|取消|取り消し/.test(normalizedQuery)) return clean(setting.cancellationRules) ?? NEEDS_CONFIRMATION_REPLY;
  if (/注意|利用規約|確認事項/.test(normalizedQuery)) return clean(setting.attentionNotes) ?? NEEDS_CONFIRMATION_REPLY;
  if (/NG|禁止|断り|お断り/.test(normalizedQuery)) return clean(setting.ngResponseRules) ?? NEEDS_CONFIRMATION_REPLY;
  if (/予約|受付|何分前|何時間前|ルール|規定/.test(normalizedQuery)) {
    return [
      clean(setting.reservationRules),
      `予約受付のリードタイムは${setting.reservationLeadTimeMin}分です。`,
      setting.phoneAiCreatesHoldOnly ? "電話AIは仮予約まで対応します。" : null,
      setting.autoConfirmEnabled ? "自動確定が有効です。" : null
    ]
      .filter(Boolean)
      .join("\n");
  }

  return NEEDS_CONFIRMATION_REPLY;
}

async function buildCourseSelectionQuestion(storeId: string) {
  const courses = await findActiveCourses(storeId);
  if (!courses.length) return NEEDS_CONFIRMATION_REPLY;
  return `登録済みのコースから選んでください。${courses.map(formatCourseLine).join("、")}です。`;
}

async function buildTherapistSelectionQuestion(storeId: string) {
  const therapists = await prisma.therapist
    .findMany({
      where: { storeId, status: "ACTIVE", acceptsNomination: true },
      select: { displayName: true },
      orderBy: { displayName: "asc" },
      take: REGISTERED_INFO_LIMIT
    })
    .catch(() => []);
  if (!therapists.length) return NEEDS_CONFIRMATION_REPLY;
  return `登録済みの指名可能なセラピスト名をお願いします。${therapists.map((item) => `${item.displayName}さん`).join("、")}です。`;
}

async function buildAttentionConfirmationQuestion(storeId: string) {
  const setting = await findStoreSettingForAi(storeId);
  const notes = clean(setting?.attentionNotes);
  if (!notes) return NEEDS_CONFIRMATION_REPLY;
  return `注意事項: ${notes}\nご確認いただけましたら、大丈夫です、とお伝えください。`;
}

async function findActiveCourses(storeId: string) {
  return prisma.course.findMany({
    where: { storeId, isActive: true },
    orderBy: { durationMin: "asc" },
    take: REGISTERED_INFO_LIMIT
  });
}

async function findActiveTherapistInfo(storeId: string) {
  return prisma.therapist
    .findMany({
      where: { storeId, status: "ACTIVE" },
      select: {
        displayName: true,
        profile: true,
        acceptsNomination: true,
        nominationFee: true
      },
      orderBy: { displayName: "asc" },
      take: REGISTERED_INFO_LIMIT
    })
    .catch(() => []);
}

async function findStoreSettingForAi(storeId: string) {
  try {
    return await prisma.storeSetting.findUnique({
      where: { storeId },
      select: {
        reservationLeadTimeMin: true,
        phoneAiCreatesHoldOnly: true,
        autoConfirmEnabled: true,
        reservationRules: true,
        cancellationRules: true,
        attentionNotes: true,
        ngResponseRules: true,
        ngWords: true
      }
    });
  } catch {
    return prisma.storeSetting
      .findUnique({
        where: { storeId },
        select: {
          reservationLeadTimeMin: true,
          phoneAiCreatesHoldOnly: true,
          autoConfirmEnabled: true,
          ngWords: true
        }
      })
      .then((setting) =>
        setting
          ? {
              ...setting,
              reservationRules: null,
              cancellationRules: null,
              attentionNotes: null,
              ngResponseRules: null
            }
          : null
      )
      .catch(() => null);
  }
}

function classifyProhibitedRequest(sourceText: string) {
  const text = normalizeSearchText(sourceText);
  if (/値引き|割引|割り引き|まけて|安くして|安くなら|クーポン|無料|返金/.test(text)) {
    return "値引き、返金、クーポン等はAIで回答・確定せず確認が必要です。";
  }
  if (/個人.*連絡|個人的.*連絡|line教|ライン教|電話番号教|連絡先教|店外/.test(text)) {
    return "個人連絡先や店外連絡の要求はAIで回答せず確認が必要です。";
  }
  return null;
}

async function classifyStoreNgWordRequest(storeId: string, sourceText: string) {
  const text = normalizeSearchText(sourceText);
  const setting = await prisma.storeSetting
    .findUnique({
      where: { storeId },
      select: { ngWords: true }
    })
    .catch(() => null);
  const ngWords = setting?.ngWords.map((word) => normalizeSearchText(word)).filter(Boolean) ?? [];
  return ngWords.some((word) => text.includes(word)) ? "StoreSetting.ngWords に該当したため確認が必要です。" : null;
}

function isRegisteredTextMatch(normalizedQuery: string, ...values: Array<string | null | undefined>) {
  const fields = values.map((value) => normalizeSearchText(value ?? "")).filter(Boolean);
  if (!fields.length) return false;

  if (
    fields.some(
      (field) =>
        (field.length >= 4 && normalizedQuery.includes(field)) ||
        (normalizedQuery.length >= 4 && field.includes(normalizedQuery))
    )
  ) {
    return true;
  }

  const querySignals = extractInfoSignals(normalizedQuery);
  if (querySignals.length === 0) return false;

  return fields.some((field) => {
    const fieldSignals = extractInfoSignals(field);
    const overlap = querySignals.filter((signal) => fieldSignals.includes(signal));
    return overlap.length >= Math.min(2, querySignals.length);
  });
}

function extractInfoSignals(value: string) {
  const signals: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["course", /コース|メニュー|施術|内容/],
    ["price", /料金|値段|金額|いくら|なんぼ|円/],
    ["therapist", /セラピスト|担当|女の子|指名/],
    ["place", /場所|住所|地図|道順|入口|最寄り|アクセス/],
    ["hours", /営業時間|何時|受付時間|最終/],
    ["reservation", /予約|受付|空き|空い/],
    ["cancel", /キャンセル|取消|取り消し/],
    ["rule", /ルール|規定|注意|利用規約|確認事項/]
  ];

  for (const [signal, pattern] of rules) {
    if (pattern.test(value)) signals.push(signal);
  }

  const duration = extractRequestedDuration(value);
  if (duration) signals.push(`duration:${duration}`);
  return signals;
}

function isCourseQuestion(value: string) {
  return /コース|料金|値段|金額|いくら|なんぼ|メニュー|施術|内容|\d{2,3}分/.test(value);
}

function isTherapistQuestion(value: string) {
  return /セラピスト|担当|女の子|指名|誰|どなた|プロフィール/.test(value);
}

function isTherapistAvailabilityQuestion(value: string) {
  return /出勤|空き|空い|今日|本日|今|対応|いける|誰いる|誰が|おすすめ/.test(value);
}

function isStoreSettingQuestion(value: string) {
  return /キャンセル|取消|取り消し|注意|利用規約|確認事項|NG|禁止|断り|お断り|予約|受付|何分前|何時間前|ルール|規定/.test(value);
}

function extractRequestedDuration(value: string) {
  const explicitDuration = value.match(/(?:^|[^\d])(\d{2,3})\s*(?:分|ふん|コース)/);
  const contextualDuration = value.match(/(?:^|[^\d])(\d{2,3})(?=いくら|円|料金|値段|コース)/);
  const duration = Number((explicitDuration ?? contextualDuration)?.[1]);
  return Number.isFinite(duration) ? duration : null;
}

function formatCourseLine(course: { name: string; durationMin: number; price: number; description: string | null }) {
  return `${course.name}（${course.durationMin}分、${formatPrice(course.price)}${course.description ? `、${course.description}` : ""}）`;
}

function formatTherapistLine(therapist: {
  displayName: string;
  profile: string | null;
  acceptsNomination: boolean;
  nominationFee: number;
}) {
  return [
    `${therapist.displayName}さん`,
    therapist.acceptsNomination ? `指名料${formatPrice(therapist.nominationFee)}` : "指名不可",
    therapist.profile
  ]
    .filter(Boolean)
    .join(" / ");
}

function normalizeSearchText(value: string) {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
}

async function resolveCourse(storeId: string, courseId?: string | null, courseName?: string | null) {
  if (courseId) return prisma.course.findFirst({ where: { id: courseId, storeId, isActive: true } });
  const name = clean(courseName);
  if (!name) return null;
  const courses = await prisma.course.findMany({ where: { storeId, isActive: true }, orderBy: { durationMin: "asc" } });
  const normalizedName = normalizeText(name);
  const duration = Number(name.match(/(\d{2,3})\s*(?:分|ふん)?/)?.[1]);
  return (
    courses.find((course) => normalizeText(course.name) === normalizedName) ??
    courses.find((course) => normalizedName.includes(normalizeText(course.name))) ??
    courses.find((course) => Number.isFinite(duration) && course.durationMin === duration) ??
    null
  );
}

async function resolveTherapist(storeId: string, therapistId?: string | null, therapistName?: string | null) {
  const therapistSelect = { id: true, displayName: true } satisfies Prisma.TherapistSelect;
  if (therapistId) {
    return prisma.therapist.findFirst({
      where: { id: therapistId, storeId, status: "ACTIVE" },
      select: therapistSelect
    });
  }
  const name = clean(therapistName);
  if (!name) return null;
  const normalizedName = normalizeText(name.replace(/さん|ちゃん|セラピスト|指名|本指名/g, ""));
  const therapists = await prisma.therapist.findMany({
    where: { storeId, status: "ACTIVE" },
    select: therapistSelect
  });
  return (
    therapists.find((therapist) => normalizeText(therapist.displayName) === normalizedName) ??
    therapists.find((therapist) => normalizedName.includes(normalizeText(therapist.displayName))) ??
    null
  );
}

async function formatCourseKnownText(storeId: string, courseId: string | null, fallbackName: string) {
  if (!courseId) return fallbackName;
  const course = await prisma.course.findFirst({ where: { id: courseId, storeId, isActive: true } });
  return course ? `${course.name}、${formatPrice(course.price)}` : fallbackName;
}

function buildTentativeSummary(reservation: ReservationWithDetails) {
  const therapist = reservation.therapist ? `、担当は${reservation.therapist.displayName}さん` : "";
  const room = reservation.room ? `、お部屋は${reservation.room.name}` : "";
  const nominationFee = reservation.nominated ? reservation.therapist?.nominationFee ?? 0 : 0;
  const total = reservation.course.price + nominationFee;
  return `${formatJapaneseDate(reservation.startsAt)}から、${reservation.course.name}${therapist}${room}で受け付けています。合計は${formatPrice(total)}です。`;
}

function isUnavailableReason(reason: string) {
  return /対応可能なセラピストが見つかりません|空き部屋がありません|予約不可|セラピスト|ルーム|部屋/.test(reason);
}

function buildUnavailableReply(reason: string) {
  if (/セラピスト/.test(reason)) {
    return "申し訳ありません。その時間は対応できるセラピストが空いていないため、ご案内できません。別の時間でしたら確認できます。";
  }
  if (/ルーム|部屋/.test(reason)) {
    return "申し訳ありません。その時間は空きルームがないため、ご案内できません。別の時間でしたら確認できます。";
  }
  return "申し訳ありません。その時間は予約をお受けできません。別の日時で確認します。";
}

function parseStartsAtText(value?: string | null) {
  const text = clean(value);
  if (!text) return null;
  const normalizedText = normalizeTimeText(text);
  const today = getJstDateParts(new Date());

  if (/今から|すぐ|最短|なる早|このあと/.test(normalizedText) && !hasExplicitTime(normalizedText)) {
    return roundJstToNextSlot(new Date(), 30);
  }

  const relativeBase = /明後日|あさって/.test(normalizedText)
    ? addJstDays(today, 2)
    : /明日|あした/.test(normalizedText)
      ? addJstDays(today, 1)
      : /今日|本日|今晩|夜|夕方|深夜|仕事終わり|今から|このあと/.test(normalizedText)
        ? today
        : null;
  const monthDay = normalizedText.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/);
  const slashDate = normalizedText.match(/(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/);
  const dateMatch = monthDay ?? slashDate;
  const hourMinute = normalizedText.match(/(\d{1,2})\s*(?:時|:|：)\s*(?:(\d{1,2})\s*分?|半)?/);
  if (!hourMinute) return null;

  const base = relativeBase ?? today;
  const year = dateMatch?.[1] ? Number(dateMatch[1]) : base.year;
  const month = dateMatch?.[2] ? Number(dateMatch[2]) : base.month;
  const day = dateMatch?.[3] ? Number(dateMatch[3]) : base.day;
  let hour = Number(hourMinute[1]);
  const minute = /半/.test(hourMinute[0]) ? 30 : hourMinute[2] ? Number(hourMinute[2]) : 0;
  hour = normalizeBusinessHour(hour, normalizedText);
  let parsed = dateFromJstParts({ year, month, day, hour, minute });
  if (!dateMatch && !relativeBase && parsed.getTime() < Date.now() - 30 * 60 * 1000) {
    parsed = new Date(parsed.getTime() + 24 * 60 * 60 * 1000);
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeBusinessHour(hour: number, text: string) {
  const explicitMorning = /(午前|朝|AM|am)/.test(text);
  const explicitEvening = /(午後|夜|よる|夕方|晩|PM|pm)/.test(text);
  const explicitLateNight = /(深夜|夜中|明け方)/.test(text);

  if (explicitLateNight && hour < 6) return hour + 24;
  if (explicitEvening && hour < 12) return hour + 12;
  if (!explicitMorning && hour >= 1 && hour <= 5) return hour + 24;
  if (!explicitMorning && hour >= 6 && hour < 12) return hour + 12;
  return hour;
}

function mergeStartsAtTexts(primary?: string | null, fallback?: string | null) {
  const current = clean(primary);
  const previous = clean(fallback);
  if (current && previous) {
    if (hasDatePart(current) && hasExplicitTime(previous) && !hasExplicitTime(current)) return `${current} ${previous}`;
    if (hasExplicitTime(current) && hasDatePart(previous) && !hasDatePart(current)) return `${previous} ${current}`;
    return current;
  }
  return current ?? previous;
}

function missingDateTimeLabel(value?: string | null) {
  const text = clean(value);
  if (!text) return "希望日時";
  if (hasExplicitTime(text) && !hasDatePart(text)) return "希望日";
  if (hasDatePart(text) && !hasExplicitTime(text)) return "希望時間";
  return "希望日時";
}

function hasDatePart(value: string) {
  return /今日|本日|明日|あした|明後日|あさって|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|(?:\d{4}[/-])?\d{1,2}[/-]\d{1,2}/.test(value);
}

function hasExplicitTime(value: string) {
  return /\d{1,2}\s*(?:時|:|：)\s*(?:(?:\d{1,2})\s*分?|半)?/.test(normalizeTimeText(value));
}

function getJstDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addJstDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function dateFromJstParts(parts: { year: number; month: number; day: number; hour: number; minute: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 9, parts.minute, 0, 0));
}

function roundJstToNextSlot(date: Date, addMinutes: number) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000 + addMinutes * 60 * 1000);
  const roundedMinutes = Math.ceil(jst.getUTCMinutes() / 15) * 15;
  jst.setUTCMinutes(roundedMinutes, 0, 0);
  return new Date(jst.getTime() - 9 * 60 * 60 * 1000);
}

function coerceDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTimeText(value: string) {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/(\d{1,2})時\s*(\d{1,2})\s*分/g, "$1:$2")
    .replace(/(\d{1,2})時\s*半/g, "$1:30")
    .replace(/(\d{1,2})時(?!\d)/g, "$1:00");
}

function formatPrice(value: number) {
  return `${Math.max(0, value).toLocaleString("ja-JP")}円`;
}

function dedupeLines(lines: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return lines.filter((line): line is string => {
    if (!line || seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function formatJapaneseList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}と${items[1]}`;
  return `${items.slice(0, -1).join("、")}、${items.at(-1)}`;
}

function clean(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function cleanCustomerName(value?: string | null) {
  const text = clean(value);
  if (!text) return null;
  if (/予約|コース|指名|フリー|初めて|今日|明日|電話番号|時間|確認|キャンセル|変更|お願い|大丈夫/.test(text)) return null;
  return text;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

import { ActorType, ConversationChannel, MessageRole, NotificationStatus, NotificationType, ReservationStatus, ShiftStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { orchestrateAiReservationReception } from "@/lib/ai-reservation-orchestrator";
import { verifyLineSignature, replyLineMessage } from "@/lib/line-service";
import { recordNotificationDeliveryLog } from "@/lib/notification-service";
import { extractReservationFromText } from "@/lib/openai-service";
import { prisma } from "@/lib/prisma";
import {
  mergeReservationDrafts,
  parseReservationDraft,
  serializeReservationDraft,
  workflowStateForAction
} from "@/lib/reservation-draft";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
};

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-line-signature");
    const verification = verifyLineSignature(rawBody, signature);
    const allowUnsignedDemo = process.env.NODE_ENV !== "production" && !process.env.LINE_CHANNEL_SECRET;

    if (!verification.ok && !allowUnsignedDemo) {
      return fail(new Error(verification.reason ?? "LINE signature verification failed"), 401);
    }

    const body = JSON.parse(rawBody || "{}") as { events?: LineEvent[] };
    const results = [];

    for (const event of body.events ?? []) {
      const text = event.message?.text?.trim();
      if (event.type !== "message" || event.message?.type !== "text" || !text) continue;

      const lineId = event.source?.userId;
      const therapistResolution = lineId ? await resolveTherapistLineAccount(lineId) : { status: "missing" as const };
      if (therapistResolution.status === "duplicate") {
        results.push(await handleDuplicateTherapistLineId({ lineId, replyToken: event.replyToken, text }));
        continue;
      }

      const therapist = therapistResolution.status === "matched" ? therapistResolution.therapist : null;
      const storeId = therapist?.storeId ?? (await resolveLineStoreId(lineId));

      if (therapist) {
        results.push(
          await handleTherapistLineEvent({
            lineId,
            replyToken: event.replyToken,
            text,
            therapist
          })
        );
        continue;
      }

      if (!storeId) {
        results.push(await handleUnresolvedLineStore({ lineId, replyToken: event.replyToken, text }));
        continue;
      }

      if (isTherapistOperationalCommand(text)) {
        results.push(await handleUnlinkedTherapistCommand({ storeId, lineId, replyToken: event.replyToken, text }));
        continue;
      }

      results.push(await handleCustomerLineEvent({ storeId, lineId, replyToken: event.replyToken, text }));
    }

    return ok({ verified: verification.ok, demoUnsigned: allowUnsignedDemo, results });
  } catch (error) {
    return fail(error);
  }
}

async function resolveLineStoreId(lineId?: string) {
  if (!lineId) return null;

  const therapists = await prisma.therapist.findMany({
    where: { lineId, status: "ACTIVE" },
    select: { storeId: true },
    distinct: ["storeId"],
    take: 2
  });
  if (therapists.length === 1) return therapists[0].storeId;
  if (therapists.length > 1) return null;

  const customers = await prisma.customer.findMany({
    where: { lineId },
    select: { storeId: true },
    distinct: ["storeId"],
    take: 2
  });
  if (customers.length === 1) return customers[0].storeId;
  if (customers.length > 1) return null;

  const stores = await prisma.store.findMany({ select: { id: true }, take: 2 });
  return stores.length === 1 ? stores[0].id : null;
}

async function resolveTherapistLineAccount(lineId: string) {
  const therapists = await prisma.therapist.findMany({
    where: { lineId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, displayName: true, storeId: true }
  });

  if (therapists.length === 0) return { status: "missing" as const };
  if (therapists.length === 1) return { status: "matched" as const, therapist: therapists[0] };

  return { status: "duplicate" as const, therapists };
}

async function handleDuplicateTherapistLineId(input: { lineId?: string; replyToken?: string; text: string }) {
  const reply = [
    "このLINE IDが複数のセラピストに登録されているため、出勤・退室連絡として処理できません。",
    "誤った店舗や担当者に反映される事故を防ぐため、管理者が /setup でLINE IDの重複を解消してください。",
    input.lineId ? `LINE ID: ${input.lineId}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: reply }])
    : { skipped: true, reason: "replyToken missing" };

  return {
    action: "THERAPIST_LINE_ID_DUPLICATE",
    lineId: input.lineId ?? null,
    text: input.text,
    replyResult
  };
}

async function handleUnresolvedLineStore(input: { lineId?: string; replyToken?: string; text: string }) {
  const reply = input.lineId
    ? [
        "このLINEアカウントの店舗を特定できませんでした。",
        "100店舗運用では、店舗別LINE設定または登録済みの顧客/セラピストLINE IDが必要です。",
        `LINE ID: ${input.lineId}`,
        "管理者に登録を依頼してください。"
      ].join("\n")
    : "このLINEアカウントを識別できませんでした。管理者にLINE連携設定を確認してください。";

  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: reply }])
    : { skipped: true, reason: "replyToken missing" };

  return {
    action: "LINE_STORE_UNRESOLVED",
    lineId: input.lineId ?? null,
    replyResult
  };
}

async function handleUnlinkedTherapistCommand(input: { storeId: string; lineId?: string; replyToken?: string; text: string }) {
  const reply = input.lineId
    ? [
        "このLINEアカウントはセラピストとして未登録です。",
        "出勤・退室連絡として処理するには、管理者が /setup のセラピスト情報に下記LINE IDを登録してください。",
        `LINE ID: ${input.lineId}`,
        "登録後にもう一度送ってください。"
      ].join("\n")
    : "このLINEアカウントを識別できませんでした。セラピストLINE登録後にもう一度送ってください。";

  const conversation = await prisma.conversation.create({
    data: {
      storeId: input.storeId,
      channel: ConversationChannel.LINE,
      externalUserId: input.lineId,
      workflowState: "LINE_ID_REGISTRATION_REQUIRED",
      summary: `未登録LINE命令: ${input.text}`,
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, content: input.text },
          { role: MessageRole.AI, content: reply }
        ]
      }
    }
  });

  await prisma.notification.create({
    data: {
      storeId: input.storeId,
      type: NotificationType.THERAPIST_SHIFT,
      channel: ConversationChannel.LINE,
      status: NotificationStatus.FAILED,
      targetLineId: input.lineId,
      body: `未登録LINE IDからセラピスト運用命令を受信しました。LINE IDを /setup で登録してください。本文: ${input.text}`
    }
  });

  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: reply }])
    : { skipped: true, reason: "replyToken missing" };

  return {
    conversationId: conversation.id,
    action: "THERAPIST_LINE_ID_REQUIRED",
    lineId: input.lineId ?? null,
    replyResult
  };
}

async function handleCustomerLineEvent(input: { storeId: string; lineId?: string; replyToken?: string; text: string }) {
  const existing = await findLatestLineConversation(input.storeId, input.lineId);
  const customerControl = classifyCustomerControlIntent(input.text);
  if (customerControl) {
    return handleCustomerControlIntent({ ...input, existing, control: customerControl });
  }

  const priorMessages = existing?.messages ?? [];
  const conversation = existing
    ? await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          externalUserId: input.lineId ?? undefined,
          workflowState: existing.workflowState || "LINE_ACTIVE",
          summary: input.text,
          messages: { create: { role: MessageRole.CUSTOMER, content: input.text } }
        }
      })
    : await prisma.conversation.create({
        data: {
          storeId: input.storeId,
          channel: ConversationChannel.LINE,
          externalUserId: input.lineId,
          workflowState: "LINE_ACTIVE",
          summary: input.text,
          messages: { create: { role: MessageRole.CUSTOMER, content: input.text } }
        }
      });

  const extractionText = buildExtractionText(priorMessages, input.text);
  const extraction = await extractReservationFromText(extractionText);
  const draft = mergeReservationDrafts(parseReservationDraft(existing?.reservationDraft), { lineId: input.lineId });
  const orchestration = await orchestrateAiReservationReception({
    storeId: input.storeId,
    channel: ConversationChannel.LINE,
    conversationId: conversation.id,
    sourceText: extractionText,
    extraction,
    draft
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      summary: extraction.summary || orchestration.reply,
      externalUserId: input.lineId ?? undefined,
      workflowState: orchestration.workflowState ?? workflowStateForAction(orchestration.action),
      reservationDraft: serializeReservationDraft(orchestration.draft ?? draft),
      customerId: orchestration.reservation?.customerId ?? undefined,
      messages: { create: { role: MessageRole.AI, content: orchestration.reply } }
    }
  });

  if (orchestration.escalationReason) {
    await prisma.escalation.create({
      data: {
        storeId: input.storeId,
        conversationId: conversation.id,
        reason: "LOW_CONFIDENCE",
        summary: orchestration.escalationReason
      }
    });
  }

  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: orchestration.reply }])
    : { skipped: true, reason: "replyToken missing" };

  return {
    conversationId: conversation.id,
    extraction,
    checklist: orchestration.checklist,
    action: orchestration.action,
    reservationId: orchestration.reservation?.id ?? null,
    replyResult
  };
}

async function handleCustomerControlIntent(input: {
  storeId: string;
  lineId?: string;
  replyToken?: string;
  text: string;
  existing: Awaited<ReturnType<typeof findLatestLineConversation>>;
  control: { type: "CANCEL_REQUEST" | "CHANGE_REQUEST"; reply: string; workflowState: string };
}) {
  const conversation = input.existing
    ? await prisma.conversation.update({
        where: { id: input.existing.id },
        data: {
          externalUserId: input.lineId ?? undefined,
          workflowState: input.control.workflowState,
          summary: input.text,
          messages: {
            create: [
              { role: MessageRole.CUSTOMER, content: input.text },
              { role: MessageRole.AI, content: input.control.reply }
            ]
          }
        }
      })
    : await prisma.conversation.create({
        data: {
          storeId: input.storeId,
          channel: ConversationChannel.LINE,
          externalUserId: input.lineId,
          workflowState: input.control.workflowState,
          summary: input.text,
          messages: {
            create: [
              { role: MessageRole.CUSTOMER, content: input.text },
              { role: MessageRole.AI, content: input.control.reply }
            ]
          }
        }
      });

  await prisma.notification.create({
    data: {
      storeId: input.storeId,
      type: input.control.type === "CANCEL_REQUEST" ? NotificationType.RESERVATION_CANCELLED : NotificationType.RESERVATION_CHANGED,
      channel: ConversationChannel.LINE,
      status: NotificationStatus.PENDING,
      targetLineId: input.lineId,
      body: `顧客LINEから${input.control.type === "CANCEL_REQUEST" ? "キャンセル" : "予約変更"}相談を受信しました。本文: ${input.text}`
    }
  });

  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: input.control.reply }])
    : { skipped: true, reason: "replyToken missing" };

  return {
    conversationId: conversation.id,
    action: input.control.type,
    replyResult
  };
}

async function handleTherapistLineEvent(input: {
  lineId?: string;
  replyToken?: string;
  text: string;
  therapist: { id: string; displayName: string; storeId: string };
}) {
  const conversation = await appendTherapistConversation(input);
  const shift = parseShiftMessage(input.text);

  if (shift) {
    const existingShift = await prisma.shift.findFirst({
      where: {
        storeId: input.therapist.storeId,
        therapistId: input.therapist.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        status: ShiftStatus.SCHEDULED
      },
      orderBy: { updatedAt: "desc" }
    });
    const savedShift =
      existingShift ??
      (await prisma.shift.create({
        data: {
          storeId: input.therapist.storeId,
          therapistId: input.therapist.id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          status: ShiftStatus.SCHEDULED
        }
      }));

    const body = existingShift
      ? `${input.therapist.displayName}さんの出勤予定はすでに登録済みです。 ${formatLineDateTime(shift.startsAt)}-${formatLineTime(shift.endsAt)}`
      : `${input.therapist.displayName}さんの出勤予定を登録しました。 ${formatLineDateTime(shift.startsAt)}-${formatLineTime(shift.endsAt)}`;
    const notification = await prisma.notification.create({
      data: {
        storeId: input.therapist.storeId,
        type: NotificationType.THERAPIST_SHIFT,
        channel: ConversationChannel.LINE,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        targetName: input.therapist.displayName,
        targetLineId: input.lineId,
        body
      }
    });
    await recordNotificationDeliveryLog(notification.id, {
      payload: {
        source: "line_webhook",
        action: existingShift ? "THERAPIST_SHIFT_ALREADY_RECORDED" : "THERAPIST_SHIFT_RECORDED"
      }
    });

    await appendAiMessage(conversation.id, body, "SHIFT_RECORDED");
    const replyResult = input.replyToken
      ? await replyLineMessage(input.replyToken, [{ type: "text", text: body }])
      : { skipped: true, reason: "replyToken missing" };

    return {
      conversationId: conversation.id,
      action: existingShift ? "THERAPIST_SHIFT_ALREADY_RECORDED" : "THERAPIST_SHIFT_RECORDED",
      shiftId: savedShift.id,
      replyResult
    };
  }

  if (isExitMessage(input.text)) {
    const now = new Date();
    const reservation = await prisma.reservation.findFirst({
      where: {
        storeId: input.therapist.storeId,
        therapistId: input.therapist.id,
        status: { in: [ReservationStatus.TENTATIVE, ReservationStatus.CONFIRMED] },
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      include: { room: true, customer: true, course: true },
      orderBy: { startsAt: "desc" }
    });

    if (!reservation) {
      const reply = "退出連絡を受け取りました。現在利用中の予約が見つからないため、店舗側で確認してください。";
      await prisma.notification.create({
        data: {
          storeId: input.therapist.storeId,
          type: NotificationType.RESERVATION_CHANGED,
          channel: ConversationChannel.LINE,
          status: NotificationStatus.PENDING,
          targetName: input.therapist.displayName,
          targetLineId: input.lineId,
          body: `${input.therapist.displayName}さんから退室連絡を受信しましたが、現在利用中の予約が見つかりません。本文: ${input.text}`
        }
      });
      await appendAiMessage(conversation.id, reply, "EXIT_REVIEW_REQUIRED");
      const replyResult = input.replyToken
        ? await replyLineMessage(input.replyToken, [{ type: "text", text: reply }])
        : { skipped: true, reason: "replyToken missing" };
      return { conversationId: conversation.id, action: "ROOM_EXIT_REVIEW_REQUIRED", replyResult };
    }

    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.VISITED, endsAt: now },
      include: { room: true, customer: true, course: true }
    });

    await prisma.auditLog.create({
      data: {
        storeId: input.therapist.storeId,
        reservationId: reservation.id,
        actorType: ActorType.AI,
        actorId: input.lineId,
        action: "line.room_exit_reported",
        before: { status: reservation.status, endsAt: reservation.endsAt, roomId: reservation.roomId },
        after: { status: updated.status, endsAt: updated.endsAt, roomId: updated.roomId }
      }
    });

    const body = `${input.therapist.displayName}さんから退出連絡。${reservation.room?.name ?? "未割当ルーム"}を空き反映しました。`;
    const notification = await prisma.notification.create({
      data: {
        storeId: input.therapist.storeId,
        reservationId: reservation.id,
        type: NotificationType.RESERVATION_CHANGED,
        channel: ConversationChannel.LINE,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        targetName: input.therapist.displayName,
        targetLineId: input.lineId,
        body
      }
    });
    await recordNotificationDeliveryLog(notification.id, {
      payload: {
        source: "line_webhook",
        action: "ROOM_EXIT_RECORDED"
      }
    });

    await appendAiMessage(conversation.id, body, "ROOM_EXIT_RECORDED");
    const replyResult = input.replyToken
      ? await replyLineMessage(input.replyToken, [{ type: "text", text: body }])
      : { skipped: true, reason: "replyToken missing" };

    return { conversationId: conversation.id, action: "ROOM_EXIT_RECORDED", reservationId: updated.id, replyResult };
  }

  const reply = "連絡を受け取りました。管理画面のLINE履歴に反映しました。";
  await appendAiMessage(conversation.id, reply, "THERAPIST_MESSAGE_RECEIVED");
  const replyResult = input.replyToken
    ? await replyLineMessage(input.replyToken, [{ type: "text", text: reply }])
    : { skipped: true, reason: "replyToken missing" };

  return { conversationId: conversation.id, action: "THERAPIST_MESSAGE_RECORDED", replyResult };
}

async function appendTherapistConversation(input: {
  lineId?: string;
  text: string;
  therapist: { id: string; displayName: string; storeId: string };
}) {
  const existing = input.lineId
    ? await prisma.conversation.findFirst({
        where: {
          storeId: input.therapist.storeId,
          channel: ConversationChannel.LINE,
          externalUserId: input.lineId
        },
        orderBy: { updatedAt: "desc" }
      })
    : null;

  if (existing) {
    return prisma.conversation.update({
      where: { id: existing.id },
      data: {
        summary: `${input.therapist.displayName}: ${input.text}`,
        workflowState: "THERAPIST_MESSAGE",
        messages: { create: { role: MessageRole.STAFF, content: input.text } }
      }
    });
  }

  return prisma.conversation.create({
    data: {
      storeId: input.therapist.storeId,
      channel: ConversationChannel.LINE,
      externalUserId: input.lineId,
      summary: `${input.therapist.displayName}: ${input.text}`,
      workflowState: "THERAPIST_MESSAGE",
      messages: { create: { role: MessageRole.STAFF, content: input.text } }
    }
  });
}

async function appendAiMessage(conversationId: string, content: string, workflowState: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      summary: content,
      workflowState,
      messages: { create: { role: MessageRole.AI, content } }
    }
  });
}

function parseShiftMessage(text: string) {
  if (!/(出勤|シフト|勤務)/.test(text)) return null;

  const normalized = normalizeDigits(text);
  const today = jstDateParts(new Date());
  const dateParts = parseLineDate(normalized, today);
  const timeRange = parseLineTimeRange(normalized);
  if (!timeRange) return null;

  const startsAt = dateFromJstParts({ ...dateParts, hour: timeRange.startHour, minute: timeRange.startMinute });
  let endsAt = dateFromJstParts({ ...dateParts, hour: timeRange.endHour, minute: timeRange.endMinute });
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);

  return { startsAt, endsAt };
}

function isExitMessage(text: string) {
  return /(退出しました|退室しました|施術終わり|終わりました|部屋空き|ルーム空き|空きました)/.test(text);
}

function isTherapistOperationalCommand(text: string) {
  return Boolean(parseShiftMessage(text) || isExitMessage(text));
}

function classifyCustomerControlIntent(text: string) {
  const normalized = normalizeDigits(text).replace(/\s+/g, "");
  const isCancel =
    /(キャンセル|きゃんせる|取消|取り消し|とりけし|やめます|やっぱやめ|一旦大丈夫|いったん大丈夫|行けなく|行けない|なしで|キャンセルで)/.test(normalized);
  if (isCancel) {
    return {
      type: "CANCEL_REQUEST" as const,
      workflowState: "CANCEL_REQUESTED",
      reply: "キャンセル希望を受け付けました。対象の予約を店舗側で確認して対応します。行き違いを防ぐため、予約時のお名前または電話番号も送ってください。"
    };
  }

  const isChange =
    /(変更|変え|かえ|ずら|リスケ|時間を変|日にちを変|明日|明後日|来週|[0-9]{1,2}時.*変更|変更できますか|変えられますか)/.test(normalized);
  if (isChange) {
    return {
      type: "CHANGE_REQUEST" as const,
      workflowState: "CHANGE_REQUESTED",
      reply: "予約変更のご相談として受け付けました。勝手に確定せず、店舗側で空き状況を確認します。変更したい日時と、予約時のお名前または電話番号を送ってください。"
    };
  }

  return null;
}

function parseLineDate(value: string, today: { year: number; month: number; day: number }) {
  const dateText = value.replace(/\d{1,2}:\d{2}\s*(?:から|〜|~|-)\s*\d{1,2}:\d{2}/g, "");

  if (/(今日|本日)/.test(dateText)) return today;
  if (/(明日|あした)/.test(dateText)) return addJstDays(today, 1);
  if (/(明後日|あさって)/.test(dateText)) return addJstDays(today, 2);

  const japaneseDate = dateText.match(/(?:(20\d{2})年)?\s*(\d{1,2})月\s*(\d{1,2})日/);
  const slashDate = dateText.match(/(?:^|[^\d:])(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})(?:$|[^\d:])/);
  const explicitDate = japaneseDate ?? slashDate;
  if (!explicitDate) return today;

  return {
    year: Number(explicitDate[1] ?? today.year),
    month: Number(explicitDate[2]),
    day: Number(explicitDate[3])
  };
}

function parseLineTimeRange(value: string) {
  const timePattern = String.raw`(\d{1,2})(?::(\d{2})|時)?`;
  const separatorPattern = String.raw`(?:から|〜|~|-)`;
  const range = new RegExp(`${timePattern}\\s*${separatorPattern}\\s*${timePattern}`).exec(value);
  if (range) {
    return {
      startHour: Number(range[1]),
      startMinute: Number(range[2] ?? 0),
      endHour: Number(range[3]),
      endMinute: Number(range[4] ?? 0)
    };
  }

  const japaneseRange = /(\d{1,2})時\s*(?:から|〜|~|-)\s*(\d{1,2})時(?:\s*(\d{1,2})分)?/.exec(value);
  if (japaneseRange) {
    return {
      startHour: Number(japaneseRange[1]),
      startMinute: 0,
      endHour: Number(japaneseRange[2]),
      endMinute: Number(japaneseRange[3] ?? 0)
    };
  }

  return null;
}

function jstDateParts(date: Date) {
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

function formatLineDateTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatLineTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

async function findLatestLineConversation(storeId: string, lineId?: string) {
  if (!lineId) return null;

  const byExternalUser = await prisma.conversation.findFirst({
    where: {
      storeId,
      channel: ConversationChannel.LINE,
      externalUserId: lineId
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } }
    },
    orderBy: { updatedAt: "desc" }
  });

  if (byExternalUser) return byExternalUser;

  const customer = await prisma.customer.findFirst({
    where: { storeId, lineId },
    select: { id: true }
  });

  if (!customer) return null;

  const conversation = await prisma.conversation.findFirst({
    where: {
      storeId,
      channel: ConversationChannel.LINE,
      customerId: customer.id
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } }
    },
    orderBy: { updatedAt: "desc" }
  });

  if (!conversation) return null;

  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { externalUserId: lineId },
    include: {
      messages: { orderBy: { createdAt: "asc" } }
    }
  });
}

function buildExtractionText(priorMessages: Array<{ role: MessageRole; content: string }>, currentText: string) {
  const recent = priorMessages
    .filter((message) => message.role === MessageRole.CUSTOMER)
    .slice(-12)
    .map((message) => `お客様: ${message.content}`);

  return [...recent, `お客様: ${currentText}`].join("\n");
}



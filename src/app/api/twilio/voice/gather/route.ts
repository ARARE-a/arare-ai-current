import { ConversationChannel, MessageRole } from "@prisma/client";
import { NextRequest } from "next/server";
import { orchestrateAiReservationReception } from "@/lib/ai-reservation-orchestrator";
import { extractReservationFromText } from "@/lib/openai-service";
import { resolveStoreByCallSid } from "@/lib/phone-routing";
import { prisma } from "@/lib/prisma";
import { mergeReservationDrafts, parseReservationDraft, serializeReservationDraft, workflowStateForAction } from "@/lib/reservation-draft";
import { sayJa, twiml } from "@/lib/twilio-service";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const speech = form.get("SpeechResult")?.toString() ?? "";
  const callSid = form.get("CallSid")?.toString();
  const from = form.get("From")?.toString();
  const to = form.get("To")?.toString() ?? form.get("Called")?.toString();
  const queryStoreId = request.nextUrl.searchParams.get("storeId");
  const querySettingId = request.nextUrl.searchParams.get("settingId");

  const resolved = queryStoreId
    ? {
        ok: true as const,
        storeId: queryStoreId,
        settingId: querySettingId ?? ""
      }
    : await resolveStoreByCallSid(callSid);

  if (!resolved.ok) {
    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayJa("お電話ありがとうございます。AI受付に接続できませんでした。しばらくしてから、もう一度お電話ください。")}
</Response>`);
  }

  const conversationPair = await upsertPhoneConversation({
    storeId: resolved.storeId,
    phone: from,
    text: speech
  });

  const extractionText = buildExtractionText(conversationPair.priorMessages, speech);
  const extraction = await extractReservationFromText(extractionText).catch((error) => ({
    intent: "ESCALATE" as const,
    confidence: 0,
    escalationReason: error instanceof Error ? error.message : "OpenAI extraction failed",
    summary: speech || "内容を聞き取れませんでした。",
    customerName: null,
    phone: null,
    startsAtText: null,
    courseName: null,
    nominationIntent: null,
    therapistName: null,
    firstVisit: null,
    attentionConfirmed: null,
    finalConfirmation: null
  }));

  const draft = mergeReservationDrafts(parseReservationDraft(conversationPair.conversation.reservationDraft), {
    phone: from ?? undefined
  });
  const orchestration = await orchestrateAiReservationReception({
    storeId: resolved.storeId,
    channel: ConversationChannel.PHONE,
    conversationId: conversationPair.conversation.id,
    sourceText: extractionText,
    extraction,
    draft,
    actorId: callSid
  });

  await prisma.conversation.update({
    where: { id: conversationPair.conversation.id },
    data: {
      summary: extraction.summary,
      workflowState: orchestration.workflowState ?? workflowStateForAction(orchestration.action),
      reservationDraft: serializeReservationDraft(orchestration.draft ?? draft),
      customerId: orchestration.reservation?.customerId ?? undefined,
      messages: { create: { role: MessageRole.AI, content: orchestration.reply } }
    }
  });

  const callLogData = {
    storePhoneSettingId: resolved.settingId || undefined,
    reservationId: orchestration.reservation?.id,
    phoneNumber: from,
    toNumber: to,
    twilioCallSid: callSid,
    status: orchestration.reservation
      ? orchestration.reservation.status === "CONFIRMED"
        ? ("SUMMARIZED" as const)
        : ("HOLD_CREATED" as const)
      : orchestration.action === "ESCALATED"
        ? ("ESCALATED" as const)
        : ("TRANSCRIBED" as const),
    transcript: speech,
    aiSummary: extraction.summary,
    confidence: extraction.confidence,
    requiredReview: orchestration.action !== "CONFIRMED",
    reviewNotes: orchestration.reply
  };

  const existing = callSid
    ? await prisma.callLog.findFirst({
        where: { storeId: resolved.storeId, twilioCallSid: callSid },
        orderBy: { createdAt: "desc" }
      })
    : null;
  const callLog = existing
    ? await prisma.callLog.update({ where: { id: existing.id }, data: callLogData })
    : await prisma.callLog.create({ data: { ...callLogData, storeId: resolved.storeId } });

  if (orchestration.escalationReason && callLog) {
    await prisma.escalation
      .create({
        data: {
          storeId: resolved.storeId,
          callLogId: callLog.id,
          reason: "LOW_CONFIDENCE",
          summary: orchestration.escalationReason
        }
      })
      .catch(() => null);
  }

  return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response>${sayJa(orchestration.reply)}</Response>`);
}

function buildExtractionText(priorMessages: Array<{ role: MessageRole; content: string }>, currentText: string) {
  const recent = priorMessages
    .filter((message) => message.role === MessageRole.CUSTOMER)
    .slice(-12)
    .map((message) => `顧客: ${message.content}`);

  return [...recent, `顧客: ${currentText}`].join("\n");
}

async function upsertPhoneConversation(input: { storeId: string; phone?: string; text: string }) {
  if (!input.phone) {
    const created = await prisma.conversation.create({
      data: {
        storeId: input.storeId,
        channel: ConversationChannel.PHONE,
        summary: input.text,
        messages: { create: { role: MessageRole.CUSTOMER, content: input.text } }
      },
      include: { messages: { orderBy: { createdAt: "asc" } } }
    });

    return {
      conversation: created,
      priorMessages: created.messages.filter((message) => message.role === MessageRole.CUSTOMER).slice(0, -1)
    };
  }

  const existing = await prisma.conversation.findFirst({
    where: { storeId: input.storeId, channel: ConversationChannel.PHONE, externalUserId: input.phone },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });

  const conversation = existing
    ? await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          externalUserId: input.phone,
          summary: existing.summary || input.text,
          messages: { create: { role: MessageRole.CUSTOMER, content: input.text } }
        },
        include: { messages: { orderBy: { createdAt: "asc" } } }
      })
    : await prisma.conversation.create({
        data: {
          storeId: input.storeId,
          channel: ConversationChannel.PHONE,
          externalUserId: input.phone,
          summary: input.text,
          messages: { create: { role: MessageRole.CUSTOMER, content: input.text } }
        },
        include: { messages: { orderBy: { createdAt: "asc" } } }
      });

  return {
    conversation,
    priorMessages: conversation.messages.filter((message) => message.role === MessageRole.CUSTOMER).slice(0, -1)
  };
}

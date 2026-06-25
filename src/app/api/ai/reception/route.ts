import { ConversationChannel, MessageRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { validateAutomationToken } from "@/lib/automation-auth";
import { orchestrateAiReservationReception } from "@/lib/ai-reservation-orchestrator";
import { extractReservationFromText } from "@/lib/openai-service";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  mergeReservationDrafts,
  parseReservationDraft,
  serializeReservationDraft,
  workflowStateForAction
} from "@/lib/reservation-draft";
import { getRequestStoreContext, type RequestStoreContext } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  channel: z.nativeEnum(ConversationChannel).default(ConversationChannel.WEB_CHAT),
  message: z.string().min(1),
  conversationId: z.string().optional(),
  customer: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      lineId: z.string().optional()
    })
    .optional(),
  reservationDraft: z
    .object({
      startsAt: z.coerce.date().optional(),
      startsAtText: z.string().optional(),
      courseId: z.string().optional(),
      courseName: z.string().optional(),
      therapistId: z.string().optional(),
      therapistName: z.string().optional(),
      nominationIntent: z.boolean().optional(),
      firstVisit: z.boolean().optional(),
      attentionConfirmed: z.boolean().optional(),
      finalConfirmation: z.boolean().optional()
    })
    .optional()
});

export async function POST(request: NextRequest) {
  try {
    const access = await resolveReceptionAccess(request);
    if (access.response) return access.response;

    const rateLimitError = await rateLimit(request, {
      name: "ai-reception",
      rules: [
        { windowMs: 60 * 1000, max: rateLimitMax("AI_RECEPTION_RATE_LIMIT_PER_MINUTE", 30) },
        { windowMs: 10 * 60 * 1000, max: rateLimitMax("AI_RECEPTION_RATE_LIMIT_PER_10_MINUTES", 120) }
      ]
    });
    if (rateLimitError) return rateLimitError;

    const payload = schema.parse(await request.json());
    if (access.context?.storeId && payload.storeId && payload.storeId !== access.context.storeId) {
      return NextResponse.json({ error: "store access mismatch" }, { status: 403 });
    }

    const requestStore = access.context?.storeId ?? payload.storeId ?? (await getRequestStoreContext())?.storeId;
    if (!requestStore) {
      throw new Error("storeId is required for AI reception.");
    }
    const existing = payload.conversationId
      ? await prisma.conversation.findUnique({
          where: { id: payload.conversationId, storeId: requestStore },
          include: { messages: { orderBy: { createdAt: "asc" } } }
        })
      : null;

    const conversation = existing
      ? await prisma.conversation.update({
          where: { id: existing.id },
          data: {
            externalUserId: payload.customer?.lineId,
            messages: { create: { role: MessageRole.CUSTOMER, content: payload.message } }
          }
        })
      : await prisma.conversation.create({
          data: {
            storeId: requestStore,
            channel: payload.channel,
            externalUserId: payload.customer?.lineId,
            summary: payload.message,
            messages: { create: { role: MessageRole.CUSTOMER, content: payload.message } }
          }
        });

    const extractionText = buildExtractionText(existing?.messages ?? [], payload.message);
    const extraction = await extractReservationFromText(extractionText);
    const draft = mergeReservationDrafts(parseReservationDraft(existing?.reservationDraft), {
      customerName: payload.customer?.name,
      phone: payload.customer?.phone,
      lineId: payload.customer?.lineId,
      startsAt: payload.reservationDraft?.startsAt,
      startsAtText: payload.reservationDraft?.startsAtText,
      courseId: payload.reservationDraft?.courseId,
      courseName: payload.reservationDraft?.courseName,
      therapistId: payload.reservationDraft?.therapistId,
      therapistName: payload.reservationDraft?.therapistName,
      nominationIntent: payload.reservationDraft?.nominationIntent,
      firstVisit: payload.reservationDraft?.firstVisit,
      attentionConfirmed: payload.reservationDraft?.attentionConfirmed,
      finalConfirmation: payload.reservationDraft?.finalConfirmation
    });
    const orchestration = await orchestrateAiReservationReception({
      storeId: requestStore,
      channel: payload.channel,
      conversationId: conversation.id,
      sourceText: extractionText,
      extraction,
      draft
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        summary: extraction.summary,
        externalUserId: payload.customer?.lineId,
        workflowState: orchestration.workflowState ?? workflowStateForAction(orchestration.action),
        reservationDraft: serializeReservationDraft(orchestration.draft ?? draft),
        customerId: orchestration.reservation?.customerId ?? undefined,
        messages: { create: { role: MessageRole.AI, content: orchestration.reply } }
      }
    });

    if (orchestration.escalationReason) {
      await prisma.escalation.create({
        data: {
          storeId: requestStore,
          conversationId: conversation.id,
          reason: "LOW_CONFIDENCE",
          summary: orchestration.escalationReason
        }
      });
    }

    return ok({
      conversationId: conversation.id,
      extraction,
      checklist: orchestration.checklist,
      action: orchestration.action,
      reply: orchestration.reply,
      reservation: orchestration.reservation
    });
  } catch (error) {
    return fail(error);
  }
}

async function resolveReceptionAccess(request: NextRequest): Promise<{
  context?: RequestStoreContext;
  response?: NextResponse;
}> {
  const context = await getRequestStoreContext();

  if (context?.authenticated) {
    return { context };
  }

  const automationAuthError = validateAutomationToken(request);
  if (automationAuthError) {
    return { response: automationAuthError };
  }

  return context ? { context } : {};
}

function buildExtractionText(priorMessages: Array<{ role: MessageRole; content: string }>, currentText: string) {
  const recent = priorMessages
    .filter((message) => message.role === MessageRole.CUSTOMER)
    .slice(-12)
    .map((message) => `お客様: ${message.content}`);

  return [...recent, `お客様: ${currentText}`].join("\n");
}

function rateLimitMax(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

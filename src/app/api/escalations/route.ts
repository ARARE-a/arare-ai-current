import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  conversationId: z.string().optional(),
  callLogId: z.string().optional(),
  reason: z.enum([
    "UNCLEAR_INPUT",
    "COMPLAINT",
    "DISCOUNT_NEGOTIATION",
    "SPECIAL_REQUEST",
    "NG_WORD",
    "POSSIBLE_BLACKLIST",
    "LOW_CONFIDENCE",
    "RULE_EXCEPTION",
    "PERSONAL_QUESTION"
  ]),
  summary: z.string().min(1),
  assignedTo: z.string().optional()
});

export async function GET(request: NextRequest) {
  try {
    if (!env("DATABASE_URL")) return ok([]);
    void request;
    const { storeId } = await requireRequestStoreContext();
    const escalations = await prisma.escalation.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" }
    });
    return ok(escalations);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext();
    if (!env("DATABASE_URL")) return ok({ dryRun: true, payload }, { status: 201 });
    const { storeId: _ignored, ...data } = payload;
    const escalation = await prisma.escalation.create({ data: { ...data, storeId } });
    await prisma.auditLog.create({
      data: {
        storeId,
        actorType: "AI",
        action: "escalation.created",
        after: payload
      }
    });
    return ok(escalation, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

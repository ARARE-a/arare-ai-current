import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  id: z.string().optional(),
  question: z.string().min(1),
  answer: z.string().min(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const faqs = await prisma.faq.findMany({
      where: { storeId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }]
    });
    return ok(faqs);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    if (payload.id) {
      await prisma.faq.findFirstOrThrow({ where: { id: payload.id, storeId }, select: { id: true } });
    }
    const faq = payload.id
      ? await prisma.faq.update({
          where: { id: payload.id },
          data: {
            question: payload.question,
            answer: payload.answer,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }
        })
      : await prisma.faq.upsert({
          where: { storeId_question: { storeId, question: payload.question } },
          update: {
            answer: payload.answer,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          },
          create: {
            storeId,
            question: payload.question,
            answer: payload.answer,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }
        });

    return ok(faq, { status: payload.id ? 200 : 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

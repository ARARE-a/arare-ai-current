import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  source: z.string().nullable().optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    const payload = schema.parse(await request.json());
    await prisma.knowledgeBase.findFirstOrThrow({ where: { id, storeId }, select: { id: true } });
    const item = await prisma.knowledgeBase.update({
      where: { id },
      data: {
        ...payload,
        source: payload.source === undefined ? undefined : normalizeOptionalText(payload.source)
      }
    });
    return ok(item);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    await prisma.knowledgeBase.findFirstOrThrow({ where: { id, storeId }, select: { id: true } });
    const item = await prisma.knowledgeBase.update({
      where: { id },
      data: { isActive: false }
    });
    return ok(item);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

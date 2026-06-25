import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  source: z.string().nullable().optional(),
  isActive: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category")?.trim();
    const active = searchParams.get("active");

    const items = await prisma.knowledgeBase.findMany({
      where: {
        storeId,
        category: category || undefined,
        isActive: active === null ? undefined : active === "true"
      },
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }]
    });

    return ok(items);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);

    const item = payload.id
      ? await prisma.knowledgeBase.update({
          where: { id: payload.id },
          data: {
            title: payload.title,
            category: payload.category,
            content: payload.content,
            source: normalizeOptionalText(payload.source),
            isActive: payload.isActive
          }
        })
      : await prisma.knowledgeBase.create({
          data: {
            storeId,
            title: payload.title,
            category: payload.category,
            content: payload.content,
            source: normalizeOptionalText(payload.source),
            isActive: payload.isActive
          }
        });

    return ok(item, { status: payload.id ? 200 : 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

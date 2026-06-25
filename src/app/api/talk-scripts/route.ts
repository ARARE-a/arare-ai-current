import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  situation: z.string().min(1),
  content: z.string().min(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
});

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const situation = new URL(request.url).searchParams.get("situation")?.trim();
    const scripts = await prisma.talkScript.findMany({
      where: { storeId, situation: situation || undefined },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }]
    });
    return ok(scripts);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    if (payload.id) {
      await prisma.talkScript.findFirstOrThrow({ where: { id: payload.id, storeId }, select: { id: true } });
    }

    const script = payload.id
      ? await prisma.talkScript.update({
          where: { id: payload.id },
          data: {
            title: payload.title,
            situation: payload.situation,
            content: payload.content,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }
        })
      : await prisma.talkScript.create({
          data: {
            storeId,
            title: payload.title,
            situation: payload.situation,
            content: payload.content,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }
        });

    return ok(script, { status: payload.id ? 200 : 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

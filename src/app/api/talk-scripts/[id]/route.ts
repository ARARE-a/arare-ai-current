import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  title: z.string().min(1).optional(),
  situation: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    await prisma.talkScript.findFirstOrThrow({ where: { id, storeId }, select: { id: true } });
    const script = await prisma.talkScript.update({
      where: { id },
      data: schema.parse(await request.json())
    });
    return ok(script);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    await prisma.talkScript.findFirstOrThrow({ where: { id, storeId }, select: { id: true } });
    const script = await prisma.talkScript.update({ where: { id }, data: { isActive: false } });
    return ok(script);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

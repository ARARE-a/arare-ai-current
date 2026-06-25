import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  name: z.string().min(1),
  isActive: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const rooms = await prisma.room.findMany({ where: { storeId }, orderBy: { name: "asc" } });
    return ok(rooms);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId: _ignored, ...data } = payload;
    const { storeId } = await requireRequestStoreContext();
    const room = await prisma.room.upsert({
      where: { storeId_name: { storeId, name: data.name } },
      update: data,
      create: { ...data, storeId }
    });
    return ok(room, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}


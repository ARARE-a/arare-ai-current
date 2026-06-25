import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  name: z.string().min(1),
  durationMin: z.number().int().min(15),
  price: z.number().int().min(0),
  description: z.string().optional(),
  isActive: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const courses = await prisma.course.findMany({ where: { storeId }, orderBy: { durationMin: "asc" } });
    return ok(courses);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId: _ignored, ...data } = payload;
    const { storeId } = await requireRequestStoreContext();
    const course = await prisma.course.upsert({
      where: { storeId_name: { storeId, name: data.name } },
      update: data,
      create: { ...data, storeId }
    });
    return ok(course, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

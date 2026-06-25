import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const schema = z.object({
  storeId: z.string().optional(),
  name: z.string().min(1),
  phone: z.string().min(8),
  lineId: z.string().optional(),
  memo: z.string().optional(),
  isNg: z.boolean().default(false)
});

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const customers = await prisma.customer.findMany({
      where: { storeId },
      include: { reservations: { include: { course: true, therapist: true }, orderBy: { startsAt: "desc" } } },
      orderBy: { updatedAt: "desc" }
    });
    return ok(customers);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = schema.parse(await request.json());
    const { storeId: _ignored, ...data } = payload;
    const { storeId } = await requireRequestStoreContext();
    const customer = await prisma.customer.upsert({
      where: { storeId_phone: { storeId, phone: data.phone } },
      update: data,
      create: { ...data, storeId }
    });
    return ok(customer, { status: 201 });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}


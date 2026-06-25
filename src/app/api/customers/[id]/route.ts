import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(8).optional(),
  lineId: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  isNg: z.boolean().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const customer = await prisma.customer.update({
      where: { id },
      data: schema.parse(await request.json())
    });
    return ok(customer);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const customer = await prisma.customer.delete({ where: { id } });
    return ok(customer);
  } catch (error) {
    return fail(error);
  }
}

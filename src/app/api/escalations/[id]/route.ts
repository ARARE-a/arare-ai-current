import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]).optional(),
  assignedTo: z.string().nullable().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const escalation = await prisma.escalation.update({
      where: { id },
      data: {
        ...payload,
        resolvedAt: payload.status === "RESOLVED" ? new Date() : undefined
      }
    });
    await prisma.auditLog.create({
      data: {
        storeId: escalation.storeId,
        actorType: "ADMIN",
        action: "escalation.updated",
        after: payload
      }
    });
    return ok(escalation);
  } catch (error) {
    return fail(error);
  }
}

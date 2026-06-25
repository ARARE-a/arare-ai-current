import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const slot = await prisma.blockedSlot.delete({ where: { id } });
    await prisma.auditLog.create({
      data: {
        storeId: slot.storeId,
        actorType: "ADMIN",
        action: "blocked_slot.deleted",
        before: slot
      }
    });
    return ok(slot);
  } catch (error) {
    return fail(error);
  }
}

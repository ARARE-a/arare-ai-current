import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const holds = await prisma.reservationHold.findMany({
      where: { storeId },
      include: { reservation: { include: { customer: true, course: true, therapist: true, room: true } } },
      orderBy: { createdAt: "desc" }
    });
    return ok(holds);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

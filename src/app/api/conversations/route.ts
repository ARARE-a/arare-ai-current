import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const conversations = await prisma.conversation.findMany({
      where: { storeId },
      include: { customer: true, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" }
    });
    return ok(conversations);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

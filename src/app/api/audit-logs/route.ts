import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    if (!env("DATABASE_URL")) return ok([]);
    void request;
    const { storeId } = await requireRequestStoreContext();
    const logs = await prisma.auditLog.findMany({
      where: { storeId },
      include: { reservation: { include: { customer: true, course: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(logs);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

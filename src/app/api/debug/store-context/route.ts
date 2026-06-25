import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireRequestStoreContext();
    const store = await safeDebugQuery("store", () =>
      prisma.store.findUnique({
        where: { id: context.storeId },
        select: { id: true, name: true, updatedAt: true }
      })
    );

    const counts = await Promise.all([
      safeDebugQuery("courses", () => prisma.course.count({ where: { storeId: context.storeId } })),
      safeDebugQuery("activeCourses", () => prisma.course.count({ where: { storeId: context.storeId, isActive: true } })),
      safeDebugQuery("rooms", () => prisma.room.count({ where: { storeId: context.storeId } })),
      safeDebugQuery("activeRooms", () => prisma.room.count({ where: { storeId: context.storeId, isActive: true } })),
      safeDebugQuery("therapists", () => prisma.therapist.count({ where: { storeId: context.storeId } })),
      safeDebugQuery("activeTherapists", () => prisma.therapist.count({ where: { storeId: context.storeId, status: "ACTIVE" } })),
      safeDebugQuery("futureShifts", () => prisma.shift.count({ where: { storeId: context.storeId, endsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "CHECKED_IN"] } } })),
      safeDebugQuery("reservations", () => prisma.reservation.count({ where: { storeId: context.storeId } })),
      safeDebugQuery("conversations", () => prisma.conversation.count({ where: { storeId: context.storeId } })),
      safeDebugQuery("notifications", () => prisma.notification.count({ where: { storeId: context.storeId } }))
    ]);

    return NextResponse.json({
      ok: true,
      context: {
        storeId: context.storeId,
        source: context.source,
        role: context.role ?? null,
        authenticated: context.authenticated,
        clerkConfigured: context.clerkConfigured,
        userEmailMasked: maskEmail(context.userEmail)
      },
      store: unwrapDebugValue(store),
      counts: Object.fromEntries(
        ["courses", "activeCourses", "rooms", "activeRooms", "therapists", "activeTherapists", "futureShifts", "reservations", "conversations", "notifications"].map((key, index) => [
          key,
          unwrapDebugValue(counts[index])
        ])
      ),
      queryErrors: [store, ...counts].filter((item) => item && typeof item === "object" && "error" in item)
    });
  } catch (error) {
    if (error instanceof StoreAccessError) {
      return NextResponse.json({ ok: false, error: error.message, reason: error.reason }, { status: error.status });
    }

    console.error("debug store-context failed", error);
    return NextResponse.json({ ok: false, error: "debug store-context failed" }, { status: 500 });
  }
}

function maskEmail(email?: string) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

async function safeDebugQuery<T>(label: string, query: () => Promise<T>) {
  try {
    return { label, value: await query() };
  } catch (error) {
    return { label, error: error instanceof Error ? error.message : "unknown error" };
  }
}

function unwrapDebugValue<T>(result: { value?: T; error?: string }) {
  return "error" in result ? null : result.value ?? null;
}

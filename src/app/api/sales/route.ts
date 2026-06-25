import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    void request;
    const { storeId } = await requireRequestStoreContext();
    const reservations = await prisma.reservation.findMany({
      where: { storeId, status: { in: ["CONFIRMED", "VISITED"] } },
      include: { course: true, therapist: true, customer: true }
    });
    const shifts = await prisma.shift.findMany({
      where: { storeId, endsAt: { gte: jstDayStart(new Date()) } }
    });

    const today = jstDayStart(new Date());
    const tomorrow = addDays(today, 1);
    const month = jstMonthStart(new Date());
    const total = reservations.reduce((sum, item) => sum + reservationAmount(item), 0);
    const daily = reservations
      .filter((item) => item.startsAt >= today && item.startsAt < tomorrow)
      .reduce((sum, item) => sum + reservationAmount(item), 0);
    const monthly = reservations
      .filter((item) => item.startsAt >= month)
      .reduce((sum, item) => sum + reservationAmount(item), 0);
    const nominated = reservations.filter((item) => item.nominated).length;
    const repeat = reservations.filter((item) => item.customer.visitCount > 1).length;
    const bookedMinutes = reservations.reduce((sum, item) => sum + minutesBetween(item.startsAt, item.endsAt), 0);
    const shiftMinutes = shifts.reduce((sum, item) => sum + minutesBetween(item.startsAt, item.endsAt), 0);

    return ok({
      total,
      daily,
      monthly,
      reservationCount: reservations.length,
      nominationRate: reservations.length ? Math.round((nominated / reservations.length) * 100) : 0,
      repeatRate: reservations.length ? Math.round((repeat / reservations.length) * 100) : 0,
      utilizationRate: shiftMinutes ? Math.min(100, Math.round((bookedMinutes / shiftMinutes) * 100)) : 0,
      byTherapist: groupBy(reservations, (item) => item.therapist?.displayName ?? "未割当"),
      byCourse: groupBy(reservations, (item) => item.course.name)
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

function groupBy<T extends { course: { price: number }; nominated?: boolean; therapist?: { nominationFee: number } | null }>(
  items: T[],
  key: (item: T) => string
) {
  return Object.values(
    items.reduce<Record<string, { name: string; amount: number; count: number }>>((acc, item) => {
      const name = key(item);
      acc[name] ??= { name, amount: 0, count: 0 };
      acc[name].amount += reservationAmount(item);
      acc[name].count += 1;
      return acc;
    }, {})
  );
}

function reservationAmount(item: { course: { price: number }; nominated?: boolean; therapist?: { nominationFee: number } | null }) {
  return item.course.price + (item.nominated ? item.therapist?.nominationFee ?? 0 : 0);
}

function jstDayStart(date: Date) {
  const parts = jstParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, -9, 0, 0, 0));
}

function jstMonthStart(date: Date) {
  const parts = jstParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, 1, -9, 0, 0, 0));
}

function jstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

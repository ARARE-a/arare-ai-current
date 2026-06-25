import { ReservationStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createReservation, findAvailability } from "@/lib/reservation-service";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { storeId } = await requireRequestStoreContext();
    const status = searchParams.get("status") as ReservationStatus | null;

    const reservations = await prisma.reservation.findMany({
      where: { storeId, status: status ?? undefined },
      include: { customer: true, therapist: true, room: true, course: true },
      orderBy: { startsAt: "asc" }
    });

    return ok(reservations);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const { storeId } = await requireRequestStoreContext();
    const reservation = await createReservation({ ...payload, storeId });
    return ok(reservation, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

const availabilitySchema = z.object({
  storeId: z.string().optional(),
  startsAt: z.coerce.date(),
  courseId: z.string(),
  therapistId: z.string().optional(),
  roomId: z.string().optional(),
  excludeReservationId: z.string().optional()
});

export async function PUT(request: NextRequest) {
  try {
    const payload = availabilitySchema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext();
    const availability = await findAvailability({ ...payload, storeId });
    return ok(availability);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

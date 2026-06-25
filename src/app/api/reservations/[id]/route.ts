import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { cancelReservation, updateReservation, updateReservationSchema } from "@/lib/reservation-service";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext();
    const reservation = await prisma.reservation.findFirstOrThrow({
      where: { id, storeId },
      include: { customer: true, therapist: true, room: true, course: true }
    });
    return ok(reservation);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 404);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext();
    const payload = updateReservationSchema.parse(await request.json());
    const reservation = await updateReservation(id, { ...payload, storeId });
    return ok(reservation);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext();
    const body = await request.json().catch(() => ({}));
    const reservation = await cancelReservation(id, { ...body, storeId });
    return ok(reservation);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

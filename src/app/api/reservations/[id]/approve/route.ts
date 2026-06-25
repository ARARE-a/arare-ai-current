import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { approveReservation } from "@/lib/reservation-service";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { storeId } = await requireRequestStoreContext();
    const body = await request.json().catch(() => ({}));
    const reservation = await approveReservation(id, { ...body, storeId });
    return ok(reservation);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

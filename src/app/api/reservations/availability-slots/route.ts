import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { findAvailabilitySlots } from "@/lib/reservation-service";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const availabilitySlotsSchema = z.object({
  startsAtList: z.array(z.coerce.date()).min(1).max(60),
  courseId: z.string().min(1),
  therapistId: z.string().optional(),
  roomId: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional()
});

export async function POST(request: NextRequest) {
  try {
    const payload = availabilitySlotsSchema.parse(await request.json());
    const { storeId } = await requireRequestStoreContext();
    const slots = await findAvailabilitySlots({ ...payload, storeId });
    return ok(slots);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

import { ConversationChannel, ReservationStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { approveReservation, createReservation } from "@/lib/reservation-service";
import { requireRequestStoreContext } from "@/lib/store-access";

const schema = z.object({
  customer: z.string().min(1),
  phone: z.string().min(8),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  room: z.string().min(1),
  course: z.string().min(1),
  therapist: z.string().min(1),
  source: z.enum(["LINE", "電話", "Webチャット"]),
  status: z.enum(["仮予約", "確定"]).default("仮予約")
});

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await requireRequestStoreContext();
    const payload = schema.parse(await request.json());
    const course = await prisma.course.findFirstOrThrow({ where: { storeId, name: payload.course } });
    const therapist = await prisma.therapist.findFirstOrThrow({ where: { storeId, displayName: payload.therapist } });
    const room = await prisma.room.findFirstOrThrow({ where: { storeId, name: payload.room } });

    const startsAt = new Date();
    const [hour, minute] = payload.time.split(":").map(Number);
    startsAt.setHours(hour, minute, 0, 0);

    const reservation = await createReservation({
      storeId,
      customer: {
        name: payload.customer,
        phone: payload.phone
      },
      startsAt,
      courseId: course.id,
      therapistId: therapist.id,
      roomId: room.id,
      nominated: true,
      firstVisit: false,
      attentionConfirmed: true,
      source: toChannel(payload.source),
      status: ReservationStatus.TENTATIVE,
      actorType: "ADMIN"
    });

    if (payload.status === "確定") {
      const approved = await approveReservation(reservation.id, { storeId, actorType: "ADMIN" });
      return ok(approved, { status: 201 });
    }

    return ok(reservation, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

function toChannel(channel: "LINE" | "電話" | "Webチャット") {
  if (channel === "電話") return ConversationChannel.PHONE;
  if (channel === "Webチャット") return ConversationChannel.WEB_CHAT;
  return ConversationChannel.LINE;
}

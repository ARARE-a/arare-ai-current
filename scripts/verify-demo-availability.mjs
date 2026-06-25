import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storeId = process.env.DEMO_STORE_ID ?? "demo-store-arare-ai";

function roundUpToSlot(date, slotMinutes = 30) {
  const slotMs = slotMinutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / slotMs) * slotMs);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const startsAt = roundUpToSlot(new Date(Date.now() + 5 * 60 * 1000));
  const course = await prisma.course.findFirst({
    where: { storeId, isActive: true },
    orderBy: [{ durationMin: "asc" }, { price: "asc" }]
  });
  if (!course) throw new Error("No active course found");
  const endsAt = new Date(startsAt.getTime() + course.durationMin * 60 * 1000);

  const [shifts, rooms, reservations, blockedSlots] = await Promise.all([
    prisma.shift.findMany({
      where: {
        storeId,
        startsAt: { lte: startsAt },
        endsAt: { gte: endsAt },
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
        therapist: { status: "ACTIVE" }
      },
      include: { therapist: { select: { displayName: true } } },
      orderBy: { startsAt: "asc" }
    }),
    prisma.room.findMany({ where: { storeId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.reservation.findMany({
      where: {
        storeId,
        status: { in: ["TENTATIVE", "CONFIRMED", "VISITED"] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt }
      },
      select: { therapistId: true, roomId: true }
    }),
    prisma.blockedSlot.findMany({
      where: {
        storeId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt }
      },
      select: { therapistId: true, roomId: true }
    })
  ]);

  const busyTherapistIds = new Set(reservations.map((item) => item.therapistId).filter(Boolean));
  const busyRoomIds = new Set(reservations.map((item) => item.roomId).filter(Boolean));
  const blockedTherapistIds = new Set(blockedSlots.map((item) => item.therapistId).filter(Boolean));
  const blockedRoomIds = new Set(blockedSlots.map((item) => item.roomId).filter(Boolean));
  const availableTherapists = shifts.filter(
    (shift) => !busyTherapistIds.has(shift.therapistId) && !blockedTherapistIds.has(shift.therapistId)
  );
  const availableRooms = rooms.filter((room) => !busyRoomIds.has(room.id) && !blockedRoomIds.has(room.id));

  console.log(
    JSON.stringify(
      {
        ok: availableTherapists.length > 0 && availableRooms.length > 0,
        storeId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        course: { name: course.name, durationMin: course.durationMin },
        shiftCount: shifts.length,
        roomCount: rooms.length,
        reservationCount: reservations.length,
        blockedSlotCount: blockedSlots.length,
        availableTherapistCount: availableTherapists.length,
        availableRoomCount: availableRooms.length,
        sample: {
          therapist: availableTherapists[0]?.therapist.displayName ?? null,
          room: availableRooms[0]?.name ?? null
        }
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

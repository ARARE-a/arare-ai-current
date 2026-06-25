import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storeId = process.env.DEMO_STORE_ID ?? "demo-store-arare-ai";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const [reservations, notifications] = await Promise.all([
    prisma.reservation.findMany({
      where: { storeId },
      include: {
        customer: { select: { name: true, phone: true } },
        therapist: { select: { displayName: true } },
        room: { select: { name: true } },
        course: { select: { name: true, durationMin: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.notificationLog.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        reservations: reservations.map((reservation) => ({
          id: reservation.id,
          status: reservation.status,
          createdAt: reservation.createdAt.toISOString(),
          startsAt: reservation.startsAt.toISOString(),
          endsAt: reservation.endsAt.toISOString(),
          customer: reservation.customer?.name ?? null,
          phone: reservation.customer?.phone ?? null,
          therapist: reservation.therapist?.displayName ?? null,
          room: reservation.room?.name ?? null,
          course: reservation.course?.name ?? null,
          source: reservation.source
        })),
        notifications: notifications.map((notification) => ({
          id: notification.id,
          status: notification.status,
          type: notification.type,
          channel: notification.channel,
          createdAt: notification.createdAt.toISOString(),
          recipientName: notification.recipientName,
          recipientPhone: notification.recipientPhone,
          provider: notification.provider,
          errorCode: notification.errorCode,
          errorMessage: notification.errorMessage
        }))
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

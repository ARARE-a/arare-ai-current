import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv(".env.local");
loadEnv(".env");

const prisma = new PrismaClient();
const now = new Date();
const activeReservationStatuses = ["TENTATIVE", "CONFIRMED"];
const queryErrors = [];

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);
  const futureActiveReservations = await prisma.reservation.findMany({
    where: {
      startsAt: { gte: now },
      status: { in: activeReservationStatuses }
    },
    select: {
      id: true,
      storeId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      roomId: true,
      therapistId: true,
      courseId: true,
      customerId: true
    },
    orderBy: { startsAt: "asc" },
    take: 500
  });

  const storeCount = await safeQuery("Store.count", () => prisma.store.count());
  const courseCount = await safeQuery("Course.count", () => prisma.course.count());
  const roomCount = await safeQuery("Room.count", () => prisma.room.count());
  const activeRoomCount = await safeQuery("Room.active.count", () => prisma.room.count({ where: { isActive: true } }));
  const therapistCount = await safeQuery("Therapist.count", () => prisma.therapist.count());
  const activeTherapistCount = await safeQuery("Therapist.active.count", () =>
    prisma.therapist.count({ where: { status: "ACTIVE" } })
  );
  const shiftCount = await safeQuery("Shift.count", () => prisma.shift.count());
  const shiftsFromNowCount = await safeQuery("Shift.future.count", () =>
    prisma.shift.count({ where: { endsAt: { gte: now }, status: { in: ["SCHEDULED", "CHECKED_IN"] } } })
  );
  const reservationCount = await safeQuery("Reservation.count", () => prisma.reservation.count());
  const reservationHoldCount = await safeQuery("ReservationHold.count", () => prisma.reservationHold.count());
  const notificationCount = await safeQuery("Notification.count", () => prisma.notification.count());
  const notificationLogCount = await safeQuery("NotificationLog.count", () => prisma.notificationLog.count());
  const callLogCount = await safeQuery("CallLog.count", () => prisma.callLog.count());
  const conversationCount = await safeQuery("Conversation.count", () => prisma.conversation.count());
  const customerCount = await safeQuery("Customer.count", () => prisma.customer.count());
  const userCount = await safeQuery("User.count", () => prisma.user.count());
  const notificationStatusGroups = await safeQuery("Notification.groupBy.status", () =>
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } })
  );
  const notificationLogStatusGroups = await safeQuery("NotificationLog.groupBy.status", () =>
    prisma.notificationLog.groupBy({ by: ["status"], _count: { _all: true } })
  );
  const knowledgeBaseCount = await safeQuery("KnowledgeBase.count", () => prisma.knowledgeBase.count());
  const faqCount = await safeQuery("Faq.count", () => prisma.faq.count());
  const talkScriptCount = await safeQuery("TalkScript.count", () => prisma.talkScript.count());
  const reservationChangeHistoryCount = await safeQuery("ReservationChangeHistory.count", () =>
    prisma.reservationChangeHistory.count()
  );
  const therapistSpecialtiesSample = await safeQuery("Therapist.specialties.sample", () =>
    prisma.therapist.findMany({
      select: { id: true, displayName: true, specialties: true },
      take: 5,
      orderBy: { createdAt: "asc" }
    })
  );
  const reservationStatusGroups = await safeQuery("Reservation.groupBy.status", () =>
    prisma.reservation.groupBy({ by: ["status"], _count: { _all: true } })
  );
  const callLogStatusGroups = await safeQuery("CallLog.groupBy.status", () =>
    prisma.callLog.groupBy({ by: ["status"], _count: { _all: true } })
  );

  const missingReservationLinks = futureActiveReservations
    .map((reservation) => ({
      id: reservation.id,
      status: reservation.status,
      startsAt: reservation.startsAt.toISOString(),
      missing: ["roomId", "therapistId", "courseId", "customerId"].filter((key) => !reservation[key])
    }))
    .filter((reservation) => reservation.missing.length > 0);

  const conflicts = findReservationConflicts(futureActiveReservations);
  const checks = {
    schemaReadableForCheckedModels: queryErrors.length === 0,
    prdCoreModelsReadable:
      numberOrZero(knowledgeBaseCount) >= 0 &&
      numberOrZero(faqCount) >= 0 &&
      numberOrZero(talkScriptCount) >= 0 &&
      numberOrZero(notificationLogCount) >= 0 &&
      numberOrZero(reservationChangeHistoryCount) >= 0 &&
      Array.isArray(therapistSpecialtiesSample),
    coreDemoDataPresent: positive(storeCount) && positive(courseCount) && positive(activeRoomCount) && positive(activeTherapistCount),
    futureActiveReservationsHaveRequiredLinks: missingReservationLinks.length === 0,
    noFutureRoomOrTherapistOverlapInSample: conflicts.length === 0,
    futureShiftDataPresent: positive(shiftsFromNowCount)
  };

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        dbHost: databaseUrl.host,
        readOnly: true,
        counts: {
          stores: storeCount,
          courses: courseCount,
          rooms: roomCount,
          activeRooms: activeRoomCount,
          therapists: therapistCount,
          activeTherapists: activeTherapistCount,
          shifts: shiftCount,
          shiftsFromNow: shiftsFromNowCount,
          reservations: reservationCount,
          futureActiveReservationsSampled: futureActiveReservations.length,
          reservationHolds: reservationHoldCount,
          notifications: notificationCount,
          notificationLogs: notificationLogCount,
          knowledgeBase: knowledgeBaseCount,
          faq: faqCount,
          talkScripts: talkScriptCount,
          reservationChangeHistory: reservationChangeHistoryCount,
          callLogs: callLogCount,
          conversations: conversationCount,
          customers: customerCount,
          users: userCount
        },
        groupedCounts: {
          reservations: toCountMap(reservationStatusGroups, "status"),
          notifications: toCountMap(notificationStatusGroups, "status"),
          notificationLogs: toCountMap(notificationLogStatusGroups, "status"),
          callLogs: toCountMap(callLogStatusGroups, "status")
        },
        checks,
        queryErrors,
        prdCoreModelSamples: {
          therapistSpecialties: Array.isArray(therapistSpecialtiesSample)
            ? therapistSpecialtiesSample.map((therapist) => ({
                id: therapist.id,
                displayName: therapist.displayName,
                specialties: therapist.specialties
              }))
            : null
        },
        missingReservationLinks,
        conflicts,
        sampledFutureReservationIds: futureActiveReservations.slice(0, 10).map((reservation) => reservation.id)
      },
      null,
      2
    )
  );

  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
} finally {
  await prisma.$disconnect();
}

function findReservationConflicts(reservations) {
  const conflicts = [];

  for (let i = 0; i < reservations.length; i += 1) {
    for (let j = i + 1; j < reservations.length; j += 1) {
      const a = reservations[i];
      const b = reservations[j];
      if (a.storeId !== b.storeId) continue;
      if (!(a.startsAt < b.endsAt && b.startsAt < a.endsAt)) continue;

      if (a.roomId && a.roomId === b.roomId) {
        conflicts.push({
          type: "room",
          reservationA: a.id,
          reservationB: b.id,
          startsAtA: a.startsAt.toISOString(),
          startsAtB: b.startsAt.toISOString()
        });
      }

      if (a.therapistId && a.therapistId === b.therapistId) {
        conflicts.push({
          type: "therapist",
          reservationA: a.id,
          reservationB: b.id,
          startsAtA: a.startsAt.toISOString(),
          startsAtB: b.startsAt.toISOString()
        });
      }
    }
  }

  return conflicts;
}

function toCountMap(rows, key) {
  if (!Array.isArray(rows)) return null;
  return Object.fromEntries(rows.map((row) => [row[key], row._count._all]));
}

async function safeQuery(name, fn) {
  try {
    return await fn();
  } catch (error) {
    queryErrors.push({
      name,
      code: error?.code ?? null,
      message: summarizeError(error)
    });
    return null;
  }
}

function positive(value) {
  return typeof value === "number" && value > 0;
}

function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

function summarizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\s+/g, " ")
    .replace(/Invalid `[^`]+` invocation:/g, "Invalid Prisma invocation:")
    .slice(0, 220);
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

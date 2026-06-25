import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const storeId = process.env.DEMO_STORE_ID ?? "demo-store-arare-ai";
const apply = process.argv.includes("--apply");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Math.max(1, Number(daysArg?.split("=")[1] ?? 7));

function currentJstParts(date = new Date()) {
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

function jstDate(dayOffset, hour, minute = 0) {
  const base = currentJstParts();
  return new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset, hour - 9, minute, 0, 0));
}

async function upsertShift(therapist, dayOffset) {
  const startsAt = jstDate(dayOffset, 12);
  const endsAt = jstDate(dayOffset + 1, 5);
  const existing = await prisma.shift.findFirst({
    where: {
      storeId,
      therapistId: therapist.id,
      startsAt,
      endsAt
    },
    select: { id: true, status: true }
  });

  if (!apply) {
    return {
      action: existing ? "would_keep" : "would_create",
      therapist: therapist.displayName,
      startsAt,
      endsAt
    };
  }

  if (existing) {
    const shift =
      existing.status === "SCHEDULED"
        ? existing
        : await prisma.shift.update({ where: { id: existing.id }, data: { status: "SCHEDULED" }, select: { id: true } });
    return { action: "kept", id: shift.id, therapist: therapist.displayName, startsAt, endsAt };
  }

  const shift = await prisma.shift.create({
    data: {
      storeId,
      therapistId: therapist.id,
      startsAt,
      endsAt,
      status: "SCHEDULED"
    },
    select: { id: true }
  });
  return { action: "created", id: shift.id, therapist: therapist.displayName, startsAt, endsAt };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, openTime: true, closeTime: true }
  });
  if (!store) {
    throw new Error(`Store not found: ${storeId}`);
  }

  const therapists = await prisma.therapist.findMany({
    where: { storeId, status: "ACTIVE" },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" }
  });
  if (!therapists.length) {
    throw new Error(`No ACTIVE therapists found for store: ${storeId}`);
  }

  const results = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    for (const therapist of therapists) {
      results.push(await upsertShift(therapist, dayOffset));
    }
  }

  const futureShiftCount = await prisma.shift.count({
    where: {
      storeId,
      endsAt: { gte: new Date() },
      status: { in: ["SCHEDULED", "CHECKED_IN"] }
    }
  });

  const summary = results.reduce(
    (acc, item) => {
      acc[item.action] = (acc[item.action] ?? 0) + 1;
      return acc;
    },
    {}
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: apply ? "applied" : "dry-run",
        store,
        days,
        therapistCount: therapists.length,
        therapists: therapists.map((item) => item.displayName),
        summary,
        futureShiftCount,
        firstShift: results[0]
          ? {
              therapist: results[0].therapist,
              startsAt: results[0].startsAt.toISOString(),
              endsAt: results[0].endsAt.toISOString()
            }
          : null,
        lastShift: results.at(-1)
          ? {
              therapist: results.at(-1).therapist,
              startsAt: results.at(-1).startsAt.toISOString(),
              endsAt: results.at(-1).endsAt.toISOString()
            }
          : null
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

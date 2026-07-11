const ACTIVE_SHIFT_STATUSES = new Set(["SCHEDULED", "CHECKED_IN"]);

export async function ensureDemoBusinessHourShifts({
  prisma,
  storeId,
  days = 90,
  now = new Date(),
  apply = true
}) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      openTime: true,
      closeTime: true,
      therapists: {
        where: { status: "ACTIVE" },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true }
      }
    }
  });
  if (!store) throw new Error(`Demo store not found: ${storeId}`);
  if (!store.therapists.length) throw new Error(`No active therapists found: ${storeId}`);

  const dayCount = Math.max(1, Math.floor(Number(days) || 90));
  const openMinutes = parseBusinessClock(store.openTime, 12 * 60);
  let closeMinutes = parseBusinessClock(store.closeTime, 29 * 60);
  if (closeMinutes <= openMinutes) closeMinutes += 24 * 60;
  const today = getJstDateParts(now);
  const expected = [];

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    const date = addJstDays(today, dayOffset);
    const startsAt = jstBusinessTimeToDate(date, openMinutes);
    const endsAt = jstBusinessTimeToDate(date, closeMinutes);
    const dateKey = formatDateKey(date);
    for (const therapist of store.therapists) {
      expected.push({
        id: buildShiftId(dateKey, therapist.id),
        storeId,
        therapistId: therapist.id,
        therapistName: therapist.displayName,
        startsAt,
        endsAt,
        status: "SCHEDULED"
      });
    }
  }

  const existing = await prisma.shift.findMany({
    where: {
      storeId,
      startsAt: { lt: expected.at(-1).endsAt },
      endsAt: { gt: expected[0].startsAt }
    },
    select: { id: true, therapistId: true, startsAt: true, endsAt: true, status: true }
  });
  const covering = new Set();
  for (const row of expected) {
    const match = existing.find(
      (item) =>
        item.therapistId === row.therapistId &&
        ACTIVE_SHIFT_STATUSES.has(item.status) &&
        item.startsAt <= row.startsAt &&
        item.endsAt >= row.endsAt
    );
    if (match) covering.add(row.id);
  }

  const missing = expected.filter((row) => !covering.has(row.id));
  if (apply) {
    for (const row of missing) {
      await prisma.shift.upsert({
        where: { id: row.id },
        update: {
          storeId: row.storeId,
          therapistId: row.therapistId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status
        },
        create: {
          id: row.id,
          storeId: row.storeId,
          therapistId: row.therapistId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status
        }
      });
    }
  }

  return {
    storeId,
    storeName: store.name,
    openTime: store.openTime,
    closeTime: store.closeTime,
    days: dayCount,
    therapistCount: store.therapists.length,
    expectedShiftCount: expected.length,
    alreadyCovered: covering.size,
    createdOrUpdated: apply ? missing.length : 0,
    wouldCreateOrUpdate: missing.length,
    firstStartsAt: expected[0].startsAt,
    lastEndsAt: expected.at(-1).endsAt
  };
}

export function parseBusinessClock(value, fallbackMinutes) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})(?::([0-5]\d))?$/);
  if (!match) return fallbackMinutes;
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

function getJstDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addJstDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function jstBusinessTimeToDate(parts, totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 9, minute, 0, 0));
}

function formatDateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function buildShiftId(dateKey, therapistId) {
  const safeTherapistId = String(therapistId).replace(/[^A-Za-z0-9_-]/g, "-");
  return `demo-auto-shift-${dateKey}-${safeTherapistId}`;
}

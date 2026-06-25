import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRequestStoreContext, StoreAccessError } from "@/lib/store-access";

const courseSchema = z.object({
  name: z.string().min(1),
  durationMin: z.number().int().min(1),
  price: z.number().int().min(0),
  description: z.string().optional(),
  isActive: z.boolean().default(true)
});

const therapistSchema = z.object({
  displayName: z.string().min(1),
  phone: z.string().optional(),
  lineId: z.string().optional(),
  profile: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).default("ACTIVE"),
  acceptsNomination: z.boolean().default(true),
  nominationFee: z.number().int().min(0).default(0)
});

const roomSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(true)
});

const shiftSchema = z.object({
  therapistName: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.enum(["SCHEDULED", "CHECKED_IN", "COMPLETED", "CANCELLED"]).default("SCHEDULED")
});

const schema = z
  .object({
    storeId: z.string().optional(),
    url: z.string().url().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    store: z
      .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        openTime: z.string().optional(),
        closeTime: z.string().optional()
      })
      .optional(),
    courses: z.array(courseSchema).default([]),
    therapists: z.array(therapistSchema).default([]),
    rooms: z.array(roomSchema).default([]),
    shifts: z.array(shiftSchema).default([])
  })
  .refine(
    (value) => Boolean(value.url || value.html || value.text || value.store || value.courses.length || value.therapists.length || value.rooms.length || value.shifts.length),
    "url/html/text/store/courses/therapists/rooms/shifts のいずれかが必要です"
  );

type ParsedShift = {
  therapistName: string;
  startsAt: Date;
  endsAt: Date;
};

type CourseInput = z.infer<typeof courseSchema>;
type TherapistInput = z.infer<typeof therapistSchema>;
type RoomInput = z.infer<typeof roomSchema>;

export async function POST(request: NextRequest) {
  let storeId = "";
  let body: unknown;

  try {
    const context = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    storeId = context.storeId;
    body = await request.json();
  } catch (error) {
    const status = error instanceof StoreAccessError ? error.status : 400;
    const message = error instanceof StoreAccessError ? error.reason : "invalid_json";
    return NextResponse.json({ error: message }, { status });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const fetched = payload.url ? await fetchHomepageText(payload.url) : { text: "", source: "manual" };
  if ("error" in fetched) return fetched.error;

  const sourceText = [payload.text, payload.html ? htmlToText(payload.html) : "", fetched.text].filter(Boolean).join("\n");
  const hours = extractBusinessHours(sourceText);
  const courses = uniqueCourses([...payload.courses, ...extractCourses(sourceText)]);
  const extractedTherapistNames = extractTherapistNames(sourceText);
  const therapists = uniqueTherapists([
    ...payload.therapists,
    ...extractedTherapistNames.map((displayName) => ({ displayName, status: "ACTIVE" as const, acceptsNomination: true, nominationFee: 0 }))
  ]);
  const rooms = uniqueRooms([...payload.rooms, ...extractRooms(sourceText)]);
  const parsedShifts: Array<ParsedShift & { status?: "SCHEDULED" | "CHECKED_IN" | "COMPLETED" | "CANCELLED" }> = [
    ...payload.shifts,
    ...extractShifts(sourceText, therapists.map((item) => item.displayName))
  ];

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.store.findUnique({ where: { id: storeId } });
    const storeUpdateData = compact({
      name: payload.store?.name,
      phone: payload.store?.phone,
      address: payload.store?.address,
      openTime: payload.store?.openTime ?? hours?.openTime,
      closeTime: payload.store?.closeTime ?? hours?.closeTime
    });

    const store = Object.keys(storeUpdateData).length
      ? await tx.store.update({ where: { id: storeId }, data: storeUpdateData })
      : before;

    const courseResults = [];
    for (const course of courses) {
      courseResults.push(
        await tx.course.upsert({
          where: { storeId_name: { storeId, name: course.name } },
          update: {
            durationMin: course.durationMin,
            price: course.price,
            description: course.description,
            isActive: course.isActive ?? true
          },
          create: {
            storeId,
            name: course.name,
            durationMin: course.durationMin,
            price: course.price,
            description: course.description,
            isActive: course.isActive ?? true
          }
        })
      );
    }

    const therapistResults = [];
    for (const therapist of therapists) {
      const lineId = normalizeOptionalText(therapist.lineId);
      if (lineId) {
        const duplicate = await tx.therapist.findFirst({
          where: {
            storeId,
            lineId,
            displayName: { not: therapist.displayName }
          },
          select: { displayName: true }
        });
        if (duplicate) throw new Error(`LINE ID is already registered to ${duplicate.displayName}`);
      }

      therapistResults.push(
        await tx.therapist.upsert({
          where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
          update: compact({
            phone: normalizeOptionalText(therapist.phone),
            lineId,
            profile: normalizeOptionalText(therapist.profile),
            status: therapist.status,
            acceptsNomination: therapist.acceptsNomination,
            nominationFee: therapist.nominationFee > 0 ? therapist.nominationFee : undefined
          }),
          create: {
            displayName: therapist.displayName,
            storeId,
            phone: normalizeOptionalText(therapist.phone),
            lineId,
            profile: normalizeOptionalText(therapist.profile),
            status: therapist.status,
            acceptsNomination: therapist.acceptsNomination,
            nominationFee: therapist.nominationFee
          }
        })
      );
    }

    const roomResults = [];
    for (const room of rooms) {
      roomResults.push(
        await tx.room.upsert({
          where: { storeId_name: { storeId, name: room.name } },
          update: { isActive: room.isActive },
          create: { storeId, name: room.name, isActive: room.isActive }
        })
      );
    }

    const therapistByName = new Map(therapistResults.map((therapist) => [therapist.displayName, therapist]));
    const shiftResults = [];
    for (const shift of parsedShifts) {
      const therapist = therapistByName.get(shift.therapistName);
      if (!therapist) continue;

      const existing = await tx.shift.findFirst({
        where: {
          storeId,
          therapistId: therapist.id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt
        }
      });

      if (existing) {
        shiftResults.push(existing);
        continue;
      }

      shiftResults.push(
        await tx.shift.create({
          data: {
            storeId,
            therapistId: therapist.id,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            status: shift.status ?? "SCHEDULED"
          }
        })
      );
    }

    const audit = await tx.auditLog.create({
      data: {
        storeId,
        actorType: "SYSTEM",
        action: "store.homepage_imported",
        before: before
          ? {
              name: before.name,
              phone: before.phone,
              address: before.address,
              openTime: before.openTime,
              closeTime: before.closeTime
            }
          : undefined,
        after: {
          source: payload.url ? "url" : "manual",
          url: payload.url ?? null,
          store: store
            ? {
                name: store.name,
                phone: store.phone,
                address: store.address,
                openTime: store.openTime,
                closeTime: store.closeTime
              }
            : null,
          courses: courseResults.map((course) => course.name),
          therapists: therapistResults.map((therapist) => therapist.displayName),
          rooms: roomResults.map((room) => room.name),
          shifts: shiftResults.map((shift) => ({
            therapistId: shift.therapistId,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString()
          }))
        }
      }
    });

    return {
      store,
      imported: {
        courses: courseResults,
        therapists: therapistResults,
        rooms: roomResults,
        shifts: shiftResults,
        auditLogId: audit.id
      },
      parsed: {
        courses: courses.length,
        therapists: therapists.length,
        rooms: rooms.length,
        shifts: parsedShifts.length
      }
    };
  });

  return ok(result);
}

async function fetchHomepageText(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "ARARE-AI-store-import/1.0" } });
  } catch (error) {
    return {
      error: NextResponse.json(
        { error: "homepage_fetch_failed", details: error instanceof Error ? error.message : String(error) },
        { status: 502 }
      )
    };
  }

  if (!response.ok) {
    return { error: NextResponse.json({ error: "homepage_fetch_failed", status: response.status }, { status: 502 }) };
  }

  return { text: htmlToText(await response.text()), source: "url" };
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h1|h2|h3|section|article|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&yen;/g, "円")
    .replace(/&#165;/g, "円")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractBusinessHours(text: string) {
  const normalized = normalizeDigits(text);
  const match = normalized.match(
    /(?:営業時間|受付時間|OPEN|Open|open)[^\d]{0,30}(\d{1,2})(?::(\d{2}))?\s*(?:-|~|〜|から)\s*(\d{1,2})(?::(\d{2}))?/
  );
  if (!match) return null;

  const openHour = Number(match[1]);
  const openMinute = Number(match[2] ?? 0);
  const closeHourRaw = Number(match[3]);
  const closeMinute = Number(match[4] ?? 0);
  const closeHour = closeHourRaw <= openHour ? closeHourRaw + 24 : closeHourRaw;

  return { openTime: formatClock(openHour, openMinute), closeTime: formatClock(closeHour, closeMinute) };
}

function extractCourses(text: string): CourseInput[] {
  const normalized = normalizeDigits(text);
  const matches = normalized.matchAll(/(\d{2,3})\s*(?:分|min|minutes?)\s*(?:コース)?[^\d円￥¥]{0,40}(?:¥|￥|円)?\s*([0-9,]{4,7})\s*(?:円|yen)?/gi);
  const courses: CourseInput[] = [];

  for (const match of matches) {
    const durationMin = Number(match[1]);
    const price = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(durationMin) || !Number.isFinite(price)) continue;
    if (durationMin < 20 || durationMin > 300) continue;
    courses.push({
      name: `${durationMin}分コース`,
      durationMin,
      price,
      description: `${durationMin}分 / ${price.toLocaleString("ja-JP")}円`,
      isActive: true
    });
  }

  return courses;
}

function extractTherapistNames(text: string) {
  const names = new Set<string>();
  const normalized = text.replace(/[ \t]+/g, " ");
  const patterns = [
    /(?:セラピスト|スタッフ|キャスト|名前|name)[:：\s]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-zー・]{2,16})/giu,
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-zー・]{2,16})(?:さん|ちゃん|様)?\s*(?:出勤|勤務|本日出勤|出勤中)/gu
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const name = sanitizeName(match[1]);
      if (!name || isInvalidTherapistName(name)) continue;
      names.add(name);
    }
  }

  return Array.from(names).slice(0, 30);
}

function extractRooms(text: string): RoomInput[] {
  const rooms = new Set<string>();
  const normalized = normalizeDigits(text);
  for (const match of normalized.matchAll(/(?:ルーム|部屋|Room|room)[:：\s]*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー・\s]{1,24})/giu)) {
    const name = sanitizeName(match[1]);
    if (name) rooms.add(name);
  }
  return Array.from(rooms).map((name) => ({ name, isActive: true })).slice(0, 20);
}

function extractShifts(text: string, therapistNames: string[]): ParsedShift[] {
  if (therapistNames.length === 0) return [];

  const normalized = normalizeDigits(text);
  const lines = normalized.split(/\n|。|　/).map((line) => line.trim()).filter(Boolean);
  const shifts: ParsedShift[] = [];

  for (const line of lines) {
    const therapistName = therapistNames.find((name) => line.includes(name));
    if (!therapistName) continue;

    const date = parseJapaneseDate(line);
    const range = parseTimeRange(line);
    if (!date || !range) continue;

    const startsAt = toJstUtcDate(date.year, date.month, date.day, range.startHour, range.startMinute);
    let endsAt = toJstUtcDate(date.year, date.month, date.day, range.endHour, range.endMinute);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
    shifts.push({ therapistName, startsAt, endsAt });
  }

  return uniqueBy(shifts, (shift) => `${shift.therapistName}-${shift.startsAt.toISOString()}-${shift.endsAt.toISOString()}`);
}

function parseJapaneseDate(value: string) {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = { year: jstNow.getUTCFullYear(), month: jstNow.getUTCMonth() + 1, day: jstNow.getUTCDate() };

  if (/(本日|今日)/.test(value)) return today;
  if (/明日/.test(value)) return addDays(today, 1);
  if (/明後日/.test(value)) return addDays(today, 2);

  const monthDay = value.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const slashDate = value.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  const match = monthDay ?? slashDate;
  if (!match) return today;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = today.year;
  if (month < today.month - 1) year += 1;
  return { year, month, day };
}

function parseTimeRange(value: string) {
  const match = value.match(/(\d{1,2})(?::(\d{2})|時)?\s*(?:-|~|〜|から)\s*(\d{1,2})(?::(\d{2})|時)?/);
  if (!match) return null;

  return {
    startHour: Number(match[1]),
    startMinute: Number(match[2] ?? 0),
    endHour: Number(match[3]),
    endMinute: Number(match[4] ?? 0)
  };
}

function toJstUtcDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatClock(hour: number, minute: number) {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function sanitizeName(value: string) {
  return value.replace(/[「」『』【】（）()\[\]・:：]/g, "").trim();
}

function isInvalidTherapistName(name: string) {
  return /^(セラピスト|スタッフ|キャスト|出勤|勤務|本日|今日|明日|営業時間|受付時間|コース|料金|予約|店舗|電話|LINE|SNS|ACCESS|MENU|SYSTEM)$/i.test(name);
}

function uniqueCourses(items: CourseInput[]) {
  return uniqueBy(items, (item) => item.name).slice(0, 30);
}

function uniqueTherapists(items: TherapistInput[]) {
  return uniqueBy(items, (item) => item.displayName).slice(0, 50);
}

function uniqueRooms(items: RoomInput[]) {
  return uniqueBy(items, (item) => item.name).slice(0, 30);
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}



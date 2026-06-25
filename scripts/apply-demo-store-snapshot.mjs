import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const root = process.cwd();
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

const prisma = new PrismaClient();
const storeId = process.env.DEMO_STORE_ID ?? "demo-store-arare-ai";
const voiceWebhookUrl = process.env.VOICE_WEBHOOK_CANONICAL_URL || null;
const voiceRelayWsUrl = process.env.VOICE_RELAY_WS_URL || null;

function jstDate(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
}

async function upsertShift(tx, therapistId, startsAt, endsAt) {
  const existing = await tx.shift.findFirst({
    where: {
      storeId,
      therapistId,
      startsAt,
      endsAt
    }
  });
  if (existing) {
    return tx.shift.update({
      where: { id: existing.id },
      data: { status: "SCHEDULED" }
    });
  }
  return tx.shift.create({
    data: {
      storeId,
      therapistId,
      startsAt,
      endsAt,
      status: "SCHEDULED"
    }
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.upsert({
      where: { id: storeId },
      update: {
        name: "Queen of the Night",
        phone: "090-3129-9110",
        address: "大阪市中央区農人橋3-1-1",
        openTime: "12:00",
        closeTime: "29:00"
      },
      create: {
        id: storeId,
        name: "Queen of the Night",
        phone: "090-3129-9110",
        address: "大阪市中央区農人橋3-1-1",
        openTime: "12:00",
        closeTime: "29:00"
      }
    });

    await tx.storeSetting.upsert({
      where: { storeId },
      update: {
        roomCount: 3,
        phoneAiCreatesHoldOnly: true,
        autoConfirmEnabled: false
      },
      create: {
        storeId,
        roomCount: 3,
        phoneAiCreatesHoldOnly: true,
        autoConfirmEnabled: false
      }
    });

    const rooms = [];
    for (const name of ["vinoプレジオ本町 101", "vinoプレジオ本町 202", "vinoプレジオ本町 303"]) {
      rooms.push(
        await tx.room.upsert({
          where: { storeId_name: { storeId, name } },
          update: { isActive: true },
          create: { storeId, name, isActive: true }
        })
      );
    }

    await tx.room.updateMany({
      where: {
        storeId,
        name: { notIn: rooms.map((room) => room.name) }
      },
      data: { isActive: false }
    });

    const course90 = await tx.course.upsert({
      where: { storeId_name: { storeId, name: "Legend Massage 90分コース" } },
      update: {
        durationMin: 90,
        price: 12000,
        description: "ユーザー提供SMS例を元にしたデモ用コース",
        isActive: true
      },
      create: {
        storeId,
        name: "Legend Massage 90分コース",
        durationMin: 90,
        price: 12000,
        description: "ユーザー提供SMS例を元にしたデモ用コース",
        isActive: true
      }
    });

    await tx.course.updateMany({
      where: {
        storeId,
        id: { not: course90.id }
      },
      data: { isActive: false }
    });

    const therapists = [];
    for (const therapist of [
      { displayName: "美咲", nominationFee: 2000, profile: "デモ検証用セラピスト" },
      { displayName: "清澄せいら", nominationFee: 5000, profile: "ユーザー提供SMS例を元にしたデモ用セラピスト" }
    ]) {
      therapists.push(
        await tx.therapist.upsert({
          where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
          update: {
            profile: therapist.profile,
            nominationFee: therapist.nominationFee,
            status: "ACTIVE",
            acceptsNomination: true
          },
          create: {
            storeId,
            displayName: therapist.displayName,
            profile: therapist.profile,
            nominationFee: therapist.nominationFee,
            status: "ACTIVE",
            acceptsNomination: true
          }
        })
      );
    }

    await tx.therapist.updateMany({
      where: {
        storeId,
        displayName: { notIn: therapists.map((therapist) => therapist.displayName) }
      },
      data: { status: "INACTIVE" }
    });

    const misaki = therapists.find((therapist) => therapist.displayName === "美咲");
    const seira = therapists.find((therapist) => therapist.displayName === "清澄せいら");
    const shifts = [];
    shifts.push(await upsertShift(tx, misaki.id, jstDate(2026, 6, 12, 10), jstDate(2026, 6, 12, 17)));
    shifts.push(await upsertShift(tx, seira.id, jstDate(2026, 6, 12, 14), jstDate(2026, 6, 13, 5)));

    const phoneSetting = await tx.storePhoneSetting.findFirst({
      where: { storeId },
      orderBy: { updatedAt: "desc" }
    });
    const phoneSettingResult = phoneSetting
      ? await tx.storePhoneSetting.update({
          where: { id: phoneSetting.id },
          data: {
            voiceWebhookUrl,
            voiceRelayWsUrl,
            voiceAiEnabled: Boolean(voiceWebhookUrl && voiceRelayWsUrl),
            routingMode: voiceWebhookUrl && voiceRelayWsUrl ? "ALWAYS_AI" : "MANUAL_ONLY"
          }
        })
      : null;

    const audit = await tx.auditLog.create({
      data: {
        storeId,
        actorType: "SYSTEM",
        action: "store.homepage_imported",
        after: {
          importMode: "manual_demo_snapshot",
          note: "実店舗ホームページURL未提供のため、ユーザー提供SMS例とデモ検証要件を元に手動投入した証跡。実店舗HPをクロールした証跡ではありません。",
          sourceUrl: "manual-demo://queen-of-the-night-snapshot-2026-06-09",
          store: {
            id: store.id,
            name: store.name,
            phone: store.phone,
            address: store.address,
            openTime: store.openTime,
            closeTime: store.closeTime
          },
          rooms: rooms.map((room) => room.name),
          courses: [course90.name],
          therapists: therapists.map((therapist) => therapist.displayName),
          shifts: shifts.map((shift) => ({
            therapistId: shift.therapistId,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString()
          })),
          phoneSetting: phoneSettingResult
            ? {
                id: phoneSettingResult.id,
                voiceWebhookUrl: phoneSettingResult.voiceWebhookUrl,
                voiceRelayWsUrl: phoneSettingResult.voiceRelayWsUrl
              }
            : null
        }
      }
    });

    return {
      store,
      rooms,
      course90,
      therapists,
      shifts,
      phoneSetting: phoneSettingResult,
      audit
    };
  });

  console.log(
    JSON.stringify(
      {
        storeId,
        storeName: result.store.name,
        phone: result.store.phone,
        address: result.store.address,
        activeRooms: result.rooms.map((room) => room.name),
        activeCourses: [result.course90.name],
        activeTherapists: result.therapists.map((therapist) => therapist.displayName),
        shifts: result.shifts.map((shift) => ({
          therapistId: shift.therapistId,
          startsAt: shift.startsAt.toISOString(),
          endsAt: shift.endsAt.toISOString()
        })),
        homepageImportAuditId: result.audit.id,
        importMode: result.audit.after.importMode,
        voiceWebhookUrl: result.phoneSetting?.voiceWebhookUrl ?? null,
        voiceRelayWsUrl: result.phoneSetting?.voiceRelayWsUrl ?? null
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, ShiftStatus, TherapistStatus, UserRole } from "@prisma/client";

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
const forceDemoSeed = process.env.DEMO_SEED_FORCE === "1";

function jstDateParts(date = new Date()) {
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

function dateFromJst(dayOffset, hour, minute = 0) {
  const base = jstDateParts();
  return new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset, hour - 9, minute, 0, 0));
}

function overlaps(left, right) {
  return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
}

async function main() {
  const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") || "https://arare-ai-three.vercel.app";
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
  const normalizedTwilioNumber = twilioNumber?.replace(/[^\d+]/g, "");

  const store = await prisma.store.upsert({
    where: { id: storeId },
    update: forceDemoSeed ? {
      name: "導入店舗デモ",
      phone: "090-0000-0000",
      address: "大阪市中央区サンプル1-2-3",
      openTime: "12:00",
      closeTime: "29:00"
    } : {},
    create: {
      id: storeId,
      name: "導入店舗デモ",
      phone: "090-0000-0000",
      address: "大阪市中央区サンプル1-2-3",
      openTime: "12:00",
      closeTime: "29:00",
      users: {
        create: {
          name: "管理者",
          email: "owner@example.com",
          role: UserRole.OWNER
        }
      }
    }
  });

  await prisma.storeSetting.upsert({
    where: { storeId },
    update: forceDemoSeed ? {
      reservationLeadTimeMin: 0,
      cancelDeadlineHours: 6,
      roomCount: 3,
      ngWords: ["暴言", "無断キャンセル常習", "返金強要"],
      phoneAiCreatesHoldOnly: true,
      autoConfirmEnabled: false
    } : {},
    create: {
      storeId,
      reservationLeadTimeMin: 0,
      cancelDeadlineHours: 6,
      roomCount: 3,
      ngWords: ["暴言", "無断キャンセル常習", "返金強要"],
      phoneAiCreatesHoldOnly: true,
      autoConfirmEnabled: false
    }
  });

  await prisma.aiSetting.upsert({
    where: { storeId },
    update: forceDemoSeed ? {
      tone: "明るく、短く、予約受付らしい自然な接客。フルネームは求めず、名前または苗字で受け付ける。",
      requireHumanApproval: true,
      minConfidenceForHold: 0.7,
      minConfidenceForConfirm: 0.9
    } : {},
    create: {
      storeId,
      tone: "明るく、短く、予約受付らしい自然な接客。フルネームは求めず、名前または苗字で受け付ける。",
      requireHumanApproval: true,
      minConfidenceForHold: 0.7,
      minConfidenceForConfirm: 0.9
    }
  });

  const roleUsers = [
    {
      email: process.env.DEMO_OWNER_EMAIL || "owner@arare-ai.local",
      name: "デモ店舗オーナー",
      role: UserRole.OWNER
    },
    {
      email: process.env.DEMO_MANAGER_EMAIL || "manager@arare-ai.local",
      name: "デモ店舗マネージャー",
      role: UserRole.MANAGER
    },
    {
      email: process.env.DEMO_STAFF_EMAIL || "staff@arare-ai.local",
      name: "デモ店舗スタッフ",
      role: UserRole.STAFF
    }
  ];

  for (const user of roleUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { storeId, name: user.name, role: user.role },
      create: { storeId, email: user.email, name: user.name, role: user.role }
    });
  }

  const roomNames = ["プレジオ本町 101", "プレジオ本町 202", "プレジオ本町 303"];
  if (forceDemoSeed) {
    await prisma.room.updateMany({
      where: { storeId, name: { notIn: roomNames } },
      data: { isActive: false }
    });
  }

  const rooms = [];
  for (const name of roomNames) {
    rooms.push(
      await prisma.room.upsert({
        where: { storeId_name: { storeId, name } },
        update: forceDemoSeed ? { isActive: true } : {},
        create: { storeId, name, isActive: true }
      })
    );
  }

  const courses = [];
  for (const course of [
    { name: "60分コース", durationMin: 60, price: 12000, description: "短時間で試しやすい基本コース" },
    { name: "90分コース", durationMin: 90, price: 17000, description: "一番人気の標準コース" },
    { name: "120分コース", durationMin: 120, price: 22000, description: "ゆっくり利用したい方向けのロングコース" }
  ]) {
    courses.push(
      await prisma.course.upsert({
        where: { storeId_name: { storeId, name: course.name } },
        update: forceDemoSeed ? { ...course, isActive: true } : {},
        create: { ...course, storeId, isActive: true }
      })
    );
  }

  const demoTherapists = [
    { displayName: "美咲", profile: "落ち着いた接客が得意", nominationFee: 2000 },
    { displayName: "玲奈", profile: "リピート率の高い人気セラピスト", nominationFee: 3000 },
    { displayName: "葵", profile: "新人キャンペーン対象", nominationFee: 1000 }
  ];
  if (forceDemoSeed) {
    await prisma.therapist.updateMany({
      where: { storeId, displayName: { notIn: demoTherapists.map((item) => item.displayName) } },
      data: { status: TherapistStatus.INACTIVE }
    });
  }

  const therapists = [];
  for (const therapist of demoTherapists) {
    therapists.push(
      await prisma.therapist.upsert({
        where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
        update: forceDemoSeed ? {
          ...therapist,
          phone: null,
          status: TherapistStatus.ACTIVE,
          acceptsNomination: true
        } : {},
        create: {
          ...therapist,
          storeId,
          phone: null,
          lineId: null,
          status: TherapistStatus.ACTIVE,
          acceptsNomination: true
        }
      })
    );
  }

  const todayStart = dateFromJst(0, 0);
  const dayAfterTomorrowEnd = dateFromJst(3, 0);
  const existingShiftCount = await prisma.shift.count({
    where: { storeId, startsAt: { lt: dayAfterTomorrowEnd }, endsAt: { gt: todayStart } }
  });
  const shouldCreateDemoShifts = forceDemoSeed || existingShiftCount === 0;
  let shiftsCreated = 0;

  if (forceDemoSeed) {
    await prisma.blockedSlot.deleteMany({
      where: { storeId, startsAt: { lt: dayAfterTomorrowEnd }, endsAt: { gt: todayStart } }
    });
    await prisma.shift.deleteMany({
      where: { storeId, startsAt: { lt: dayAfterTomorrowEnd }, endsAt: { gt: todayStart } }
    });
  }

  if (shouldCreateDemoShifts) {
    for (const dayOffset of [0, 1, 2]) {
      for (const therapist of therapists) {
        await prisma.shift.create({
          data: {
            storeId,
            therapistId: therapist.id,
            startsAt: dateFromJst(dayOffset, 12),
            endsAt: dateFromJst(dayOffset + 1, 5),
            status: ShiftStatus.SCHEDULED
          }
        });
        shiftsCreated += 1;
      }
    }
  }

  if (forceDemoSeed) {
    const activeReservations = await prisma.reservation.findMany({
      where: {
        storeId,
        startsAt: { gte: todayStart, lt: dayAfterTomorrowEnd },
        status: { in: ["TENTATIVE", "CONFIRMED"] }
      },
      orderBy: { startsAt: "asc" }
    });

  for (const reservation of activeReservations.filter((item) => !item.roomId || !item.therapistId)) {
    const overlappingReservations = activeReservations.filter((item) => item.id !== reservation.id && overlaps(item, reservation));
    const room = reservation.roomId
      ? rooms.find((item) => item.id === reservation.roomId)
      : rooms.find((item) => !overlappingReservations.some((other) => other.roomId === item.id));
    const therapist = reservation.therapistId
      ? therapists.find((item) => item.id === reservation.therapistId)
      : therapists.find((item) => !overlappingReservations.some((other) => other.therapistId === item.id));

    if (!room || !therapist) continue;

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        roomId: room.id,
        therapistId: therapist.id,
        confirmationText: `${reservation.confirmationText ?? ""}\nデモ整備: ${room.name} / ${therapist.displayName}へ割当済み`.trim()
      }
    });

    reservation.roomId = room.id;
    reservation.therapistId = therapist.id;
    }
  }

  if (twilioNumber && normalizedTwilioNumber) {
    await prisma.storePhoneSetting.upsert({
      where: { normalizedAiReceptionPhoneNumber: normalizedTwilioNumber },
      update: forceDemoSeed ? {
        storeId,
        aiReceptionPhoneNumber: twilioNumber,
        voiceWebhookUrl: `${publicAppUrl}/api/twilio/voice`,
        voiceRelayWsUrl: process.env.VOICE_RELAY_WS_URL,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        voiceAiEnabled: true,
        routingMode: "ALWAYS_AI"
      } : {},
      create: {
        storeId,
        aiReceptionPhoneNumber: twilioNumber,
        normalizedAiReceptionPhoneNumber: normalizedTwilioNumber,
        voiceWebhookUrl: `${publicAppUrl}/api/twilio/voice`,
        voiceRelayWsUrl: process.env.VOICE_RELAY_WS_URL,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        voiceAiEnabled: true,
        routingMode: "ALWAYS_AI"
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        storeId,
        storeName: store.name,
        rooms: rooms.length,
        courses: courses.length,
        therapists: therapists.length,
        forceDemoSeed,
        shiftsCreated,
        roleUsers: roleUsers.map((user) => ({ email: user.email, role: user.role })),
        guaranteedSlotsSeeded: shiftsCreated > 0,
        twilioRoute: Boolean(twilioNumber && normalizedTwilioNumber)
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

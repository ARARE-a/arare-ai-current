import { addDays, addHours, set } from "date-fns";
import {
  ConversationChannel,
  MessageRole,
  NotificationStatus,
  NotificationType,
  PrismaClient,
  ReservationStatus,
  ShiftStatus,
  TherapistStatus,
  UserRole
} from "@prisma/client";
import { DEMO_STORE_ID } from "../src/lib/constants";

const prisma = new PrismaClient();

const atToday = (hour: number, minute = 0) =>
  set(new Date(), { hours: hour, minutes: minute, seconds: 0, milliseconds: 0 });

async function main() {
  await prisma.store.upsert({
    where: { id: DEMO_STORE_ID },
    update: {},
    create: {
      id: DEMO_STORE_ID,
      name: "導入店舗デモ",
      phone: "03-0000-0000",
      address: "東京都中央区サンプル1-2-3",
      openTime: "12:00",
      closeTime: "29:00",
      setting: {
        create: {
          reservationLeadTimeMin: 60,
          cancelDeadlineHours: 6,
          roomCount: 3,
          ngWords: ["暴言", "無断キャンセル常習"]
        }
      },
      users: {
        create: {
          name: "管理者",
          email: "owner@example.com",
          role: UserRole.OWNER
        }
      }
    }
  });

  const rooms = await Promise.all(
    ["Room A", "Room B", "Room C"].map((name) =>
      prisma.room.upsert({
        where: { storeId_name: { storeId: DEMO_STORE_ID, name } },
        update: {},
        create: { storeId: DEMO_STORE_ID, name }
      })
    )
  );

  const courses = await Promise.all(
    [
      { name: "60分コース", durationMin: 60, price: 12000 },
      { name: "90分コース", durationMin: 90, price: 17000 },
      { name: "120分コース", durationMin: 120, price: 22000 }
    ].map((course) =>
      prisma.course.upsert({
        where: { storeId_name: { storeId: DEMO_STORE_ID, name: course.name } },
        update: course,
        create: { ...course, storeId: DEMO_STORE_ID }
      })
    )
  );

  const therapists = await Promise.all(
    [
      { displayName: "美咲", profile: "落ち着いた接客が得意", nominationFee: 2000 },
      { displayName: "玲奈", profile: "リピート率の高い人気セラピスト", nominationFee: 3000 },
      { displayName: "葵", profile: "新人キャンペーン対象", nominationFee: 1000 }
    ].map((therapist) =>
      prisma.therapist.upsert({
        where: { storeId_displayName: { storeId: DEMO_STORE_ID, displayName: therapist.displayName } },
        update: {
          ...therapist,
          status: TherapistStatus.ACTIVE,
          acceptsNomination: true
        },
        create: {
          ...therapist,
          storeId: DEMO_STORE_ID,
          status: TherapistStatus.ACTIVE,
          acceptsNomination: true
        }
      })
    )
  );

  await Promise.all(
    therapists.map((therapist, index) =>
      prisma.shift.create({
        data: {
          storeId: DEMO_STORE_ID,
          therapistId: therapist.id,
          startsAt: atToday(12 + index),
          endsAt: atToday(23),
          status: ShiftStatus.SCHEDULED
        }
      })
    )
  );

  const customers = await Promise.all(
    [
      { name: "山田 太郎", phone: "090-1111-2222", lineId: "line_yamada", visitCount: 4 },
      { name: "佐藤 健", phone: "080-3333-4444", lineId: "line_sato", visitCount: 1 },
      { name: "鈴木 誠", phone: "070-5555-6666", visitCount: 0 }
    ].map((customer) =>
      prisma.customer.upsert({
        where: { storeId_phone: { storeId: DEMO_STORE_ID, phone: customer.phone } },
        update: customer,
        create: { ...customer, storeId: DEMO_STORE_ID }
      })
    )
  );

  const reservationSeeds = [
    {
      customer: customers[0],
      therapist: therapists[1],
      room: rooms[0],
      course: courses[1],
      startsAt: atToday(15),
      status: ReservationStatus.CONFIRMED,
      source: ConversationChannel.LINE,
      nominated: true
    },
    {
      customer: customers[1],
      therapist: therapists[0],
      room: rooms[1],
      course: courses[0],
      startsAt: atToday(18, 30),
      status: ReservationStatus.TENTATIVE,
      source: ConversationChannel.WEB_CHAT,
      nominated: false
    },
    {
      customer: customers[2],
      therapist: therapists[2],
      room: rooms[2],
      course: courses[2],
      startsAt: addDays(atToday(20), 1),
      status: ReservationStatus.CONFIRMED,
      source: ConversationChannel.PHONE,
      nominated: true
    }
  ];

  for (const seed of reservationSeeds) {
    const reservation = await prisma.reservation.create({
      data: {
        storeId: DEMO_STORE_ID,
        customerId: seed.customer.id,
        therapistId: seed.therapist.id,
        roomId: seed.room.id,
        courseId: seed.course.id,
        startsAt: seed.startsAt,
        endsAt: addHours(seed.startsAt, seed.course.durationMin / 60),
        status: seed.status,
        source: seed.source,
        nominated: seed.nominated,
        confirmationText: `${seed.startsAt.getMonth() + 1}月${seed.startsAt.getDate()}日${seed.startsAt.getHours()}時から${seed.course.name}、${seed.therapist.displayName}セラピストでお取りします。よろしいでしょうか？`
      }
    });

    if (seed.status === ReservationStatus.CONFIRMED) {
      await prisma.notification.create({
        data: {
          storeId: DEMO_STORE_ID,
          reservationId: reservation.id,
          type: NotificationType.RESERVATION_CONFIRMED,
          channel: seed.source,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          body: reservation.confirmationText ?? "予約を確定しました。"
        }
      });
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      storeId: DEMO_STORE_ID,
      customerId: customers[0].id,
      channel: ConversationChannel.LINE,
      summary: "90分コース、玲奈指名で当日予約を確定。",
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, content: "今日19時頃、90分で空いてますか？" },
          { role: MessageRole.AI, content: "19時30分から玲奈セラピストでご案内可能です。お名前とお電話番号をお願いします。" },
          { role: MessageRole.CUSTOMER, content: "山田です。090-1111-2222です。" },
          { role: MessageRole.AI, content: "90分コース、玲奈セラピストご指名で仮予約しました。内容にお間違いなければ確定します。" }
        ]
      }
    }
  });

  await prisma.reservation.updateMany({
    where: { storeId: DEMO_STORE_ID, customerId: customers[0].id },
    data: { conversationId: conversation.id }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

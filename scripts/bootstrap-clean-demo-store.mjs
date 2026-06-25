import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv(".env.production.local");
loadEnv(".env.local");
loadEnv(".env");

const prisma = new PrismaClient();

const storeId = process.env.DEMO_STORE_ID || "demo-store-arare-ai";
const ownerEmail = normalizeEmail(process.env.DEMO_OWNER_EMAIL) || "owner@example.com";
const now = new Date();

const courses = [
  { id: "demo-course-60", name: "60分リラックスコース", durationMin: 60, price: 12000, description: "初回や短時間利用向けの基本コース。" },
  { id: "demo-course-90", name: "90分スタンダードコース", durationMin: 90, price: 17000, description: "デモで中心に使う標準コース。" },
  { id: "demo-course-120", name: "120分ゆったりコース", durationMin: 120, price: 22000, description: "長めに過ごしたい方向けのコース。" }
];

const rooms = [
  { id: "demo-room-a", name: "Room A" },
  { id: "demo-room-b", name: "Room B" },
  { id: "demo-room-c", name: "Room C" }
];

const therapists = [
  {
    id: "demo-therapist-misaki",
    displayName: "みさき",
    nominationFee: 2000,
    specialties: ["初回対応", "落ち着いた接客", "丁寧なヒアリング"],
    profile: "落ち着いた会話と丁寧な確認が得意なデモ用セラピスト。初回のお客様にも案内しやすい設定です。"
  },
  {
    id: "demo-therapist-seira",
    displayName: "せいら",
    nominationFee: 3000,
    specialties: ["会話多め", "リピーター対応", "明るい接客"],
    profile: "明るい接客とテンポのよい会話が特徴のデモ用セラピスト。再来店のお客様にも提案しやすい設定です。"
  },
  {
    id: "demo-therapist-aoi",
    displayName: "あおい",
    nominationFee: 1000,
    specialties: ["新人", "短時間コース", "静かな接客"],
    profile: "静かな接客と短時間コースの案内に向いたデモ用セラピスト。"
  }
];

const faqs = [
  { id: "demo-faq-payment", question: "支払い方法は何がありますか？", answer: "現金を基本とし、その他の支払い方法は店舗確認として案内してください。", sortOrder: 10 },
  { id: "demo-faq-first", question: "初めてでも利用できますか？", answer: "初めてのお客様も利用できます。注意事項を確認したうえで予約受付を進めます。", sortOrder: 20 },
  { id: "demo-faq-nomination", question: "指名できますか？", answer: "出勤と空き状況により指名可能です。指名料はセラピストごとに確認してください。", sortOrder: 30 }
];

const knowledgeItems = [
  {
    id: "demo-knowledge-policy",
    title: "予約受付ルール",
    category: "予約",
    content: "予約確定前に、日時、コース、指名有無、名前、電話番号、初回来店か再来店か、注意事項確認を必ずそろえる。"
  },
  {
    id: "demo-knowledge-ng",
    title: "AIで回答しない内容",
    category: "安全",
    content: "値引き、返金、個人的な連絡先、店外誘導、クレームはAIで断定回答せず、店舗確認に回す。"
  },
  {
    id: "demo-knowledge-hours",
    title: "営業時間",
    category: "店舗",
    content: "営業時間は12:00から翌5:00。深夜帯は日付をまたぐため、予約日時を必ず復唱確認する。"
  }
];

const talkScripts = [
  {
    id: "demo-talk-first-visit",
    title: "初回来店確認",
    situation: "予約受付",
    content: "初めてのご利用か、以前にもご利用いただいたことがあるかを確認してください。",
    sortOrder: 10
  },
  {
    id: "demo-talk-final-confirmation",
    title: "確定前の復唱",
    situation: "予約確定",
    content: "日時、コース、担当、料金目安、お名前、電話番号を復唱し、問題ないか確認してから確定してください。",
    sortOrder: 20
  },
  {
    id: "demo-talk-escalation",
    title: "店舗確認への切り替え",
    situation: "要確認",
    content: "こちらは店舗確認のうえで折り返します、と案内し、無理に判断しないでください。",
    sortOrder: 30
  }
];

function jstDate(dayOffset, hour, minute = 0) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + dayOffset, hour - 9, minute, 0, 0));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.upsert({
      where: { id: storeId },
      update: {
        name: "ARARE デモ店",
        phone: "03-0000-0000",
        address: "東京都中央区デモ1-2-3",
        openTime: "12:00",
        closeTime: "29:00"
      },
      create: {
        id: storeId,
        name: "ARARE デモ店",
        phone: "03-0000-0000",
        address: "東京都中央区デモ1-2-3",
        openTime: "12:00",
        closeTime: "29:00"
      }
    });

    const owner = await tx.user.upsert({
      where: { email: ownerEmail },
      update: {
        storeId,
        name: "デモ管理者",
        role: "OWNER"
      },
      create: {
        storeId,
        name: "デモ管理者",
        email: ownerEmail,
        role: "OWNER"
      }
    });

    await tx.storeSetting.upsert({
      where: { storeId },
      update: {
        reservationLeadTimeMin: 60,
        cancelDeadlineHours: 6,
        nominationRequired: false,
        roomCount: rooms.length,
        reservationRules: "予約確定前に必須項目を復唱し、最終確認のYESを取る。",
        cancellationRules: "キャンセルや変更は店舗確認として扱い、AIだけで断定しない。",
        attentionNotes: "注意事項確認が取れていない場合は予約確定しない。",
        ngResponseRules: "値引き、返金、店外、個人連絡先は店舗確認へ回す。",
        ngWords: ["値引き", "返金", "個人連絡先", "店外"],
        phoneAiCreatesHoldOnly: true,
        autoConfirmEnabled: false
      },
      create: {
        storeId,
        reservationLeadTimeMin: 60,
        cancelDeadlineHours: 6,
        nominationRequired: false,
        roomCount: rooms.length,
        reservationRules: "予約確定前に必須項目を復唱し、最終確認のYESを取る。",
        cancellationRules: "キャンセルや変更は店舗確認として扱い、AIだけで断定しない。",
        attentionNotes: "注意事項確認が取れていない場合は予約確定しない。",
        ngResponseRules: "値引き、返金、店外、個人連絡先は店舗確認へ回す。",
        ngWords: ["値引き", "返金", "個人連絡先", "店外"],
        phoneAiCreatesHoldOnly: true,
        autoConfirmEnabled: false
      }
    });

    await tx.aiSetting.upsert({
      where: { storeId },
      update: {
        tone: "丁寧で落ち着いた受付対応。曖昧な点は確認し、予約確定前に必ず復唱する。",
        forbiddenAnswers: ["値引きの確約", "返金判断", "個人連絡先の案内", "店外誘導"],
        escalationKeywords: ["クレーム", "値引き", "返金", "個人連絡先", "店外", "トラブル"],
        requireHumanApproval: true,
        minConfidenceForHold: 0.7,
        minConfidenceForConfirm: 0.9
      },
      create: {
        storeId,
        tone: "丁寧で落ち着いた受付対応。曖昧な点は確認し、予約確定前に必ず復唱する。",
        forbiddenAnswers: ["値引きの確約", "返金判断", "個人連絡先の案内", "店外誘導"],
        escalationKeywords: ["クレーム", "値引き", "返金", "個人連絡先", "店外", "トラブル"],
        requireHumanApproval: true,
        minConfidenceForHold: 0.7,
        minConfidenceForConfirm: 0.9
      }
    });

    for (const room of rooms) {
      await tx.room.upsert({
        where: { storeId_name: { storeId, name: room.name } },
        update: { isActive: true },
        create: { id: room.id, storeId, name: room.name, isActive: true }
      });
    }

    for (const course of courses) {
      await tx.course.upsert({
        where: { storeId_name: { storeId, name: course.name } },
        update: {
          durationMin: course.durationMin,
          price: course.price,
          description: course.description,
          isActive: true
        },
        create: { ...course, storeId, isActive: true }
      });
    }

    const optionNames = [
      { id: "demo-option-nomination", name: "本指名", price: 2000, description: "セラピスト指名時の目安オプション。" },
      { id: "demo-option-extension", name: "延長30分", price: 6000, description: "空き状況により店舗確認。" }
    ];
    for (const option of optionNames) {
      await tx.courseOption.upsert({
        where: { storeId_name: { storeId, name: option.name } },
        update: { price: option.price, description: option.description, isActive: true },
        create: { ...option, storeId, isActive: true }
      });
    }

    for (const therapist of therapists) {
      await tx.therapist.upsert({
        where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
        update: {
          profile: therapist.profile,
          specialties: therapist.specialties,
          nominationFee: therapist.nominationFee,
          status: "ACTIVE",
          acceptsNomination: true
        },
        create: {
          id: therapist.id,
          storeId,
          displayName: therapist.displayName,
          profile: therapist.profile,
          specialties: therapist.specialties,
          nominationFee: therapist.nominationFee,
          status: "ACTIVE",
          acceptsNomination: true
        }
      });
    }

    for (const therapist of therapists) {
      for (const course of courses) {
        await tx.therapistCourse.upsert({
          where: { therapistId_courseId: { therapistId: therapist.id, courseId: course.id } },
          update: {},
          create: {
            id: `demo-tc-${therapist.id.replace("demo-therapist-", "")}-${course.id.replace("demo-course-", "")}`,
            storeId,
            therapistId: therapist.id,
            courseId: course.id
          }
        });
      }
    }

    for (let day = 0; day < 7; day += 1) {
      for (let index = 0; index < therapists.length; index += 1) {
        const startsAt = jstDate(day, 12 + index * 2);
        const endsAt = jstDate(day + 1, index === 0 ? 0 : 2 + index);
        const existing = await tx.shift.findFirst({
          where: { storeId, therapistId: therapists[index].id, startsAt, endsAt },
          select: { id: true }
        });
        if (existing) {
          await tx.shift.update({ where: { id: existing.id }, data: { status: "SCHEDULED" } });
        } else {
          await tx.shift.create({
            data: {
              id: `demo-shift-${day}-${index}`,
              storeId,
              therapistId: therapists[index].id,
              startsAt,
              endsAt,
              status: "SCHEDULED"
            }
          });
        }
      }
    }

    for (const item of faqs) {
      await tx.faq.upsert({
        where: { storeId_question: { storeId, question: item.question } },
        update: { answer: item.answer, sortOrder: item.sortOrder, isActive: true },
        create: { ...item, storeId, isActive: true }
      });
    }

    for (const item of knowledgeItems) {
      await tx.knowledgeBase.upsert({
        where: { id: item.id },
        update: { title: item.title, category: item.category, content: item.content, source: "clean-demo-seed", isActive: true },
        create: { ...item, storeId, source: "clean-demo-seed", isActive: true }
      });
    }

    for (const item of talkScripts) {
      await tx.talkScript.upsert({
        where: { id: item.id },
        update: { title: item.title, situation: item.situation, content: item.content, sortOrder: item.sortOrder, isActive: true },
        create: { ...item, storeId, isActive: true }
      });
    }

    const customer = await tx.customer.upsert({
      where: { storeId_phone: { storeId, phone: "090-1111-2222" } },
      update: {
        name: "山田 太郎",
        lineId: "line_demo_yamada",
        memo: "デモ用リピーター顧客",
        visitCount: 3,
        isNg: false
      },
      create: {
        id: "demo-customer-yamada",
        storeId,
        name: "山田 太郎",
        phone: "090-1111-2222",
        lineId: "line_demo_yamada",
        memo: "デモ用リピーター顧客",
        visitCount: 3,
        isNg: false
      }
    });

    const reservationStartsAt = jstDate(1, 19, 30);
    const reservationEndsAt = jstDate(1, 21, 0);
    const existingReservation = await tx.reservation.findFirst({
      where: {
        storeId,
        customerId: customer.id,
        startsAt: reservationStartsAt,
        endsAt: reservationEndsAt
      },
      select: { id: true }
    });
    const reservation = existingReservation
      ? await tx.reservation.update({
          where: { id: existingReservation.id },
          data: {
            therapistId: "demo-therapist-misaki",
            roomId: "demo-room-a",
            courseId: "demo-course-90",
            status: "CONFIRMED",
            nominated: true,
            firstVisit: false,
            source: "WEB_CHAT",
            note: "デモ表示用の確定予約",
            confirmationText: "明日19:30から90分スタンダードコース、みさき指名で確定しています。"
          }
        })
      : await tx.reservation.create({
          data: {
            id: "demo-reservation-confirmed-1",
            storeId,
            customerId: customer.id,
            therapistId: "demo-therapist-misaki",
            roomId: "demo-room-a",
            courseId: "demo-course-90",
            startsAt: reservationStartsAt,
            endsAt: reservationEndsAt,
            status: "CONFIRMED",
            nominated: true,
            firstVisit: false,
            source: "WEB_CHAT",
            note: "デモ表示用の確定予約",
            confirmationText: "明日19:30から90分スタンダードコース、みさき指名で確定しています。"
          }
        });

    const conversation = await tx.conversation.upsert({
      where: { id: "demo-conversation-webchat-1" },
      update: {
        storeId,
        customerId: customer.id,
        channel: "WEB_CHAT",
        externalUserId: "web-demo-yamada",
        workflowState: "CONFIRMED",
        summary: "90分コース、みさき指名のデモ予約"
      },
      create: {
        id: "demo-conversation-webchat-1",
        storeId,
        customerId: customer.id,
        channel: "WEB_CHAT",
        externalUserId: "web-demo-yamada",
        workflowState: "CONFIRMED",
        summary: "90分コース、みさき指名のデモ予約"
      }
    });

    const messages = [
      { id: "demo-message-1", role: "CUSTOMER", content: "明日の19時半から90分で、みさきさん指名できますか？" },
      { id: "demo-message-2", role: "AI", content: "明日19時半から90分、みさき指名で確認します。お名前とお電話番号をお願いします。" },
      { id: "demo-message-3", role: "CUSTOMER", content: "山田です。090-1111-2222です。前にも利用しています。" },
      { id: "demo-message-4", role: "AI", content: "山田様、明日19:30から90分スタンダードコース、みさき指名で仮押さえしました。店舗確認後に確定します。" }
    ];
    for (const message of messages) {
      await tx.message.upsert({
        where: { id: message.id },
        update: { role: message.role, content: message.content },
        create: { ...message, conversationId: conversation.id }
      });
    }

    await tx.reservation.update({
      where: { id: reservation.id },
      data: { conversationId: conversation.id }
    });

    const notification = await tx.notification.upsert({
      where: { id: "demo-notification-confirmed-1" },
      update: {
        storeId,
        reservationId: reservation.id,
        type: "RESERVATION_CONFIRMED",
        channel: "WEB_CHAT",
        status: "SENT",
        sentAt: new Date(),
        body: reservation.confirmationText || "予約を確定しました。"
      },
      create: {
        id: "demo-notification-confirmed-1",
        storeId,
        reservationId: reservation.id,
        type: "RESERVATION_CONFIRMED",
        channel: "WEB_CHAT",
        status: "SENT",
        sentAt: new Date(),
        body: reservation.confirmationText || "予約を確定しました。"
      }
    });

    await tx.notificationLog.upsert({
      where: { storeId_dedupeKey: { storeId, dedupeKey: "demo-confirmed-1" } },
      update: {
        notificationId: notification.id,
        reservationId: reservation.id,
        type: "RESERVATION_CONFIRMED",
        channel: "WEB_CHAT",
        status: "SENT",
        recipientName: customer.name,
        recipientPhone: customer.phone,
        provider: "internal-demo",
        sentAt: new Date()
      },
      create: {
        id: "demo-notification-log-confirmed-1",
        storeId,
        notificationId: notification.id,
        reservationId: reservation.id,
        type: "RESERVATION_CONFIRMED",
        channel: "WEB_CHAT",
        status: "SENT",
        recipientName: customer.name,
        recipientPhone: customer.phone,
        provider: "internal-demo",
        dedupeKey: "demo-confirmed-1",
        sentAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        storeId,
        actorType: "SYSTEM",
        action: "demo.clean_bootstrap_applied",
        after: {
          storeId,
          ownerEmail,
          source: "scripts/bootstrap-clean-demo-store.mjs",
          appliedAt: new Date().toISOString()
        }
      }
    });

    return {
      store,
      owner,
      reservation,
      counts: {
        rooms: await tx.room.count({ where: { storeId, isActive: true } }),
        courses: await tx.course.count({ where: { storeId, isActive: true } }),
        therapists: await tx.therapist.count({ where: { storeId, status: "ACTIVE" } }),
        shifts: await tx.shift.count({ where: { storeId, endsAt: { gte: now }, status: "SCHEDULED" } }),
        faqs: await tx.faq.count({ where: { storeId, isActive: true } }),
        knowledge: await tx.knowledgeBase.count({ where: { storeId, isActive: true } }),
        talkScripts: await tx.talkScript.count({ where: { storeId, isActive: true } })
      }
    };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        storeId: result.store.id,
        storeName: result.store.name,
        ownerEmail: result.owner.email,
        sampleReservationId: result.reservation.id,
        counts: result.counts
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

function normalizeEmail(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

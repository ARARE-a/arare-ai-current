import {
  ActorType,
  ConversationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
  ReservationStatus,
  ShiftStatus
} from "@prisma/client";
import { addHours, addMinutes } from "date-fns";
import { z } from "zod";
import {
  buildReservationConfirmationMessage,
  buildReservationCancellationSmsBody,
  buildReservationSmsBody,
  recordDeliveredNotificationLogs,
  recordQueuedNotificationLogs,
  sendNotification
} from "./notification-service";
import { prisma } from "./prisma";

export const createReservationSchema = z.object({
  storeId: z.string().min(1),
  customer: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    phone: z.string().min(8),
    lineId: z.string().optional(),
    memo: z.string().optional()
  }),
  startsAt: z.coerce.date(),
  courseId: z.string().min(1),
  therapistId: z.string().optional(),
  roomId: z.string().optional(),
  nominated: z.boolean().default(false),
  firstVisit: z.boolean().default(false),
  note: z.string().optional(),
  source: z.nativeEnum(ConversationChannel).default(ConversationChannel.ADMIN),
  status: z.nativeEnum(ReservationStatus).default(ReservationStatus.TENTATIVE),
  attentionConfirmed: z.boolean().default(false),
  actorType: z.nativeEnum(ActorType).default(ActorType.AI),
  actorId: z.string().optional()
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

type ReservationDb = Prisma.TransactionClient;

type AvailabilityInput = {
  storeId: string;
  startsAt: Date;
  courseId: string;
  therapistId?: string;
  roomId?: string;
  endsAt?: Date;
  excludeReservationId?: string;
};

type AvailabilitySlotsInput = {
  storeId: string;
  startsAtList: Date[];
  courseId: string;
  therapistId?: string;
  roomId?: string;
  limit?: number;
};

const activeReservationStatuses = [ReservationStatus.TENTATIVE, ReservationStatus.CONFIRMED];
const duplicatePhoneReservationMessage =
  "同じ電話番号で時間が重なる予約があります。既存予約を確認してください。";

function normalizeReservationPhoneForComparison(phone?: string | null) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("81") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

async function assertNoOverlappingReservationForPhone(
  db: ReservationDb,
  input: {
    storeId: string;
    phone?: string | null;
    startsAt: Date;
    endsAt: Date;
    excludeReservationId?: string | null;
  }
) {
  const normalizedPhone = normalizeReservationPhoneForComparison(input.phone);
  if (!normalizedPhone) return;

  const overlappingReservations = await db.reservation.findMany({
    where: {
      storeId: input.storeId,
      status: { in: activeReservationStatuses },
      id: input.excludeReservationId ? { not: input.excludeReservationId } : undefined,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt }
    },
    select: {
      id: true,
      customer: { select: { phone: true } }
    }
  });

  const hasDuplicatePhone = overlappingReservations.some(
    (reservation) => normalizeReservationPhoneForComparison(reservation.customer?.phone) === normalizedPhone
  );

  if (hasDuplicatePhone) {
    throw new Error(duplicatePhoneReservationMessage);
  }
}

export const updateReservationSchema = z.object({
  storeId: z.string().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  courseId: z.string().optional(),
  therapistId: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  status: z.nativeEnum(ReservationStatus).optional(),
  note: z.string().nullable().optional(),
  nominated: z.boolean().optional(),
  firstVisit: z.boolean().optional(),
  source: z.nativeEnum(ConversationChannel).optional(),
  reason: z.string().optional(),
  actorType: z.nativeEnum(ActorType).default(ActorType.ADMIN),
  actorId: z.string().optional()
});

export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

const reservationActionSchema = z.object({
  storeId: z.string().optional(),
  reason: z.string().optional(),
  actorType: z.nativeEnum(ActorType).default(ActorType.ADMIN),
  actorId: z.string().optional()
});

type ReservationActionInput = z.input<typeof reservationActionSchema>;

export async function findAvailability(input: AvailabilityInput) {
  return findAvailabilityWithClient(prisma, input);
}

export async function findAvailabilitySlots(input: AvailabilitySlotsInput) {
  const candidates = input.startsAtList
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const limit = Math.max(1, Math.min(input.limit ?? 6, 20));
  if (candidates.length === 0) return [];

  const course = await prisma.course.findFirstOrThrow({
    where: { id: input.courseId, storeId: input.storeId, isActive: true }
  });
  const windows = candidates.map((startsAt) => ({
    startsAt,
    endsAt: addMinutes(startsAt, course.durationMin)
  }));
  const rangeStart = new Date(Math.min(...windows.map((window) => window.startsAt.getTime())));
  const rangeEnd = new Date(Math.max(...windows.map((window) => window.endsAt.getTime())));

  const [blockedSlots, shifts, rooms, reservations] = await Promise.all([
    prisma.blockedSlot.findMany({
      where: {
        storeId: input.storeId,
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart }
      }
    }),
    prisma.shift.findMany({
      where: {
        storeId: input.storeId,
        startsAt: { lte: rangeEnd },
        endsAt: { gte: rangeStart },
        status: { in: [ShiftStatus.SCHEDULED, ShiftStatus.CHECKED_IN] },
        therapistId: input.therapistId || undefined,
        therapist: {
          status: "ACTIVE",
          acceptsNomination: input.therapistId ? undefined : true
        }
      },
      include: { therapist: true },
      orderBy: { startsAt: "asc" }
    }),
    prisma.room.findMany({
      where: { storeId: input.storeId, isActive: true, id: input.roomId || undefined },
      orderBy: { name: "asc" }
    }),
    prisma.reservation.findMany({
      where: {
        storeId: input.storeId,
        status: { in: activeReservationStatuses },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart }
      },
      select: { therapistId: true, roomId: true, startsAt: true, endsAt: true }
    })
  ]);

  const overlaps = (item: { startsAt: Date; endsAt: Date }, window: { startsAt: Date; endsAt: Date }) =>
    item.startsAt < window.endsAt && item.endsAt > window.startsAt;

  const found = [];
  for (const window of windows) {
    if (found.length >= limit) break;

    const overlappingBlockedSlots = blockedSlots.filter((slot) => overlaps(slot, window));
    if (overlappingBlockedSlots.some((slot) => !slot.roomId && !slot.therapistId)) continue;

    const blockedTherapistIds = new Set(overlappingBlockedSlots.map((slot) => slot.therapistId).filter(Boolean));
    const busyTherapistIds = new Set(
      reservations
        .filter((reservation) => reservation.therapistId && overlaps(reservation, window))
        .map((reservation) => reservation.therapistId)
    );
    const seenTherapistIds = new Set<string>();
    const therapists = shifts
      .filter((shift) => shift.startsAt <= window.startsAt && shift.endsAt >= window.endsAt)
      .map((shift) => shift.therapist)
      .filter((therapist) => {
        if (seenTherapistIds.has(therapist.id)) return false;
        seenTherapistIds.add(therapist.id);
        return true;
      })
      .filter((therapist) => !busyTherapistIds.has(therapist.id))
      .filter((therapist) => !blockedTherapistIds.has(therapist.id));

    const blockedRoomIds = new Set(overlappingBlockedSlots.map((slot) => slot.roomId).filter(Boolean));
    const busyRoomIds = new Set(
      reservations
        .filter((reservation) => reservation.roomId && overlaps(reservation, window))
        .map((reservation) => reservation.roomId)
    );
    const availableRooms = rooms.filter((room) => !busyRoomIds.has(room.id)).filter((room) => !blockedRoomIds.has(room.id));

    if (therapists.length === 0 || availableRooms.length === 0) continue;

    found.push({
      course,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      therapists,
      rooms: availableRooms,
      blockedSlots: overlappingBlockedSlots
    });
  }

  return found;
}

async function findAvailabilityWithClient(db: ReservationDb, input: AvailabilityInput) {
  const storeId = input.storeId;
  const course = await db.course.findFirstOrThrow({
    where: { id: input.courseId, storeId, isActive: true }
  });
  const endsAt = input.endsAt ?? addMinutes(input.startsAt, course.durationMin);

  if (endsAt <= input.startsAt) {
    throw new Error("予約の終了時刻は開始時刻より後にしてください。");
  }

  const blockedSlots = await db.blockedSlot.findMany({
    where: {
      storeId,
      startsAt: { lt: endsAt },
      endsAt: { gt: input.startsAt }
    }
  });

  const shiftWhere: Prisma.ShiftWhereInput = {
    storeId,
    startsAt: { lte: input.startsAt },
    endsAt: { gte: endsAt },
    status: { in: [ShiftStatus.SCHEDULED, ShiftStatus.CHECKED_IN] },
    therapist: {
      status: "ACTIVE",
      acceptsNomination: input.therapistId ? undefined : true
    }
  };

  if (input.therapistId) shiftWhere.therapistId = input.therapistId;

  const shifts = await db.shift.findMany({
    where: shiftWhere,
    include: { therapist: true },
    orderBy: { startsAt: "asc" }
  });

  const blockedTherapistIds = new Set(blockedSlots.map((slot) => slot.therapistId).filter(Boolean));
  const therapistReservations = await db.reservation.findMany({
    where: {
      storeId,
      status: { in: activeReservationStatuses },
      id: input.excludeReservationId ? { not: input.excludeReservationId } : undefined,
      therapistId: { in: shifts.map((shift) => shift.therapistId) },
      startsAt: { lt: endsAt },
      endsAt: { gt: input.startsAt }
    }
  });

  const busyTherapistIds = new Set(
    therapistReservations.map((reservation) => reservation.therapistId).filter(Boolean)
  );
  const seenTherapistIds = new Set<string>();
  const availableTherapists = shifts
    .map((shift) => shift.therapist)
    .filter((therapist) => {
      if (seenTherapistIds.has(therapist.id)) return false;
      seenTherapistIds.add(therapist.id);
      return true;
    })
    .filter((therapist) => !busyTherapistIds.has(therapist.id))
    .filter((therapist) => !blockedTherapistIds.has(therapist.id));

  const rooms = await db.room.findMany({
    where: { storeId, isActive: true, id: input.roomId ? input.roomId : undefined },
    orderBy: { name: "asc" }
  });
  const roomReservations = await db.reservation.findMany({
    where: {
      storeId,
      status: { in: activeReservationStatuses },
      id: input.excludeReservationId ? { not: input.excludeReservationId } : undefined,
      roomId: { in: rooms.map((room) => room.id) },
      startsAt: { lt: endsAt },
      endsAt: { gt: input.startsAt }
    }
  });
  const busyRoomIds = new Set(roomReservations.map((reservation) => reservation.roomId).filter(Boolean));
  const blockedRoomIds = new Set(blockedSlots.map((slot) => slot.roomId).filter(Boolean));
  const availableRooms = rooms
    .filter((room) => !busyRoomIds.has(room.id))
    .filter((room) => !blockedRoomIds.has(room.id));

  return {
    course,
    startsAt: input.startsAt,
    endsAt,
    therapists: availableTherapists,
    rooms: availableRooms,
    blockedSlots
  };
}

function normalizeNotificationSmsRecipient(phone?: string | null) {
  const trimmed = String(phone ?? "").trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+81${digits.slice(1)}`;
  if (digits.startsWith("81")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

function selectAvailableReservationResources<TTherapist extends { id: string }, TRoom extends { id: string }>(
  availability: {
    blockedSlots: Array<{ roomId: string | null; therapistId: string | null }>;
    therapists: TTherapist[];
    rooms: TRoom[];
  },
  input: { therapistId?: string | null; roomId?: string | null }
) {
  if (availability.blockedSlots.some((slot) => !slot.roomId && !slot.therapistId)) {
    throw new Error("店舗側で予約不可に設定されている時間帯です。");
  }

  const therapist = input.therapistId
    ? availability.therapists.find((item) => item.id === input.therapistId)
    : availability.therapists[0];
  const room = input.roomId
    ? availability.rooms.find((item) => item.id === input.roomId)
    : availability.rooms[0];

  if (!therapist) {
    throw new Error("指定時間に対応可能なセラピストが見つかりません。");
  }

  if (!room) {
    throw new Error("指定時間に空き部屋がありません。");
  }

  return { therapist, room };
}

export async function createReservation(rawInput: unknown) {
  const input = createReservationSchema.parse(rawInput);

  if (!input.attentionConfirmed) {
    throw new Error("注意事項の確認が未完了のため、予約を作成できません。");
  }

  if (input.status !== ReservationStatus.TENTATIVE) {
    throw new Error("予約作成は仮予約のみ可能です。確定は仮予約承認で行ってください。");
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const availability = await findAvailabilityWithClient(tx, input);
    await assertNoOverlappingReservationForPhone(tx, {
      storeId: input.storeId,
      phone: input.customer.phone,
      startsAt: input.startsAt,
      endsAt: availability.endsAt
    });
    const { therapist, room } = selectAvailableReservationResources(availability, input);
    const customer = await upsertReservationCustomer(tx, input);

    if (customer.isNg) {
      throw new Error("NGフラグのある顧客のため、スタッフ確認が必要です。");
    }

    const store = await tx.store.findUniqueOrThrow({
      where: { id: input.storeId },
      select: { name: true, phone: true, address: true }
    });
    const confirmationText = buildReservationConfirmationMessage({
      storeName: store.name,
      storePhone: store.phone,
      storeAddress: store.address,
      customerName: customer.name,
      startsAt: input.startsAt,
      courseName: availability.course.name,
      coursePrice: availability.course.price,
      therapistName: therapist.displayName,
      nominated: input.nominated,
      nominationFee: therapist.nominationFee,
      options: [],
      locationName: room.name
    });

    const created = await tx.reservation.create({
      data: {
        storeId: input.storeId,
        customerId: customer.id,
        therapistId: therapist.id,
        roomId: room.id,
        courseId: availability.course.id,
        startsAt: input.startsAt,
        endsAt: availability.endsAt,
        status: ReservationStatus.TENTATIVE,
        nominated: input.nominated,
        firstVisit: input.firstVisit,
        note: input.note,
        source: input.source,
        confirmationText
      },
      include: {
        customer: true,
        therapist: true,
        room: true,
        course: true
      }
    });

    await tx.reservationHold.create({
      data: {
        storeId: input.storeId,
        reservationId: created.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        roomId: room.id,
        therapistId: therapist.id,
        source: input.source,
        expiresAt: addHours(new Date(), 2)
      }
    });

    await tx.consentLog.create({
      data: {
        storeId: input.storeId,
        reservationId: created.id,
        customerId: customer.id,
        consentType: "reservation_attention_confirmed",
        content: "attentionConfirmed=true before ReservationHold creation",
        accepted: true,
        acceptedAt: new Date()
      }
    });

    await tx.notification.create({
      data: {
        storeId: input.storeId,
        reservationId: created.id,
        type: NotificationType.RESERVATION_CHANGED,
        channel: input.source,
        ...deliveredByAiReply(input.actorType, input.source),
        ...deliveredInternally(input.source),
        body: `仮予約を作成しました。店舗承認後に確定通知を送信します。\n${confirmationText}`
      }
    });

    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        reservationId: created.id,
        actorType: input.actorType,
        actorId: input.actorId,
        action: "reservation.created",
        after: {
          status: created.status,
          source: created.source,
          startsAt: created.startsAt,
          endsAt: created.endsAt,
          customerId: created.customerId,
          therapistId: created.therapistId,
          roomId: created.roomId
        }
      }
    });

    return created;
  }, transactionOptions);

  await recordQueuedNotificationLogs({ storeId: reservation.storeId, reservationId: reservation.id });

  return reservation;
}

export async function approveReservation(reservationId: string, actorOrOptions?: string | ReservationActionInput) {
  const options = normalizeReservationActionOptions(actorOrOptions);
  const approvalNotificationIds: string[] = [];
  const reservation = await prisma.$transaction(async (tx) => {
    const before = await tx.reservation.findFirstOrThrow({
      where: { id: reservationId, storeId: options.storeId ?? undefined },
      include: {
        customer: true,
        therapist: true,
        room: true,
        course: true,
        store: true,
        consentLogs: {
          where: {
            accepted: true,
            consentType: { in: ["reservation_attention_confirmed", "phone_ai_attention_confirmed"] }
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (before.status === ReservationStatus.CONFIRMED) return before;

    if (before.status !== ReservationStatus.TENTATIVE) {
      throw new Error("この予約は確定操作の対象外です。");
    }

    const activeHold = await tx.reservationHold.findFirst({
      where: { storeId: before.storeId, reservationId, approvedAt: null, rejectedAt: null },
      orderBy: { createdAt: "desc" }
    });

    if (!activeHold) {
      throw new Error("有効な仮予約がないため、確定できません。");
    }


    assertApprovalHoldMatchesReservation(activeHold, before);
    assertApprovalConsentEvidence(before);

    const availability = await findAvailabilityWithClient(tx, {
      storeId: before.storeId,
      startsAt: before.startsAt,
      endsAt: before.endsAt,
      courseId: before.courseId,
      therapistId: before.therapistId ?? undefined,
      roomId: before.roomId ?? undefined,
      excludeReservationId: before.id
    });
    await assertNoOverlappingReservationForPhone(tx, {
      storeId: before.storeId,
      phone: before.customer.phone,
      startsAt: before.startsAt,
      endsAt: availability.endsAt,
      excludeReservationId: before.id
    });
    const { therapist, room } = selectAvailableReservationResources(availability, {
      therapistId: before.therapistId,
      roomId: before.roomId
    });
    const approvalGuard = buildApprovalGuardEvidence(activeHold, before, availability, {
      therapistId: therapist.id,
      roomId: room.id
    });

    const confirmationText = buildReservationConfirmationMessage({
      storeName: before.store.name,
      storePhone: before.store.phone,
      storeAddress: before.store.address,
      customerName: before.customer.name,
      startsAt: before.startsAt,
      courseName: before.course.name,
      coursePrice: before.course.price,
      therapistName: therapist.displayName,
      nominated: before.nominated,
      nominationFee: therapist.nominationFee,
      options: [],
      locationName: room.name
    });

    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.CONFIRMED,
        therapistId: therapist.id,
        roomId: room.id,
        confirmationText
      },
      include: { customer: true, course: true, therapist: true, room: true, store: true }
    });

    await tx.reservationHold.updateMany({
      where: { id: activeHold.id, approvedAt: null, rejectedAt: null },
      data: { approvedAt: new Date() }
    });

    const customerChannels = new Set<ConversationChannel>([
      ConversationChannel.PHONE,
      updated.source !== ConversationChannel.PHONE ? updated.source : null
    ].filter(Boolean) as ConversationChannel[]);

    const customerSmsNotification = await tx.notification.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        type: NotificationType.RESERVATION_CONFIRMED,
        channel: ConversationChannel.PHONE,
        ...deliveredByStoreActor(ConversationChannel.PHONE),
        targetName: updated.customer.name,
        targetPhone: updated.customer.phone,
        customerPhone: updated.customer.phone,
        smsTo: normalizeNotificationSmsRecipient(updated.customer.phone),
        body: buildReservationSmsBody({
          startsAt: updated.startsAt,
          courseName: updated.course.name,
          customerName: updated.customer.name,
          storeName: updated.store.name,
          storePhone: updated.store.phone,
          storeAddress: updated.store.address,
          coursePrice: updated.course.price,
          therapistName: updated.therapist?.displayName,
          nominated: updated.nominated,
          nominationFee: updated.therapist?.nominationFee,
          options: [],
          locationName: updated.room?.name
        })
      }
    });
    approvalNotificationIds.push(customerSmsNotification.id);

    for (const channel of customerChannels) {
      if (channel === ConversationChannel.PHONE) continue;
      const customerChannelNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.RESERVATION_CONFIRMED,
          channel,
          ...deliveredByStoreActor(channel),
          body: confirmationText
        }
      });
      approvalNotificationIds.push(customerChannelNotification.id);
    }

    if (updated.therapist) {
      const therapistChannel = updated.therapist.lineId
        ? ConversationChannel.LINE
        : updated.therapist.phone
          ? ConversationChannel.PHONE
          : ConversationChannel.ADMIN;

      const therapistBookingNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.THERAPIST_BOOKING,
          channel: therapistChannel,
          ...deliveredInternally(therapistChannel),
          targetName: updated.therapist.displayName,
          targetPhone: updated.therapist.phone,
          targetLineId: updated.therapist.lineId,
          body: buildTherapistBookingMessage({
            title: "予約が確定しました。",
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            customerName: updated.customer.name,
            courseName: updated.course.name,
            roomName: updated.room?.name,
            nominated: updated.nominated,
            firstVisit: updated.firstVisit
          })
        }
      });
      approvalNotificationIds.push(therapistBookingNotification.id);
    }

    await tx.auditLog.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        actorType: options.actorType,
        actorId: options.actorId,
        action: "reservation.approval_guard_passed",
        after: approvalGuard
      }
    });

    await tx.auditLog.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        actorType: options.actorType,
        actorId: options.actorId,
        action: "reservation.approved",
        before: { status: before.status },
        after: { status: updated.status, guard: approvalGuard }
      }
    });

    await recordReservationChangeHistory(tx, before, updated, options, "reservation.approved");

    return updated;
  }, transactionOptions);

  await sendCreatedPendingNotifications(approvalNotificationIds);
  await recordDeliveredNotificationLogs({ storeId: reservation.storeId, reservationId: reservation.id });

  return reservation;
}

export async function updateReservation(reservationId: string, rawInput: unknown) {
  const input = updateReservationSchema.parse(rawInput);
  const updateNotificationIds: string[] = [];

  if (input.status === ReservationStatus.CANCELLED) {
    return cancelReservation(reservationId, input);
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const before = await tx.reservation.findFirstOrThrow({
      where: { id: reservationId, storeId: input.storeId ?? undefined },
      include: { customer: true, therapist: true, room: true, course: true, store: true }
    });

    if (input.status === ReservationStatus.CONFIRMED && before.status !== ReservationStatus.CONFIRMED) {
      throw new Error("予約確定は仮予約承認APIから行ってください。");
    }

    if (before.status === ReservationStatus.CONFIRMED && input.status === ReservationStatus.TENTATIVE) {
      throw new Error("確定済み予約を仮予約へ戻すことはできません。変更またはキャンセルを行ってください。");
    }

    const targetStatus = input.status ?? before.status;
    const slotFieldsChanged =
      input.startsAt !== undefined ||
      input.endsAt !== undefined ||
      input.courseId !== undefined ||
      input.therapistId !== undefined ||
      input.roomId !== undefined;

    if (!isActiveReservationStatus(before.status) && (slotFieldsChanged || isActiveReservationStatus(targetStatus))) {
      throw new Error("終了済みまたはキャンセル済みの予約日時・割当は変更できません。");
    }

    if (!isActiveReservationStatus(targetStatus)) {
      if (slotFieldsChanged) {
        throw new Error("終了・無断キャンセル扱いにする操作では予約日時・割当を同時に変更できません。");
      }

      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: targetStatus,
          note: input.note === undefined ? before.note : input.note
        },
        include: { customer: true, therapist: true, room: true, course: true, store: true }
      });

      await tx.reservationHold.updateMany({
        where: { reservationId, approvedAt: null, rejectedAt: null },
        data: { rejectedAt: new Date() }
      });

      await tx.auditLog.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          actorType: input.actorType,
          actorId: input.actorId,
          action: "reservation.updated",
          before: reservationSnapshot(before),
          after: reservationSnapshot(updated)
        }
      });
      await recordReservationChangeHistory(tx, before, updated, input, input.reason ?? "reservation.updated");
      return updated;
    }

    const startsAt = input.startsAt ?? before.startsAt;
    const courseId = input.courseId ?? before.courseId;
    const therapistId = input.therapistId === null ? undefined : input.therapistId ?? before.therapistId ?? undefined;
    const roomId = input.roomId === null ? undefined : input.roomId ?? before.roomId ?? undefined;
    const shouldRecalculateEndsAt = input.startsAt !== undefined || input.courseId !== undefined;
    const availability = await findAvailabilityWithClient(tx, {
      storeId: before.storeId,
      startsAt,
      endsAt: input.endsAt ?? (shouldRecalculateEndsAt ? undefined : before.endsAt),
      courseId,
      therapistId,
      roomId,
      excludeReservationId: before.id
    });
    await assertNoOverlappingReservationForPhone(tx, {
      storeId: before.storeId,
      phone: before.customer.phone,
      startsAt,
      endsAt: availability.endsAt,
      excludeReservationId: before.id
    });
    const selected = selectAvailableReservationResources(availability, { therapistId, roomId });
    const confirmationText = buildReservationConfirmationMessage({
      storeName: before.store.name,
      storePhone: before.store.phone,
      storeAddress: before.store.address,
      customerName: before.customer.name,
      startsAt,
      courseName: availability.course.name,
      coursePrice: availability.course.price,
      therapistName: selected.therapist.displayName,
      nominated: input.nominated ?? before.nominated,
      nominationFee: selected.therapist.nominationFee,
      options: [],
      locationName: selected.room.name
    });

    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        startsAt,
        endsAt: availability.endsAt,
        courseId: availability.course.id,
        therapistId: selected.therapist.id,
        roomId: selected.room.id,
        status: targetStatus,
        note: input.note === undefined ? before.note : input.note,
        nominated: input.nominated ?? before.nominated,
        firstVisit: input.firstVisit ?? before.firstVisit,
        source: input.source ?? before.source,
        confirmationText
      },
      include: { customer: true, therapist: true, room: true, course: true, store: true }
    });

    if (updated.status === ReservationStatus.TENTATIVE) {
      const holdUpdate = await tx.reservationHold.updateMany({
        where: { reservationId, approvedAt: null, rejectedAt: null },
        data: {
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          roomId: updated.roomId,
          therapistId: updated.therapistId
        }
      });

      if (holdUpdate.count === 0) {
        await tx.reservationHold.create({
          data: {
            storeId: updated.storeId,
            reservationId: updated.id,
            customerName: updated.customer.name,
            customerPhone: updated.customer.phone,
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            roomId: updated.roomId,
            therapistId: updated.therapistId,
            source: updated.source,
            expiresAt: addHours(new Date(), 2)
          }
        });
      }
    }

    await tx.auditLog.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: "reservation.updated",
        before: reservationSnapshot(before),
        after: reservationSnapshot(updated)
      }
    });
    await recordReservationChangeHistory(tx, before, updated, input, input.reason ?? "reservation.updated");

    if (updated.status === ReservationStatus.CONFIRMED) {
      const changeSmsNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.RESERVATION_CHANGED,
          channel: ConversationChannel.PHONE,
          ...deliveredByStoreActor(ConversationChannel.PHONE),
          targetName: updated.customer.name,
          targetPhone: updated.customer.phone,
          customerPhone: updated.customer.phone,
          smsTo: normalizeNotificationSmsRecipient(updated.customer.phone),
          body: buildReservationSmsBody({
            startsAt: updated.startsAt,
            courseName: updated.course.name,
            customerName: updated.customer.name,
            storeName: updated.store.name,
            storePhone: updated.store.phone,
            storeAddress: updated.store.address,
            coursePrice: updated.course.price,
            therapistName: updated.therapist?.displayName,
            nominated: updated.nominated,
            nominationFee: updated.therapist?.nominationFee,
            options: [],
            locationName: updated.room?.name,
            note: "予約内容を変更しました。"
          })
        }
      });
      updateNotificationIds.push(changeSmsNotification.id);

      if (updated.source === ConversationChannel.LINE && updated.customer.lineId) {
        const changeLineNotification = await tx.notification.create({
          data: {
            storeId: updated.storeId,
            reservationId,
            type: NotificationType.RESERVATION_CHANGED,
            channel: ConversationChannel.LINE,
            ...deliveredByStoreActor(ConversationChannel.LINE),
            targetName: updated.customer.name,
            targetLineId: updated.customer.lineId,
            body: `予約内容を変更しました。\n${confirmationText}`
          }
        });
        updateNotificationIds.push(changeLineNotification.id);
      }
    }

    if (updated.status === ReservationStatus.CONFIRMED && updated.therapist) {
      const therapistChannel = updated.therapist.lineId
        ? ConversationChannel.LINE
        : updated.therapist.phone
          ? ConversationChannel.PHONE
          : ConversationChannel.ADMIN;
      const therapistChangeNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.THERAPIST_BOOKING,
          channel: therapistChannel,
          ...deliveredInternally(therapistChannel),
          targetName: updated.therapist.displayName,
          targetPhone: updated.therapist.phone,
          targetLineId: updated.therapist.lineId,
          body: buildTherapistBookingMessage({
            title: "予約内容が変更されました。",
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            customerName: updated.customer.name,
            courseName: updated.course.name,
            roomName: updated.room?.name,
            nominated: updated.nominated,
            firstVisit: updated.firstVisit
          })
        }
      });
      updateNotificationIds.push(therapistChangeNotification.id);
    }

    return updated;
  }, transactionOptions);

  await sendCreatedPendingNotifications(updateNotificationIds);
  await recordDeliveredNotificationLogs({ storeId: reservation.storeId, reservationId: reservation.id });

  return reservation;
}

export async function cancelReservation(reservationId: string, rawOptions?: ReservationActionInput) {
  const options = normalizeReservationActionOptions(rawOptions);
  const cancelNotificationIds: string[] = [];

  const reservation = await prisma.$transaction(async (tx) => {
    const before = await tx.reservation.findFirstOrThrow({
      where: { id: reservationId, storeId: options.storeId ?? undefined },
      include: { customer: true, therapist: true, room: true, course: true, store: true }
    });

    if (before.status === ReservationStatus.CANCELLED) return before;

    if (!isActiveReservationStatus(before.status)) {
      throw new Error("終了済みまたは無断キャンセル扱いの予約はキャンセルできません。");
    }

    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: ReservationStatus.CANCELLED },
      include: { customer: true, therapist: true, room: true, course: true, store: true }
    });

    await tx.reservationHold.updateMany({
      where: { reservationId, approvedAt: null, rejectedAt: null },
      data: { rejectedAt: new Date() }
    });

    await tx.auditLog.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        actorType: options.actorType,
        actorId: options.actorId,
        action: "reservation.cancelled",
        before: reservationSnapshot(before),
        after: reservationSnapshot(updated)
      }
    });
    await recordReservationChangeHistory(tx, before, updated, options, options.reason ?? "reservation.cancelled");

    const customerSmsNotification = await tx.notification.create({
      data: {
        storeId: updated.storeId,
        reservationId,
        type: NotificationType.RESERVATION_CANCELLED,
        channel: ConversationChannel.PHONE,
        ...deliveredByStoreActor(ConversationChannel.PHONE),
        targetName: updated.customer.name,
        targetPhone: updated.customer.phone,
        customerPhone: updated.customer.phone,
        smsTo: normalizeNotificationSmsRecipient(updated.customer.phone),
        body: buildReservationCancellationSmsBody({
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          courseName: updated.course.name,
          customerName: updated.customer.name,
          storeName: updated.store.name,
          storePhone: updated.store.phone,
          therapistName: updated.therapist?.displayName,
          nominated: updated.nominated,
          locationName: updated.room?.name
        })
      }
    });
    cancelNotificationIds.push(customerSmsNotification.id);

    if (updated.source === ConversationChannel.LINE && updated.customer.lineId) {
      const customerLineNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.RESERVATION_CANCELLED,
          channel: ConversationChannel.LINE,
          ...deliveredByStoreActor(ConversationChannel.LINE),
          targetName: updated.customer.name,
          targetLineId: updated.customer.lineId,
          body: `ご予約のキャンセルを承りました。\n日時: ${formatJapaneseDate(updated.startsAt)}-${formatJstTime(updated.endsAt)}\nコース: ${updated.course.name}`
        }
      });
      cancelNotificationIds.push(customerLineNotification.id);
    }

    if (updated.therapist) {
      const therapistChannel = updated.therapist.lineId
        ? ConversationChannel.LINE
        : updated.therapist.phone
          ? ConversationChannel.PHONE
          : ConversationChannel.ADMIN;
      const therapistCancelNotification = await tx.notification.create({
        data: {
          storeId: updated.storeId,
          reservationId,
          type: NotificationType.RESERVATION_CANCELLED,
          channel: therapistChannel,
          ...deliveredInternally(therapistChannel),
          targetName: updated.therapist.displayName,
          targetPhone: updated.therapist.phone,
          targetLineId: updated.therapist.lineId,
          body: buildTherapistBookingMessage({
            title: "予約がキャンセルされました。",
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            customerName: updated.customer.name,
            courseName: updated.course.name,
            roomName: updated.room?.name,
            nominated: updated.nominated,
            firstVisit: updated.firstVisit
          })
        }
      });
      cancelNotificationIds.push(therapistCancelNotification.id);
    }

    return updated;
  }, transactionOptions);

  await sendCreatedPendingNotifications(cancelNotificationIds);
  await recordDeliveredNotificationLogs({ storeId: reservation.storeId, reservationId: reservation.id });

  return reservation;
}

async function sendCreatedPendingNotifications(notificationIds: string[]) {
  if (notificationIds.length === 0) return [];

  const notifications = await prisma.notification.findMany({
    where: {
      id: { in: notificationIds },
      status: NotificationStatus.PENDING
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  const results = [];
  for (const notification of notifications) {
    results.push(await sendNotification(notification.id));
  }
  return results;
}

function deliveredByStoreActor(channel: ConversationChannel) {
  if (channel === ConversationChannel.LINE || channel === ConversationChannel.WEB_CHAT || channel === ConversationChannel.ADMIN) {
    return { status: NotificationStatus.SENT, sentAt: new Date() };
  }
  return {};
}

export function formatJapaneseDate(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return `${value("month")}月${value("day")}日${value("hour")}時${value("minute")}分`;
}

export function buildAiChecklist(payload: Record<string, unknown>) {
  const required = [
    ["name", "名前"],
    ["phone", "電話番号"],
    ["startsAt", "希望日時"],
    ["courseId", "コース"],
    ["nominationIntent", "指名有無"],
    ["firstVisit", "来店経験"],
    ["attentionConfirmed", "注意事項確認"]
  ] as const;

  const missing = required
    .filter(([key]) => payload[key] === undefined || payload[key] === null || payload[key] === "")
    .map(([, label]) => label);

  return {
    complete: missing.length === 0,
    missing,
    canConfirm: missing.length === 0 && payload.finalConfirmation === true
  };
}

function buildTherapistBookingMessage(input: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  courseName: string;
  roomName?: string | null;
  nominated: boolean;
  firstVisit: boolean;
}) {
  return [
    input.title,
    `日時: ${formatJapaneseDate(input.startsAt)}-${formatJstTime(input.endsAt)}`,
    `お客様: ${input.customerName}様`,
    `コース: ${input.courseName}`,
    `部屋: ${input.roomName ?? "未定"}`,
    `指名: ${input.nominated ? "あり" : "なし"}`,
    `来店: ${input.firstVisit ? "初回" : "再来"}`
  ].join("\n");
}

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function deliveredByAiReply(actorType: ActorType, channel: ConversationChannel) {
  if (
    actorType === ActorType.AI &&
    (channel === ConversationChannel.LINE || channel === ConversationChannel.WEB_CHAT || channel === ConversationChannel.ADMIN)
  ) {
    return { status: NotificationStatus.SENT, sentAt: new Date() };
  }

  return {};
}

function deliveredInternally(channel: ConversationChannel) {
  if (channel === ConversationChannel.WEB_CHAT || channel === ConversationChannel.ADMIN) {
    return { status: NotificationStatus.SENT, sentAt: new Date() };
  }

  return {};
}

type ApprovalHoldEvidence = {
  id: string;
  storeId: string;
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
  therapistId: string | null;
  expiresAt: Date;
};

type ApprovalReservationEvidence = {
  id: string;
  storeId: string;
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
  therapistId: string | null;
  confirmationText?: string | null;
  consentLogs?: Array<{ id: string; consentType: string; accepted: boolean; acceptedAt: Date | null }>;
};

function assertApprovalHoldMatchesReservation(hold: ApprovalHoldEvidence, reservation: ApprovalReservationEvidence) {
  const mismatches = approvalHoldMismatches(hold, reservation);
  if (mismatches.length) {
    throw new Error(`approval_guard_failed: hold mismatch (${mismatches.join(", ")})`);
  }
}

function assertApprovalConsentEvidence(reservation: ApprovalReservationEvidence) {
  const hasConsentLog = Boolean(reservation.consentLogs?.some((item) => item.accepted));
  const hasLegacyReadbackEvidence = Boolean(reservation.confirmationText);
  if (!hasConsentLog && !hasLegacyReadbackEvidence) {
    throw new Error("approval_guard_failed: customer consent evidence is missing");
  }
}

function approvalHoldMismatches(hold: ApprovalHoldEvidence, reservation: ApprovalReservationEvidence) {
  const mismatches: string[] = [];
  if (hold.storeId !== reservation.storeId) mismatches.push("storeId");
  if (hold.startsAt.getTime() !== reservation.startsAt.getTime()) mismatches.push("startsAt");
  if (hold.endsAt.getTime() !== reservation.endsAt.getTime()) mismatches.push("endsAt");
  if ((hold.roomId ?? null) !== (reservation.roomId ?? null)) mismatches.push("roomId");
  if ((hold.therapistId ?? null) !== (reservation.therapistId ?? null)) mismatches.push("therapistId");
  return mismatches;
}

function buildApprovalGuardEvidence(
  hold: ApprovalHoldEvidence,
  reservation: ApprovalReservationEvidence,
  availability: { therapists: Array<{ id: string }>; rooms: Array<{ id: string }>; blockedSlots: Array<unknown> },
  selected: { therapistId: string; roomId: string }
): Prisma.InputJsonObject {
  return {
    holdId: hold.id,
    holdExpiresAt: hold.expiresAt.toISOString(),
    holdMatchedReservation: approvalHoldMismatches(hold, reservation).length === 0,
    consentEvidence: reservation.consentLogs?.[0]
      ? {
          source: "consent_log",
          consentType: reservation.consentLogs[0].consentType,
          acceptedAt: reservation.consentLogs[0].acceptedAt?.toISOString() ?? null
        }
      : { source: "legacy_confirmation_text" },
    availability: {
      availableTherapistCount: availability.therapists.length,
      availableRoomCount: availability.rooms.length,
      blockedSlotCount: availability.blockedSlots.length,
      selectedTherapistId: selected.therapistId,
      selectedRoomId: selected.roomId
    }
  };
}

function normalizeReservationActionOptions(raw?: string | ReservationActionInput) {
  return reservationActionSchema.parse(typeof raw === "string" ? { actorId: raw } : raw ?? {});
}

function isActiveReservationStatus(status: ReservationStatus) {
  return status === ReservationStatus.TENTATIVE || status === ReservationStatus.CONFIRMED;
}

type ReservationSnapshotSource = {
  id: string;
  storeId: string;
  customerId: string;
  therapistId: string | null;
  roomId: string | null;
  courseId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  nominated: boolean;
  firstVisit: boolean;
  note: string | null;
  source: ConversationChannel;
  confirmationText?: string | null;
  conversationId?: string | null;
};

function reservationSnapshot(reservation: ReservationSnapshotSource): Prisma.InputJsonObject {
  return {
    id: reservation.id,
    storeId: reservation.storeId,
    customerId: reservation.customerId,
    therapistId: reservation.therapistId,
    roomId: reservation.roomId,
    courseId: reservation.courseId,
    startsAt: reservation.startsAt.toISOString(),
    endsAt: reservation.endsAt.toISOString(),
    status: reservation.status,
    nominated: reservation.nominated,
    firstVisit: reservation.firstVisit,
    note: reservation.note,
    source: reservation.source,
    confirmationText: reservation.confirmationText ?? null,
    conversationId: reservation.conversationId ?? null
  };
}

async function recordReservationChangeHistory(
  tx: ReservationDb,
  before: ReservationSnapshotSource,
  after: ReservationSnapshotSource,
  actor: { actorType: ActorType; actorId?: string; reason?: string | null },
  defaultReason: string
) {
  const beforeSnapshot = reservationSnapshot(before);
  const afterSnapshot = reservationSnapshot(after);

  if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) return;

  await tx.reservationChangeHistory.create({
    data: {
      storeId: after.storeId,
      reservationId: after.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      reason: actor.reason ?? defaultReason,
      before: beforeSnapshot,
      after: afterSnapshot
    }
  });
}

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10000,
  timeout: 20000
};

async function upsertReservationCustomer(db: ReservationDb, input: CreateReservationInput) {
  if (input.customer.id) {
    const existing = await db.customer.findUniqueOrThrow({ where: { id: input.customer.id } });
    return db.customer.update({
      where: { id: input.customer.id },
      data: {
        name: input.customer.name,
        phone: input.customer.phone,
        lineId: existing.lineId ?? input.customer.lineId,
        memo: input.customer.memo
      }
    });
  }

  const existing = await db.customer.findUnique({
    where: {
      storeId_phone: {
        storeId: input.storeId,
        phone: input.customer.phone
      }
    }
  });

  if (existing) {
    return db.customer.update({
      where: { id: existing.id },
      data: {
        name: input.customer.name,
        lineId: existing.lineId ?? input.customer.lineId,
        memo: input.customer.memo
      }
    });
  }

  return db.customer.create({
    data: {
      storeId: input.storeId,
      name: input.customer.name,
      phone: input.customer.phone,
      lineId: input.customer.lineId,
      memo: input.customer.memo
    }
  });
}

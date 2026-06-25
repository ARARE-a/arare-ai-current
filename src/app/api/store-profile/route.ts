import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
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

const updateSchema = z.object({
  storeId: z.string().optional(),
  store: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    openTime: z.string().optional(),
    closeTime: z.string().optional()
  }).optional(),
  courses: z.array(courseSchema).default([]),
  therapists: z.array(therapistSchema).default([]),
  rooms: z.array(roomSchema).default([])
});

export async function GET() {
  try {
    const context = await requireRequestStoreContext();
    const storeId = context.storeId;

    if (!env("DATABASE_URL")) {
      return ok({ store: null, courses: [], therapists: [], rooms: [], homepageImportEvidence: null, databaseConfigured: false });
    }

    const [store, courses, therapists, rooms, latestHomepageImportLog] = await prisma.$transaction([
      prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, name: true, phone: true, address: true, openTime: true, closeTime: true, updatedAt: true }
      }),
      prisma.course.findMany({
        where: { storeId, isActive: true },
        orderBy: { durationMin: "asc" },
        select: { id: true, name: true, durationMin: true, price: true, description: true, updatedAt: true }
      }),
      prisma.therapist.findMany({
        where: { storeId, status: "ACTIVE" },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true, phone: true, lineId: true, profile: true, acceptsNomination: true, nominationFee: true, updatedAt: true }
      }),
      prisma.room.findMany({
        where: { storeId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, updatedAt: true }
      }),
      prisma.auditLog.findFirst({
        where: { storeId, action: "store.homepage_imported" },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, actorType: true, actorId: true, before: true, after: true, createdAt: true }
      })
    ]);

    return ok({
      store: store ? { ...store, updatedAt: store.updatedAt.toISOString() } : null,
      courses: courses.map((course) => ({ ...course, updatedAt: course.updatedAt.toISOString() })),
      therapists: therapists.map((therapist) => ({ ...therapist, updatedAt: therapist.updatedAt.toISOString() })),
      rooms: rooms.map((room) => ({ ...room, updatedAt: room.updatedAt.toISOString() })),
      homepageImportEvidence: latestHomepageImportLog ? { ...latestHomepageImportLog, createdAt: latestHomepageImportLog.createdAt.toISOString() } : null,
      databaseConfigured: true
    });
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireRequestStoreContext(["OWNER", "MANAGER"]);
    const storeId = context.storeId;
    const payload = updateSchema.parse(await request.json());
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({ where: { id: storeId } });
      const storeData = compact(payload.store ?? {});
      const store = Object.keys(storeData).length
        ? await tx.store.update({ where: { id: storeId }, data: storeData })
        : before;

      const courses = [];
      for (const course of payload.courses) {
        courses.push(await tx.course.upsert({
          where: { storeId_name: { storeId, name: course.name } },
          update: course,
          create: { ...course, storeId }
        }));
      }

      const therapists = [];
      for (const therapist of payload.therapists) {
        const existingTherapist = await tx.therapist.findUnique({
          where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
          select: { id: true, nominationFee: true }
        });
        const lineId = normalizeOptionalText(therapist.lineId);
        if (lineId) {
          const duplicate = await tx.therapist.findFirst({
            where: {
              lineId,
              id: existingTherapist?.id ? { not: existingTherapist.id } : undefined
            },
            select: { displayName: true, store: { select: { name: true } } }
          });
          if (duplicate) {
            throw new Error(`LINE ID is already registered to ${duplicate.displayName} (${duplicate.store.name})`);
          }
        }

        therapists.push(await tx.therapist.upsert({
          where: { storeId_displayName: { storeId, displayName: therapist.displayName } },
          update: buildTherapistUpdateData(therapist, Boolean(existingTherapist)),
          create: { ...buildTherapistCreateData(therapist), storeId }
        }));
      }

      const rooms = [];
      for (const room of payload.rooms) {
        rooms.push(await tx.room.upsert({
          where: { storeId_name: { storeId, name: room.name } },
          update: { isActive: room.isActive },
          create: { ...room, storeId }
        }));
      }

      const audit = await tx.auditLog.create({
        data: {
          storeId,
          actorType: "ADMIN",
          action: "store.manual_profile_updated",
          before: before ? { name: before.name, phone: before.phone, address: before.address, openTime: before.openTime, closeTime: before.closeTime } : undefined,
          after: {
            store: store ? { name: store.name, phone: store.phone, address: store.address, openTime: store.openTime, closeTime: store.closeTime } : null,
            courses: courses.map((item) => item.name),
            therapists: therapists.map((item) => item.displayName),
            rooms: rooms.map((item) => item.name)
          }
        }
      });

      return { store, courses, therapists, rooms, auditLogId: audit.id };
    });

    return ok(result);
  } catch (error) {
    return fail(error, error instanceof StoreAccessError ? error.status : 400);
  }
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildTherapistCreateData(therapist: z.infer<typeof therapistSchema>) {
  return {
    displayName: therapist.displayName,
    status: therapist.status,
    acceptsNomination: therapist.acceptsNomination,
    nominationFee: therapist.nominationFee,
    phone: normalizeOptionalText(therapist.phone),
    lineId: normalizeOptionalText(therapist.lineId),
    profile: normalizeOptionalText(therapist.profile)
  };
}

function buildTherapistUpdateData(therapist: z.infer<typeof therapistSchema>, exists: boolean) {
  const data: {
    displayName?: string;
    status?: z.infer<typeof therapistSchema>["status"];
    acceptsNomination?: boolean;
    nominationFee?: number;
    phone?: string | null;
    lineId?: string | null;
    profile?: string | null;
  } = {
    phone: normalizeOptionalText(therapist.phone) ?? null,
    lineId: normalizeOptionalText(therapist.lineId) ?? null,
    profile: normalizeOptionalText(therapist.profile) ?? null
  };

  if (!exists) {
    data.displayName = therapist.displayName;
    data.status = therapist.status;
    data.acceptsNomination = therapist.acceptsNomination;
    data.nominationFee = therapist.nominationFee;
  } else if (therapist.nominationFee > 0) {
    data.nominationFee = therapist.nominationFee;
  }

  return data;
}



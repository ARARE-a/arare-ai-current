import { Prisma } from "@prisma/client";

export type ReceptionDraft = {
  customerName?: string | null;
  phone?: string | null;
  lineId?: string | null;
  startsAt?: Date | string | null;
  startsAtText?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  therapistId?: string | null;
  therapistName?: string | null;
  nominationIntent?: boolean | null;
  firstVisit?: boolean | null;
  attentionConfirmed?: boolean | null;
  finalConfirmation?: boolean | null;
};

type DraftKey = keyof ReceptionDraft;

const draftKeys: DraftKey[] = [
  "customerName",
  "phone",
  "lineId",
  "startsAt",
  "startsAtText",
  "courseId",
  "courseName",
  "therapistId",
  "therapistName",
  "nominationIntent",
  "firstVisit",
  "attentionConfirmed",
  "finalConfirmation"
];

export function parseReservationDraft(value: unknown): ReceptionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const draft: ReceptionDraft = {};

  for (const key of draftKeys) {
    const field = source[key];
    if (typeof field === "string" && field.trim()) {
      draft[key] = field.trim() as never;
    } else if (typeof field === "boolean") {
      draft[key] = field as never;
    } else if (field instanceof Date && !Number.isNaN(field.getTime())) {
      draft[key] = field.toISOString() as never;
    }
  }

  return draft;
}

export function mergeReservationDrafts(...drafts: Array<ReceptionDraft | null | undefined>): ReceptionDraft {
  const merged: ReceptionDraft = {};

  for (const draft of drafts) {
    if (!draft) continue;
    for (const key of draftKeys) {
      const value = draft[key];
      if (value !== undefined && value !== null && value !== "") {
        merged[key] = normalizeDraftValue(value) as never;
      }
    }
  }

  return merged;
}

export function serializeReservationDraft(draft: ReceptionDraft | null | undefined): Prisma.InputJsonObject {
  const data: Record<string, string | boolean> = {};
  if (!draft) return data;

  for (const key of draftKeys) {
    const value = draft[key];
    if (value === undefined || value === null || value === "") continue;
    const normalized = normalizeDraftValue(value);
    if (normalized !== undefined && normalized !== null && normalized !== "") {
      data[key] = normalized;
    }
  }

  return data as Prisma.InputJsonObject;
}

export function workflowStateForAction(action: string) {
  if (action === "CONFIRMED") return "CONFIRMED";
  if (action === "HOLD_CREATED" || action === "HOLD_REUSED") return "WAITING_FINAL_CONFIRMATION";
  if (action === "ESCALATED") return "ESCALATED";
  if (action === "INFO_PROVIDED") return "INFO_PROVIDED";
  return "COLLECTING";
}

function normalizeDraftValue(value: ReceptionDraft[DraftKey]) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim();
  return value;
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function fail(error: unknown, status = 400) {
  const responseStatus = getErrorStatus(error) ?? status;

  if (error instanceof ZodError) {
    return NextResponse.json({ error: "validation_error", details: error.flatten() }, { status: responseStatus });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: responseStatus });
  }

  return NextResponse.json({ error: "unknown_error" }, { status: responseStatus });
}

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
}

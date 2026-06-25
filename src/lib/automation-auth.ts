import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const ARARE_AUTOMATION_TOKEN_HEADER = "x-arare-automation-token";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateAutomationToken(request: NextRequest) {
  const expectedToken = process.env.ARARE_AUTOMATION_TOKEN;

  if (!expectedToken) {
    if (isProductionRuntime()) {
      return NextResponse.json({ error: "automation token not configured" }, { status: 503 });
    }

    return null;
  }

  const receivedToken = request.headers.get(ARARE_AUTOMATION_TOKEN_HEADER);

  if (!receivedToken || !constantTimeEqual(receivedToken, expectedToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

export function automationTokenHeaders(headers: HeadersInit = {}) {
  const nextHeaders = new Headers(headers);
  const token = process.env.ARARE_AUTOMATION_TOKEN;

  if (token) {
    nextHeaders.set(ARARE_AUTOMATION_TOKEN_HEADER, token);
  }

  return nextHeaders;
}

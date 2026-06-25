import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const callSid = form.get("CallSid")?.toString();
  const recordingUrl = form.get("RecordingUrl")?.toString();

  if (!callSid) {
    return ok({ updated: 0, callSid, recordingUrl, reason: "CallSid is missing" });
  }

  const result = await prisma.callLog
    .updateMany({
      where: { twilioCallSid: callSid },
      data: { recordingUrl, status: "SUMMARIZED" }
    })
    .catch(() => ({ count: 0 }));

  return ok({ updated: result.count, callSid, recordingUrl });
}

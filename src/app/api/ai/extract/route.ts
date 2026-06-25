import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { validateAutomationToken } from "@/lib/automation-auth";
import { extractReservationFromText } from "@/lib/openai-service";

const schema = z.object({
  text: z.string().min(1)
});

export async function POST(request: NextRequest) {
  try {
    const automationAuthError = validateAutomationToken(request);
    if (automationAuthError) return automationAuthError;

    const { text } = schema.parse(await request.json());
    const extraction = await extractReservationFromText(text);
    return ok(extraction);
  } catch (error) {
    return fail(error);
  }
}

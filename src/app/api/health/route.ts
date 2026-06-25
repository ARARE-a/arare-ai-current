import { NextRequest } from "next/server";

import { ok } from "@/lib/api";
import { assertProductionReady, env, featureFlags } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const features = featureFlags();
  const databaseCheck = request.nextUrl.searchParams.get("deep") === "1" ? await checkDatabaseConnection(features.database) : null;

  return ok({
    status: demoRequiredReady(features) && (!databaseCheck || databaseCheck.ok) ? "ok" : "degraded",
    features,
    databaseCheck,
    services: [
      {
        key: "database",
        label: "DB / PostgreSQL",
        configured: features.database,
        requiredForDemo: true,
        note: features.database ? "接続情報は設定済みです。" : "DATABASE_URL が未設定です。"
      },
      {
        key: "openai",
        label: "OpenAI",
        configured: features.openai,
        requiredForDemo: true,
        note: features.openai ? "APIキーは設定済みです。" : "OPENAI_API_KEY が未設定です。"
      },
      {
        key: "twilio",
        label: "Twilio / SMS / Voice",
        configured: features.twilio,
        requiredForDemo: true,
        note: features.twilio
          ? "電話AIとSMSの資格情報は設定済みです。"
          : "TwilioのSID/Auth Token/電話番号が未設定です。"
      },
      {
        key: "line",
        label: "LINE",
        configured: features.line,
        requiredForDemo: false,
        note: features.line ? "LINE連携envは設定済みです。" : "LINE envは未設定の可能性があります。本番LINE連携時に設定します。"
      },
      {
        key: "clerk",
        label: "Clerk",
        configured: features.clerk,
        requiredForDemo: false,
        note: features.clerk ? "Clerk認証envは設定済みです。" : "Clerk envは未設定の可能性があります。本番認証前に設定します。"
      }
    ],
    productionChecklist: productionChecks(),
    publicAppUrl: env("PUBLIC_APP_URL") ?? null
  });
}

async function checkDatabaseConnection(configured: boolean) {
  if (!configured) {
    return { checked: true, ok: false, error: "DATABASE_URL is not configured" };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { checked: true, ok: true };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      error: summarizeDatabaseError(error)
    };
  }
}

function summarizeDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\s+/g, " ")
    .replace(/Invalid `[^`]+` invocation:/g, "Invalid Prisma invocation:")
    .slice(0, 240);
}

function demoRequiredReady(flags: ReturnType<typeof featureFlags>) {
  return flags.database && flags.openai && flags.twilio;
}

function productionChecks() {
  const details: Record<string, { label: string; group: string; requiredForDemo: boolean; note: string }> = {
    DATABASE_URL: { label: "DB / PostgreSQL", group: "database", requiredForDemo: true, note: "予約・顧客・ログ確認に必須です。" },
    OPENAI_API_KEY: { label: "OpenAI", group: "openai", requiredForDemo: true, note: "予約抽出とAI要約に必須です。" },
    TWILIO_ACCOUNT_SID: { label: "Twilio Account SID", group: "twilio", requiredForDemo: true, note: "電話AIとSMSに必須です。" },
    TWILIO_AUTH_TOKEN: { label: "Twilio Auth Token", group: "twilio", requiredForDemo: true, note: "電話AIとSMSに必須です。" },
    TWILIO_PHONE_NUMBER: { label: "Twilio Phone Number", group: "twilio", requiredForDemo: true, note: "発着信とSMSに必須です。" },
    LINE_CHANNEL_SECRET: { label: "LINE Channel Secret", group: "line", requiredForDemo: false, note: "LINE本番連携時に設定します。" },
    LINE_CHANNEL_ACCESS_TOKEN: { label: "LINE Channel Access Token", group: "line", requiredForDemo: false, note: "LINE本番連携時に設定します。" },
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { label: "Clerk Publishable Key", group: "clerk", requiredForDemo: false, note: "本番認証前に設定します。" },
    CLERK_SECRET_KEY: { label: "Clerk Secret Key", group: "clerk", requiredForDemo: false, note: "本番認証前に設定します。" }
  };

  return [
    ...assertProductionReady().map((item) => ({ ...item, ...details[item.name] })),
    {
      name: "PUBLIC_APP_URL",
      configured: Boolean(env("PUBLIC_APP_URL")),
      label: "本番URL",
      group: "production",
      requiredForDemo: true,
      note: "Twilio Webhookと本番確認スクリプトに必要です。"
    }
  ];
}

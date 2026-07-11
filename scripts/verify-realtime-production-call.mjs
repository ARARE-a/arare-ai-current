import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv(".env");
loadEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const prisma = new PrismaClient();
const healthUrl = args.health ?? "https://arare-ai-voice-relay.onrender.com/health";
const explicitCallSid = args["call-sid"];
const smsReceived = args["sms-received"] === true || args["sms-received"] === "true";
const uiMatched = args["ui-matched"] === true || args["ui-matched"] === "true";
const outputJson = args.json === true || args.json === "true";

try {
  const report = await buildReport();
  if (outputJson) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  process.exitCode = report.overall === "PASS" ? 0 : 1;
} finally {
  await prisma.$disconnect();
}

async function buildReport() {
  const checks = [];
  const health = await fetchJson(healthUrl);
  checks.push(
    check(
      "Realtime本番フラグ",
      health.ok && health.data?.realtimeMedia?.enabled === true ? "PASS" : health.ok ? "FAIL" : "UNVERIFIED",
      health.ok
        ? `enabled=${Boolean(health.data?.realtimeMedia?.enabled)}, model=${health.data?.realtimeMedia?.model ?? "unknown"}`
        : health.error
    )
  );

  let callLog;
  try {
    callLog = explicitCallSid
      ? await prisma.callLog.findFirst({ where: { twilioCallSid: explicitCallSid }, orderBy: { createdAt: "desc" } })
      : await prisma.callLog.findFirst({ orderBy: { createdAt: "desc" } });
    checks.push(check("本番DB接続", "PASS", "CallLogを読み取りました"));
  } catch (error) {
    checks.push(
      check(
        "本番DB接続",
        "UNVERIFIED",
        sanitizeDatabaseError(error instanceof Error ? error.message : String(error))
      )
    );
    return finalizeReport(explicitCallSid ?? null, checks, null);
  }
  const callSid = explicitCallSid ?? callLog?.twilioCallSid ?? null;

  checks.push(
    check(
      "DB電話ログ",
      callLog ? "PASS" : "FAIL",
      callLog
        ? `status=${callLog.status}, duration=${callLog.durationSeconds ?? "unknown"}秒, review=${callLog.requiredReview}`
        : "CallLogが見つかりません"
    )
  );

  if (!callSid || !callLog) {
    return finalizeReport(callSid, checks, null);
  }

  const twilioCall = await fetchTwilioResource(`Calls/${encodeURIComponent(callSid)}.json`);
  checks.push(
    check(
      "Twilio通話完了",
      !twilioCall.configured ? "UNVERIFIED" : twilioCall.ok && twilioCall.data?.status === "completed" ? "PASS" : "FAIL",
      twilioCall.ok
        ? `status=${twilioCall.data.status}, duration=${twilioCall.data.duration ?? "unknown"}秒`
        : twilioCall.error
    )
  );
  checks.push(
    check(
      "Twilio接続料金",
      !twilioCall.configured || !twilioCall.ok || twilioCall.data?.price == null ? "UNVERIFIED" : "PASS",
      twilioCall.ok && twilioCall.data?.price != null
        ? `connectivity=${Math.abs(Number(twilioCall.data.price))} ${twilioCall.data.price_unit ?? "unknown"}（追加機能料金は含まない）`
        : "完了後も価格反映に時間がかかる場合があります"
    )
  );

  const transcript = String(callLog.transcript ?? "");
  const hasCustomer = transcript.includes("お客様:");
  const hasAssistant = transcript.includes("AI:");
  const mediaError = /Media Stream error|Realtime media|no audio|closed/i.test(String(callLog.reviewNotes ?? ""));
  checks.push(
    check(
      "双方向会話・障害記録",
      hasCustomer && hasAssistant && !mediaError ? "PASS" : "FAIL",
      `customer=${hasCustomer}, ai=${hasAssistant}, mediaError=${mediaError}, requiredReview=${callLog.requiredReview}`
    )
  );

  const reservation = callLog.reservationId
    ? await prisma.reservation.findUnique({
        where: { id: callLog.reservationId },
        include: {
          customer: true,
          course: true,
          therapist: true,
          room: true,
          conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } },
          notifications: { orderBy: { createdAt: "asc" } },
          notificationLogs: { orderBy: { createdAt: "asc" } }
        }
      })
    : null;
  checks.push(
    check(
      "予約DB保存",
      reservation ? "PASS" : "FAIL",
      reservation
        ? `id=${shortId(reservation.id)}, status=${reservation.status}, start=${reservation.startsAt.toISOString()}, course=${reservation.course.name}, therapist=${reservation.therapist?.displayName ?? "未割当"}, room=${reservation.room?.name ?? "未割当"}`
        : "CallLogに紐づく予約がありません"
    )
  );

  const messages = reservation?.conversation?.messages ?? [];
  checks.push(
    check(
      "会話履歴連携",
      messages.length >= 2 ? "PASS" : "FAIL",
      `conversation=${reservation?.conversationId ? shortId(reservation.conversationId) : "none"}, messages=${messages.length}`
    )
  );

  const notifications = reservation?.notifications ?? [];
  const smsNotifications = notifications.filter((item) => item.channel === "SMS" || item.smsSid);
  const smsProviderResults = [];
  for (const notification of smsNotifications) {
    if (!notification.smsSid) continue;
    smsProviderResults.push({
      notificationId: notification.id,
      result: await fetchTwilioResource(`Messages/${encodeURIComponent(notification.smsSid)}.json`)
    });
  }
  const deliveredProviderSms = smsProviderResults.some(({ result }) => result.ok && result.data?.status === "delivered");
  const acceptedProviderSms = smsProviderResults.some(({ result }) => result.ok && ["sent", "delivered"].includes(result.data?.status));
  checks.push(
    check(
      "SMSプロバイダー状態",
      deliveredProviderSms ? "PASS" : acceptedProviderSms ? "UNVERIFIED" : "FAIL",
      smsProviderResults.length
        ? smsProviderResults.map(({ result }) => result.ok ? result.data.status : result.error).join(", ")
        : `SMS通知=${smsNotifications.length}件、Twilio SID付き=0件`
    )
  );
  checks.push(
    check(
      "SMS実端末受信",
      smsReceived ? "PASS" : "UNVERIFIED",
      smsReceived ? "ユーザーが実端末受信を確認" : "--sms-received=true を付けたユーザー確認が必要"
    )
  );

  const usageEvents = await prisma.storePhoneEvent.findMany({
    where: { storeId: callLog.storeId, eventType: "VOICE_AI_USAGE_RECORDED" },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const usageEvent = usageEvents.find((item) => item.after && item.after.callSid === callSid) ?? null;
  const usageAfter = usageEvent?.after ?? null;
  const rawTokens = Number(usageAfter?.usage?.realtime?.totalTokens ?? 0) + Number(usageAfter?.usage?.transcription?.totalTokens ?? 0);
  checks.push(
    check(
      "OpenAI実使用量・推定原価",
      callLog.usageMeterRecordedAt && usageEvent && rawTokens > 0 ? "PASS" : "FAIL",
      usageEvent
        ? `tokens=${rawTokens}, estimated=${usageAfter.estimatedCost?.totalUsd ?? "unknown"} USD / ${usageAfter.estimatedCost?.totalJpy ?? "unknown"}円, billingConfirmed=${Boolean(usageAfter.estimatedCost?.billingAmountConfirmed)}`
        : "VOICE_AI_USAGE_RECORDEDが見つかりません"
    )
  );

  const period = usagePeriod(callLog.createdAt);
  const monthlyMeter = await prisma.storeUsageMeter.findUnique({
    where: { storeId_period: { storeId: callLog.storeId, period } }
  });
  checks.push(
    check(
      "月次利用量",
      monthlyMeter && monthlyMeter.voiceCallCount > 0 && monthlyMeter.voiceCallSeconds > 0 ? "PASS" : "FAIL",
      monthlyMeter
        ? `period=${period}, calls=${monthlyMeter.voiceCallCount}, seconds=${monthlyMeter.voiceCallSeconds}, estimatedCost=${monthlyMeter.estimatedCost}円`
        : `period=${period}のStoreUsageMeterがありません`
    )
  );

  const linked = Boolean(
    reservation &&
      callLog.reservationId === reservation.id &&
      notifications.every((item) => !item.reservationId || item.reservationId === reservation.id)
  );
  checks.push(
    check(
      "電話・予約・通知ID整合",
      linked ? "PASS" : "FAIL",
      `callReservation=${shortId(callLog.reservationId)}, reservation=${shortId(reservation?.id)}, notifications=${notifications.length}, logs=${reservation?.notificationLogs.length ?? 0}`
    )
  );
  checks.push(
    check(
      "ログイン後画面表示一致",
      uiMatched ? "PASS" : "UNVERIFIED",
      uiMatched ? "ユーザーが電話AI・予約一覧・通知履歴・店舗ダッシュボードを照合" : "--ui-matched=true を付けた画面照合が必要"
    )
  );

  return finalizeReport(callSid, checks, {
    callLogId: callLog.id,
    reservationId: reservation?.id ?? null,
    storeId: callLog.storeId,
    notificationCount: notifications.length
  });
}

function finalizeReport(callSid, checks, references) {
  const failed = checks.filter((item) => item.status === "FAIL").length;
  const unverified = checks.filter((item) => item.status === "UNVERIFIED").length;
  return {
    checkedAt: new Date().toISOString(),
    callSid: callSid ? maskSid(callSid) : null,
    overall: failed ? "FAIL" : unverified ? "UNVERIFIED" : "PASS",
    failed,
    unverified,
    references,
    checks
  };
}

function printReport(report) {
  console.log(`CallSid: ${report.callSid ?? "not found"}`);
  console.log(`Overall: ${report.overall} (FAIL ${report.failed} / UNVERIFIED ${report.unverified})`);
  for (const item of report.checks) console.log(`[${item.status}] ${item.name}: ${item.detail}`);
}

function check(name, status, detail) {
  return { name, status, detail: String(detail ?? "") };
}

async function fetchTwilioResource(resourcePath) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return { configured: false, ok: false, error: "Twilio credentials are not configured" };
  const result = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/${resourcePath}`, {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
  });
  return { configured: true, ...result };
}

async function fetchJson(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: data?.message ?? text.slice(0, 300) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function usagePeriod(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((item) => item.type === "year")?.value}-${parts.find((item) => item.type === "month")?.value}`;
}

function shortId(value) {
  const text = String(value ?? "");
  return text ? `...${text.slice(-8)}` : "none";
}

function maskSid(value) {
  const text = String(value ?? "");
  return text.length > 10 ? `${text.slice(0, 4)}...${text.slice(-6)}` : "***";
}

function sanitizeDatabaseError(value) {
  const text = String(value ?? "Database connection failed");
  if (/tenant\/user .* not found/i.test(text)) return "ローカルDATABASE_URLが現在の本番DBと一致していません";
  if (/authentication failed|password authentication failed/i.test(text)) return "ローカルDATABASE_URLの認証に失敗しました";
  if (/connect|database|prisma/i.test(text)) return "本番DBへ接続できませんでした。Render環境または最新DATABASE_URLで実行してください";
  return "本番DB確認中にエラーが発生しました";
}

function parseArgs(values) {
  return Object.fromEntries(
    values.map((value) => {
      const normalized = value.replace(/^--/, "");
      const separator = normalized.indexOf("=");
      return separator === -1 ? [normalized, true] : [normalized.slice(0, separator), normalized.slice(separator + 1)];
    })
  );
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

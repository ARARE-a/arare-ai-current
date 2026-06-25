import { existsSync, readFileSync } from "node:fs";

loadEnv(".env.local");
loadEnv(".env.production.local");
loadEnv(".tmp-vercel-pulled.env");
loadEnv(".tmp-vercel-production.env");
loadEnv(".env");

const baseUrl = normalizeBaseUrl(process.argv[2] ?? process.env.ARARE_VERIFY_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "https://arare-ai-three.vercel.app");
const expectedVoiceWebhookUrl = normalizeBaseUrl(
  process.env.EXPECTED_TWILIO_VOICE_WEBHOOK_URL ??
    process.env.VOICE_WEBHOOK_CANONICAL_URL ??
    process.env.NEXT_PUBLIC_VOICE_WEBHOOK_URL ??
    `${baseUrl}/api/twilio/voice`
);
const expected = {
  voiceWebhookUrl: expectedVoiceWebhookUrl,
  lineWebhookUrl: `${baseUrl}/api/line/webhook`,
  smsStatusCallbackUrl: `${baseUrl}/api/twilio/sms/status`
};

const results = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  readOnly: true,
  expected,
  twilio: await checkTwilio(),
  line: await checkLine()
};

const failed = [
  results.twilio.ok === false,
  results.line.ok === false,
  results.twilio.incomingNumber?.voiceWebhookMatches === false,
  results.line.webhook?.endpointMatches === false,
  results.line.webhook?.active === false
].some(Boolean);

console.log(JSON.stringify(results, null, 2));
process.exitCode = failed ? 1 : 0;

async function checkTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !phoneNumber || (!authToken && !(apiKey && apiSecret))) {
    return {
      ok: false,
      configured: false,
      error: "TWILIO_ACCOUNT_SID, TWILIO_PHONE_NUMBER, and either TWILIO_AUTH_TOKEN or TWILIO_API_KEY/TWILIO_API_SECRET are required."
    };
  }

  const authConfig = buildTwilioRestAuthConfig({ accountSid, authToken, apiKey, apiSecret });
  if (!authConfig.ok) {
    return {
      ok: false,
      configured: true,
      error: `${authConfig.code}: ${authConfig.reason}`
    };
  }
  const apiBase = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;

  try {
    const [account, incomingNumbers, calls, messages] = await Promise.all([
      authConfig.mode === "auth_token" ? fetchJson(`${apiBase}.json`, authConfig.authorization) : Promise.resolve(null),
      fetchJson(`${apiBase}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, authConfig.authorization),
      fetchJson(`${apiBase}/Calls.json?PageSize=10`, authConfig.authorization),
      fetchJson(`${apiBase}/Messages.json?PageSize=10`, authConfig.authorization)
    ]);

    const number = incomingNumbers?.incoming_phone_numbers?.[0] ?? null;
    return {
      ok: true,
      configured: true,
      account: {
        status: account?.status ?? null,
        type: account?.type ?? null
      },
      incomingNumber: number
        ? {
            found: true,
            phoneNumber: redactPhone(number.phone_number),
            voiceUrl: number.voice_url || null,
            voiceMethod: number.voice_method || null,
            voiceWebhookMatches: normalizeUrl(number.voice_url) === normalizeUrl(expected.voiceWebhookUrl),
            smsUrl: number.sms_url || null,
            smsMethod: number.sms_method || null
          }
        : { found: false, phoneNumber: redactPhone(phoneNumber) },
      recentCalls: summarizeTwilioRows(calls?.calls ?? [], "status", "start_time"),
      recentMessages: summarizeTwilioRows(messages?.messages ?? [], "status", "date_created", "error_code"),
      authMode: authConfig.mode,
      note: "This check reads Twilio settings and recent logs only. It does not place calls or send SMS."
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: summarizeError(error)
    };
  }
}

function buildTwilioRestAuthConfig(input) {
  const accountSid = String(input.accountSid ?? "").trim();
  const authToken = String(input.authToken ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  const apiSecret = String(input.apiSecret ?? "").trim();
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    return { ok: false, code: "TWILIO_ACCOUNT_SID_INVALID_FORMAT", reason: "TWILIO_ACCOUNT_SID must start with AC and be 34 characters." };
  }
  if (apiKey || apiSecret) {
    if (!/^SK[0-9a-fA-F]{32}$/.test(apiKey)) {
      return { ok: false, code: "TWILIO_API_KEY_INVALID_FORMAT", reason: "TWILIO_API_KEY must start with SK and be 34 characters." };
    }
    if (apiSecret.length < 20 || /\s/.test(apiSecret)) {
      return { ok: false, code: "TWILIO_API_SECRET_INVALID_FORMAT", reason: "TWILIO_API_SECRET is missing or invalid." };
    }
    return { ok: true, mode: "api_key", authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` };
  }
  if (/^THAA/i.test(authToken) || authToken.length > 80) {
    return {
      ok: false,
      code: "TWILIO_AUTH_TOKEN_INVALID_FORMAT",
      reason: "TWILIO_AUTH_TOKEN is not a Twilio REST Auth Token. Set the Auth Token from Twilio Console, or use an API Key SID/Secret implementation."
    };
  }
  if (authToken.length < 20) {
    return { ok: false, code: "TWILIO_AUTH_TOKEN_INVALID_FORMAT", reason: "TWILIO_AUTH_TOKEN is too short for Twilio REST API authentication." };
  }
  return { ok: true, mode: "auth_token", authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
}

async function checkLine() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: true,
      configured: false,
      skipped: true,
      warning: "LINE_CHANNEL_ACCESS_TOKEN is not available in local verifier env. Production /api/health can still report LINE env configured, but LINE Console webhook cannot be verified from this machine."
    };
  }

  const headers = { Authorization: `Bearer ${token}` };
  try {
    const [botInfo, webhook] = await Promise.all([
      fetchJson("https://api.line.me/v2/bot/info", headers),
      fetchJson("https://api.line.me/v2/bot/channel/webhook/endpoint", headers)
    ]);

    return {
      ok: true,
      configured: true,
      bot: {
        userIdPresent: Boolean(botInfo.userId),
        basicIdPresent: Boolean(botInfo.basicId),
        premiumIdPresent: Boolean(botInfo.premiumId)
      },
      webhook: {
        endpoint: webhook.endpoint ?? null,
        active: webhook.active ?? null,
        endpointMatches: normalizeUrl(webhook.endpoint) === normalizeUrl(expected.lineWebhookUrl)
      },
      note: "This check reads LINE bot and webhook settings only. It does not send or receive a real webhook event."
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: summarizeError(error)
    };
  }
}

async function fetchJson(url, authOrHeaders) {
  const headers = typeof authOrHeaders === "string" ? { Authorization: authOrHeaders } : authOrHeaders;
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(sanitize(payload)).slice(0, 400)}`);
  }
  return payload;
}

function summarizeTwilioRows(rows, statusKey, dateKey, errorKey) {
  const statusCounts = {};
  const errorCounts = {};
  for (const row of rows) {
    const status = String(row[statusKey] ?? "unknown");
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (errorKey && row[errorKey]) {
      const error = String(row[errorKey]);
      errorCounts[error] = (errorCounts[error] ?? 0) + 1;
    }
  }

  return {
    sampled: rows.length,
    statusCounts,
    errorCounts,
    latest: rows[0]
      ? {
          sidPrefix: String(rows[0].sid ?? "").slice(0, 2),
          status: rows[0][statusKey] ?? null,
          direction: rows[0].direction ?? null,
          date: rows[0][dateKey] ?? null,
          errorCode: errorKey ? rows[0][errorKey] ?? null : undefined
        }
      : null
  };
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
}

function normalizeUrl(value) {
  return normalizeBaseUrl(value ?? "");
}

function redactPhone(value) {
  const text = String(value ?? "");
  const digits = text.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [/token|secret|password|auth/i.test(key) ? [key, "***"] : [key, sanitize(item)]])
  );
}

function summarizeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 500);
}

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

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv(".env.local");
loadEnv(".env");

const prisma = new PrismaClient();
const baseUrl = normalizeBaseUrl(process.argv[2] ?? process.env.ARARE_VERIFY_BASE_URL ?? currentProductionUrl());
const tests = [
  {
    storeId: "verify-phone-store-a",
    storeName: "Verify Phone Store A",
    currentPhone: "03-0000-0101",
    aiPhone: "+815055501001",
    callSid: `CA_VERIFY_PHONE_A_${Date.now()}`
  },
  {
    storeId: "verify-phone-store-b",
    storeName: "Verify Phone Store B",
    currentPhone: "03-0000-0102",
    aiPhone: "+815055501002",
    callSid: `CA_VERIFY_PHONE_B_${Date.now()}`
  }
];
const unknownCallSid = `CA_VERIFY_PHONE_UNKNOWN_${Date.now()}`;

try {
  await cleanup();
  await setup();

  const results = [];
  for (const test of tests) {
    const xml = await simulateInboundCall(test.aiPhone, test.callSid);
    const callLog = await prisma.callLog.findFirst({
      where: { twilioCallSid: test.callSid },
      include: { storePhoneSetting: true }
    });

    assert(callLog, `${test.storeId}: CallLog was not created`);
    assert(callLog.storeId === test.storeId, `${test.storeId}: CallLog storeId mismatch: ${callLog.storeId}`);
    assert(callLog.toNumber === test.aiPhone, `${test.storeId}: CallLog toNumber mismatch: ${callLog.toNumber}`);
    assert(callLog.storePhoneSetting?.normalizedAiReceptionPhoneNumber === test.aiPhone, `${test.storeId}: StorePhoneSetting was not attached`);
    assert(xml.includes(test.storeId), `${test.storeId}: TwiML does not include store routing parameter`);

    results.push({
      storeId: test.storeId,
      aiPhone: test.aiPhone,
      callSid: test.callSid,
      callLogStoreId: callLog.storeId,
      twimlRouted: true
    });
  }

  const unknownXml = await simulateInboundCall("+815055509999", unknownCallSid);
  const unknownLogCount = await prisma.callLog.count({ where: { twilioCallSid: unknownCallSid } });
  assert(unknownXml.includes("登録されていません"), "Unknown number response did not report an unregistered phone setting");
  assert(unknownLogCount === 0, `Unknown number created ${unknownLogCount} CallLog rows`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        routedStores: results,
        unknownNumberProtected: true
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await prisma.$disconnect();
}

async function setup() {
  for (const test of tests) {
    await prisma.store.upsert({
      where: { id: test.storeId },
      update: { name: test.storeName, phone: test.currentPhone },
      create: {
        id: test.storeId,
        name: test.storeName,
        phone: test.currentPhone
      }
    });

    await prisma.storePhoneSetting.upsert({
      where: { normalizedAiReceptionPhoneNumber: normalizePhoneNumber(test.aiPhone) },
      update: {
        storeId: test.storeId,
        currentStorePhoneNumber: test.currentPhone,
        aiReceptionPhoneNumber: test.aiPhone,
        voiceWebhookUrl: `${baseUrl}/api/twilio/voice`,
        voiceRelayWsUrl: null,
        voiceAiEnabled: true,
        routingMode: "ALWAYS_AI"
      },
      create: {
        storeId: test.storeId,
        currentStorePhoneNumber: test.currentPhone,
        aiReceptionPhoneNumber: test.aiPhone,
        normalizedAiReceptionPhoneNumber: normalizePhoneNumber(test.aiPhone),
        voiceWebhookUrl: `${baseUrl}/api/twilio/voice`,
        voiceRelayWsUrl: null,
        voiceAiEnabled: true,
        routingMode: "ALWAYS_AI"
      }
    });
  }
}

async function simulateInboundCall(to, callSid) {
  const form = new URLSearchParams({
    From: "+819012345678",
    To: to,
    CallSid: callSid
  });
  const initial = await postTwilioForm(`${baseUrl}/api/twilio/voice`, form);
  assert(initial.response.ok, `Twilio voice webhook failed: ${initial.response.status} ${initial.text}`);
  assert(initial.text.includes("<Response>"), `Twilio voice webhook did not return TwiML: ${initial.text}`);

  const redirectUrl = extractTwimlRedirectUrl(initial.text);
  if (!redirectUrl) return initial.text;

  const redirected = await postTwilioForm(redirectUrl, form);
  assert(redirected.response.ok, `Twilio redirected voice webhook failed: ${redirected.response.status} ${redirected.text}`);
  assert(redirected.text.includes("<Response>"), `Redirected Twilio voice webhook did not return TwiML: ${redirected.text}`);
  return redirected.text;
}

async function postTwilioForm(url, form) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const text = await response.text();
  return { response, text };
}

function extractTwimlRedirectUrl(xml) {
  const match = String(xml).match(/<Redirect\b[^>]*>([^<]+)<\/Redirect>/i);
  return match ? decodeXml(match[1].trim()) : null;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function cleanup() {
  await prisma.callLog.deleteMany({
    where: {
      twilioCallSid: {
        in: [...tests.map((test) => test.callSid), unknownCallSid]
      }
    }
  });
  await prisma.store.deleteMany({
    where: {
      id: {
        in: tests.map((test) => test.storeId)
      }
    }
  });
}

function normalizePhoneNumber(value) {
  const compact = String(value ?? "").trim().replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("81")) return `+${compact}`;
  if (compact.startsWith("0")) return `+81${compact.slice(1)}`;
  return `+${compact}`;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function currentProductionUrl() {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured && !configured.includes("arare-ai.vercel.app")) return configured;
  return "https://arare-ai-three.vercel.app";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

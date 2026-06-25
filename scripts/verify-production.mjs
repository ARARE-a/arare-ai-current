import { existsSync, readFileSync } from "node:fs";

loadEnv(".env.local");
loadEnv(".env");

const baseUrl = normalizeBaseUrl(process.argv[2] ?? process.env.ARARE_VERIFY_BASE_URL ?? currentProductionUrl());
const authGatedPaths = new Set(["/api/setup/checklist", "/api/admin/state", "/api/platform/stores"]);

async function check(path, options) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { path, status: response.status, ok: response.ok, body };
}

const healthResult = await check("/api/health");
const clerkEnabled = Boolean(healthResult.body?.data?.features?.clerk);

const checks = [
  () => Promise.resolve(healthResult),
  () => check("/api/setup/checklist"),
  () => check("/api/admin/state"),
  () => check("/api/platform/stores"),
  () => check("/api/twilio/sms/status"),
  () => check("/api/ai/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "\u660e\u65e519\u6642\u304b\u308990\u5206\u30b3\u30fc\u30b9\u3092\u4e88\u7d04\u3057\u305f\u3044\u3067\u3059\u3002\u540d\u524d\u306f\u5c71\u7530\u3001\u96fb\u8a71\u756a\u53f7\u306f090-0000-0000\u3067\u3059\u3002"
    })
  })
];

const results = [];
for (const run of checks) {
  try {
    results.push(normalizeResult(await run()));
  } catch (error) {
    results.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ baseUrl, results }, null, 2));

const failed = results.filter((result) => !result.ok);
process.exit(failed.length > 0 ? 1 : 0);

function normalizeResult(result) {
  if (!clerkEnabled || !authGatedPaths.has(result.path)) return result;
  if (result.status === 401 || result.status === 307 || looksLikeSignInPage(result.body)) {
    return { ...result, ok: true, authGated: true };
  }
  return result;
}

function looksLikeSignInPage(body) {
  return typeof body === "string" && body.includes("/sign-in") && body.toLowerCase().includes("clerk");
}

function currentProductionUrl() {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured && !configured.includes("arare-ai.vercel.app")) return configured;
  return "https://arare-ai-three.vercel.app";
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
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

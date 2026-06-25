import { existsSync, readFileSync } from "node:fs";

loadEnv(".env");
loadEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const outputJson = args.json;
const minUiScore = Number(args["min-ui-score"] ?? 95);
const skipLocal = args["skip-local"];
const localBase = normalizeBaseUrl(args.local ?? process.env.ARARE_VERIFY_LOCAL_URL ?? "http://127.0.0.1:3000");
const productionBase = normalizeBaseUrl(args.production ?? process.env.ARARE_VERIFY_PRODUCTION_URL ?? process.env.ARARE_VERIFY_BASE_URL ?? currentProductionUrl());
const timeoutMs = Math.max(4000, Number(args.timeout ?? 30000));

const checks = [
  { path: "/", type: "page", label: "Home", allowSignInRedirect: true },
  { path: "/store", type: "page", label: "Store" },
  { path: "/therapist", type: "page", label: "Therapist" },
  { path: "/customer", type: "page", label: "Customer" },
  { path: "/chat", type: "page", label: "Web Chat" },
  { path: "/ops", type: "page", label: "Operations" },
  { path: "/phone-ai", type: "page", label: "Phone AI" },
  { path: "/sign-in", type: "page", label: "Sign-in" },
  { path: "/api/health", type: "api", label: "Health API", validator: validateHealthApi, comparator: compareHealthPayload },
  { path: "/api/setup/checklist", type: "api", label: "Setup Checklist", validator: validateJsonObject },
  { path: "/api/admin/state", type: "api", label: "Admin State", validator: validateAdminState },
  { path: "/api/notifications", type: "api", label: "Notifications", validator: validateNotificationPayload }
];

const pageFiles = {
  "/": "src/app/page.tsx",
  "/store": "src/app/store/page.tsx",
  "/therapist": "src/app/therapist/page.tsx",
  "/customer": "src/app/customer/page.tsx",
  "/chat": "src/app/chat/page.tsx",
  "/ops": "src/app/ops/page.tsx",
  "/phone-ai": "src/app/phone-ai/page.tsx"
};

let failCount = 0;
let unverifiedCount = 0;
const checkResults = [];
const authGatedChecks = new Set();
const productionIssues = [];

for (const check of checks) {
  const production = await runCheck(productionBase, check, timeoutMs);
  const local = skipLocal ? null : await runCheck(localBase, check, timeoutMs);
  const parity = skipLocal ? { match: true, reason: "Local check skipped" } : compareRoutes(check, local, production);
  const productionVerification = evaluateProductionVerification(production);

  if (productionVerification.outcome === "failed") {
    failCount += 1;
    productionIssues.push({ path: check.path, label: check.label, reason: productionVerification.reason });
  }
  if (productionVerification.outcome === "unverified") {
    unverifiedCount += 1;
    authGatedChecks.add(check.path);
  }
  if (!parity.match) failCount += 1;
  if (isAuthRedirectMismatchRelevant(check.path, local, parity)) {
    authGatedChecks.add(check.path);
  }

  checkResults.push({
    path: check.path,
    label: check.label,
    production,
    local,
    parity,
    productionVerification
  });
}

const uiAudit = evaluateMobileUi(pageFiles, minUiScore);
if (!uiAudit.pass) failCount += 1;

const report = {
  productionBase,
  localBase: skipLocal ? null : localBase,
  skipLocal,
  checks: checkResults,
  authGated: Array.from(authGatedChecks),
  productionIssues,
  uiAudit,
  overall: failCount > 0 ? "FAIL" : unverifiedCount > 0 ? "UNVERIFIED" : "PASS",
  failCount,
  unverifiedCount
};

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

process.exitCode = report.overall === "PASS" ? 0 : 1;

function printHumanReport(report) {
  console.log(`production: ${report.productionBase}`);
  if (!report.skipLocal) {
    console.log(`local: ${report.localBase}`);
  }
  console.log(`overall: ${report.overall}`);
  console.log(`ui-score: ${report.uiAudit.score}/100 (threshold ${report.uiAudit.threshold})`);

  for (const row of report.checks) {
    console.log(`\n${row.label} (${row.path})`);
    console.log(`  prod: ${row.production.summary}`);
    console.log(`  prod-verification: ${row.productionVerification.outcome} (${row.productionVerification.reason})`);
    if (!report.skipLocal) {
      console.log(`  local: ${row.local ? row.local.summary : "not checked"}`);
      console.log(`  parity: ${row.parity.reason}`);
      if (row.parity && row.parity.details?.length) {
        for (const detail of row.parity.details) {
          console.log(`    - ${detail}`);
        }
      }
    }
  }

  if (!report.uiAudit.pass) {
    console.log("\nUI score failed:");
    for (const detail of report.uiAudit.details) {
      console.log(`  - ${detail}`);
    }
  }

  if (report.authGated.length) {
    console.log("\nClerk-authenticated features:");
    console.log("  - 未対応: Clerkログイン済み状態が必要な機能は、テストアカウント/セッションなしでは未確認です。");
    for (const path of report.authGated) {
      console.log(`  - ${path}: 認証後機能の検証は未確認扱い`);
    }
  }
}

async function runCheck(baseUrl, check, timeoutMs) {
  const target = `${baseUrl}${check.path}`;
  const request = await fetchWithTimeout(target, timeoutMs);
  if (!request.ok) {
    return {
      ok: false,
      status: "ERR",
      state: "error",
      summary: `Request error: ${request.error}`
    };
  }

  const status = request.status;
  const headers = request.headers;
  const body = request.body ?? "";
  const location = headers.get("location") || "";
  const matchedPath = normalizePath(headers.get("x-matched-path") || "");
  const contentType = String(headers.get("content-type") || "").toLowerCase();

  if (check.type === "page") {
    if (status >= 300 && status < 400) {
      const redirectTo = normalizePath(location);
      const isSignIn = redirectTo.includes("/sign-in");
      const allowed = isSignIn ? check.path === "/sign-in" || check.allowSignInRedirect : true;
      return {
        ok: allowed,
        status,
        state: isSignIn ? "sign-in-redirect" : "redirect",
        redirectTo,
        summary: `HTTP ${status} redirect -> ${redirectTo || "unknown"}`
      };
    }

    const normalizedBody = body.toLowerCase();
    const bodyWithoutScripts = body.replace(/<script[\s\S]*?<\/script>/gi, "").toLowerCase();
    const isNotFound =
      status === 404 ||
      matchedPath === "/_not-found" ||
      bodyWithoutScripts.includes("could not be found") ||
      bodyWithoutScripts.includes("this page could not be found");

    if (isNotFound) {
      return {
        ok: false,
        status,
        state: "missing",
        summary: `HTTP ${status}: route not found`
      };
    }

    const isHtml = status >= 200 && status < 300 && contentType.includes("text/html");
    if (isHtml || normalizedBody.includes("<html")) {
      return {
        ok: true,
        status,
        state: "page",
        summary: "HTTP 200: html page"
      };
    }

    return {
      ok: status < 400,
      status,
      state: "non-html",
      summary: `HTTP ${status}: unexpected content`
    };
  }

  if (
    !(contentType.includes("application/json") || body.trim().startsWith("{") || body.trim().startsWith("["))
  ) {
    return {
      ok: false,
      status,
      state: "invalid-json",
      summary: `HTTP ${status}: non-json response`
    };
  }

  const parsed = parseJsonBody(body);
  if (!parsed.ok) {
    return {
      ok: false,
      status,
      state: "invalid-json",
      summary: `HTTP ${status}: invalid json`
    };
  }

  const payload = unwrapData(parsed.value);
  const validation = check.validator ? check.validator(payload) : { ok: true };
  if (!validation.ok) {
    return {
      ok: false,
      status,
      state: "invalid-json",
      summary: `HTTP ${status}: ${validation.reason || "validation failed"}`
    };
  }

  return {
    ok: true,
    status,
    state: "api",
    summary: `HTTP ${status}: API OK`,
    payload
  };
}

function compareRoutes(check, local, prod) {
  if (!local) {
    return { match: false, reason: "No local result" };
  }

  if (check.type === "page") {
    if (local.state === "page" && prod.state === "page") {
      return {
        match: local.status === prod.status,
        reason: local.status === prod.status ? "both page" : `page status mismatch (${local.status} / ${prod.status})`
      };
    }

    if (local.state !== prod.state) {
      return {
        match: false,
        reason: `state mismatch (${local.state} / ${prod.state})`
      };
    }

    if (local.state === "sign-in-redirect" || local.state === "redirect") {
      return {
        match: local.status === prod.status && local.redirectTo === prod.redirectTo,
        reason:
          local.status === prod.status && local.redirectTo === prod.redirectTo
            ? "same redirect"
            : `redirect mismatch (${local.redirectTo} / ${prod.redirectTo})`
      };
    }

    return {
      match: local.status === prod.status,
      reason: local.status === prod.status ? "same status" : "status mismatch"
    };
  }

  if (local.status !== prod.status) {
    return {
      match: false,
      reason: `API status mismatch (${local.status} / ${prod.status})`
    };
  }
  if (check.comparator) {
    const compareResult = check.comparator(local.payload, prod.payload);
    if (!compareResult.ok) {
      return {
        match: false,
        reason: compareResult.reason,
        details: compareResult.details
      };
    }
  }

  return {
    match: local.ok === prod.ok,
    reason: local.ok === prod.ok ? "both API OK" : "API response validity mismatch"
  };
}

function evaluateMobileUi(fileMap, threshold) {
  const details = [];
  let scoreTotal = 0;
  let files = 0;
  const fileScores = {};

  for (const [route, file] of Object.entries(fileMap)) {
    files += 1;
    if (!existsSync(file)) {
      fileScores[route] = 40;
      scoreTotal += 40;
      details.push(`${route}: missing source file (${file})`);
      continue;
    }

    const text = readFileSync(file, "utf8");
    const classTokens = Array.from(text.matchAll(/className="([^\"]*)"/g))
      .map((match) => match[1])
      .join(" ");

    let routeScore = 100;
    const hasResponsive = /\b(?:sm:|md:|lg:|xl:|2xl:)/.test(classTokens);
    const hasTouchFriendly = /\b(?:h-(?:10|11|12)|py-(?:2|3|4))\b/.test(classTokens);
    const hasLayoutControl = /\b(?:grid-cols-|flex-wrap|overflow-x-auto|whitespace-nowrap)\b/.test(classTokens);
    const hasSpacing = /\b(?:p[trblxy]?-[1-9]|m[trblxy]?-[1-9]|px-[1-9]|py-[1-9]|mx-[1-9]|my-[1-9])\b/.test(classTokens);

    if (!hasResponsive) {
      routeScore -= 20;
      details.push(`${route}: no responsive utility class (sm/md/lg/xl)`);
    }
    if (!hasTouchFriendly) {
      routeScore -= 20;
      details.push(`${route}: no mobile tap target sizing (` + "`h-10|h-11|py-2`" + `)`);
    }
    if (!hasLayoutControl) {
      routeScore -= 15;
      details.push(`${route}: no responsive layout control (` + "`grid-cols-/flex-wrap`" + `)`);
    }
    if (!hasSpacing) {
      routeScore -= 15;
      details.push(`${route}: no spacing tokens`);
    }

    fileScores[route] = routeScore;
    scoreTotal += routeScore;
  }

  const score = Math.round(scoreTotal / Math.max(files, 1));
  return {
    score,
    threshold,
    pass: score >= threshold,
    details,
    fileScores,
    files
  };
}

function normalizePath(value) {
  if (!value) return "";
  return String(value)
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "") || "/";
}

function parseJsonBody(body) {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

function unwrapData(payload) {
  if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

function evaluateProductionVerification(result) {
  if (isAuthRequiredResult(result)) {
    return { outcome: "unverified", reason: "Authentication required; protected content not checked" };
  }
  if (!result.ok) {
    return { outcome: "failed", reason: result.summary || "Production check failed" };
  }
  return { outcome: "verified", reason: result.summary || "Production check passed" };
}

function isAuthRequiredResult(result) {
  if (!result) return false;
  if (result.status === 401 || result.status === 403) return true;
  if (result.state === "sign-in-redirect") return true;
  const payload = result.payload;
  if (payload && typeof payload === "object" && /auth|login/i.test(String(payload.error ?? ""))) return true;
  return false;
}

function validateHealthApi(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "object payload required" };
  if (typeof payload.features === "object" && typeof payload.publicAppUrl === "string") return { ok: true };
  return { ok: false, reason: "health payload missing features/ok" };
}

function validateJsonObject(payload) {
  if (payload && typeof payload === "object") return { ok: true };
  return { ok: false, reason: "object required" };
}

function validateAdminState(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "object required" };
  if (!Array.isArray(payload.reservations)) return { ok: false, reason: "reservations array missing" };
  if (!Array.isArray(payload.customers)) return { ok: false, reason: "customers array missing" };
  return { ok: true };
}

function validateNotificationPayload(payload) {
  if (Array.isArray(payload)) return { ok: true };
  if (payload && Array.isArray(payload.data)) return { ok: true };
  return { ok: false, reason: "array payload expected" };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" }
    });
    const body = await response.text();
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      body
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function currentProductionUrl() {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured && !configured.includes("arare-ai.vercel.app")) return configured;
  return "https://arare-ai-three.vercel.app";
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--skip-local") {
      options["skip-local"] = true;
      continue;
    }

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith("--production=")) {
      options.production = arg.substring(arg.indexOf("=") + 1);
      continue;
    }

    if (arg.startsWith("--local=")) {
      options.local = arg.substring(arg.indexOf("=") + 1);
      continue;
    }

    if (arg.startsWith("--timeout=")) {
      options.timeout = arg.substring(arg.indexOf("=") + 1);
      continue;
    }

    if (arg.startsWith("--min-ui-score=")) {
      options["min-ui-score"] = arg.substring(arg.indexOf("=") + 1);
      continue;
    }

    if (!arg.startsWith("--") && !options.production) {
      options.production = arg;
    }
  }

  return options;
}

function compareHealthPayload(localPayload, prodPayload) {
  const keys = ["database", "openai", "line", "twilio", "clerk"];
  const details = [];

  if (!localPayload || !prodPayload) {
    return {
      ok: false,
      reason: "Health payload missing for local or production",
      details: ["health payload missing on one side"]
    };
  }

  const localFeatures = localPayload.features || {};
  const prodFeatures = prodPayload.features || {};
  let featureMismatch = false;
  const featureDifferences = [];

  for (const key of keys) {
    const localValue = Boolean(localFeatures[key]);
    const prodValue = Boolean(prodFeatures[key]);
    if (localValue !== prodValue) {
      featureMismatch = true;
      featureDifferences.push(`${key}: local=${localValue}, prod=${prodValue}`);
    }
  }

  if (featureMismatch) {
    details.push(`features mismatch: ${featureDifferences.join(", ")}`);
  }

  const localPublicAppUrl = localPayload.publicAppUrl || "";
  const prodPublicAppUrl = prodPayload.publicAppUrl || "";
  if (String(localPublicAppUrl) !== String(prodPublicAppUrl)) {
    details.push(`publicAppUrl mismatch: local="${localPublicAppUrl}", prod="${prodPublicAppUrl}"`);
  }

  if (details.length > 0) {
    return {
      ok: false,
      reason: "Health API body mismatch",
      details
    };
  }

  return { ok: true, reason: "health payload aligned" };
}

function isAuthRedirectMismatchRelevant(path, localResult, parity) {
  if (!localResult) return false;
  const authLikePath = localResult.state === "sign-in-redirect" && path !== "/sign-in" && parity.match;
  return authLikePath;
}

function printHelp() {
  console.log(`Usage:
  node scripts/verify-production-parity.mjs [--production=<url>] [--local=<url>] [--skip-local] [--json] [--timeout=<ms>] [--min-ui-score=<number>]
`);
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

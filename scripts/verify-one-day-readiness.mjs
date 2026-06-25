import { existsSync, readFileSync } from "node:fs";

loadEnv(".env.local");
loadEnv(".env");

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const timeoutMs = Number(options.timeoutMs ?? process.env.READINESS_TIMEOUT_MS ?? 30000);
const baseUrl = normalizeBaseUrl(options.baseUrl ?? options._[0] ?? process.env.ARARE_VERIFY_BASE_URL ?? currentProductionUrl());
const voiceRelayHealthUrl = options.skipVoiceRelay
  ? undefined
  : normalizeOptionalUrl(
      options.voiceRelayHealthUrl ??
        options._[1] ??
        process.env.VOICE_RELAY_HEALTH_URL ??
        deriveRelayHealthUrl(process.env.VOICE_RELAY_WS_URL) ??
        defaultRelayHealthUrl()
    );
const authHeaders = buildAuthHeaders();
const results = [];

await runCheck("production health", async () => {
  const data = unwrapData(await fetchJson("/api/health"));
  expect(data?.status === "ok", "Health endpoint did not report status=ok.", data);
  expect(isObject(data.features), "Health endpoint did not include feature flags.", data);
  expect(Array.isArray(data.productionChecklist), "Health endpoint did not include productionChecklist.", data);

  const missingRequired = data.productionChecklist
    .filter((item) => item.requiredForDemo !== false && !item.configured)
    .map((item) => item.name);
  const missingOptional = data.productionChecklist
    .filter((item) => item.requiredForDemo === false && !item.configured)
    .map((item) => item.name);
  expect(missingRequired.length === 0, `Missing required production environment variables: ${missingRequired.join(", ")}`, {
    missingRequired,
    missingOptional
  });

  return {
    details: {
      features: data.features,
      requiredEnv: "demo-required configured",
      optionalPending: missingOptional
    },
    warnings: missingOptional.length ? [`Optional integrations not configured: ${missingOptional.join(", ")}`] : []
  };
});

await runCheck("setup checklist", async () => {
  const data = unwrapData(await fetchJson("/api/setup/checklist", { headers: authHeaders }));
  expect(data?.databaseConfigured !== false, "Database is not configured for setup checklist.", data);
  expect(Array.isArray(data.items), "Setup checklist did not return checklist items.", data);

  const incomplete = data.items.filter((item) => !item.done).map((item) => item.key);
  expect(incomplete.length === 0 && data.ready === true, `Setup checklist is incomplete: ${incomplete.join(", ")}`, {
    ready: data.ready,
    incomplete
  });

  return {
    details: {
      ready: data.ready,
      checkedItems: data.items.length
    }
  };
});

await runCheck("admin state", async () => {
  const data = unwrapData(await fetchJson("/api/admin/state", { headers: authHeaders }));
  expect(data?.databaseConfigured !== false, "Admin state reports databaseConfigured=false.", data);

  const arrayKeys = ["reservations", "customers", "therapists", "courses", "conversations", "notifications", "rooms"];
  for (const key of arrayKeys) {
    expect(Array.isArray(data?.[key]), `Admin state is missing array: ${key}`, data);
  }

  const counts = Object.fromEntries(arrayKeys.map((key) => [key, data[key].length]));
  const missingCoreData = ["therapists", "courses", "rooms"].filter((key) => counts[key] < 1);
  expect(missingCoreData.length === 0, `Admin state is missing core demo data: ${missingCoreData.join(", ")}`, counts);

  const warnings = ["reservations", "customers"].filter((key) => counts[key] < 1).map((key) => `${key} is empty`);
  return {
    details: counts,
    warnings
  };
});

await runCheck("ai extraction", async () => {
  const sampleText =
    "\u4f50\u85e4\u3067\u3059\u3002\u660e\u65e519\u6642\u304b\u308990\u5206\u30b3\u30fc\u30b9\u3067\u4e88\u7d04\u3057\u305f\u3044\u3067\u3059\u3002" +
    "\u6307\u540d\u306a\u3057\u3001\u521d\u56de\u3067\u3059\u3002\u96fb\u8a71\u756a\u53f7\u306f080-1234-5678\u3067\u3059\u3002" +
    "\u6ce8\u610f\u4e8b\u9805\u3082\u78ba\u8a8d\u3057\u307e\u3057\u305f\u3002";
  const data = unwrapData(
    await fetchJson("/api/ai/extract", {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: sampleText })
    })
  );

  expect(isObject(data), "AI extraction did not return an object.", data);
  expect(typeof data.summary === "string", "AI extraction is missing summary.", data);
  expect(typeof data.confidence === "number", "AI extraction is missing numeric confidence.", data);
  expect(!String(data.escalationReason ?? "").startsWith("OPENAI_API_KEY"), "OpenAI API key is not configured.", data);
  expect(!String(data.escalationReason ?? "").startsWith("OpenAI error:"), data.escalationReason ?? "OpenAI returned an error.", data);
  expect(data.intent === "CREATE_RESERVATION", `AI extraction intent was ${data.intent}, expected CREATE_RESERVATION.`, data);

  const missingFields = ["customerName", "phone", "startsAtText", "courseName"].filter((key) => !data[key]);
  expect(missingFields.length === 0, `AI extraction missed fields: ${missingFields.join(", ")}`, data);
  expect(data.confidence >= 0.5, `AI extraction confidence is low: ${data.confidence}`, data);

  return {
    details: {
      intent: data.intent,
      customerName: data.customerName,
      phone: data.phone,
      startsAtText: data.startsAtText,
      courseName: data.courseName,
      confidence: data.confidence
    }
  };
});

await runCheck("voice relay health", async () => {
  if (options.skipVoiceRelay) {
    return {
      warnings: ["voice relay check skipped by --skip-voice-relay"],
      details: { skipped: true }
    };
  }

  expect(Boolean(voiceRelayHealthUrl), "No voice relay health URL could be resolved.");
  const data = await fetchJson(voiceRelayHealthUrl);
  expect(data?.ok === true, "Voice relay did not report ok=true.", data);
  expect(data.service === "arare-ai-voice-relay", "Voice relay service name did not match.", data);
  expect(data.openaiConfigured === true, "Voice relay OPENAI_API_KEY is not configured.", data);
  expect(data.databaseConfigured === true, "Voice relay DATABASE_URL is not configured.", data);

  return {
    details: {
      url: redactUrl(voiceRelayHealthUrl),
      openaiConfigured: data.openaiConfigured,
      databaseConfigured: data.databaseConfigured,
      activeSessions: data.activeSessions,
      uptimeSec: data.uptimeSec
    }
  };
});

const failed = results.filter((result) => result.status === "FAIL");
const warned = results.filter((result) => result.status === "WARN");

if (options.json) {
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        baseUrl,
        voiceRelayHealthUrl: voiceRelayHealthUrl ? redactUrl(voiceRelayHealthUrl) : undefined,
        results
      },
      null,
      2
    )
  );
} else {
  printReport({ baseUrl, voiceRelayHealthUrl, results, failed, warned });
}

process.exitCode = failed.length > 0 ? 1 : 0;

async function runCheck(name, fn) {
  const startedAt = Date.now();
  try {
    const result = (await fn()) ?? {};
    const warnings = result.warnings ?? [];
    results.push({
      name,
      status: warnings.length > 0 ? "WARN" : "PASS",
      durationMs: Date.now() - startedAt,
      details: result.details,
      warnings
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      details: error?.details
    });
  }
}

async function fetchJson(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers ?? {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw withDetails(new Error(`Request failed for ${redactUrl(url)}: ${error instanceof Error ? error.message : String(error)}`), {
      url: redactUrl(url),
      timeoutMs
    });
  }

  const text = await response.text();
  const body = parseBody(text);

  if (!response.ok) {
    const authHint =
      response.status === 401 || response.status === 403
        ? " Protected route rejected the request; set READINESS_COOKIE, READINESS_BEARER_TOKEN, or READINESS_AUTH_HEADER for this verifier."
        : "";
    throw withDetails(new Error(`${response.status} ${response.statusText}.${authHint} Body: ${summarizeBody(body)}`), {
      url: redactUrl(url),
      status: response.status
    });
  }

  return body;
}

function parseBody(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapData(body) {
  return isObject(body) && Object.hasOwn(body, "data") ? body.data : body;
}

function expect(condition, message, details) {
  if (!condition) throw withDetails(new Error(message), details);
}

function withDetails(error, details) {
  error.details = sanitize(details);
  return error;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/token|secret|key|authorization|cookie|password/i.test(key)) return [key, "***"];
      return [key, sanitize(item)];
    })
  );
}

function buildAuthHeaders() {
  const headers = {};

  const rawHeader = process.env.READINESS_AUTH_HEADER ?? process.env.VERIFY_AUTH_HEADER;
  if (rawHeader) {
    const separator = rawHeader.indexOf(":");
    if (separator > 0) {
      headers[rawHeader.slice(0, separator).trim()] = rawHeader.slice(separator + 1).trim();
    }
  }

  if (process.env.READINESS_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.READINESS_BEARER_TOKEN}`;
  }

  if (process.env.READINESS_COOKIE) {
    headers.Cookie = process.env.READINESS_COOKIE;
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  return headers;
}

function deriveRelayHealthUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function defaultRelayHealthUrl() {
  if (process.env.NODE_ENV === "development") {
    const port = process.env.VOICE_RELAY_PORT ?? process.env.PORT ?? "8787";
    return `http://127.0.0.1:${port}/health`;
  }
  return undefined;
}

function currentProductionUrl() {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured && !configured.includes("arare-ai.vercel.app")) return configured;
  return "https://arare-ai-three.vercel.app";
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function normalizeOptionalUrl(value) {
  return value ? String(value).trim() : undefined;
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password/i.test(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return String(value).replace(/(token|secret|key|password)=([^&\s]+)/gi, "$1=***");
  }
}

function summarizeBody(body) {
  const text = typeof body === "string" ? body : JSON.stringify(sanitize(body));
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function printReport({ baseUrl, voiceRelayHealthUrl, results, failed, warned }) {
  console.log("ARARE AI one-day readiness");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Voice relay health: ${voiceRelayHealthUrl ? redactUrl(voiceRelayHealthUrl) : "skipped"}`);
  console.log("Network safety: no SMS APIs and no outbound call APIs are invoked.");
  console.log("");

  for (const result of results) {
    const suffix = result.durationMs ? ` (${result.durationMs}ms)` : "";
    console.log(`${result.status.padEnd(4)} ${result.name}${suffix}`);
    if (result.error) console.log(`     ${result.error}`);
    for (const warning of result.warnings ?? []) console.log(`     warning: ${warning}`);
    if (result.details) console.log(`     ${summarizeBody(result.details)}`);
  }

  console.log("");
  console.log(`Summary: ${results.length - failed.length - warned.length} passed, ${warned.length} warned, ${failed.length} failed.`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/verify-one-day-readiness.mjs [baseUrl] [voiceRelayHealthUrl]

Options:
  --base-url <url>                 App URL. Defaults to PUBLIC_APP_URL or http://127.0.0.1:3000.
  --voice-relay-health-url <url>   Relay health URL. Defaults to VOICE_RELAY_HEALTH_URL, derived VOICE_RELAY_WS_URL, or local :8787.
  --skip-voice-relay               Do not contact the voice relay.
  --timeout-ms <ms>                Per-request timeout. Defaults to 30000.
  --json                           Print machine-readable JSON.
  --help                           Show this message.

Protected admin APIs:
  Set READINESS_COOKIE, READINESS_BEARER_TOKEN, or READINESS_AUTH_HEADER="Header: value" if Clerk or another gate protects the app.

Safety:
  This verifier performs HTTP GET/POST health probes only. It does not send SMS and does not create real phone calls.`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (["json", "help", "skipVoiceRelay"].includes(key)) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

loadEnv(".env.local");
loadEnv(".env");

const args = parseArgs(process.argv.slice(2));
const datasetPath = args.dataset ?? "data/nlu_guard_classification_augmentation_3000.csv";
const relayUrl = firstNonEmpty(
  args.url,
  process.env.VOICE_RELAY_VERIFY_URL,
  process.env.VOICE_RELAY_WS_URL,
  buildDefaultRelayUrl()
);
const limit = Number(args.limit ?? 1000);
const timeoutMs = Number(args.timeoutMs ?? 20000);
const maxRetries = Number(args.retries ?? 1);
const outPath =
  args.out ??
  path.join("reports", `phone_ai_regression_1000_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const fromNumber = args.from ?? "+818037884404";
const toNumber = args.to ?? "+19412396480";

if (!existsSync(datasetPath)) {
  console.error(`Dataset not found: ${datasetPath}`);
  process.exit(1);
}

const rows = selectRows(readCsv(datasetPath), limit);
const results = [];

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const result = await runCaseWithRetry(row, index + 1);
  results.push(result);
  if ((index + 1) % 50 === 0) {
    console.log(JSON.stringify(progressSummary(results, rows.length)));
  }
}

const summary = buildSummary(results);
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ summary, relayUrl: redactToken(relayUrl), datasetPath, results }, null, 2), "utf8");
  console.log(JSON.stringify({ ...summary, outPath }, null, 2));
if (summary.failed > 0) process.exitCode = 1;

async function runCaseWithRetry(row, caseNumber) {
  const attempts = [];
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await runCase(row, caseNumber, attempt + 1);
      return attempts.length ? { ...result, attempts: [...attempts, { ok: true, attempt: attempt + 1 }] } : result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ ok: false, attempt: attempt + 1, error: message });
      if (/Invalid URL/i.test(message) || attempt >= maxRetries) {
        return {
          ok: false,
          pass: false,
          error: message,
          attempts,
          category: row.category,
          utterance: row.utterance,
          expectedAction: row.expected_action ?? row.expectedAction,
          forbiddenAction: row.forbidden_action ?? row.forbiddenAction,
          priority: row.priority,
          row
        };
      }
      await sleep(250);
    }
  }
}

async function runCase(row, caseNumber) {
  const callSid = `CA_REGRESSION_${Date.now()}_${String(caseNumber).padStart(4, "0")}`;
  const received = [];
  const startedAt = new Date().toISOString();
  const responseText = await sendPrompt({
    callSid,
    text: row.utterance,
    received
  });
  const assertion = assertCase(row, responseText);
  return {
    ok: true,
    pass: assertion.pass,
    caseNumber,
    callSid,
    category: row.category,
    utterance: row.utterance,
    expectedAction: row.expected_action ?? row.expectedAction,
    forbiddenAction: row.forbidden_action ?? row.forbiddenAction,
    priority: row.priority,
    responseText,
    assertion,
    startedAt,
    endedAt: new Date().toISOString(),
    messages: received
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendPrompt({ callSid, text, received }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms for ${callSid}`));
    }, timeoutMs);
    const tokens = [];
    const ws = new WebSocket(relayUrl);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          sessionId: `VX_REGRESSION_${Date.now()}`,
          callSid,
          from: fromNumber,
          to: toNumber,
          direction: "inbound",
          callStatus: "RINGING",
          customParameters: {
            storeId: "demo-store-arare-ai",
            storePhoneSettingId: "",
            toNumber,
            fromNumber,
            callReference: callSid
          }
        })
      );
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "prompt", voicePrompt: text, lang: "ja-JP", last: true }));
      }, 100);
    });
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      received.push(message);
      if (message.type === "text" && message.token) tokens.push(String(message.token));
      if (message.type === "end" || (message.type === "text" && message.last === true)) {
        clearTimeout(timeout);
        ws.close();
        resolve(tokens.join(""));
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function assertCase(row, responseText) {
  const category = row.category;
  const expected = row.expected_action ?? row.expectedAction ?? "";
  const forbidden = row.forbidden_action ?? row.forbiddenAction ?? "";
  const failures = [];
  const sourceText = String(responseText ?? "");
  const utteranceText = String(row.utterance ?? "");
  const text = normalize(sourceText);
  const utterance = normalize(utteranceText);
  const hasAny = (value, needles) => needles.some((needle) => String(value ?? "").includes(needle));

  if (!text) failures.push("empty_response");

  const prematurelyReserved = hasAny(sourceText, [
    "\u4e88\u7d04\u3092\u627f\u308a\u307e\u3057\u305f",
    "\u4e88\u7d04\u3092\u78ba\u5b9a",
    "\u78ba\u5b9a\u3057\u307e\u3057\u305f",
    "\u78ba\u8a8dSMS",
    "SMS\u3092\u304a\u9001\u308a",
    "\u3054\u6765\u5e97\u304a\u5f85\u3061"
  ]);
  const customerInfoWords = [
    "\u304a\u540d\u524d",
    "\u4e88\u7d04\u8005\u69d8",
    "\u96fb\u8a71\u756a\u53f7",
    "\u3054\u9023\u7d61\u5148",
    "\u30b3\u30fc\u30b9\u306f"
  ];
  const availabilityWords = [
    "\u304a\u65e5\u306b\u3061",
    "\u65e5\u4ed8",
    "\u65e5\u6642",
    "\u304a\u6642\u9593",
    "\u6642\u9593",
    "\u4f55\u6642",
    "\u7a7a\u304d",
    "\u5019\u88dc",
    "\u78ba\u8a8d",
    "\u3054\u6848\u5185\u53ef\u80fd",
    "\u6e80\u67a0",
    "\u30bb\u30e9\u30d4\u30b9\u30c8"
  ];
  const clarificationWords = [
    "\u78ba\u8a8d",
    "\u3069\u3061\u3089",
    "\u5348\u524d",
    "\u5348\u5f8c",
    "\u671d",
    "\u663c",
    "\u591c",
    "\u4f55\u6642",
    "\u304a\u6642\u9593",
    "\u6642\u9593",
    "\u304a\u65e5\u306b\u3061",
    "\u65e5\u4ed8",
    "\u65e5\u6642",
    "\u3082\u3046\u4e00\u5ea6",
    "\u6559\u3048\u3066"
  ];
  const asksCustomerInfoTooEarly =
    hasAny(sourceText, customerInfoWords) && !hasAny(sourceText, availabilityWords);
  const asksClarification = hasAny(sourceText, clarificationWords);
  const mentionsAvailabilityPath = hasAny(sourceText, availabilityWords);

  if (prematurelyReserved) failures.push("premature_reservation_confirmation");

  if (category === "relative_date_context") {
    if (!mentionsAvailabilityPath) failures.push("missing_date_availability_path");
    if (asksCustomerInfoTooEarly) failures.push("asked_customer_info_before_datetime_availability");
  }

  if (category === "time_disambiguation" || category === "time_ambiguity_guard") {
    const hasExplicitAmPm =
      hasAny(utteranceText, ["\u671d", "\u663c", "\u591c", "\u5348\u524d", "\u5348\u5f8c"]) || /[12][0-9]\u6642|2[0-9]\u6642/.test(utteranceText);
    if (!hasExplicitAmPm && !asksClarification) failures.push("missing_time_disambiguation_question");
    if (!hasExplicitAmPm && hasAny(sourceText, ["\u78ba\u5b9a\u3057\u307e\u3057\u305f", "\u3054\u6848\u5185\u3067\u304d\u307e\u3059"])) {
      failures.push("low_confidence_time_confirmed");
    }
  }

  if (category === "pending_confirmation") {
    if (prematurelyReserved) failures.push("confirmed_without_pending_offer");
    if (!asksClarification && !mentionsAvailabilityPath) failures.push("missing_pending_confirmation_recovery");
  }

  if (category === "availability_search" || category === "availability_search_question") {
    if (!mentionsAvailabilityPath) failures.push("missing_availability_search_response");
    if (asksCustomerInfoTooEarly) failures.push("asked_customer_info_before_availability");
  }

  if (category === "therapist_false_positive") {
    const likelyFalsePositiveSource = hasAny(utteranceText, [
      "\u304b\u306a\u3044",
      "\u304b\u306a\u308a",
      "\u8ab0\u304b",
      "\u8ab0\u3067\u3082",
      "\u6307\u540d\u306a\u3057",
      "\u30d5\u30ea\u30fc",
      "\u53cb\u9054",
      "\u7d39\u4ecb",
      "\u53e3\u30b3\u30df",
      "\u7a7a\u3044\u3066\u308b\u4eba"
    ]);
    if (
      likelyFalsePositiveSource &&
      (/(kana)/i.test(sourceText) ||
        hasAny(sourceText, [
          "\u304b\u306a\u3055\u3093",
          "\u304b\u306a\u69d8",
          "\u6307\u540d\u3067",
          "\u6307\u540d\u3068\u3057\u3066",
          "\u62c5\u5f53\u306f\u304b\u306a",
          "\u304b\u306a\u3067\u9032\u3081"
        ]))
    ) {
      failures.push("false_positive_therapist_saved");
    }
    if (/selected_therapist/.test(forbidden) && hasAny(sourceText, ["\u6307\u540d\u3067\u9032\u3081", "\u62c5\u5f53\u3068\u3057\u3066", "\u9078\u629e\u3057\u307e\u3057\u305f"])) {
      failures.push("forbidden_therapist_assignment_risk");
    }
  }

  if (category === "repeat_response_guard") {
    if (!hasAny(sourceText, ["\u5019\u88dc", "\u5225", "\u78ba\u8a8d", "\u7a7a\u304d", "\u304a\u8abf\u3079", "\u65e5\u6642", "\u65e5\u4ed8", "\u6642\u9593", "\u304a\u6642\u9593", "\u30aa\u30da\u30ec\u30fc\u30bf\u30fc", "\u5e97\u8217"])) {
      failures.push("repeat_without_escape_route");
    }
  }

  if (/selected_therapist|customer_name|requested_datetime/.test(forbidden) && hasAny(sourceText, ["\u4fdd\u5b58\u3057\u307e\u3057\u305f", "\u78ba\u5b9a\u3057\u307e\u3057\u305f", "\u6307\u540d\u3067\u9032\u3081", "\u4e88\u7d04\u3092\u627f\u308a\u307e\u3057\u305f"])) {
    failures.push("forbidden_action_risk");
  }

  if (/clarification|required|\u78ba\u8a8d|\u805e\u304f/.test(expected) && !asksClarification) {
    failures.push("missing_clarification");
  }

  if ((utterance.includes("10\u6642") || utterance.includes("\uff11\uff10\u6642")) && !hasAny(utteranceText, ["\u591c", "\u671d", "\u5348\u524d", "\u5348\u5f8c", "22\u6642", "\uff12\uff12\u6642", "10\u6642\u3063\u3066\u591c"])) {
    if (hasAny(sourceText, ["22\u6642", "\uff12\uff12\u6642", "\u591c10\u6642", "\u591c\uff11\uff10\u6642"]) && !asksClarification) {
      failures.push("ambiguous_10_oclock_forced_to_22");
    }
  }

  return { pass: failures.length === 0, failures };
}
function buildSummary(items) {
  const failedItems = items.filter((item) => !item.pass);
  const byCategory = {};
  for (const item of items) {
    const category = item.category ?? "unknown";
    byCategory[category] ??= { total: 0, passed: 0, failed: 0 };
    byCategory[category].total += 1;
    if (item.pass) byCategory[category].passed += 1;
    else byCategory[category].failed += 1;
  }
  return {
    total: items.length,
    passed: items.length - failedItems.length,
    failed: failedItems.length,
    passRate: items.length ? Number((((items.length - failedItems.length) / items.length) * 100).toFixed(2)) : 0,
    byCategory
  };
}

function progressSummary(items, total) {
  const summary = buildSummary(items);
  return { progress: `${items.length}/${total}`, passed: summary.passed, failed: summary.failed };
}

function readCsv(filePath) {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, "").trim());
  return lines.slice(1).map((line) => {
    const columns = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]));
  });
}

function selectRows(rows, limit) {
  if (!Number.isFinite(limit) || limit <= 0 || rows.length <= limit) return rows;
  const groups = new Map();
  for (const row of rows) {
    const category = row.category || "unknown";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(row);
  }
  const categories = Array.from(groups.keys()).sort();
  const selected = [];
  let cursor = 0;
  while (selected.length < limit && categories.length > 0) {
    const category = categories[cursor % categories.length];
    const bucket = groups.get(category);
    if (bucket && bucket.length > 0) {
      selected.push(bucket.shift());
    }
    if (bucket && bucket.length === 0) {
      groups.delete(category);
      categories.splice(categories.indexOf(category), 1);
      cursor = 0;
      continue;
    }
    cursor += 1;
  }
  return selected;
}

function parseCsvLine(line) {
  const columns = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      columns.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  columns.push(current);
  return columns;
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) parsed[match[1]] = match[2];
  }
  return parsed;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function buildDefaultRelayUrl() {
  const token = process.env.VOICE_RELAY_SHARED_SECRET;
  const base = "ws://127.0.0.1:8787/conversation-relay";
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function redactToken(value) {
  return value.replace(/token=([^&]+)/, "token=***");
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
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

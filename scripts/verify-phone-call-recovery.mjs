import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advanceStateRetry,
  classifyFinalConfirmationTurn,
  extractFirstVisitAnswer,
  getNextReservationField,
  isAttentionConfirmationAnswer,
  isLowConfidenceCustomerName,
  isPhoneCallerNumberAffirmative
} from "./lib/phone-state-intents.mjs";

const fixture = JSON.parse(readFileSync("data/phone_ai_real_call_recovery_cases.json", "utf8"));
const courses = [
  { id: "course-60", name: "60分リラックスコース", durationMin: 60 },
  { id: "course-90", name: "90分スタンダードコース", durationMin: 90 },
  { id: "course-120", name: "120分ゆったりコース", durationMin: 120 }
];

for (const item of fixture.cases) {
  let actual;
  if (item.scope === "phone_caller_affirmative") actual = isPhoneCallerNumberAffirmative(item.utterance);
  if (item.scope === "final_confirmation") {
    const result = classifyFinalConfirmationTurn(item.utterance, courses);
    actual = result.intent;
    if (item.expectedDurationMin) assert.equal(result.course?.durationMin, item.expectedDurationMin, item.utterance);
  }
  if (item.scope === "first_visit") actual = extractFirstVisitAnswer(item.utterance);
  if (item.scope === "attention") actual = isAttentionConfirmationAnswer(item.utterance);
  if (item.scope === "name_confidence") actual = isLowConfidenceCustomerName(item.utterance);
  assert.equal(actual, item.expected, `${item.scope}: ${item.utterance}`);
}

const attempts = {};
assert.deepEqual(advanceStateRetry(attempts, "finalConfirmation"), { attempts, count: 1, shouldEscalate: false });
assert.deepEqual(advanceStateRetry(attempts, "finalConfirmation"), { attempts, count: 2, shouldEscalate: false });
assert.deepEqual(advanceStateRetry(attempts, "finalConfirmation"), { attempts, count: 3, shouldEscalate: true });

const draft = {
  startsAt: new Date("2026-07-11T12:00:00.000Z"),
  availabilityCheckResult: { ok: true },
  customerName: "佐藤",
  phone: "080-3788-4404"
};
assert.equal(getNextReservationField(draft), "course");
draft.course = courses[1];
assert.equal(getNextReservationField(draft), "firstVisit");
draft.firstVisit = false;
assert.equal(getNextReservationField(draft), "attention");
draft.attentionConfirmed = true;
assert.equal(getNextReservationField(draft), "finalConfirmation");

console.log(JSON.stringify({ ok: true, cases: fixture.cases.length + 7, source: fixture.source }, null, 2));

import assert from "node:assert/strict";
import { ensureDemoBusinessHourShifts, parseBusinessClock } from "./lib/demo-business-hour-shifts.mjs";

assert.equal(parseBusinessClock("12:00", 0), 720);
assert.equal(parseBusinessClock("29:30", 0), 1770);
assert.equal(parseBusinessClock("invalid", 720), 720);

const writes = [];
const prisma = {
  store: {
    findUnique: async () => ({
      id: "demo-store",
      name: "Demo",
      openTime: "12:00",
      closeTime: "29:00",
      therapists: [
        { id: "therapist-a", displayName: "A" },
        { id: "therapist-b", displayName: "B" }
      ]
    })
  },
  shift: {
    findMany: async () => [],
    upsert: async (input) => {
      writes.push(input);
      return input.create;
    }
  }
};

const result = await ensureDemoBusinessHourShifts({
  prisma,
  storeId: "demo-store",
  days: 2,
  now: new Date("2026-07-11T04:00:00.000Z"),
  apply: true
});

assert.equal(result.expectedShiftCount, 4);
assert.equal(result.createdOrUpdated, 4);
assert.equal(writes.length, 4);
assert.equal(writes[0].create.startsAt.toISOString(), "2026-07-11T03:00:00.000Z");
assert.equal(writes[0].create.endsAt.toISOString(), "2026-07-11T20:00:00.000Z");
assert.equal(writes[2].create.startsAt.toISOString(), "2026-07-12T03:00:00.000Z");
assert.equal(writes[2].create.endsAt.toISOString(), "2026-07-12T20:00:00.000Z");

console.log(JSON.stringify({ pass: true, assertions: 11, generated: writes.length }, null, 2));

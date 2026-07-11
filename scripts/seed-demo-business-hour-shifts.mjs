import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ensureDemoBusinessHourShifts } from "./lib/demo-business-hour-shifts.mjs";

loadEnv(".env.local");
loadEnv(".env");

const prisma = new PrismaClient();
const storeId = process.env.DEMO_STORE_ID ?? "demo-store-arare-ai";
const daysArg = process.argv.find((value) => value.startsWith("--days="));
const days = Number(daysArg?.split("=")[1] ?? process.env.DEMO_AUTO_SHIFT_DAYS ?? 90);
const apply = process.argv.includes("--apply");

try {
  const result = await ensureDemoBusinessHourShifts({ prisma, storeId, days, apply });
  console.log(JSON.stringify({ ok: true, mode: apply ? "applied" : "dry-run", ...result }, null, 2));
} finally {
  await prisma.$disconnect();
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

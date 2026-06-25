import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

type RateLimitRule = {
  windowMs: number;
  max: number;
};

type RateLimitOptions = {
  name: string;
  rules: RateLimitRule[];
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitBucket>;

const globalRateLimitStore = globalThis as typeof globalThis & {
  __arareRateLimitStore?: RateLimitStore;
};

function store() {
  globalRateLimitStore.__arareRateLimitStore ??= new Map();
  return globalRateLimitStore.__arareRateLimitStore;
}

function clientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function requestIdentity(request: NextRequest) {
  const token = request.headers.get("x-arare-automation-token") ?? "";
  const tokenHash = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "no-token";
  return createHash("sha256").update(`${clientIp(request)}:${tokenHash}`).digest("hex").slice(0, 32);
}

function cleanupExpiredBuckets(now: number) {
  const current = store();
  if (current.size < 1000) return;

  for (const [key, bucket] of current.entries()) {
    if (bucket.resetAt <= now) current.delete(key);
  }
}

export async function rateLimit(request: NextRequest, options: RateLimitOptions) {
  if (process.env.DATABASE_URL) {
    try {
      return await databaseRateLimit(request, options);
    } catch (error) {
      console.error("database rate limit failed; falling back to memory limiter", error);
    }
  }

  return memoryRateLimit(request, options);
}

function memoryRateLimit(request: NextRequest, options: RateLimitOptions) {
  const now = Date.now();
  const identity = requestIdentity(request);
  const current = store();
  cleanupExpiredBuckets(now);

  let retryAfterMs = 0;

  for (const rule of options.rules) {
    const key = `${options.name}:${identity}:${rule.windowMs}`;
    const existing = current.get(key);
    const bucket =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + rule.windowMs
          };

    bucket.count += 1;
    current.set(key, bucket);

    if (bucket.count > rule.max) {
      retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - now);
    }
  }

  if (retryAfterMs <= 0) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: "rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}

async function databaseRateLimit(request: NextRequest, options: RateLimitOptions) {
  await ensureDatabaseRateLimitTable();

  const now = new Date();
  const identity = requestIdentity(request);
  let retryAfterMs = 0;

  for (const rule of options.rules) {
    const key = createHash("sha256").update(`${options.name}:${identity}:${rule.windowMs}`).digest("hex");
    const resetAt = new Date(Date.now() + rule.windowMs);
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "ApiRateLimit" ("id", "key", "count", "resetAt", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${key}, 1, ${resetAt}, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "ApiRateLimit"."resetAt" <= ${now} THEN 1
          ELSE "ApiRateLimit"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "ApiRateLimit"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "ApiRateLimit"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;

    const bucket = rows[0];
    if (bucket && bucket.count > rule.max) {
      retryAfterMs = Math.max(retryAfterMs, bucket.resetAt.getTime() - Date.now());
    }
  }

  void pruneExpiredDatabaseBuckets().catch((error) => {
    console.error("rate limit cleanup failed", error);
  });

  if (retryAfterMs <= 0) return null;

  return rateLimitResponse(retryAfterMs);
}

let lastDatabasePruneAt = 0;
let databaseTableReady: Promise<void> | null = null;

function ensureDatabaseRateLimitTable() {
  databaseTableReady ??= (async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ApiRateLimit" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "count" INTEGER NOT NULL DEFAULT 0,
        "resetAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ApiRateLimit_pkey" PRIMARY KEY ("id")
      )
    `;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "ApiRateLimit_key_key" ON "ApiRateLimit"("key")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ApiRateLimit_resetAt_idx" ON "ApiRateLimit"("resetAt")`;
  })().catch((error) => {
    databaseTableReady = null;
    throw error;
  });

  return databaseTableReady;
}

async function pruneExpiredDatabaseBuckets() {
  const now = Date.now();
  if (now - lastDatabasePruneAt < 10 * 60 * 1000) return;
  lastDatabasePruneAt = now;

  await prisma.$executeRaw`
    DELETE FROM "ApiRateLimit"
    WHERE "resetAt" < ${new Date(now - 60 * 60 * 1000)}
  `;
}

function rateLimitResponse(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: "rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}

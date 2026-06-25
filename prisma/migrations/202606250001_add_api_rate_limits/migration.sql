CREATE TABLE IF NOT EXISTS "ApiRateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiRateLimit_key_key" ON "ApiRateLimit"("key");
CREATE INDEX IF NOT EXISTS "ApiRateLimit_resetAt_idx" ON "ApiRateLimit"("resetAt");

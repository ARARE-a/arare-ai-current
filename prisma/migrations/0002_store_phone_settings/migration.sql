-- CreateEnum
CREATE TYPE "PhoneRoutingMode" AS ENUM ('ALWAYS_AI', 'AFTER_HOURS_AI', 'BUSY_OR_NO_ANSWER_AI', 'MANUAL_ONLY');

-- AlterTable
ALTER TABLE "CallLog"
ADD COLUMN "storePhoneSettingId" TEXT,
ADD COLUMN "toNumber" TEXT;

-- CreateTable
CREATE TABLE "StorePhoneSetting" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currentStorePhoneNumber" TEXT,
    "aiReceptionPhoneNumber" TEXT NOT NULL,
    "normalizedAiReceptionPhoneNumber" TEXT NOT NULL,
    "twilioPhoneNumberSid" TEXT,
    "twilioAccountSid" TEXT,
    "twilioSubaccountSid" TEXT,
    "voiceWebhookUrl" TEXT,
    "voiceRelayWsUrl" TEXT,
    "fallbackPhoneNumber" TEXT,
    "voiceAiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "routingMode" "PhoneRoutingMode" NOT NULL DEFAULT 'ALWAYS_AI',
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePhoneSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePhoneEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storePhoneSettingId" TEXT,
    "eventType" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePhoneEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreUsageMeter" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "voiceCallCount" INTEGER NOT NULL DEFAULT 0,
    "voiceCallSeconds" INTEGER NOT NULL DEFAULT 0,
    "aiSessionCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreUsageMeter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorePhoneSetting_aiReceptionPhoneNumber_key" ON "StorePhoneSetting"("aiReceptionPhoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StorePhoneSetting_normalizedAiReceptionPhoneNumber_key" ON "StorePhoneSetting"("normalizedAiReceptionPhoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StorePhoneSetting_twilioPhoneNumberSid_key" ON "StorePhoneSetting"("twilioPhoneNumberSid");

-- CreateIndex
CREATE INDEX "StorePhoneSetting_storeId_voiceAiEnabled_idx" ON "StorePhoneSetting"("storeId", "voiceAiEnabled");

-- CreateIndex
CREATE INDEX "StorePhoneSetting_normalizedAiReceptionPhoneNumber_idx" ON "StorePhoneSetting"("normalizedAiReceptionPhoneNumber");

-- CreateIndex
CREATE INDEX "StorePhoneEvent_storeId_createdAt_idx" ON "StorePhoneEvent"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StorePhoneEvent_storePhoneSettingId_idx" ON "StorePhoneEvent"("storePhoneSettingId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreUsageMeter_storeId_period_key" ON "StoreUsageMeter"("storeId", "period");

-- CreateIndex
CREATE INDEX "StoreUsageMeter_period_idx" ON "StoreUsageMeter"("period");

-- CreateIndex
CREATE INDEX "CallLog_storePhoneSettingId_idx" ON "CallLog"("storePhoneSettingId");

-- AddForeignKey
ALTER TABLE "StorePhoneSetting" ADD CONSTRAINT "StorePhoneSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePhoneEvent" ADD CONSTRAINT "StorePhoneEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePhoneEvent" ADD CONSTRAINT "StorePhoneEvent_storePhoneSettingId_fkey" FOREIGN KEY ("storePhoneSettingId") REFERENCES "StorePhoneSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreUsageMeter" ADD CONSTRAINT "StoreUsageMeter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_storePhoneSettingId_fkey" FOREIGN KEY ("storePhoneSettingId") REFERENCES "StorePhoneSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

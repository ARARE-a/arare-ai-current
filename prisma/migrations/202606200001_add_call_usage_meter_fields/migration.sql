ALTER TABLE "CallLog"
ADD COLUMN "durationSeconds" INTEGER,
ADD COLUMN "usageMeterRecordedAt" TIMESTAMP(3);

CREATE INDEX "CallLog_usageMeterRecordedAt_idx" ON "CallLog"("usageMeterRecordedAt");

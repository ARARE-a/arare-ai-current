ALTER TABLE "Therapist" ADD COLUMN "phone" TEXT;
ALTER TABLE "Therapist" ADD COLUMN "lineId" TEXT;

ALTER TABLE "Conversation" ADD COLUMN "workflowState" TEXT NOT NULL DEFAULT 'COLLECTING';
ALTER TABLE "Conversation" ADD COLUMN "reservationDraft" JSONB;

ALTER TABLE "Notification" ADD COLUMN "targetName" TEXT;
ALTER TABLE "Notification" ADD COLUMN "targetPhone" TEXT;
ALTER TABLE "Notification" ADD COLUMN "targetLineId" TEXT;

CREATE INDEX "Therapist_storeId_lineId_idx" ON "Therapist"("storeId", "lineId");
CREATE INDEX "Notification_storeId_type_status_scheduledAt_idx" ON "Notification"("storeId", "type", "status", "scheduledAt");

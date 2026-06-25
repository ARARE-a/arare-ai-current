ALTER TABLE "Notification" ADD COLUMN "smsDeliveryStatus" TEXT;
ALTER TABLE "Notification" ADD COLUMN "smsDeliveryCheckedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "smsDeliveredAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "smsDeliveryRaw" JSONB;

CREATE INDEX "Notification_smsSid_idx" ON "Notification"("smsSid");
CREATE INDEX "Notification_storeId_smsDeliveryStatus_idx" ON "Notification"("storeId", "smsDeliveryStatus");

ALTER TABLE "Conversation" ADD COLUMN "externalUserId" TEXT;

CREATE INDEX "Conversation_storeId_channel_externalUserId_updatedAt_idx"
  ON "Conversation"("storeId", "channel", "externalUserId", "updatedAt");

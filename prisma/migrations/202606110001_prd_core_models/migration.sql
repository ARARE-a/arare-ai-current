-- PRD core data models for knowledge management, notification logs, and reservation change history.

ALTER TABLE "Therapist"
ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "StoreSetting"
ADD COLUMN "reservationRules" TEXT,
ADD COLUMN "cancellationRules" TEXT,
ADD COLUMN "attentionNotes" TEXT,
ADD COLUMN "ngResponseRules" TEXT;

CREATE TABLE "CourseOption" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "courseId" TEXT,
  "name" TEXT NOT NULL,
  "price" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TherapistCourse" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "therapistId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TherapistCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "notificationId" TEXT,
  "reservationId" TEXT,
  "type" "NotificationType" NOT NULL,
  "channel" "ConversationChannel" NOT NULL,
  "status" "NotificationStatus" NOT NULL,
  "recipientName" TEXT,
  "recipientPhone" TEXT,
  "recipientLineId" TEXT,
  "provider" TEXT,
  "providerMessageId" TEXT,
  "dedupeKey" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "payload" JSONB,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationChangeHistory" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "reason" TEXT,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReservationChangeHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeBase" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FAQ" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TalkScript" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "situation" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TalkScript_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseOption_storeId_name_key" ON "CourseOption"("storeId", "name");
CREATE INDEX "CourseOption_storeId_isActive_idx" ON "CourseOption"("storeId", "isActive");
CREATE INDEX "CourseOption_courseId_idx" ON "CourseOption"("courseId");

CREATE UNIQUE INDEX "TherapistCourse_therapistId_courseId_key" ON "TherapistCourse"("therapistId", "courseId");
CREATE INDEX "TherapistCourse_storeId_idx" ON "TherapistCourse"("storeId");
CREATE INDEX "TherapistCourse_courseId_idx" ON "TherapistCourse"("courseId");

CREATE UNIQUE INDEX "NotificationLog_storeId_dedupeKey_key" ON "NotificationLog"("storeId", "dedupeKey");
CREATE INDEX "NotificationLog_storeId_type_status_createdAt_idx" ON "NotificationLog"("storeId", "type", "status", "createdAt");
CREATE INDEX "NotificationLog_notificationId_idx" ON "NotificationLog"("notificationId");
CREATE INDEX "NotificationLog_reservationId_idx" ON "NotificationLog"("reservationId");
CREATE INDEX "NotificationLog_providerMessageId_idx" ON "NotificationLog"("providerMessageId");

CREATE INDEX "ReservationChangeHistory_storeId_createdAt_idx" ON "ReservationChangeHistory"("storeId", "createdAt");
CREATE INDEX "ReservationChangeHistory_reservationId_createdAt_idx" ON "ReservationChangeHistory"("reservationId", "createdAt");

CREATE INDEX "KnowledgeBase_storeId_category_isActive_idx" ON "KnowledgeBase"("storeId", "category", "isActive");
CREATE INDEX "KnowledgeBase_storeId_updatedAt_idx" ON "KnowledgeBase"("storeId", "updatedAt");

CREATE UNIQUE INDEX "FAQ_storeId_question_key" ON "FAQ"("storeId", "question");
CREATE INDEX "FAQ_storeId_isActive_sortOrder_idx" ON "FAQ"("storeId", "isActive", "sortOrder");

CREATE INDEX "TalkScript_storeId_situation_isActive_idx" ON "TalkScript"("storeId", "situation", "isActive");
CREATE INDEX "TalkScript_storeId_sortOrder_idx" ON "TalkScript"("storeId", "sortOrder");

ALTER TABLE "CourseOption" ADD CONSTRAINT "CourseOption_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseOption" ADD CONSTRAINT "CourseOption_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TherapistCourse" ADD CONSTRAINT "TherapistCourse_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TherapistCourse" ADD CONSTRAINT "TherapistCourse_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TherapistCourse" ADD CONSTRAINT "TherapistCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationChangeHistory" ADD CONSTRAINT "ReservationChangeHistory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationChangeHistory" ADD CONSTRAINT "ReservationChangeHistory_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TalkScript" ADD CONSTRAINT "TalkScript_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

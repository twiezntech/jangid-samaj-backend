-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('STUDENT', 'PROFESSIONAL', 'ENTREPRENEUR', 'SPORTS', 'SOCIAL', 'OTHER');

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "photoUrl" TEXT,
    "achievedOn" DATE,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementTranslation" (
    "id" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "personName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "AchievementTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_slug_key" ON "Achievement"("slug");

-- CreateIndex
CREATE INDEX "Achievement_status_isFeatured_achievedOn_idx" ON "Achievement"("status", "isFeatured", "achievedOn" DESC);

-- CreateIndex
CREATE INDEX "Achievement_category_status_idx" ON "Achievement"("category", "status");

-- CreateIndex
CREATE INDEX "Achievement_stateId_status_idx" ON "Achievement"("stateId", "status");

-- CreateIndex
CREATE INDEX "Achievement_districtId_status_idx" ON "Achievement"("districtId", "status");

-- CreateIndex
CREATE INDEX "Achievement_cityId_status_idx" ON "Achievement"("cityId", "status");

-- CreateIndex
CREATE INDEX "Achievement_createdById_idx" ON "Achievement"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementTranslation_achievementId_lang_key" ON "AchievementTranslation"("achievementId", "lang");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementTranslation" ADD CONSTRAINT "AchievementTranslation_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

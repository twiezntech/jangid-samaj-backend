-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "CeremonyType" AS ENUM ('ANTIM_YATRA', 'UTHAVNA', 'SHOK_SABHA', 'PAGDI_RASM', 'OTHER');

-- CreateEnum
CREATE TYPE "TributeStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN');

-- CreateTable
CREATE TABLE "Obituary" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "gender" "Gender",
    "photoUrl" TEXT,
    "dateOfBirth" DATE,
    "dateOfDeath" DATE NOT NULL,
    "ageYears" INTEGER,
    "gotraId" TEXT,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "contactName" TEXT,
    "contactRelation" TEXT,
    "contactPhone" TEXT,
    "isContactPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obituary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObituaryTranslation" (
    "id" TEXT NOT NULL,
    "obituaryId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "name" TEXT NOT NULL,
    "relationLine" TEXT,
    "nativePlace" TEXT,
    "biography" TEXT,
    "familyMessage" TEXT,

    CONSTRAINT "ObituaryTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObituaryCeremony" (
    "id" TEXT NOT NULL,
    "obituaryId" TEXT NOT NULL,
    "type" "CeremonyType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObituaryCeremony_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObituaryTribute" (
    "id" TEXT NOT NULL,
    "obituaryId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "relation" TEXT,
    "message" TEXT NOT NULL,
    "status" "TributeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObituaryTribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Obituary_slug_key" ON "Obituary"("slug");

-- CreateIndex
CREATE INDEX "Obituary_status_dateOfDeath_idx" ON "Obituary"("status", "dateOfDeath" DESC);

-- CreateIndex
CREATE INDEX "Obituary_stateId_status_idx" ON "Obituary"("stateId", "status");

-- CreateIndex
CREATE INDEX "Obituary_districtId_status_idx" ON "Obituary"("districtId", "status");

-- CreateIndex
CREATE INDEX "Obituary_cityId_status_idx" ON "Obituary"("cityId", "status");

-- CreateIndex
CREATE INDEX "Obituary_createdById_idx" ON "Obituary"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ObituaryTranslation_obituaryId_lang_key" ON "ObituaryTranslation"("obituaryId", "lang");

-- CreateIndex
CREATE INDEX "ObituaryCeremony_obituaryId_startsAt_idx" ON "ObituaryCeremony"("obituaryId", "startsAt");

-- CreateIndex
CREATE INDEX "ObituaryCeremony_startsAt_idx" ON "ObituaryCeremony"("startsAt");

-- CreateIndex
CREATE INDEX "ObituaryTribute_obituaryId_status_createdAt_idx" ON "ObituaryTribute"("obituaryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ObituaryTribute_status_createdAt_idx" ON "ObituaryTribute"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ObituaryTribute_obituaryId_userId_key" ON "ObituaryTribute"("obituaryId", "userId");

-- AddForeignKey
ALTER TABLE "Obituary" ADD CONSTRAINT "Obituary_gotraId_fkey" FOREIGN KEY ("gotraId") REFERENCES "Gotra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obituary" ADD CONSTRAINT "Obituary_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obituary" ADD CONSTRAINT "Obituary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObituaryTranslation" ADD CONSTRAINT "ObituaryTranslation_obituaryId_fkey" FOREIGN KEY ("obituaryId") REFERENCES "Obituary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObituaryCeremony" ADD CONSTRAINT "ObituaryCeremony_obituaryId_fkey" FOREIGN KEY ("obituaryId") REFERENCES "Obituary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObituaryTribute" ADD CONSTRAINT "ObituaryTribute_obituaryId_fkey" FOREIGN KEY ("obituaryId") REFERENCES "Obituary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObituaryTribute" ADD CONSTRAINT "ObituaryTribute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

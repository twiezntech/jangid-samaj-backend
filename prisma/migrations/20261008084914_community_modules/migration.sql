-- CreateEnum
CREATE TYPE "SavedType" AS ENUM ('NEWS', 'BUSINESS', 'EVENT', 'DIRECTORY', 'LEADER', 'ACHIEVEMENT', 'OBITUARY');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE', 'BUSINESS_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "GalleryItemKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVED', 'REJECTED', 'TRIBUTE', 'JOB_APPLICATION', 'INTEREST', 'INTEREST_ACCEPTED', 'ANNOUNCEMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('NEWS', 'BUSINESS', 'EVENT', 'DIRECTORY', 'LEADER', 'ACHIEVEMENT', 'OBITUARY', 'TRIBUTE', 'JOB', 'ALBUM', 'MATRIMONY');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'FAKE', 'OFFENSIVE', 'WRONG_INFO', 'PRIVACY', 'OTHER');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('NEVER_MARRIED', 'DIVORCED', 'WIDOWED', 'AWAITING_DIVORCE');

-- CreateEnum
CREATE TYPE "ProfileFor" AS ENUM ('SELF', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'RELATIVE');

-- CreateEnum
CREATE TYPE "Manglik" AS ENUM ('NO', 'YES', 'ANSHIK', 'DONT_KNOW');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SCHOOL', 'DIPLOMA', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "IncomeRange" AS ENUM ('UNDER_3L', 'L3_TO_6L', 'L6_TO_10L', 'L10_TO_20L', 'ABOVE_20L', 'NOT_SPECIFIED');

-- CreateEnum
CREATE TYPE "PhotoVisibility" AS ENUM ('MEMBERS', 'ON_ACCEPT');

-- CreateEnum
CREATE TYPE "InterestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('HOME_TOP', 'HOME_FEED', 'SIDEBAR', 'ARTICLE_INLINE', 'LIST_TOP');

-- AlterTable
ALTER TABLE "News" ADD COLUMN     "isSponsored" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SavedType" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "type" "JobType" NOT NULL,
    "workMode" "WorkMode" NOT NULL DEFAULT 'ONSITE',
    "organisationName" TEXT NOT NULL,
    "businessId" TEXT,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "experienceYears" INTEGER,
    "vacancies" INTEGER,
    "lastDate" DATE,
    "applyUrl" TEXT,
    "applyEmail" TEXT,
    "applyPhone" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTranslation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,

    CONSTRAINT "JobTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "status" "InboxStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "coverUrl" TEXT,
    "takenOn" DATE,
    "eventId" TEXT,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumTranslation" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "AlbumTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "kind" "GalleryItemKind" NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GalleryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "titleHi" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "bodyHi" TEXT,
    "bodyEn" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "titleHi" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "bodyHi" TEXT,
    "bodyEn" TEXT,
    "link" TEXT,
    "locationId" TEXT,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "reporterId" TEXT,
    "status" "InboxStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrimonyProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "profileFor" "ProfileFor" NOT NULL DEFAULT 'SELF',
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "heightCm" INTEGER,
    "maritalStatus" "MaritalStatus" NOT NULL DEFAULT 'NEVER_MARRIED',
    "manglik" "Manglik" NOT NULL DEFAULT 'DONT_KNOW',
    "gotraId" TEXT,
    "motherGotraId" TEXT,
    "educationLevel" "EducationLevel",
    "education" TEXT,
    "profession" TEXT,
    "income" "IncomeRange" NOT NULL DEFAULT 'NOT_SPECIFIED',
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "nativePlace" TEXT,
    "fatherName" TEXT,
    "fatherOccupation" TEXT,
    "motherName" TEXT,
    "siblings" TEXT,
    "about" TEXT,
    "prefAgeMin" INTEGER,
    "prefAgeMax" INTEGER,
    "prefNotes" TEXT,
    "photos" TEXT[],
    "photoVisibility" "PhotoVisibility" NOT NULL DEFAULT 'MEMBERS',
    "contactPhone" TEXT NOT NULL,
    "contactWhatsapp" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrimonyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrimonyInterest" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "status" "InterestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrimonyInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrimonyShortlist" (
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrimonyShortlist_pkey" PRIMARY KEY ("ownerId","targetId")
);

-- CreateTable
CREATE TABLE "MatrimonyBlock" (
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrimonyBlock_pkey" PRIMARY KEY ("ownerId","targetId")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "advertiser" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPageView" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPageView_pkey" PRIMARY KEY ("day","path")
);

-- CreateTable
CREATE TABLE "DailySearch" (
    "day" DATE NOT NULL,
    "term" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailySearch_pkey" PRIMARY KEY ("day","term")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "SavedItem_userId_createdAt_idx" ON "SavedItem"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SavedItem_userId_type_slug_key" ON "SavedItem"("userId", "type", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Job_slug_key" ON "Job"("slug");

-- CreateIndex
CREATE INDEX "Job_status_isFeatured_createdAt_idx" ON "Job"("status", "isFeatured", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "Job_stateId_status_idx" ON "Job"("stateId", "status");

-- CreateIndex
CREATE INDEX "Job_districtId_status_idx" ON "Job"("districtId", "status");

-- CreateIndex
CREATE INDEX "Job_cityId_status_idx" ON "Job"("cityId", "status");

-- CreateIndex
CREATE INDEX "Job_createdById_idx" ON "Job"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "JobTranslation_jobId_lang_key" ON "JobTranslation"("jobId", "lang");

-- CreateIndex
CREATE INDEX "JobApplication_jobId_createdAt_idx" ON "JobApplication"("jobId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobId_userId_key" ON "JobApplication"("jobId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_slug_key" ON "Album"("slug");

-- CreateIndex
CREATE INDEX "Album_status_isFeatured_takenOn_idx" ON "Album"("status", "isFeatured", "takenOn" DESC);

-- CreateIndex
CREATE INDEX "Album_eventId_idx" ON "Album"("eventId");

-- CreateIndex
CREATE INDEX "Album_stateId_status_idx" ON "Album"("stateId", "status");

-- CreateIndex
CREATE INDEX "Album_districtId_status_idx" ON "Album"("districtId", "status");

-- CreateIndex
CREATE INDEX "Album_cityId_status_idx" ON "Album"("cityId", "status");

-- CreateIndex
CREATE INDEX "Album_createdById_idx" ON "Album"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumTranslation_albumId_lang_key" ON "AlbumTranslation"("albumId", "lang");

-- CreateIndex
CREATE INDEX "GalleryItem_albumId_sortOrder_idx" ON "GalleryItem"("albumId", "sortOrder");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "MatrimonyProfile_code_key" ON "MatrimonyProfile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MatrimonyProfile_userId_key" ON "MatrimonyProfile"("userId");

-- CreateIndex
CREATE INDEX "MatrimonyProfile_status_isHidden_gender_dateOfBirth_idx" ON "MatrimonyProfile"("status", "isHidden", "gender", "dateOfBirth");

-- CreateIndex
CREATE INDEX "MatrimonyProfile_stateId_status_idx" ON "MatrimonyProfile"("stateId", "status");

-- CreateIndex
CREATE INDEX "MatrimonyProfile_districtId_status_idx" ON "MatrimonyProfile"("districtId", "status");

-- CreateIndex
CREATE INDEX "MatrimonyProfile_gotraId_idx" ON "MatrimonyProfile"("gotraId");

-- CreateIndex
CREATE INDEX "MatrimonyInterest_toId_status_idx" ON "MatrimonyInterest"("toId", "status");

-- CreateIndex
CREATE INDEX "MatrimonyInterest_fromId_status_idx" ON "MatrimonyInterest"("fromId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MatrimonyInterest_fromId_toId_key" ON "MatrimonyInterest"("fromId", "toId");

-- CreateIndex
CREATE INDEX "Ad_placement_isActive_startsAt_endsAt_idx" ON "Ad"("placement", "isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "DailyPageView_day_section_idx" ON "DailyPageView"("day", "section");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTranslation" ADD CONSTRAINT "JobTranslation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumTranslation" ADD CONSTRAINT "AlbumTranslation_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyProfile" ADD CONSTRAINT "MatrimonyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyProfile" ADD CONSTRAINT "MatrimonyProfile_gotraId_fkey" FOREIGN KEY ("gotraId") REFERENCES "Gotra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyProfile" ADD CONSTRAINT "MatrimonyProfile_motherGotraId_fkey" FOREIGN KEY ("motherGotraId") REFERENCES "Gotra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyProfile" ADD CONSTRAINT "MatrimonyProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyInterest" ADD CONSTRAINT "MatrimonyInterest_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyInterest" ADD CONSTRAINT "MatrimonyInterest_toId_fkey" FOREIGN KEY ("toId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyShortlist" ADD CONSTRAINT "MatrimonyShortlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyShortlist" ADD CONSTRAINT "MatrimonyShortlist_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyBlock" ADD CONSTRAINT "MatrimonyBlock_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrimonyBlock" ADD CONSTRAINT "MatrimonyBlock_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MatrimonyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DirectoryType" AS ENUM ('ORGANIZATION', 'COMMITTEE', 'SAMAJ_BHAWAN', 'CONTACT');

-- CreateEnum
CREATE TYPE "LeaderCategory" AS ENUM ('SARPANCH', 'ELECTED_REPRESENTATIVE', 'SOCIAL_WORKER', 'PRESIDENT', 'COMMITTEE_MEMBER', 'OTHER');

-- CreateEnum
CREATE TYPE "Lang" AS ENUM ('hi', 'en');

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_parentId_fkey";

-- DropForeignKey
ALTER TABLE "NewsCategory" DROP CONSTRAINT "NewsCategory_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "NewsCategory" DROP CONSTRAINT "NewsCategory_newsId_fkey";

-- DropIndex
DROP INDEX "Location_level_idx";

-- DropIndex
DROP INDEX "Location_parentId_idx";

-- DropIndex
DROP INDEX "Location_slug_key";

-- DropIndex
DROP INDEX "News_locationId_idx";

-- DropIndex
DROP INDEX "News_publishedAt_idx";

-- DropIndex
DROP INDEX "News_status_idx";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "name",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "nameHi" TEXT NOT NULL,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "name",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "nameHi" TEXT NOT NULL,
ADD COLUMN     "path" TEXT NOT NULL,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "News" DROP COLUMN "body",
DROP COLUMN "excerpt",
DROP COLUMN "metaDescription",
DROP COLUMN "metaTitle",
DROP COLUMN "title",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "districtId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "sourceName" TEXT,
ADD COLUMN     "stateId" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "isLocationScoped" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tag" DROP COLUMN "name",
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "nameHi" TEXT NOT NULL;

-- DropTable
DROP TABLE "NewsCategory";

-- DropEnum
DROP TYPE "NewsStatus";

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsTranslation" (
    "id" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "imageAlt" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "NewsTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "DirectoryType" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "isContactPublic" BOOLEAN NOT NULL DEFAULT true,
    "coverImageUrl" TEXT,
    "establishedYear" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryTranslation" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,

    CONSTRAINT "DirectoryTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderProfile" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "LeaderCategory" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "photoUrl" TEXT,
    "locationId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "cityId" TEXT,
    "organizationId" TEXT,
    "termStart" DATE,
    "termEnd" DATE,
    "phone" TEXT,
    "email" TEXT,
    "socials" JSONB,
    "isContactPublic" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderTranslation" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "lang" "Lang" NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "bio" TEXT,

    CONSTRAINT "LeaderTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsTranslation_newsId_lang_key" ON "NewsTranslation"("newsId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryEntry_slug_key" ON "DirectoryEntry"("slug");

-- CreateIndex
CREATE INDEX "DirectoryEntry_status_type_sortOrder_idx" ON "DirectoryEntry"("status", "type", "sortOrder");

-- CreateIndex
CREATE INDEX "DirectoryEntry_stateId_status_type_idx" ON "DirectoryEntry"("stateId", "status", "type");

-- CreateIndex
CREATE INDEX "DirectoryEntry_districtId_status_type_idx" ON "DirectoryEntry"("districtId", "status", "type");

-- CreateIndex
CREATE INDEX "DirectoryEntry_cityId_status_type_idx" ON "DirectoryEntry"("cityId", "status", "type");

-- CreateIndex
CREATE INDEX "DirectoryEntry_submittedById_idx" ON "DirectoryEntry"("submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryTranslation_entryId_lang_key" ON "DirectoryTranslation"("entryId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderProfile_slug_key" ON "LeaderProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderProfile_userId_key" ON "LeaderProfile"("userId");

-- CreateIndex
CREATE INDEX "LeaderProfile_status_category_sortOrder_idx" ON "LeaderProfile"("status", "category", "sortOrder");

-- CreateIndex
CREATE INDEX "LeaderProfile_stateId_status_category_idx" ON "LeaderProfile"("stateId", "status", "category");

-- CreateIndex
CREATE INDEX "LeaderProfile_districtId_status_category_idx" ON "LeaderProfile"("districtId", "status", "category");

-- CreateIndex
CREATE INDEX "LeaderProfile_cityId_status_category_idx" ON "LeaderProfile"("cityId", "status", "category");

-- CreateIndex
CREATE INDEX "LeaderProfile_organizationId_idx" ON "LeaderProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderTranslation_leaderId_lang_key" ON "LeaderTranslation"("leaderId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "Location_path_key" ON "Location"("path");

-- CreateIndex
CREATE INDEX "Location_parentId_isActive_idx" ON "Location"("parentId", "isActive");

-- CreateIndex
CREATE INDEX "Location_level_isActive_idx" ON "Location"("level", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Location_parentId_slug_key" ON "Location"("parentId", "slug");

-- CreateIndex
CREATE INDEX "News_status_publishedAt_idx" ON "News"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_stateId_status_publishedAt_idx" ON "News"("stateId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_districtId_status_publishedAt_idx" ON "News"("districtId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_cityId_status_publishedAt_idx" ON "News"("cityId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_categoryId_status_publishedAt_idx" ON "News"("categoryId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_authorId_updatedAt_idx" ON "News"("authorId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "News_status_scheduledAt_idx" ON "News"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "NewsTag_tagId_idx" ON "NewsTag"("tagId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsTranslation" ADD CONSTRAINT "NewsTranslation_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEntry" ADD CONSTRAINT "DirectoryEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEntry" ADD CONSTRAINT "DirectoryEntry_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryTranslation" ADD CONSTRAINT "DirectoryTranslation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DirectoryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderProfile" ADD CONSTRAINT "LeaderProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderProfile" ADD CONSTRAINT "LeaderProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "DirectoryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderProfile" ADD CONSTRAINT "LeaderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderProfile" ADD CONSTRAINT "LeaderProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderTranslation" ADD CONSTRAINT "LeaderTranslation_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "LeaderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Fuzzy / substring search on titles and names (ILIKE '%q%' becomes index-assisted)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "NewsTranslation_title_trgm_idx" ON "NewsTranslation" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "DirectoryTranslation_name_trgm_idx" ON "DirectoryTranslation" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "LeaderTranslation_name_trgm_idx" ON "LeaderTranslation" USING GIN ("name" gin_trgm_ops);

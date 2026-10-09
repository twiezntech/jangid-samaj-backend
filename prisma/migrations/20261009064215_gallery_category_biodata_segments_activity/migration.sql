-- CreateEnum
CREATE TYPE "AlbumCategory" AS ENUM ('EVENT', 'SUCCESS_STORY', 'INTERVIEW', 'REEL', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "AnnouncementSegment" AS ENUM ('EVERYONE', 'BUSINESS_OWNERS', 'MATRIMONY_MEMBERS', 'EVENT_ATTENDEES');

-- AlterTable
ALTER TABLE "Album" ADD COLUMN     "category" "AlbumCategory" NOT NULL DEFAULT 'EVENT';

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "segment" "AnnouncementSegment" NOT NULL DEFAULT 'EVERYONE';

-- AlterTable
ALTER TABLE "MatrimonyProfile" ADD COLUMN     "biodataUrl" TEXT;

-- CreateTable
CREATE TABLE "UserActivityDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "UserActivityDay_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "UserActivityDay_day_idx" ON "UserActivityDay"("day");

-- CreateIndex
CREATE INDEX "Album_category_status_idx" ON "Album"("category", "status");

-- AddForeignKey
ALTER TABLE "UserActivityDay" ADD CONSTRAINT "UserActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

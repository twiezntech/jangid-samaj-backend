-- CreateTable
CREATE TABLE "Rishi" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rishi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gotra" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT,
    "nameKey" TEXT NOT NULL,
    "rishiId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gotra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rishi_slug_key" ON "Rishi"("slug");

-- CreateIndex
CREATE INDEX "Rishi_isActive_sortOrder_idx" ON "Rishi"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Gotra_nameKey_key" ON "Gotra"("nameKey");

-- CreateIndex
CREATE INDEX "Gotra_isActive_nameEn_idx" ON "Gotra"("isActive", "nameEn");

-- CreateIndex
CREATE INDEX "Gotra_rishiId_isActive_idx" ON "Gotra"("rishiId", "isActive");

-- AddForeignKey
ALTER TABLE "Gotra" ADD CONSTRAINT "Gotra_rishiId_fkey" FOREIGN KEY ("rishiId") REFERENCES "Rishi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

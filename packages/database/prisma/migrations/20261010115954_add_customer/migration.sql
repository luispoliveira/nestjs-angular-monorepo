-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "taxIdEncrypted" TEXT,
    "taxIdHash" TEXT,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_deletedAt_createdAt_idx" ON "customer"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_taxIdHash_key" ON "customer"("taxIdHash") WHERE ("deletedAt" IS NULL);

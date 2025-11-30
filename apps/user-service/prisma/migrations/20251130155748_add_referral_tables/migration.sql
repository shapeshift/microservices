-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "referral_usages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referralCode" TEXT NOT NULL,
    "refereeAddress" TEXT NOT NULL,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "referral_usages_referralCode_fkey" FOREIGN KEY ("referralCode") REFERENCES "referral_codes" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE INDEX "referral_codes_ownerAddress_idx" ON "referral_codes"("ownerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "referral_usages_refereeAddress_key" ON "referral_usages"("refereeAddress");

-- CreateIndex
CREATE INDEX "referral_usages_referralCode_idx" ON "referral_usages"("referralCode");

-- CreateIndex
CREATE INDEX "referral_usages_refereeAddress_idx" ON "referral_usages"("refereeAddress");

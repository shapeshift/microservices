-- CreateExtension
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateTable
CREATE TABLE "public"."swaps" (
    "swapId" TEXT NOT NULL,
    "sellAsset" JSONB NOT NULL,
    "buyAsset" JSONB NOT NULL,
    "sellAmountCryptoBaseUnit" TEXT NOT NULL,
    "expectedBuyAmountCryptoBaseUnit" TEXT NOT NULL,
    "actualBuyAmountCryptoBaseUnit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "swapperName" TEXT NOT NULL,
    "sellAccountId" TEXT NOT NULL,
    "buyAccountId" TEXT,
    "receiveAddress" TEXT,
    "sellTxHash" TEXT,
    "buyTxHash" TEXT,
    "txLink" TEXT,
    "statusMessage" TEXT,
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "referralCode" TEXT,
    "sellAssetUsd" TEXT,
    "buyAssetUsd" TEXT,
    "affiliateAssetUsd" TEXT,
    "isAffiliateVerified" BOOLEAN,
    "affiliateVerificationDetails" JSONB,
    "affiliateAddress" CITEXT,
    "affiliateBps" INTEGER,
    "origin" TEXT,
    "affiliateFeeAssetId" TEXT,
    "actualAffiliateFeeAmountCryptoBaseUnit" TEXT,
    "shapeshiftBps" INTEGER NOT NULL,

    CONSTRAINT "swaps_pkey" PRIMARY KEY ("swapId")
);

-- CreateTable
CREATE TABLE "public"."affiliates" (
    "id" TEXT NOT NULL,
    "wallet_address" CITEXT NOT NULL,
    "receive_address" CITEXT,
    "partner_code" CITEXT,
    "bps" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swaps_referralCode_idx" ON "public"."swaps"("referralCode");

-- CreateIndex
CREATE INDEX "swaps_affiliateAddress_idx" ON "public"."swaps"("affiliateAddress");

-- CreateIndex
CREATE INDEX "swaps_status_sellTxHash_idx" ON "public"."swaps"("status", "sellTxHash");

-- CreateIndex
CREATE INDEX "swaps_userId_idx" ON "public"."swaps"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_wallet_address_key" ON "public"."affiliates"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_partner_code_key" ON "public"."affiliates"("partner_code");

-- CreateIndex
CREATE INDEX "affiliates_partner_code_idx" ON "public"."affiliates"("partner_code");

-- CreateIndex
CREATE INDEX "affiliates_is_active_idx" ON "public"."affiliates"("is_active");

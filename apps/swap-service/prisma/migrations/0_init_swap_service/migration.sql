-- CreateTable
CREATE TABLE "public"."swaps" (
    "id" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "sellAsset" JSONB NOT NULL,
    "buyAsset" JSONB NOT NULL,
    "sellAmountCryptoBaseUnit" TEXT NOT NULL,
    "expectedBuyAmountCryptoBaseUnit" TEXT NOT NULL,
    "sellAmountCryptoPrecision" TEXT NOT NULL,
    "expectedBuyAmountCryptoPrecision" TEXT NOT NULL,
    "actualBuyAmountCryptoPrecision" TEXT,
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
    "estimatedCompletion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "chainflipSwapId" INTEGER,
    "relayTransactionMetadata" JSONB,
    "relayerExplorerTxLink" TEXT,
    "relayerTxHash" TEXT,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "streamingSwapMetadata" JSONB,
    "userId" TEXT NOT NULL,
    "sellAmountUsd" TEXT,
    "referralCode" TEXT,
    "isReferralEligible" BOOLEAN NOT NULL DEFAULT true,
    "isAffiliateVerified" BOOLEAN,
    "affiliateVerificationDetails" JSONB,
    "affiliateVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "swaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "swapId" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "swaps_swapId_key" ON "public"."swaps"("swapId");

-- CreateIndex
CREATE INDEX "swaps_referralCode_idx" ON "public"."swaps"("referralCode");

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "public"."swaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

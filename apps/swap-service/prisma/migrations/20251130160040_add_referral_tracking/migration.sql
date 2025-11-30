-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_swaps" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "estimatedCompletion" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    "isReferralEligible" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_swaps" ("actualBuyAmountCryptoPrecision", "buyAccountId", "buyAsset", "buyTxHash", "chainflipSwapId", "createdAt", "estimatedCompletion", "expectedBuyAmountCryptoBaseUnit", "expectedBuyAmountCryptoPrecision", "id", "isStreaming", "metadata", "receiveAddress", "relayTransactionMetadata", "relayerExplorerTxLink", "relayerTxHash", "sellAccountId", "sellAmountCryptoBaseUnit", "sellAmountCryptoPrecision", "sellAsset", "sellTxHash", "source", "status", "statusMessage", "stepIndex", "streamingSwapMetadata", "swapId", "swapperName", "txLink", "updatedAt", "userId") SELECT "actualBuyAmountCryptoPrecision", "buyAccountId", "buyAsset", "buyTxHash", "chainflipSwapId", "createdAt", "estimatedCompletion", "expectedBuyAmountCryptoBaseUnit", "expectedBuyAmountCryptoPrecision", "id", "isStreaming", "metadata", "receiveAddress", "relayTransactionMetadata", "relayerExplorerTxLink", "relayerTxHash", "sellAccountId", "sellAmountCryptoBaseUnit", "sellAmountCryptoPrecision", "sellAsset", "sellTxHash", "source", "status", "statusMessage", "stepIndex", "streamingSwapMetadata", "swapId", "swapperName", "txLink", "updatedAt", "userId" FROM "swaps";
DROP TABLE "swaps";
ALTER TABLE "new_swaps" RENAME TO "swaps";
CREATE UNIQUE INDEX "swaps_swapId_key" ON "swaps"("swapId");
CREATE INDEX "swaps_referralCode_idx" ON "swaps"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

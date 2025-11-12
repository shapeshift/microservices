-- CreateTable
CREATE TABLE "swaps" (
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
    "userId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "swapId" TEXT,
    CONSTRAINT "notifications_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "swaps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "swaps_swapId_key" ON "swaps"("swapId");


-- CreateTable
CREATE TABLE "public"."affiliates" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "receive_address" TEXT,
    "partner_code" TEXT,
    "bps" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_wallet_address_key" ON "public"."affiliates"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_partner_code_key" ON "public"."affiliates"("partner_code");

-- CreateIndex
CREATE INDEX "affiliates_partner_code_idx" ON "public"."affiliates"("partner_code");

-- CreateIndex
CREATE INDEX "affiliates_is_active_idx" ON "public"."affiliates"("is_active");

-- CreateIndex
CREATE INDEX "swaps_status_sellTxHash_idx" ON "public"."swaps"("status", "sellTxHash");

-- CreateIndex
CREATE INDEX "swaps_userId_idx" ON "public"."swaps"("userId");

-- Additional wallets that may manage a partner's affiliate config. The registering wallet
-- stays on affiliates.wallet_address as the owner and is never a row here.
CREATE TABLE "affiliate_members" (
  "id" TEXT PRIMARY KEY,
  "affiliate_id" TEXT NOT NULL,
  "wallet_address" CITEXT NOT NULL UNIQUE,
  "added_by" CITEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_members_affiliate_id_fkey"
    FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "affiliate_members_affiliate_id_idx" ON "affiliate_members"("affiliate_id");

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- AlterTable
ALTER TABLE "public"."affiliates" ALTER COLUMN "wallet_address" SET DATA TYPE CITEXT,
ALTER COLUMN "receive_address" SET DATA TYPE CITEXT,
ALTER COLUMN "partner_code" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "public"."swaps" ALTER COLUMN "affiliateAddress" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "public"."swaps" ADD COLUMN "shapeshiftBps" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "public"."swaps" ALTER COLUMN "shapeshiftBps" DROP DEFAULT;

/*
  Warnings:

  - You are about to drop the column `pollFailCount` on the `swaps` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."swaps" DROP COLUMN "pollFailCount";

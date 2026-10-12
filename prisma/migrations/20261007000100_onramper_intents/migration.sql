-- CreateTable
CREATE TABLE "public"."onramper_intents" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "checkout" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onramper_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onramper_intents_expiresAt_idx" ON "public"."onramper_intents"("expiresAt");

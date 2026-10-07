-- CreateTable
CREATE TABLE "public"."security_rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "security_rate_limits_expiresAt_idx" ON "public"."security_rate_limits"("expiresAt");

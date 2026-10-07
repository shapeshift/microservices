-- CreateTable
CREATE TABLE "public"."device_identities" (
    "keyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_identities_pkey" PRIMARY KEY ("keyId")
);

-- CreateTable
CREATE TABLE "public"."device_challenges" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."device_sessions" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "public"."push_registrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_identities_userId_key" ON "public"."device_identities"("userId");

-- CreateIndex
CREATE INDEX "device_challenges_expiresAt_idx" ON "public"."device_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "device_sessions_userId_idx" ON "public"."device_sessions"("userId");

-- CreateIndex
CREATE INDEX "device_sessions_expiresAt_idx" ON "public"."device_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "push_registrations_expiresAt_idx" ON "public"."push_registrations"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."device_identities" ADD CONSTRAINT "device_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

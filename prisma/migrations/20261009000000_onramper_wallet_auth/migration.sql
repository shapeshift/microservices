CREATE TABLE "onramper_challenges" (
  "id" TEXT PRIMARY KEY,
  "origin" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "onramper_challenges_expiresAt_idx" ON "onramper_challenges"("expiresAt");

CREATE TABLE "onramper_sessions" (
  "id" TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "origin" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "onramper_sessions_expiresAt_idx" ON "onramper_sessions"("expiresAt");

-- Unauthenticated intents must not survive the authorization migration.
DELETE FROM "onramper_intents";
ALTER TABLE "onramper_intents" ADD COLUMN "sessionId" TEXT NOT NULL;
ALTER TABLE "onramper_intents" ADD CONSTRAINT "onramper_intents_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "onramper_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "monitoring_alerts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "monitoring_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_errors" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "hourStart" TIMESTAMPTZ(3) NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastRequestId" TEXT,

    CONSTRAINT "monitoring_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitoring_alerts_openedAt_idx" ON "monitoring_alerts"("openedAt");

-- CreateIndex
CREATE INDEX "monitoring_errors_hourStart_idx" ON "monitoring_errors"("hourStart");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_errors_fingerprint_hourStart_key" ON "monitoring_errors"("fingerprint", "hourStart");

-- One open alert per problem, however many instances notice it.
CREATE UNIQUE INDEX "monitoring_alerts_one_open_key"
  ON "monitoring_alerts" ("code") WHERE "resolvedAt" IS NULL;

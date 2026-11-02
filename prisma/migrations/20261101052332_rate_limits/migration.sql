-- CreateTable
CREATE TABLE "system_rate_limits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "system_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "system_rate_limits_windowStart_idx" ON "system_rate_limits"("windowStart");

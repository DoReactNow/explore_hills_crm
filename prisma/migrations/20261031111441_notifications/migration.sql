-- CreateTable
CREATE TABLE "notifications_notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "groupCount" INTEGER NOT NULL DEFAULT 1,
    "dedupeKeys" TEXT[],
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications_preferences" (
    "userId" UUID NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "notifications_push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_notifications_userId_createdAt_idx" ON "notifications_notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_notifications_userId_readAt_idx" ON "notifications_notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_push_subscriptions_endpoint_key" ON "notifications_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "notifications_push_subscriptions_userId_idx" ON "notifications_push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "notifications_notifications" ADD CONSTRAINT "notifications_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications_preferences" ADD CONSTRAINT "notifications_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications_push_subscriptions" ADD CONSTRAINT "notifications_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

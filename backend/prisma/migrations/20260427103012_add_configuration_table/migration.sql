-- CreateEnum
CREATE TYPE "ConfigurationType" AS ENUM ('CHANNEL', 'AI', 'PRICING', 'SYSTEM');

-- CreateTable
CREATE TABLE "configurations" (
    "id" TEXT NOT NULL,
    "type" "ConfigurationType" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configurations_key_key" ON "configurations"("key");

-- CreateIndex
CREATE INDEX "configurations_type_idx" ON "configurations"("type");

-- CreateIndex
CREATE INDEX "configurations_key_idx" ON "configurations"("key");

-- CreateIndex
CREATE INDEX "configurations_isActive_idx" ON "configurations"("isActive");

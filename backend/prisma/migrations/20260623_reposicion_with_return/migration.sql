-- Marcos 2026-06-23: REPOSICION suma el campo "qué producto y por
-- cuánto" + toggle CON/SIN devolución + cierre por perdido
-- (mensajería no lo trajo). DEVOLUCION sigue funcionando igual pero
-- ahora comparte el ciclo returnState para uniformidad.

CREATE TYPE "ReturnState" AS ENUM ('NONE', 'PENDING', 'RETURNED', 'LOST');

ALTER TABLE "orders"
  ADD COLUMN "returnState"        "ReturnState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "productValue"       DOUBLE PRECISION,
  ADD COLUMN "productLabel"       TEXT,
  ADD COLUMN "returnCarrier"      TEXT,
  ADD COLUMN "returnShippingCost" DOUBLE PRECISION,
  ADD COLUMN "lostAt"             TIMESTAMP(3),
  ADD COLUMN "lostById"           TEXT,
  ADD CONSTRAINT "orders_lostById_fkey"
    FOREIGN KEY ("lostById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_returnState_idx" ON "orders"("returnState");
CREATE INDEX "orders_lostAt_idx"      ON "orders"("lostAt");

-- Backfill: las DEVOLUCION existentes ya tienen el ciclo de retorno.
-- Las que aún no volvieron (returnedAt IS NULL) → PENDING. Las que
-- volvieron → RETURNED. REPOSICION históricas se quedan en NONE
-- (no se tracking-eaba el retorno antes).
UPDATE "orders" SET "returnState" = 'PENDING'
  WHERE "orderType" = 'DEVOLUCION' AND "returnedAt" IS NULL;
UPDATE "orders" SET "returnState" = 'RETURNED'
  WHERE "orderType" = 'DEVOLUCION' AND "returnedAt" IS NOT NULL;

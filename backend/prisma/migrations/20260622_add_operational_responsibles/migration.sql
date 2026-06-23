-- Marcos 2026-06-22: catálogo de responsables operativos (personal de
-- depósito) que puede ser marcado como "responsable del paquete mal
-- despachado" al cargar un REPOSICIÓN. Editable desde Settings → Logística.

CREATE TABLE "operational_responsibles" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL UNIQUE,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "operational_responsibles_active_idx" ON "operational_responsibles"("active");

ALTER TABLE "orders"
  ADD COLUMN "responsibleId" TEXT,
  ADD CONSTRAINT "orders_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "operational_responsibles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_responsibleId_idx" ON "orders"("responsibleId");

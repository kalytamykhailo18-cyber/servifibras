-- Marcos 2026-06-24 (Bloque E visibility): tabla de eventos de
-- shortcuts skip-Claude. Sirve para que el widget de Uso de IA muestre
-- cuanto se ahorra mensualmente por cada optimizacion del Bloque E.
CREATE TABLE "cost_opt_events" (
  "id"                   TEXT PRIMARY KEY,
  "source"               TEXT NOT NULL,
  "intent"               TEXT,
  "conversationId"       TEXT,
  "estimatedTokensSaved" INTEGER NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "cost_opt_events_source_idx"     ON "cost_opt_events"("source");
CREATE INDEX "cost_opt_events_createdAt_idx"  ON "cost_opt_events"("createdAt");

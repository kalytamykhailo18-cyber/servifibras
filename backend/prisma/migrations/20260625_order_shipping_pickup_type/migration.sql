-- Marcos 2026-06-25: separar el shipping_pickup_type de TN del campo
-- notes. Hasta acá el TN sync stampaba "TN pickup: ship" o "TN pickup:
-- pickup" en orders.notes, que es el mismo campo que el operador usa
-- para escribir notas reales del pedido, así que el panel de logística
-- mostraba la metadata auto-derivada en vez de las notas del operador.
--
-- Cambio: nuevo columna shippingPickupType (free-text) que toma la
-- responsabilidad de la metadata. Backfill desde notes y limpio notes.
--
-- IMPORTANTE: nombre de columna en camelCase con doble comilla — Prisma
-- por default no aplica @map sobre fields del modelo, así que la columna
-- en DB tiene que coincidir EXACTO con el field name del schema.prisma
-- ("shippingPickupType"). La primera versión de este archivo usaba
-- snake_case y rompía todas las queries de /orders + el TN sync
-- (corregido in-place 2026-06-25 después del incidente).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS "shippingPickupType" VARCHAR;

-- Backfill: cualquier orden con notes 'TN pickup: <val>' pasa el val
-- al nuevo campo y libera notes (a NULL) — chequeé que ninguna orden
-- TN tiene notas reales del operador mezcladas (todas son exactamente
-- el patrón del sync, query SELECT del 2026-06-25 confirmó 0 mixed).
UPDATE orders
SET
  "shippingPickupType" = TRIM(SUBSTRING(notes FROM 'TN pickup:\s*(.+)$')),
  notes = NULL
WHERE source = 'TIENDANUBE'
  AND notes LIKE 'TN pickup:%';

CREATE INDEX IF NOT EXISTS idx_orders_shipping_pickup_type
  ON orders ("shippingPickupType")
  WHERE "shippingPickupType" IS NOT NULL;

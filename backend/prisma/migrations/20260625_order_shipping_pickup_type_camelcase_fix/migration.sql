-- Marcos 2026-06-25 (rescate): la primera versión del migration
-- 20260625_order_shipping_pickup_type creó la columna como
-- snake_case (shipping_pickup_type) pero Prisma esperaba camelCase
-- (shippingPickupType) porque el field en schema.prisma no lleva @map.
-- Cualquier query que tocaba Order entera (incluyendo /admin/orders)
-- tiraba "column orders.shippingPickupType does not exist" → 500.
-- Marcos lo cazó cuando se le cayó la pantalla de Pedidos.
--
-- Este migration es idempotente:
--   - Si la columna ya está renombrada (prod después del hotfix), no-op.
--   - Si todavía está en snake_case (entornos que corrieron la versión
--     vieja del migration sin el hotfix manual), la renombra.
--   - Si la columna nunca se creó (entornos nuevos donde el migration
--     original — ya corregido in-place — la creó como camelCase), no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'shipping_pickup_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'shippingPickupType'
  ) THEN
    EXECUTE 'ALTER TABLE orders RENAME COLUMN shipping_pickup_type TO "shippingPickupType"';
  END IF;
END $$;

-- Recreate the index against the correctly-named column (idempotent).
DROP INDEX IF EXISTS idx_orders_shipping_pickup_type;
CREATE INDEX IF NOT EXISTS idx_orders_shipping_pickup_type
  ON orders ("shippingPickupType")
  WHERE "shippingPickupType" IS NOT NULL;

-- Marcos 2026-06-23: discountPercent en Order para descuento general
-- (ej. cliente paga por transferencia, lista contempla %). Per-row
-- discounts viven en el JSON products como discountPercent (sin
-- migración).
ALTER TABLE "orders" ADD COLUMN "discountPercent" DOUBLE PRECISION;

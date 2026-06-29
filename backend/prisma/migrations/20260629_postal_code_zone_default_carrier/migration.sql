-- Marcos 2026-06-29: agrega defaultCarrier opcional a postal_code_zones
-- para que el panel Despachos por Mensajería pueda asignar
-- automáticamente el courier cuando el operador no lo seteó manualmente
-- en el armado. El analytics service ya buscaba zona vía cascada
-- (localidad/CP/heurística); ahora también busca defaultCarrier en la
-- misma fila resuelta y lo usa como fallback antes de mandar a
-- "Sin asignar".
--
-- IMPORTANTE: nombre de columna en camelCase con doble comilla — Prisma
-- por default no aplica @map sobre fields del modelo (verifié todas
-- las otras columnas de la tabla: cp/locality/zone son lowercase
-- naturalmente; localityNormalized, active, createdAt, updatedAt son
-- camelCase). Para mantener consistencia uso "defaultCarrier".

ALTER TABLE postal_code_zones
  ADD COLUMN IF NOT EXISTS "defaultCarrier" VARCHAR;

-- Index opcional — sólo necesario si terminamos buscando por carrier
-- desde el lado del analytics, pero por ahora el lookup va por
-- (cp,localityNormalized) que ya está indexado. No agrego index por
-- defaultCarrier para no inflar la tabla.

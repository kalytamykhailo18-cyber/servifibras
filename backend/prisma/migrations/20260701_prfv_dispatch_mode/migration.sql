-- Marcos 2026-06-30: PRFV placas sub-mode per row.
-- "Laminados PRFV: segmento completo con opción: Retira caseros / Envio"
-- Nullable so existing rows stay undecided until operator picks.
-- VARCHAR to keep the migration simple (enum via app-side validation:
-- valid values 'RETIRA_CASEROS' | 'ENVIO').
-- Column name double-quoted camelCase to match the Prisma field
-- name (no @map, per project convention — the schema reference trap
-- from prisma-column-naming-trap memory).
ALTER TABLE prfv_placas
  ADD COLUMN IF NOT EXISTS "dispatchMode" VARCHAR;

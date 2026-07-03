-- Marcos 2026-07-03: motivo del error en REPOSICION.

DO $$ BEGIN
  CREATE TYPE "ReplacementErrorReason" AS ENUM (
    'PRODUCTO_EQUIVOCADO',
    'PRODUCTO_FALTANTE',
    'ROTO_MAL_EMBALADO',
    'DIRECCION_MAL_CARGADA',
    'OTRO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS "errorReason"     "ReplacementErrorReason",
  ADD COLUMN IF NOT EXISTS "errorReasonNote" TEXT;

-- Marcos 2026-07-03: password-change session invalidation.
--
-- Add "passwordChangedAt" to users. On JWT validate we reject any
-- token whose iat < user.passwordChangedAt, so changing a password
-- kills every session issued with the previous hash.
--
-- Backfill: existing users start with passwordChangedAt = createdAt,
-- so their currently-valid sessions (issued after creation) remain
-- valid until an actual password change happens.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP;

UPDATE users
   SET "passwordChangedAt" = "createdAt"
 WHERE "passwordChangedAt" IS NULL;

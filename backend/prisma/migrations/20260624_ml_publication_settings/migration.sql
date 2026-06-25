-- Marcos 2026-06-24: settings por publicación de ML — per-item
-- override del modo cerrado (auto / always-draft / always-send).
CREATE TABLE "ml_publication_settings" (
  "itemId"         TEXT PRIMARY KEY,
  "closedModeMode" TEXT NOT NULL DEFAULT 'auto',
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "updatedById"    TEXT
);

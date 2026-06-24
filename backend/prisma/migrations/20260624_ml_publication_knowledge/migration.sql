-- Marcos 2026-06-24: base de conocimiento por publicación de ML.
-- Q&A histórico de cada publicación + curación operativa / IA.

CREATE TABLE "ml_publication_knowledge" (
  "id"              TEXT PRIMARY KEY,
  "itemId"          TEXT NOT NULL,
  "accountKey"      TEXT NOT NULL,
  "mlQuestionId"    TEXT NOT NULL UNIQUE,
  "questionText"    TEXT NOT NULL,
  "answerText"      TEXT,
  "questionAt"      TIMESTAMP(3) NOT NULL,
  "answeredAt"      TIMESTAMP(3),
  "curationStatus"  TEXT NOT NULL DEFAULT 'pending',
  "curatedAnswer"   TEXT,
  "curatedAt"       TIMESTAMP(3),
  "curatedById"     TEXT,
  "stalenessFlag"   TEXT,
  "aiValidityScore" DOUBLE PRECISION,
  "aiNote"          TEXT,
  "ingestedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE INDEX "ml_publication_knowledge_itemId_idx"
  ON "ml_publication_knowledge"("itemId");
CREATE INDEX "ml_publication_knowledge_accountKey_idx"
  ON "ml_publication_knowledge"("accountKey");
CREATE INDEX "ml_publication_knowledge_curationStatus_idx"
  ON "ml_publication_knowledge"("curationStatus");
CREATE INDEX "ml_publication_knowledge_itemId_curationStatus_idx"
  ON "ml_publication_knowledge"("itemId", "curationStatus");

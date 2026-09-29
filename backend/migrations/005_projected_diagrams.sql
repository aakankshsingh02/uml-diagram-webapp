-- Sequence, communication and component diagrams are drawn by code from the architecture model.
ALTER TABLE diagrams ADD COLUMN projected BOOLEAN NOT NULL DEFAULT false;

-- One trace per LLM call kind: the architecture model, and (when any type is LLM-drawn) the diagrams.
ALTER TABLE generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'diagrams'
  CHECK (kind IN ('architecture', 'diagrams'));

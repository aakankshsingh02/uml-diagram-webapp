-- A message now records one generation per LLM call kind (architecture, and diagrams when the LLM drew any).
ALTER TABLE generations DROP CONSTRAINT generations_message_id_key;
ALTER TABLE generations ADD CONSTRAINT generations_message_id_kind_key UNIQUE (message_id, kind);

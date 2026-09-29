-- The architecture model each version's diagrams were drawn from; revised (not recreated) on updates.
-- NULL for versions created before architecture models existed.
ALTER TABLE messages ADD COLUMN architecture JSONB;

-- Consistency issues still present in the accepted reply (empty when the diagrams matched the model).
ALTER TABLE generations ADD COLUMN consistency_issues TEXT[] NOT NULL DEFAULT '{}';

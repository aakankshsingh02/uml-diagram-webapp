ALTER TABLE diagrams ADD COLUMN repaired BOOLEAN NOT NULL DEFAULT false;
-- Request order of diagram types; rows of one insert share created_at, so it cannot order them.
ALTER TABLE diagrams ADD COLUMN position SMALLINT NOT NULL DEFAULT 0;

-- One LLM exchange per message: the unit exported to the RL trainer as a trajectory.
CREATE TABLE generations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  messages    JSONB NOT NULL,
  attempts    INT  NOT NULL CHECK (attempts >= 1),
  latency_ms  INT  NOT NULL CHECK (latency_ms >= 0),
  exported_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generations_created_idx ON generations(created_at, id);

-- Export state moves to generations; feedback becomes one row per user per diagram.
DROP INDEX feedback_unexported_idx;
ALTER TABLE feedback DROP COLUMN exported_at;
ALTER TABLE feedback ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE feedback ADD CONSTRAINT feedback_diagram_user_key UNIQUE (diagram_id, user_id);
ALTER TABLE feedback DROP CONSTRAINT feedback_rating_check;
ALTER TABLE feedback ADD CONSTRAINT feedback_rating_check CHECK (rating IN (-1, 1));

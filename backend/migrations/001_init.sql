CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_id_idx ON conversations(user_id);

-- Each user prompt is a message; each generation run bumps the conversation version.
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  version         INT  NOT NULL,
  prompt          TEXT NOT NULL,
  diagram_types   TEXT[] NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, version)
);

CREATE TABLE diagrams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  diagram_type TEXT NOT NULL,
  engine       TEXT NOT NULL CHECK (engine IN ('mermaid', 'plantuml', 'excalidraw')),
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,
  svg          TEXT,
  render_error TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX diagrams_message_id_idx ON diagrams(message_id);

-- Feedback is stored with the exact prompt/output it refers to so it can be exported
-- as trajectories for the RL trainer (LangChain ART) later.
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id  UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN -1 AND 1),
  comment     TEXT,
  exported_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_unexported_idx ON feedback(created_at) WHERE exported_at IS NULL;

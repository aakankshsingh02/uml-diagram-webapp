-- Email/password accounts replace the anonymous per-browser external_id.
-- users.id (gen_random_uuid() = UUID v4) stays the key every other table references.
-- Pre-auth anonymous rows are kept (their generations and feedback are training data) but
-- have no credentials, so nobody can sign in as them.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users DROP COLUMN external_id;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
-- The API lowercases emails; this keeps the unique key case-insensitive.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE users ADD CONSTRAINT users_credentials_check
  CHECK ((email IS NULL) = (password_hash IS NULL));

-- Opaque bearer sessions. Only the SHA-256 of the token is stored, so a DB leak exposes no live tokens.
CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE INDEX conversations_user_updated_idx ON conversations(user_id, updated_at DESC);
DROP INDEX conversations_user_id_idx;

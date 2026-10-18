ALTER TABLE sessions ADD COLUMN skin_profile JSONB NOT NULL DEFAULT '{"type":"","concerns":[],"note":""}'::jsonb;
CREATE TABLE support_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  screenshot BYTEA CHECK (octet_length(screenshot) <= 600000),
  created BIGINT NOT NULL,
  email_state TEXT NOT NULL DEFAULT 'pending' CHECK (email_state IN ('pending','accepted','failed'))
);
CREATE INDEX support_message_created ON support_messages(created);
CREATE INDEX support_message_email ON support_messages(email, created);

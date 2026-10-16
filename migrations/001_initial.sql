CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  pregnancy INTEGER NOT NULL CHECK (pregnancy IN (0, 1)),
  glp1 INTEGER NOT NULL CHECK (glp1 IN (0, 1)),
  code_hash TEXT NOT NULL,
  expires BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created BIGINT NOT NULL
);
CREATE INDEX session_email ON sessions(email, created);

-- The saved report is also the durable free-report entitlement record.
-- The normalized email primary key enforces this across all server instances.
CREATE TABLE reports (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  report_id TEXT NOT NULL UNIQUE,
  content JSONB NOT NULL,
  completed BIGINT NOT NULL
);
CREATE TABLE photo_batches (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  revision INTEGER NOT NULL CHECK (revision > 0),
  expires BIGINT NOT NULL
);
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES photo_batches(email) ON DELETE CASCADE,
  bytes BYTEA NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (email, position)
);
CREATE INDEX photo_email ON photos(email);
CREATE TABLE photo_attempts (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  started BIGINT NOT NULL,
  total INTEGER NOT NULL CHECK (total > 0)
);
CREATE TABLE ingredient_drafts (
  email TEXT PRIMARY KEY REFERENCES photo_batches(email) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  modes JSONB NOT NULL,
  catalog_version TEXT NOT NULL,
  content JSONB NOT NULL
);

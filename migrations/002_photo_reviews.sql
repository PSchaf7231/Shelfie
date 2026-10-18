CREATE TABLE photo_reviews (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 400),
  consent_version TEXT NOT NULL CHECK (consent_version = 'photo-review-v1'),
  created BIGINT NOT NULL,
  expires BIGINT NOT NULL CHECK (expires > created)
);
CREATE INDEX photo_review_owner ON photo_reviews(email, created);
CREATE INDEX photo_review_expiry ON photo_reviews(expires);
CREATE TABLE photo_review_images (
  review_id TEXT NOT NULL REFERENCES photo_reviews(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 5),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 600000),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1600),
  PRIMARY KEY (review_id, position)
);

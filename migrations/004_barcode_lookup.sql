ALTER TABLE photo_batches ADD COLUMN ingredient_origin JSONB;
CREATE TABLE barcode_lookups (
  id UUID PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  product JSONB NOT NULL,
  expires BIGINT NOT NULL
);
CREATE INDEX barcode_lookups_expiry ON barcode_lookups(expires);
CREATE INDEX barcode_lookups_owner ON barcode_lookups(owner_hash);

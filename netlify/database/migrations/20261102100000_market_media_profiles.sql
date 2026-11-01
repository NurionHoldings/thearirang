ALTER TABLE market_stores ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE market_stores ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE market_stores ADD COLUMN image_url text NOT NULL DEFAULT '';
ALTER TABLE market_stores ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE market_products ADD COLUMN image_url text NOT NULL DEFAULT '';
ALTER TABLE market_products ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE market_media (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), actor_id text NOT NULL,
 blob_key text NOT NULL UNIQUE, mime text NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),
 created_at timestamptz NOT NULL DEFAULT now()
);

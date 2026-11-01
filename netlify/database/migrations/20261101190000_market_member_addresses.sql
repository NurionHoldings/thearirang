CREATE TABLE market_member_addresses (
 id uuid PRIMARY KEY, customer_id text NOT NULL REFERENCES market_customers(id),
 label text NOT NULL, recipient_name text NOT NULL, phone text NOT NULL,
 address_base text NOT NULL, address_detail text NOT NULL, postal_code text NOT NULL DEFAULT '',
 delivery_note text NOT NULL DEFAULT '', verified_area jsonb,
 region_id uuid REFERENCES market_regions(id), verified_at timestamptz,
 is_default boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_member_addresses_customer ON market_member_addresses(customer_id);
CREATE UNIQUE INDEX market_member_addresses_one_default ON market_member_addresses(customer_id) WHERE is_default=true;
ALTER TABLE market_customers ADD COLUMN selected_address_id uuid REFERENCES market_member_addresses(id) ON DELETE SET NULL;

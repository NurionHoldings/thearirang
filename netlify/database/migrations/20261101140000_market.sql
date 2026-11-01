CREATE TABLE market_capacity (id integer PRIMARY KEY CHECK(id=1), vendor_count integer NOT NULL DEFAULT 0 CHECK(vendor_count BETWEEN 0 AND 100));
INSERT INTO market_capacity(id,vendor_count) VALUES(1,0);
CREATE TABLE market_regions (
 id uuid PRIMARY KEY, name text NOT NULL, province text NOT NULL, city text NOT NULL,
 district text NOT NULL DEFAULT '', dong text NOT NULL DEFAULT '', city_type text NOT NULL CHECK(city_type IN ('small','large')),
 level text NOT NULL CHECK(level IN ('city','district','dong')), aliases jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT false,
 UNIQUE(province,city,district,dong),
 CHECK((city_type='small' AND level='city' AND district='' AND dong='') OR (city_type='large' AND level IN ('district','dong') AND district<>'' AND (level<>'dong' OR dong<>'')))
);
CREATE TABLE market_stores (
 id uuid PRIMARY KEY, name text NOT NULL, region_id uuid NOT NULL REFERENCES market_regions(id), service_regions jsonb NOT NULL,
 address text NOT NULL, status text NOT NULL CHECK(status IN ('pending','active','suspended','rejected')), open boolean NOT NULL DEFAULT false,
 delivery_fee integer NOT NULL CHECK(delivery_fee BETWEEN 0 AND 1000000), minimum_order integer NOT NULL CHECK(minimum_order BETWEEN 0 AND 100000000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_accounts (
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL CHECK(role IN ('merchant','rider')),
 password_hash text NOT NULL, salt text NOT NULL, store_id uuid REFERENCES market_stores(id), region_ids jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT true, on_duty boolean NOT NULL DEFAULT false,
 CHECK((role='merchant' AND store_id IS NOT NULL) OR (role='rider' AND store_id IS NULL))
);
CREATE TABLE market_customers (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE market_sessions (token_hash text PRIMARY KEY, actor_id text NOT NULL, role text NOT NULL CHECK(role IN ('customer','merchant','rider','operator')), expires_at timestamptz NOT NULL);
CREATE INDEX market_sessions_expiry ON market_sessions(expires_at);
CREATE TABLE market_products (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), title text NOT NULL, category text NOT NULL,
 unit text NOT NULL, price integer NOT NULL CHECK(price BETWEEN 1 AND 100000000), stock integer NOT NULL CHECK(stock BETWEEN 0 AND 100000),
 active boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false, description text NOT NULL DEFAULT '', origin text NOT NULL DEFAULT '', storage text NOT NULL DEFAULT 'ambient'
);
CREATE INDEX market_products_store ON market_products(store_id);
CREATE TABLE market_address_checks (id uuid PRIMARY KEY, customer_id text NOT NULL, store_id uuid NOT NULL REFERENCES market_stores(id), region_id uuid NOT NULL REFERENCES market_regions(id), address_base text NOT NULL, verified_area jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE market_orders (
 id uuid PRIMARY KEY, customer_id text NOT NULL, store_id uuid NOT NULL REFERENCES market_stores(id), region_id uuid NOT NULL REFERENCES market_regions(id),
 rider_id uuid REFERENCES market_accounts(id), status text NOT NULL CHECK(status IN ('new','accepted','preparing','ready','picked_up','delivered','cancelled','rejected')),
 items jsonb NOT NULL, customer_name text NOT NULL, phone text NOT NULL, address_base text NOT NULL, address_detail text NOT NULL,
 subtotal numeric(15,0) NOT NULL, delivery_fee integer NOT NULL, total numeric(15,0) NOT NULL, payment_method text NOT NULL DEFAULT 'pay_on_delivery', payment_state text NOT NULL DEFAULT 'unverified',
 idempotency_key uuid NOT NULL, request_hash text NOT NULL, delivery_code text NOT NULL, delivery_attempts integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
 UNIQUE(customer_id,idempotency_key), CHECK(payment_method='pay_on_delivery'), CHECK(payment_state='unverified')
);
CREATE INDEX market_orders_customer ON market_orders(customer_id,created_at);
CREATE INDEX market_orders_store ON market_orders(store_id,status);
CREATE INDEX market_orders_rider ON market_orders(rider_id,status);
CREATE TABLE market_events (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES market_orders(id), actor_id text NOT NULL, action text NOT NULL, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE market_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);

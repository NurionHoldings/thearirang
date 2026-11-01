-- Private partner contracts and evidence-backed reconciliation; no consumer payment rail changes.
CREATE TABLE market_contracts (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), version integer NOT NULL,
 document jsonb NOT NULL, document_hash text NOT NULL, issued_by text NOT NULL,
 status text NOT NULL CHECK(status IN ('issued','signed','withdrawn')),
 issued_at timestamptz NOT NULL DEFAULT now(), signed_at timestamptz,
 signature jsonb, UNIQUE(store_id,version)
);
CREATE TABLE market_contract_reads (
 token_hash text PRIMARY KEY, contract_id uuid NOT NULL REFERENCES market_contracts(id),
 actor_id text NOT NULL, document_hash text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz
);
CREATE TABLE market_finance_events (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), contract_id uuid NOT NULL REFERENCES market_contracts(id),
 kind text NOT NULL CHECK(kind IN ('capture','refund','reversal')), parent_id uuid REFERENCES market_finance_events(id),
 external_reference text UNIQUE NOT NULL, evidence_reference text NOT NULL, occurred_at timestamptz NOT NULL,
 amount bigint NOT NULL CHECK(amount>0 AND amount<=100000000),
 actual_pg_fee bigint NOT NULL CHECK(actual_pg_fee BETWEEN -100000000 AND 100000000),
 variance_reason text NOT NULL DEFAULT '', amounts jsonb NOT NULL, actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='capture' AND parent_id IS NULL) OR (kind IN ('refund','reversal') AND parent_id IS NOT NULL))
);
CREATE TABLE market_settlements (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), cutoff timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','approved','requested','paid','void')),
 snapshot jsonb NOT NULL, snapshot_hash text NOT NULL, version integer NOT NULL DEFAULT 1,
 review jsonb, approved_by text, approved_at timestamptz,
 payout jsonb, requested_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_settlement_items (
 event_id uuid PRIMARY KEY REFERENCES market_finance_events(id), settlement_id uuid NOT NULL REFERENCES market_settlements(id)
);
CREATE TABLE market_finance_audit (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES market_stores(id), actor_id text NOT NULL,
 action text NOT NULL, resource_id uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_contracts_store ON market_contracts(store_id,version DESC);
CREATE INDEX market_finance_store_time ON market_finance_events(store_id,occurred_at);
CREATE INDEX market_settlements_store ON market_settlements(store_id,created_at DESC);
-- Signed document/evidence snapshots are append-only through both application and database.
CREATE FUNCTION market_contract_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'issued' OR NEW.document IS DISTINCT FROM OLD.document
 OR NEW.document_hash<>OLD.document_hash OR NEW.store_id<>OLD.store_id OR NEW.version<>OLD.version
 OR NEW.issued_by<>OLD.issued_by OR NEW.issued_at<>OLD.issued_at THEN
 RAISE EXCEPTION 'contract snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER market_contract_immutable BEFORE UPDATE OR DELETE ON market_contracts FOR EACH ROW EXECUTE FUNCTION market_contract_immutable();
CREATE FUNCTION market_finance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'financial evidence is append only'; END $$;
CREATE TRIGGER market_finance_event_immutable BEFORE UPDATE OR DELETE ON market_finance_events FOR EACH ROW EXECUTE FUNCTION market_finance_append_only();
CREATE TRIGGER market_finance_audit_immutable BEFORE UPDATE OR DELETE ON market_finance_audit FOR EACH ROW EXECUTE FUNCTION market_finance_append_only();
CREATE UNIQUE INDEX market_one_open_settlement ON market_settlements(store_id) WHERE status IN ('draft','approved','requested');
CREATE FUNCTION market_settlement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.store_id<>OLD.store_id OR NEW.cutoff<>OLD.cutoff
 OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash<>OLD.snapshot_hash
 OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'settlement snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER market_settlement_immutable BEFORE UPDATE OR DELETE ON market_settlements FOR EACH ROW EXECUTE FUNCTION market_settlement_immutable();
-- Corrections add a new evidence reconciliation; original financial events remain unchanged.
CREATE TABLE market_finance_reconciliations (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES market_finance_events(id), version integer NOT NULL,
 actual_pg_fee bigint NOT NULL CHECK(actual_pg_fee BETWEEN -100000000 AND 100000000),
 reason text NOT NULL, evidence_reference text NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,version)
);
CREATE TRIGGER market_finance_reconciliation_immutable BEFORE UPDATE OR DELETE ON market_finance_reconciliations FOR EACH ROW EXECUTE FUNCTION market_finance_append_only();

CREATE UNIQUE INDEX market_one_event_reversal ON market_finance_events(parent_id) WHERE kind='reversal';

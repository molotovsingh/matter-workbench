-- Shadow credit metering ledger for future monetisation.
-- This migration deliberately does not enforce credits or integrate payments.
-- It creates tenant-scoped, idempotent credit accounting primitives so provider
-- spend evidence can later be translated into product credits without reusing
-- cost_events as the commercial source of truth.

CREATE TABLE IF NOT EXISTS credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_type text NOT NULL CHECK (account_type IN ('tenant_pool', 'user_limit', 'matter_budget')),
  user_id uuid REFERENCES users(id),
  matter_id uuid REFERENCES matters(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  currency text NOT NULL DEFAULT 'MWB_CREDIT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (account_type = 'tenant_pool' AND user_id IS NULL AND matter_id IS NULL)
    OR (account_type = 'user_limit' AND user_id IS NOT NULL AND matter_id IS NULL)
    OR (account_type = 'matter_budget' AND user_id IS NULL AND matter_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_accounts_id_tenant_id_unique
  ON credit_accounts (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS credit_accounts_one_active_tenant_pool
  ON credit_accounts (tenant_id)
  WHERE account_type = 'tenant_pool' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS credit_accounts_one_active_user_limit
  ON credit_accounts (tenant_id, user_id)
  WHERE account_type = 'user_limit' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS credit_accounts_one_active_matter_budget
  ON credit_accounts (tenant_id, matter_id)
  WHERE account_type = 'matter_budget' AND status = 'active';

CREATE TABLE IF NOT EXISTS credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL REFERENCES credit_accounts(id),
  credits numeric NOT NULL CHECK (credits > 0),
  grant_type text NOT NULL CHECK (grant_type IN ('beta_seed', 'monthly_plan', 'admin_adjustment', 'promo', 'migration')),
  idempotency_key text NOT NULL,
  source_ref text,
  expires_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_grants_id_tenant_id_unique
  ON credit_grants (id, tenant_id);

CREATE INDEX IF NOT EXISTS credit_grants_account_idx
  ON credit_grants (tenant_id, account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL REFERENCES credit_accounts(id),
  matter_id uuid REFERENCES matters(id),
  user_id uuid REFERENCES users(id),
  job_id uuid REFERENCES processing_jobs(id),
  provider_run_id uuid REFERENCES provider_runs(id),
  credits_reserved numeric NOT NULL CHECK (credits_reserved > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'refunded', 'expired')),
  idempotency_key text NOT NULL,
  policy_version text NOT NULL,
  sku text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_id_tenant_id_unique
  ON credit_reservations (id, tenant_id);

CREATE INDEX IF NOT EXISTS credit_reservations_account_status_idx
  ON credit_reservations (tenant_id, account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_reservations_job_idx
  ON credit_reservations (tenant_id, job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_reservations_provider_run_idx
  ON credit_reservations (tenant_id, provider_run_id)
  WHERE provider_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL REFERENCES credit_accounts(id),
  reservation_id uuid REFERENCES credit_reservations(id),
  grant_id uuid REFERENCES credit_grants(id),
  matter_id uuid REFERENCES matters(id),
  user_id uuid REFERENCES users(id),
  job_id uuid REFERENCES processing_jobs(id),
  provider_run_id uuid REFERENCES provider_runs(id),
  cost_event_id uuid REFERENCES cost_events(id),
  event_type text NOT NULL CHECK (event_type IN ('grant', 'reserve', 'debit', 'release', 'refund', 'adjustment', 'shadow_debit', 'shadow_refund')),
  credits_delta numeric NOT NULL,
  currency text NOT NULL DEFAULT 'MWB_CREDIT',
  policy_version text,
  sku text,
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_id_tenant_id_unique
  ON credit_ledger (id, tenant_id);

CREATE INDEX IF NOT EXISTS credit_ledger_account_created_idx
  ON credit_ledger (tenant_id, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_ledger_matter_created_idx
  ON credit_ledger (tenant_id, matter_id, created_at DESC)
  WHERE matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON credit_ledger (tenant_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_provider_run_idx
  ON credit_ledger (tenant_id, provider_run_id)
  WHERE provider_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_sku_created_idx
  ON credit_ledger (tenant_id, sku, created_at DESC)
  WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cost_events_id_tenant_id_unique
  ON cost_events (id, tenant_id);

ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_accounts_tenant_isolation ON credit_accounts;
CREATE POLICY credit_accounts_tenant_isolation
  ON credit_accounts
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_grants_tenant_isolation ON credit_grants;
CREATE POLICY credit_grants_tenant_isolation
  ON credit_grants
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_reservations_tenant_isolation ON credit_reservations;
CREATE POLICY credit_reservations_tenant_isolation
  ON credit_reservations
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_ledger_tenant_isolation ON credit_ledger;
CREATE POLICY credit_ledger_tenant_isolation
  ON credit_ledger
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_accounts_user_tenant_member_fk') THEN
    ALTER TABLE credit_accounts
      ADD CONSTRAINT credit_accounts_user_tenant_member_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_accounts_matter_tenant_fk') THEN
    ALTER TABLE credit_accounts
      ADD CONSTRAINT credit_accounts_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_grants_account_tenant_fk') THEN
    ALTER TABLE credit_grants
      ADD CONSTRAINT credit_grants_account_tenant_fk
      FOREIGN KEY (account_id, tenant_id) REFERENCES credit_accounts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_grants_created_by_tenant_member_fk') THEN
    ALTER TABLE credit_grants
      ADD CONSTRAINT credit_grants_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_reservations_account_tenant_fk') THEN
    ALTER TABLE credit_reservations
      ADD CONSTRAINT credit_reservations_account_tenant_fk
      FOREIGN KEY (account_id, tenant_id) REFERENCES credit_accounts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_reservations_matter_tenant_fk') THEN
    ALTER TABLE credit_reservations
      ADD CONSTRAINT credit_reservations_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_reservations_user_tenant_member_fk') THEN
    ALTER TABLE credit_reservations
      ADD CONSTRAINT credit_reservations_user_tenant_member_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_reservations_job_tenant_fk') THEN
    ALTER TABLE credit_reservations
      ADD CONSTRAINT credit_reservations_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_reservations_provider_run_tenant_fk') THEN
    ALTER TABLE credit_reservations
      ADD CONSTRAINT credit_reservations_provider_run_tenant_fk
      FOREIGN KEY (provider_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_account_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_account_tenant_fk
      FOREIGN KEY (account_id, tenant_id) REFERENCES credit_accounts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_reservation_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_reservation_tenant_fk
      FOREIGN KEY (reservation_id, tenant_id) REFERENCES credit_reservations (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_grant_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_grant_tenant_fk
      FOREIGN KEY (grant_id, tenant_id) REFERENCES credit_grants (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_matter_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_user_tenant_member_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_user_tenant_member_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_job_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_provider_run_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_provider_run_tenant_fk
      FOREIGN KEY (provider_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_cost_event_tenant_fk') THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_cost_event_tenant_fk
      FOREIGN KEY (cost_event_id, tenant_id) REFERENCES cost_events (id, tenant_id);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS credit_accounts_set_updated_at ON credit_accounts;
CREATE TRIGGER credit_accounts_set_updated_at
  BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS credit_reservations_set_updated_at ON credit_reservations;
CREATE TRIGGER credit_reservations_set_updated_at
  BEFORE UPDATE ON credit_reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

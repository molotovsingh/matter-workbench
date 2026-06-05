-- Tenant organization profile for hosted beta.
-- The original control plane already has tenants, users, tenant memberships,
-- and matter memberships. This migration makes the intended account shape
-- explicit at the tenant row itself: a personal beta tenant can remain
-- single-user, while organization/firm tenants can carry a slug, a capacity
-- signal, and an owner link without changing runtime behavior.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS account_scope text;

UPDATE tenants
SET account_scope = CASE WHEN type = 'firm' THEN 'organization' ELSE 'single_user' END
WHERE account_scope IS NULL;

ALTER TABLE tenants
  ALTER COLUMN account_scope SET DEFAULT 'single_user',
  ALTER COLUMN account_scope SET NOT NULL;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS organization_slug text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_member_count integer;

UPDATE tenants
SET max_member_count = CASE WHEN account_scope = 'organization' THEN greatest(max_member_count, 2) ELSE coalesce(max_member_count, 1) END
WHERE max_member_count IS NULL OR (account_scope = 'organization' AND max_member_count < 2);

ALTER TABLE tenants
  ALTER COLUMN max_member_count SET DEFAULT 1,
  ALTER COLUMN max_member_count SET NOT NULL;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS primary_owner_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_organization_slug_unique
  ON tenants (lower(organization_slug))
  WHERE organization_slug IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_account_scope_check') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_account_scope_check
      CHECK (account_scope IN ('single_user', 'organization'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_organization_slug_check') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_organization_slug_check
      CHECK (
        organization_slug IS NULL
        OR organization_slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_max_member_count_positive') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_max_member_count_positive
      CHECK (max_member_count > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_org_member_capacity_check') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_org_member_capacity_check
      CHECK (
        account_scope = 'single_user'
        OR max_member_count >= 2
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_primary_owner_user_fk') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_primary_owner_user_fk
      FOREIGN KEY (primary_owner_user_id) REFERENCES users (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_primary_owner_membership_fk') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_primary_owner_membership_fk
      FOREIGN KEY (id, primary_owner_user_id) REFERENCES tenant_memberships (tenant_id, user_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

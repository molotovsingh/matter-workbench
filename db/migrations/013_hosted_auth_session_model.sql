-- Hosted auth identity and tenant-session model.
-- This is provider-neutral on purpose: the database records the external
-- identity and the selected tenant session, but does not choose Auth0,
-- Supabase, Clerk, self-hosted auth, or any other runtime provider.

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted_pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (provider, provider_subject)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_id_user_id_unique
  ON auth_identities (id, user_id);

CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx
  ON auth_identities (user_id);

DROP TRIGGER IF EXISTS auth_identities_set_updated_at ON auth_identities;
CREATE TRIGGER auth_identities_set_updated_at
  BEFORE UPDATE ON auth_identities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS tenant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  auth_identity_id uuid REFERENCES auth_identities(id),
  session_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_hash),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id),
  FOREIGN KEY (auth_identity_id, user_id) REFERENCES auth_identities (id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_sessions_tenant_user_idx
  ON tenant_sessions (tenant_id, user_id, expires_at);

CREATE INDEX IF NOT EXISTS tenant_sessions_active_idx
  ON tenant_sessions (tenant_id, user_id, expires_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS tenant_sessions_set_updated_at ON tenant_sessions;
CREATE TRIGGER tenant_sessions_set_updated_at
  BEFORE UPDATE ON tenant_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_sessions_tenant_isolation ON tenant_sessions;
CREATE POLICY tenant_sessions_tenant_isolation
  ON tenant_sessions
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

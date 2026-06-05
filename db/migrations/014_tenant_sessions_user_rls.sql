-- Tighten hosted session visibility for already-applied shadow databases.
-- New installs get the same policy from 013; this migration keeps the local
-- shadow rehearsal in sync after 013 was applied during acceptance testing.

DROP POLICY IF EXISTS tenant_sessions_tenant_isolation ON tenant_sessions;
CREATE POLICY tenant_sessions_tenant_isolation
  ON tenant_sessions
  USING (tenant_id = current_app_tenant_id() AND user_id = current_app_user_id())
  WITH CHECK (tenant_id = current_app_tenant_id() AND user_id = current_app_user_id());

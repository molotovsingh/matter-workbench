-- User membership integrity for hosted beta.
-- Users are global identities, but tenant-scoped legal rows must not point at
-- users who are outside the tenant. Composite foreign keys to
-- tenant_memberships keep those references tenant-local while allowing nullable
-- user references for worker/system events.

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_id_tenant_id_unique ON audit_events (id, tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_memberships_user_tenant_member_fk') THEN
    ALTER TABLE matter_memberships
      ADD CONSTRAINT matter_memberships_user_tenant_member_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matters_created_by_tenant_member_fk') THEN
    ALTER TABLE matters
      ADD CONSTRAINT matters_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_intakes_created_by_tenant_member_fk') THEN
    ALTER TABLE matter_intakes
      ADD CONSTRAINT matter_intakes_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_sessions_created_by_tenant_member_fk') THEN
    ALTER TABLE upload_sessions
      ADD CONSTRAINT upload_sessions_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_confirmed_by_tenant_member_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_confirmed_by_tenant_member_fk
      FOREIGN KEY (tenant_id, confirmed_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_created_by_tenant_member_fk') THEN
    ALTER TABLE processing_jobs
      ADD CONSTRAINT processing_jobs_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attention_acknowledgements_user_tenant_member_fk') THEN
    ALTER TABLE attention_acknowledgements
      ADD CONSTRAINT attention_acknowledgements_user_tenant_member_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_actor_tenant_member_fk') THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_actor_tenant_member_fk
      FOREIGN KEY (tenant_id, actor_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_ideas_created_by_tenant_member_fk') THEN
    ALTER TABLE skill_ideas
      ADD CONSTRAINT skill_ideas_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skills_created_by_tenant_member_fk') THEN
    ALTER TABLE configurable_skills
      ADD CONSTRAINT configurable_skills_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skills_status_changed_by_tenant_member_fk') THEN
    ALTER TABLE configurable_skills
      ADD CONSTRAINT configurable_skills_status_changed_by_tenant_member_fk
      FOREIGN KEY (tenant_id, status_changed_by) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_versions_created_by_tenant_member_fk') THEN
    ALTER TABLE configurable_skill_versions
      ADD CONSTRAINT configurable_skill_versions_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_approval_event_tenant_fk') THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_approval_event_tenant_fk
      FOREIGN KEY (approval_event_id, tenant_id) REFERENCES audit_events (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_approval_event_tenant_fk') THEN
    ALTER TABLE cost_events
      ADD CONSTRAINT cost_events_approval_event_tenant_fk
      FOREIGN KEY (approval_event_id, tenant_id) REFERENCES audit_events (id, tenant_id);
  END IF;
END;
$$;

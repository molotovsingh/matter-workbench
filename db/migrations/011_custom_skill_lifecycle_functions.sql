-- Custom skill lifecycle helpers for hosted beta.
-- Native skills remain app-owned. This function only mutates rows in the
-- configurable_skills table visible to the current tenant context.

CREATE INDEX IF NOT EXISTS configurable_skills_tenant_status_idx
  ON configurable_skills (tenant_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION update_configurable_skill_lifecycle(
  p_skill_id uuid,
  p_action text,
  p_reason text DEFAULT null,
  p_actor_user_id uuid DEFAULT null
)
RETURNS TABLE (
  skill_id uuid,
  previous_status text,
  new_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  skill_row configurable_skills%ROWTYPE;
  next_status text;
BEGIN
  SELECT *
  INTO skill_row
  FROM configurable_skills cs
  WHERE cs.id = p_skill_id
    AND cs.tenant_id = current_app_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom skill not found for current tenant';
  END IF;

  IF skill_row.status = 'disabled' THEN
    RAISE EXCEPTION 'previous skill versions cannot be lifecycle-mutated';
  END IF;

  CASE p_action
    WHEN 'suspend' THEN
      IF skill_row.status = 'active' THEN
        next_status := 'suspended';
      END IF;
    WHEN 'resume' THEN
      IF skill_row.status = 'suspended' THEN
        next_status := 'active';
      END IF;
    WHEN 'archive' THEN
      IF skill_row.status IN ('active', 'suspended') THEN
        next_status := 'archived';
      END IF;
    WHEN 'restore' THEN
      IF skill_row.status = 'archived' THEN
        next_status := 'suspended';
      END IF;
    WHEN 'delete' THEN
      IF skill_row.status IN ('active', 'suspended', 'archived', 'draft') THEN
        next_status := 'deleted';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid configurable skill lifecycle action: %', p_action;
  END CASE;

  IF next_status IS NULL THEN
    RAISE EXCEPTION 'invalid configurable skill lifecycle transition: % from %', p_action, skill_row.status;
  END IF;

  IF next_status = 'active' AND EXISTS (
    SELECT 1
    FROM configurable_skills other
    WHERE other.tenant_id = current_app_tenant_id()
      AND other.id <> p_skill_id
      AND other.slash = skill_row.slash
      AND other.status = 'active'
  ) THEN
    RAISE EXCEPTION 'another active custom skill already owns this slash';
  END IF;

  UPDATE configurable_skills
  SET status = next_status,
      previous_status = skill_row.status,
      status_changed_at = now(),
      status_changed_by = p_actor_user_id,
      status_change_reason = p_reason,
      updated_at = now()
  WHERE id = p_skill_id
    AND tenant_id = current_app_tenant_id();

  skill_id := skill_row.id;
  previous_status := skill_row.status;
  new_status := next_status;
  RETURN NEXT;
END;
$$;

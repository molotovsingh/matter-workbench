-- Prevent concurrent creates from splitting one active matter name across rows.
-- Archived matters may retain a historical name; only the active namespace is
-- unique within a tenant.

DO $$
DECLARE
  duplicate_group_count integer;
BEGIN
  SELECT count(*)::integer
  INTO duplicate_group_count
  FROM (
    SELECT tenant_id, lower(name)
    FROM matters
    WHERE status = 'active'
    GROUP BY tenant_id, lower(name)
    HAVING count(*) > 1
  ) duplicate_groups;

  IF duplicate_group_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'Cannot enforce active matter-name uniqueness: %s duplicate tenant/name group(s) exist. Resolve duplicates before retrying migration 026.',
        duplicate_group_count
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS matters_active_tenant_lower_name_unique
  ON matters (tenant_id, lower(name))
  WHERE status = 'active';

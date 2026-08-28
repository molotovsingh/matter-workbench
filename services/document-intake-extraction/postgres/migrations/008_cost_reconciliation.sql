-- Reconcile unknown billed cost without permitting measured evidence to be rewritten.
alter table document_intake_extraction.provider_attempts
  add column reconciled_at timestamptz,
  add column reconciliation_reference text;

alter table document_intake_extraction.cost_events
  add column reconciled_at timestamptz,
  add column reconciliation_reference text;

create or replace function document_intake_extraction.reconcile_attempt_cost(
  target_attempt_id uuid,
  confirmed_input_units numeric,
  confirmed_output_units numeric,
  confirmed_billed_cost_usd numeric,
  confirmed_reference text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, document_intake_extraction
as $$
declare
  target_tenant text := document_intake_extraction.current_tenant_id();
  changed integer;
begin
  if target_tenant is null then
    return false;
  end if;
  if confirmed_billed_cost_usd is null or confirmed_billed_cost_usd < 0
     or (confirmed_input_units is not null and confirmed_input_units < 0)
     or (confirmed_output_units is not null and confirmed_output_units < 0)
     or nullif(btrim(confirmed_reference), '') is null
     or length(confirmed_reference) > 240 then
    return false;
  end if;

  update document_intake_extraction.provider_attempts
  set input_units = confirmed_input_units,
      output_units = confirmed_output_units,
      billed_cost_usd = confirmed_billed_cost_usd,
      cost_measurement_status = 'measured',
      reconciled_at = now(),
      reconciliation_reference = confirmed_reference
  where tenant_id = target_tenant
    and attempt_id = target_attempt_id
    and cost_measurement_status = 'unknown_requires_reconciliation';
  get diagnostics changed = row_count;

  if changed = 1 then
    update document_intake_extraction.cost_events
    set input_units = confirmed_input_units,
        output_units = confirmed_output_units,
        billed_cost_usd = confirmed_billed_cost_usd,
        measurement_status = 'measured',
        reconciled_at = now(),
        reconciliation_reference = confirmed_reference
    where tenant_id = target_tenant
      and attempt_id = target_attempt_id
      and measurement_status = 'unknown_requires_reconciliation';
    if not found then
      raise exception 'matching unknown cost event was not found';
    end if;
    return true;
  end if;

  return exists (
    select 1
    from document_intake_extraction.provider_attempts pa
    join document_intake_extraction.cost_events ce
      on ce.tenant_id = pa.tenant_id and ce.attempt_id = pa.attempt_id
    where pa.tenant_id = target_tenant
      and pa.attempt_id = target_attempt_id
      and pa.cost_measurement_status = 'measured'
      and ce.measurement_status = 'measured'
      and pa.input_units is not distinct from confirmed_input_units
      and pa.output_units is not distinct from confirmed_output_units
      and pa.billed_cost_usd is not distinct from confirmed_billed_cost_usd
      and pa.reconciliation_reference = confirmed_reference
      and ce.reconciliation_reference = confirmed_reference
  );
end
$$;

revoke all on function document_intake_extraction.reconcile_attempt_cost(uuid, numeric, numeric, numeric, text) from public;

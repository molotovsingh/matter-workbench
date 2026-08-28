-- Bounded document-local claims for page-range provider calls.
create or replace function document_intake_extraction.claim_document_local_page_work(
  worker_id text,
  maximum_pages integer default 8,
  lock_milliseconds integer default 60000
)
returns setof document_intake_extraction.page_computations
language plpgsql
as $$
begin
  perform document_intake_extraction.expire_page_leases();
  return query
  with seed as materialized (
    select pc.computation_id, pc.source_sha256, pc.page_number, pc.provider, pc.model, pc.adapter_version,
           pc.routing_policy, pc.validator_version
    from document_intake_extraction.page_computations pc
    left join lateral (
      select max(cd.priority) as demand_priority, min(cd.virtual_finish) as virtual_finish
      from document_intake_extraction.computation_demands cd
      where cd.tenant_id = pc.tenant_id
        and cd.computation_id = pc.computation_id
        and cd.fulfilled_at is null
    ) demand on true
    where pc.tenant_id = document_intake_extraction.current_tenant_id()
      and pc.status = 'queued'
      and pc.run_after <= now()
      and pc.attempt_count < pc.maximum_attempts
    order by coalesce(demand.demand_priority, pc.priority) desc,
             coalesce(demand.virtual_finish, 0),
             pc.created_at,
             pc.source_sha256,
             pc.page_number
    limit 1
    for update of pc skip locked
  ),
  lockable as materialized (
    select pc.computation_id, pc.page_number
    from document_intake_extraction.page_computations pc
    cross join seed
    where pc.tenant_id = document_intake_extraction.current_tenant_id()
      and pc.source_sha256 = seed.source_sha256
      and pc.provider = seed.provider
      and pc.model = seed.model
      and pc.adapter_version = seed.adapter_version
      and pc.routing_policy = seed.routing_policy
      and pc.validator_version = seed.validator_version
      and pc.page_number >= seed.page_number
      and pc.status = 'queued'
      and pc.run_after <= now()
      and pc.attempt_count < pc.maximum_attempts
    order by pc.page_number
    limit greatest(1, least(maximum_pages, 32))
    for update of pc skip locked
  ),
  numbered as (
    select lockable.computation_id, lockable.page_number,
           row_number() over (order by lockable.page_number) as contiguous_ordinal
    from lockable
  ),
  selected as (
    select numbered.computation_id
    from numbered
    cross join seed
    where numbered.page_number = seed.page_number + numbered.contiguous_ordinal - 1
  )
  update document_intake_extraction.page_computations pc
  set status = 'running',
      attempt_count = pc.attempt_count + 1,
      lease_token = gen_random_uuid(),
      locked_by = worker_id,
      locked_at = now(),
      last_heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(1000, lock_milliseconds)::double precision / 1000)
  from selected
  where pc.computation_id = selected.computation_id
    and pc.tenant_id = document_intake_extraction.current_tenant_id()
  returning pc.*;
end
$$;

revoke all on function document_intake_extraction.claim_document_local_page_work(text, integer, integer) from public;

-- Capability-scoped work claims.
--
-- claim_page_work and claim_document_local_page_work previously selected any
-- queued page computation for the tenant, regardless of the provider
-- capability the page was routed to. A worker holding only one provider (for
-- example a Gemini repair lane) could therefore claim pages routed to a
-- different provider and fail them destructively with
-- worker.provider_unavailable, marking pages review_required without any
-- provider attempt. Both functions now accept an allowed_capabilities JSON
-- array of {provider, model, adapter_version} objects; null preserves the
-- unrestricted behavior, an empty array claims nothing.

drop function document_intake_extraction.claim_page_work(text, integer);

create function document_intake_extraction.claim_page_work(
  worker_id text,
  lock_milliseconds integer default 60000,
  allowed_capabilities jsonb default null
)
returns setof document_intake_extraction.page_computations
language plpgsql
as $$
begin
  if allowed_capabilities is not null and jsonb_typeof(allowed_capabilities) <> 'array' then
    raise exception 'allowed_capabilities must be a JSON array of capability objects';
  end if;
  perform document_intake_extraction.expire_page_leases();
  return query
  with candidate as (
    select pc.computation_id
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
      and (
        allowed_capabilities is null
        or exists (
          select 1
          from jsonb_array_elements(allowed_capabilities) capability
          where capability->>'provider' = pc.provider
            and capability->>'model' = pc.model
            and capability->>'adapter_version' = pc.adapter_version
        )
      )
    order by coalesce(demand.demand_priority, pc.priority) desc,
             coalesce(demand.virtual_finish, 0),
             pc.created_at
    limit 1
    for update of pc skip locked
  )
  update document_intake_extraction.page_computations pc
  set status = 'running',
      attempt_count = pc.attempt_count + 1,
      lease_token = gen_random_uuid(),
      locked_by = worker_id,
      locked_at = now(),
      last_heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(1000, lock_milliseconds)::double precision / 1000)
  from candidate
  where pc.computation_id = candidate.computation_id
    and pc.tenant_id = document_intake_extraction.current_tenant_id()
  returning pc.*;
end
$$;

revoke all on function document_intake_extraction.claim_page_work(text, integer, jsonb) from public;

drop function document_intake_extraction.claim_document_local_page_work(text, integer, integer);

create function document_intake_extraction.claim_document_local_page_work(
  worker_id text,
  maximum_pages integer default 8,
  lock_milliseconds integer default 60000,
  allowed_capabilities jsonb default null
)
returns setof document_intake_extraction.page_computations
language plpgsql
as $$
begin
  if allowed_capabilities is not null and jsonb_typeof(allowed_capabilities) <> 'array' then
    raise exception 'allowed_capabilities must be a JSON array of capability objects';
  end if;
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
      and (
        allowed_capabilities is null
        or exists (
          select 1
          from jsonb_array_elements(allowed_capabilities) capability
          where capability->>'provider' = pc.provider
            and capability->>'model' = pc.model
            and capability->>'adapter_version' = pc.adapter_version
        )
      )
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

revoke all on function document_intake_extraction.claim_document_local_page_work(text, integer, integer, jsonb) from public;

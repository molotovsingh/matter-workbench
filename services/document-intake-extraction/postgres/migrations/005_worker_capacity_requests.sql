-- Durable tenant-scoped requests for predictive warm and burst worker capacity.
create table document_intake_extraction.worker_capacity_requests (
  capacity_request_id uuid primary key,
  tenant_id text not null,
  pool_id text not null,
  workload_class text not null,
  request_fingerprint char(64) not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  desired_workers integer not null check (desired_workers between 0 and 100000),
  minimum_workers integer not null check (minimum_workers between 0 and 100000),
  maximum_workers integer not null check (maximum_workers between 1 and 100000),
  generation bigint not null default 1 check (generation > 0),
  status text not null check (status in ('scheduled', 'applying', 'applied', 'failed', 'cancelled')),
  reason_json jsonb not null,
  not_before timestamptz not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  observed_workers integer check (observed_workers is null or observed_workers between 0 and 100000),
  locked_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, pool_id),
  unique (tenant_id, capacity_request_id),
  check (minimum_workers <= desired_workers and desired_workers <= maximum_workers),
  check (expires_at > not_before)
);

create index worker_capacity_requests_due_idx
  on document_intake_extraction.worker_capacity_requests
  (tenant_id, status, not_before, created_at)
  where status in ('scheduled', 'failed');

create trigger worker_capacity_requests_touch_updated_at
before update on document_intake_extraction.worker_capacity_requests
for each row execute function document_intake_extraction.touch_updated_at();

alter table document_intake_extraction.worker_capacity_requests enable row level security;
alter table document_intake_extraction.worker_capacity_requests force row level security;
create policy tenant_isolation on document_intake_extraction.worker_capacity_requests
using (tenant_id = document_intake_extraction.current_tenant_id())
with check (tenant_id = document_intake_extraction.current_tenant_id());

revoke all on document_intake_extraction.worker_capacity_requests from public;

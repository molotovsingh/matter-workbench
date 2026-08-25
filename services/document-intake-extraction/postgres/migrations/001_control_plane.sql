-- Isolated V4 control-plane schema. It is not part of the Matter Workbench runtime migration chain.
create schema if not exists document_intake_extraction;
revoke all on schema document_intake_extraction from public;

create or replace function document_intake_extraction.current_tenant_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('document_intake_extraction.tenant_id', true), '')
$$;

create or replace function document_intake_extraction.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table document_intake_extraction.source_blobs (
  sha256 char(64) primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  object_key text not null unique,
  bytes bigint not null check (bytes > 0 and bytes <= 2147483648),
  page_count integer check (page_count between 1 and 10000),
  inspector_version text,
  created_at timestamptz not null default now(),
  verified_at timestamptz not null,
  integrity_status text not null default 'verified' check (integrity_status in ('verified', 'quarantined'))
);

create table document_intake_extraction.intakes (
  intake_id uuid primary key,
  tenant_id text not null,
  matter_id text not null,
  idempotency_key text not null,
  client_request_id text,
  status text not null check (status in (
    'awaiting_upload', 'uploading_with_speculative_processing', 'processing',
    'ready', 'ready_with_review', 'failed', 'cancelled'
  )),
  expected_file_count integer not null check (expected_file_count between 1 and 500),
  expected_bytes bigint not null check (expected_bytes between 1 and 2147483648),
  committed_file_count integer not null default 0 check (committed_file_count between 0 and 500),
  committed_bytes bigint not null default 0 check (committed_bytes between 0 and 2147483648),
  observed_page_count integer not null default 0 check (observed_page_count between 0 and 10000),
  scheduler_priority integer not null default 0,
  scheduler_virtual_finish numeric(30, 10) not null default 0,
  custody_committed_at timestamptz,
  ready_at timestamptz,
  result_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, intake_id)
);

create table document_intake_extraction.intake_files (
  file_id uuid primary key,
  tenant_id text not null,
  intake_id uuid not null,
  document_id uuid not null,
  ordinal integer not null check (ordinal >= 0 and ordinal < 500),
  client_file_id text,
  original_name text not null,
  relative_path text not null,
  mime_type text not null,
  expected_bytes bigint not null check (expected_bytes between 1 and 2147483648),
  status text not null check (status in ('awaiting_upload', 'uploaded', 'committed', 'failed', 'cancelled')),
  upload_token_digest char(64) check (upload_token_digest is null or upload_token_digest ~ '^[a-f0-9]{64}$'),
  staged_object_key text,
  upload_authorization_expires_at timestamptz,
  source_sha256 char(64),
  custody_receipt_json jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, intake_id) references document_intake_extraction.intakes (tenant_id, intake_id) on delete restrict,
  foreign key (source_sha256) references document_intake_extraction.source_blobs (sha256) on delete restrict,
  unique (tenant_id, intake_id, ordinal),
  unique (tenant_id, document_id),
  unique (tenant_id, file_id)
);

create table document_intake_extraction.blob_tenant_references (
  tenant_id text not null,
  source_sha256 char(64) not null references document_intake_extraction.source_blobs (sha256) on delete restrict,
  logical_reference_count integer not null default 1 check (logical_reference_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, source_sha256)
);

create table document_intake_extraction.documents (
  document_id uuid primary key,
  tenant_id text not null,
  intake_id uuid not null,
  file_id uuid not null,
  source_sha256 char(64) not null references document_intake_extraction.source_blobs (sha256) on delete restrict,
  page_count integer not null check (page_count between 1 and 10000),
  inspector_version text not null,
  duplicate_of_document_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, intake_id) references document_intake_extraction.intakes (tenant_id, intake_id) on delete restrict,
  foreign key (tenant_id, file_id) references document_intake_extraction.intake_files (tenant_id, file_id) on delete restrict,
  foreign key (tenant_id, duplicate_of_document_id) references document_intake_extraction.documents (tenant_id, document_id) on delete restrict,
  unique (tenant_id, document_id)
);

create table document_intake_extraction.page_computations (
  computation_id uuid primary key,
  tenant_id text not null,
  fingerprint char(64) not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  source_sha256 char(64) not null references document_intake_extraction.source_blobs (sha256) on delete restrict,
  page_number integer not null check (page_number between 1 and 10000),
  provider text not null,
  model text not null check (model !~* '(^|[-_./])(latest|current|auto)($|[-_./])'),
  adapter_version text not null,
  routing_policy text not null,
  validator_version text not null,
  status text not null check (status in ('queued', 'running', 'accepted', 'review_required')),
  priority integer not null default 0,
  weight numeric(12, 4) not null default 1 check (weight > 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  maximum_attempts integer not null default 3 check (maximum_attempts between 1 and 20),
  lease_token uuid,
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  output_json jsonb,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, fingerprint),
  unique (tenant_id, computation_id)
);

create table document_intake_extraction.document_pages (
  tenant_id text not null,
  document_id uuid not null,
  page_number integer not null check (page_number between 1 and 10000),
  computation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, document_id) references document_intake_extraction.documents (tenant_id, document_id) on delete restrict,
  foreign key (tenant_id, computation_id) references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict,
  primary key (tenant_id, document_id, page_number)
);

create table document_intake_extraction.computation_demands (
  tenant_id text not null,
  intake_id uuid not null,
  computation_id uuid not null,
  priority integer not null default 0,
  virtual_finish numeric(30, 10) not null default 0,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, intake_id) references document_intake_extraction.intakes (tenant_id, intake_id) on delete restrict,
  foreign key (tenant_id, computation_id) references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict,
  primary key (tenant_id, intake_id, computation_id)
);

create table document_intake_extraction.provider_attempts (
  attempt_id uuid primary key,
  tenant_id text not null,
  computation_id uuid not null,
  fingerprint char(64) not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  provider text not null,
  model text not null,
  adapter_version text not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('running', 'accepted', 'review_required', 'failed', 'lease_expired')),
  provider_request_id text,
  input_units numeric,
  output_units numeric,
  billed_cost_usd numeric(20, 10),
  cost_measurement_status text not null check (cost_measurement_status in ('pending', 'measured', 'unknown_requires_reconciliation')),
  error_code text,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz,
  latency_ms bigint check (latency_ms is null or latency_ms >= 0),
  foreign key (tenant_id, computation_id) references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict,
  unique (tenant_id, computation_id, attempt_number),
  unique (tenant_id, attempt_id)
);

create table document_intake_extraction.cost_events (
  cost_event_id uuid primary key,
  tenant_id text not null,
  attempt_id uuid not null,
  computation_id uuid not null,
  fingerprint char(64) not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  provider text not null,
  model text not null,
  adapter_version text not null,
  attempt_status text not null,
  input_units numeric,
  output_units numeric,
  billed_cost_usd numeric(20, 10),
  measurement_status text not null check (measurement_status in ('measured', 'unknown_requires_reconciliation')),
  occurred_at timestamptz not null,
  foreign key (tenant_id, attempt_id) references document_intake_extraction.provider_attempts (tenant_id, attempt_id) on delete restrict,
  foreign key (tenant_id, computation_id) references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict
);

create table document_intake_extraction.extraction_results (
  result_id uuid primary key,
  tenant_id text not null,
  matter_id text not null,
  intake_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('ready', 'ready_with_review')),
  assembler_version text not null,
  document_count integer not null check (document_count between 1 and 500),
  page_count integer not null check (page_count between 1 and 10000),
  review_page_count integer not null check (review_page_count between 0 and 10000),
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, intake_id) references document_intake_extraction.intakes (tenant_id, intake_id) on delete restrict,
  unique (tenant_id, intake_id, version),
  unique (tenant_id, result_id)
);

alter table document_intake_extraction.intakes
  add constraint intakes_result_fk
  foreign key (tenant_id, result_id)
  references document_intake_extraction.extraction_results (tenant_id, result_id)
  deferrable initially deferred;

create table document_intake_extraction.outbox_events (
  event_id uuid primary key,
  tenant_id text not null,
  matter_id text not null,
  intake_id uuid not null,
  result_id uuid not null,
  event_type text not null,
  schema_version text not null,
  payload_json jsonb not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'delivering', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, intake_id) references document_intake_extraction.intakes (tenant_id, intake_id) on delete restrict,
  foreign key (tenant_id, result_id) references document_intake_extraction.extraction_results (tenant_id, result_id) on delete restrict,
  unique (tenant_id, event_type, intake_id, result_id),
  unique (tenant_id, event_id)
);

create table document_intake_extraction.capacity_observations (
  observation_id uuid primary key,
  tenant_id text not null,
  workload_class text not null,
  provider text,
  model text,
  adapter_version text,
  bytes bigint,
  pages integer,
  page_operations numeric,
  duration_ms bigint,
  ocr_share numeric(8, 7),
  repair_share numeric(8, 7),
  throttled boolean not null default false,
  observed_at timestamptz not null,
  check (bytes is null or bytes > 0),
  check (pages is null or pages > 0),
  check (duration_ms is null or duration_ms > 0)
);

create index intakes_scheduler_idx on document_intake_extraction.intakes
  (status, scheduler_priority desc, scheduler_virtual_finish, created_at);
create index intake_files_commit_idx on document_intake_extraction.intake_files
  (tenant_id, intake_id, status, ordinal);
create index documents_source_idx on document_intake_extraction.documents
  (tenant_id, source_sha256);
create index page_computations_claim_idx on document_intake_extraction.page_computations
  (tenant_id, status, run_after, priority desc, created_at);
create index page_computations_lease_idx on document_intake_extraction.page_computations
  (tenant_id, lease_expires_at) where status = 'running';
create index computation_demands_scheduler_idx on document_intake_extraction.computation_demands
  (tenant_id, fulfilled_at, priority desc, virtual_finish, created_at);
create index provider_attempts_work_idx on document_intake_extraction.provider_attempts
  (tenant_id, computation_id, attempt_number);
create index cost_events_intake_time_idx on document_intake_extraction.cost_events
  (tenant_id, occurred_at);
create index outbox_delivery_idx on document_intake_extraction.outbox_events
  (delivery_status, next_attempt_at, created_at) where delivery_status in ('pending', 'failed');
create index capacity_observations_lookup_idx on document_intake_extraction.capacity_observations
  (tenant_id, workload_class, provider, model, observed_at desc);

create trigger intakes_touch_updated_at before update on document_intake_extraction.intakes
for each row execute function document_intake_extraction.touch_updated_at();
create trigger intake_files_touch_updated_at before update on document_intake_extraction.intake_files
for each row execute function document_intake_extraction.touch_updated_at();
create trigger blob_tenant_refs_touch_updated_at before update on document_intake_extraction.blob_tenant_references
for each row execute function document_intake_extraction.touch_updated_at();
create trigger page_computations_touch_updated_at before update on document_intake_extraction.page_computations
for each row execute function document_intake_extraction.touch_updated_at();
create trigger outbox_touch_updated_at before update on document_intake_extraction.outbox_events
for each row execute function document_intake_extraction.touch_updated_at();

create or replace function document_intake_extraction.expire_page_leases()
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  update document_intake_extraction.page_computations
  set status = case when attempt_count >= maximum_attempts then 'review_required' else 'queued' end,
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      run_after = now()
  where tenant_id = document_intake_extraction.current_tenant_id()
    and status = 'running'
    and lease_expires_at < now();
  get diagnostics changed = row_count;
  return changed;
end
$$;

create or replace function document_intake_extraction.claim_page_work(
  worker_id text,
  lock_milliseconds integer default 60000
)
returns setof document_intake_extraction.page_computations
language plpgsql
as $$
begin
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

create or replace function document_intake_extraction.renew_page_lease(
  target_computation_id uuid,
  target_lease_token uuid,
  lock_milliseconds integer default 60000
)
returns boolean
language plpgsql
as $$
declare
  changed integer;
begin
  update document_intake_extraction.page_computations
  set last_heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(1000, lock_milliseconds)::double precision / 1000)
  where tenant_id = document_intake_extraction.current_tenant_id()
    and computation_id = target_computation_id
    and status = 'running'
    and lease_token = target_lease_token;
  get diagnostics changed = row_count;
  return changed = 1;
end
$$;

alter table document_intake_extraction.intakes enable row level security;
alter table document_intake_extraction.intakes force row level security;
alter table document_intake_extraction.intake_files enable row level security;
alter table document_intake_extraction.intake_files force row level security;
alter table document_intake_extraction.blob_tenant_references enable row level security;
alter table document_intake_extraction.blob_tenant_references force row level security;
alter table document_intake_extraction.documents enable row level security;
alter table document_intake_extraction.documents force row level security;
alter table document_intake_extraction.page_computations enable row level security;
alter table document_intake_extraction.page_computations force row level security;
alter table document_intake_extraction.document_pages enable row level security;
alter table document_intake_extraction.document_pages force row level security;
alter table document_intake_extraction.computation_demands enable row level security;
alter table document_intake_extraction.computation_demands force row level security;
alter table document_intake_extraction.provider_attempts enable row level security;
alter table document_intake_extraction.provider_attempts force row level security;
alter table document_intake_extraction.cost_events enable row level security;
alter table document_intake_extraction.cost_events force row level security;
alter table document_intake_extraction.extraction_results enable row level security;
alter table document_intake_extraction.extraction_results force row level security;
alter table document_intake_extraction.outbox_events enable row level security;
alter table document_intake_extraction.outbox_events force row level security;
alter table document_intake_extraction.capacity_observations enable row level security;
alter table document_intake_extraction.capacity_observations force row level security;

create policy tenant_isolation on document_intake_extraction.intakes
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.intake_files
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.blob_tenant_references
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.documents
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.page_computations
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.document_pages
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.computation_demands
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.provider_attempts
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.cost_events
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.extraction_results
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.outbox_events
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());
create policy tenant_isolation on document_intake_extraction.capacity_observations
using (tenant_id = document_intake_extraction.current_tenant_id()) with check (tenant_id = document_intake_extraction.current_tenant_id());

revoke all on all tables in schema document_intake_extraction from public;
revoke all on all functions in schema document_intake_extraction from public;

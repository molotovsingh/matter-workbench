-- Append-only, tenant-isolated custody and control audit evidence without document text.
create table document_intake_extraction.audit_events (
  audit_event_id uuid primary key,
  tenant_id text not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{2,119}$'),
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_.]{1,79}$'),
  resource_id text not null,
  actor_type text not null check (actor_type in ('service', 'worker', 'operator', 'system')),
  actor_id text not null,
  idempotency_key text not null,
  details_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, event_type, idempotency_key),
  unique (tenant_id, audit_event_id),
  check (octet_length(details_json::text) <= 16384)
);

create index audit_events_resource_idx
  on document_intake_extraction.audit_events (tenant_id, resource_type, resource_id, occurred_at, audit_event_id);
create index audit_events_time_idx
  on document_intake_extraction.audit_events (tenant_id, occurred_at, audit_event_id);

alter table document_intake_extraction.audit_events enable row level security;
alter table document_intake_extraction.audit_events force row level security;
create policy tenant_isolation on document_intake_extraction.audit_events
using (tenant_id = document_intake_extraction.current_tenant_id())
with check (tenant_id = document_intake_extraction.current_tenant_id());

revoke all on document_intake_extraction.audit_events from public;

-- Preserve many-to-many lineage when suspicious primary pages are superseded by selective repair.
create table document_intake_extraction.computation_supersessions (
  tenant_id text not null,
  prior_computation_id uuid not null,
  replacement_computation_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, prior_computation_id)
    references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict,
  foreign key (tenant_id, replacement_computation_id)
    references document_intake_extraction.page_computations (tenant_id, computation_id) on delete restrict,
  primary key (tenant_id, prior_computation_id, replacement_computation_id),
  check (prior_computation_id <> replacement_computation_id)
);

alter table document_intake_extraction.computation_supersessions enable row level security;
alter table document_intake_extraction.computation_supersessions force row level security;
create policy tenant_isolation on document_intake_extraction.computation_supersessions
using (tenant_id = document_intake_extraction.current_tenant_id())
with check (tenant_id = document_intake_extraction.current_tenant_id());

revoke all on document_intake_extraction.computation_supersessions from public;

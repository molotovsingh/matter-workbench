-- Preserve successful, failed, and throttled provider observations separately for restart-safe calibration.
alter table document_intake_extraction.capacity_observations
  add column outcome text not null default 'success'
  check (outcome in ('success', 'failed', 'throttled'));

create index capacity_observations_provider_outcome_idx
  on document_intake_extraction.capacity_observations
  (tenant_id, provider, model, adapter_version, outcome, observed_at desc)
  where provider is not null;

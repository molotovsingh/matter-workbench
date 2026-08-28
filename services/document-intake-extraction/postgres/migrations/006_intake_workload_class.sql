-- Persist bounded corpus classes so ETA and provider calibration remain comparable across restarts.
alter table document_intake_extraction.intakes
  add column workload_class text not null default 'mixed_legal'
  check (workload_class in ('mixed_legal', 'born_digital_legal', 'archival_legal', 'evaluation'));

create index intakes_workload_class_idx
  on document_intake_extraction.intakes (tenant_id, workload_class, status, created_at);

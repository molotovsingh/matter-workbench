-- Non-sensitive operational canary for proving V4 backup/restore preserves row data.
-- Runtime workers do not need it and receive no grant.
create table document_intake_extraction.recovery_canary (
  canary_key text primary key,
  canary_value text not null,
  created_at timestamptz not null default now()
);

revoke all on document_intake_extraction.recovery_canary from public;

insert into document_intake_extraction.recovery_canary (canary_key, canary_value)
values ('v4-recovery-canary/v1', 'matter-workbench-v4');

alter table mothership_signal_events
  add column if not exists status text not null default 'active';

alter table mothership_signal_events
  add column if not exists status_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mothership_signal_events_status_check'
      and conrelid = 'mothership_signal_events'::regclass
  ) then
    alter table mothership_signal_events
      add constraint mothership_signal_events_status_check
      check (status in ('active', 'resolved', 'superseded', 'suppressed'));
  end if;
end $$;

create index if not exists mothership_signal_events_installation_status_received_idx
  on mothership_signal_events (installation_id, status, received_at desc);

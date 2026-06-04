# Matter Workbench Shadow DB Snapshot

Generated at: 2026-06-04T00:00:00.000Z
Matched: yes
Branch: codex/matter-workbench-checkpoint-2026-05-17
Commit: be0530d
Worktree clean: yes

This is a shadow-database handoff artifact. It records what the PostgreSQL control-plane mirror currently reports, without changing Matter Workbench runtime storage.

```text
Matter Workbench shadow DB report
matched: yes
matter_filter: (none)
slash_filter: (none)
matter_counts: matched
  matters: expected=15 actual=15
  matter_intakes: expected=17 actual=17
  documents: expected=180 actual=180
  extraction_records: expected=180 actual=180
  source_descriptors: expected=125 actual=125
  matter_artifacts: expected=28 actual=28
  matter_import_batches: expected=15 actual=15
  matter_import_items: expected=180 actual=180
matter_totals:
  documents: 180
  extraction_records: 180
  source_descriptors: 125
  matter_artifacts: 28
matter_summaries:
  Atlas Constuction vs Diptishree documents=9 extractions=9 source_descriptors=9 artifacts=2 next_file_number=10
  Ayesha Vs Japan Airlines documents=34 extractions=34 source_descriptors=18 artifacts=2 next_file_number=35
  Bharat Nagpal Vs Gionee India documents=14 extractions=14 source_descriptors=14 artifacts=2 next_file_number=15
  Bose vs Atlas Realty - Contract Validity documents=4 extractions=4 source_descriptors=2 artifacts=2 next_file_number=5
  Devi vs Patel Traders - Money Recovery documents=5 extractions=5 source_descriptors=3 artifacts=2 next_file_number=6
  In re: Datacenter Logs - Evidence Triage documents=6 extractions=6 source_descriptors=0 artifacts=0 next_file_number=7
  Iqbal vs Brightline Industries - Goods Supply documents=7 extractions=7 source_descriptors=5 artifacts=2 next_file_number=8
  Kamran vs NCT documents=27 extractions=27 source_descriptors=8 artifacts=2 next_file_number=28
  KK Taori vs Roma Builders documents=12 extractions=12 source_descriptors=12 artifacts=2 next_file_number=13
  Krishnan vs Lumen Logistics - Service Recovery documents=8 extractions=8 source_descriptors=6 artifacts=2 next_file_number=9
  Mehta vs Skyline documents=12 extractions=12 source_descriptors=10 artifacts=2 next_file_number=13
  Nair vs Marlin Constructions - Boundary Dispute documents=7 extractions=7 source_descriptors=5 artifacts=2 next_file_number=8
  Sharma vs Raheja Horizon - Possession Default documents=13 extractions=13 source_descriptors=11 artifacts=2 next_file_number=14
  Techbeliever Vs GST documents=14 extractions=14 source_descriptors=14 artifacts=2 next_file_number=15
  Verma vs Northstar Traders - Delivery Default documents=8 extractions=8 source_descriptors=8 artifacts=2 next_file_number=9
skill_counts: matched
  skill_ideas: expected=21 actual=21
  skill_samples: expected=15 actual=15
  configurable_skills: expected=8 actual=8
  configurable_skill_versions: expected=8 actual=8
  configurable_skill_runs: expected=22 actual=22
skill_totals:
  configurable_skills: 8
  configurable_skill_versions: 8
  configurable_skill_runs: 22
skill_summaries:
  /draft_demand_notice Draft Demand Notice from Matter Facts status=active versions=1 runs=4
  /filing_route_plan Filing Route and Document Preparation Plan status=active versions=1 runs=2
  /filing_route_plan_failed_validation Filing Route and Document Preparation Plan status=draft versions=1 runs=0
  /party_officer_map Party and Officer Map status=active versions=1 runs=4
  /party_officer_map_2 Party and Officer Map status=active versions=1 runs=7
  /party_officer_map_3 Party and Officer Map status=draft versions=1 runs=0
  /statute_section_reading_guide Statute and Section Reading Guide status=active versions=1 runs=2
  /the_story The Story status=active versions=1 runs=3
advisory_counts: matched
  open_local_attention_incidents: expected=64 actual=64
  latest_advisory_snapshot_matters: expected=15 actual=15
  latest_snapshot_blockers: expected=2 actual=2
  latest_snapshot_warnings: expected=62 actual=62
  latest_snapshot_info: expected=0 actual=0
advisory_totals:
  blockers: 2
  warnings: 62
  info: 0
  incidents: 64
latest_advisory_snapshots:
  Atlas Constuction vs Diptishree blockers=0 warnings=6 info=0 incidents=6
  Ayesha Vs Japan Airlines blockers=0 warnings=7 info=0 incidents=7
  Bharat Nagpal Vs Gionee India blockers=0 warnings=5 info=0 incidents=5
  Bose vs Atlas Realty - Contract Validity blockers=1 warnings=3 info=0 incidents=4
  Devi vs Patel Traders - Money Recovery blockers=0 warnings=2 info=0 incidents=2
  In re: Datacenter Logs - Evidence Triage blockers=0 warnings=3 info=0 incidents=3
  Iqbal vs Brightline Industries - Goods Supply blockers=0 warnings=3 info=0 incidents=3
  Kamran vs NCT blockers=0 warnings=5 info=0 incidents=5
  KK Taori vs Roma Builders blockers=0 warnings=3 info=0 incidents=3
  Krishnan vs Lumen Logistics - Service Recovery blockers=0 warnings=3 info=0 incidents=3
  Mehta vs Skyline blockers=0 warnings=5 info=0 incidents=5
  Nair vs Marlin Constructions - Boundary Dispute blockers=0 warnings=4 info=0 incidents=4
  Sharma vs Raheja Horizon - Possession Default blockers=0 warnings=3 info=0 incidents=3
  Techbeliever Vs GST blockers=1 warnings=9 info=0 incidents=10
  Verma vs Northstar Traders - Delivery Default blockers=0 warnings=1 info=0 incidents=1
storage_counts: matched
  storage_objects: expected=582 actual=582
  document_blobs: expected=359 actual=359
  extraction_storage_links: expected=180 actual=180
  matter_artifact_storage_links: expected=28 actual=28
  skill_sample_storage_links: expected=15 actual=15
storage_totals:
  storage_objects: 582
storage_roles:
  extraction_payload: 180
  matter_artifact: 28
  skill_sample: 15
  source_original: 179
  source_working_copy: 180
provider_run_counts: matched
  provider_runs: expected=61 actual=61
  matter_artifact_provider_links: expected=28 actual=28
  skill_sample_ai_run_links: expected=15 actual=15
  configurable_skill_run_provider_links: expected=18 actual=18
provider_run_totals:
  provider_runs: 61
provider_run_groups:
  native_source_skill openrouter/meta-llama/llama-3.3-70b-instruct: 19
  native_source_skill openrouter/openai/gpt-4.1: 9
  skill_creation openai-direct/gpt-5.4: 15
  skill_execution openai-direct/gpt-5.4: 18
job_counts: matched
  processing_jobs: expected=61 actual=61
  provider_run_job_links: expected=61 actual=61
job_totals:
  processing_jobs: 61
job_groups:
  custom_skill failed: 1
  custom_skill succeeded: 32
  list_of_dates succeeded: 14
  source_labels succeeded: 14
cost_event_counts: matched
  cost_events: expected=61 actual=61
  provider_run_cost_links: expected=61 actual=61
cost_event_totals:
  cost_events: 61
  actual_amount: 4.01009444
cost_event_groups:
  matter actual openrouter/meta-llama/llama-3.3-70b-instruct: count=19 amount=0.04393044
  matter actual openrouter/openai/gpt-4.1: count=9 amount=3.9661639999999996
  matter unknown openai-direct/gpt-5.4: count=33 amount=
audit_event_counts: matched
  audit_events: expected=397 actual=397
  matter_linked_audit_events: expected=270 actual=270
  provider_invoked_audit_events: expected=89 actual=89
audit_event_totals:
  audit_events: 397
  provider_invoked_audit_events: 89
audit_event_groups:
  command.accepted provider_invoked=false: 1
  command.awaiting_skill_idea provider_invoked=false: 50
  command.cancelled provider_invoked=false: 12
  command.copied_review_packet provider_invoked=false: 3
  command.failed provider_invoked=false: 1
  command.failed provider_invoked=true: 8
  command.opened_interview provider_invoked=false: 25
  command.opened_interview provider_invoked=true: 30
  command.overlap_checked provider_invoked=true: 5
  command.question_answered provider_invoked=false: 128
  command.ran provider_invoked=false: 33
  command.ran provider_invoked=true: 20
  command.ready_for_review provider_invoked=false: 1
  command.router_checked provider_invoked=true: 10
  command.sample_approved provider_invoked=false: 10
  command.sample_feedback provider_invoked=true: 3
  command.sample_generated provider_invoked=true: 10
  command.saved_idea provider_invoked=false: 25
  command.skill_created provider_invoked=true: 3
  command.started_another_idea provider_invoked=false: 3
  command.updated_idea provider_invoked=false: 1
  command.warned provider_invoked=false: 15
```

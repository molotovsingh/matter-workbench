-- Hold the downstream filing report against the run that produced it.
--
-- A lawyer can start a run and leave; runs reach several minutes on large
-- documents. The report of what entered the matter record and what did not has
-- to survive that, or it only ever reaches someone who waits.
--
-- On the intake rather than the extraction result: the result is written once
-- and is the extraction evidence, so annotating it with a consumer's bookkeeping
-- would mutate evidence. Intakes already carry mutable run state. The report is
-- discarded with the intake, which is exactly the lifetime the requirement asks
-- for.
alter table document_intake_extraction.intakes
  add column filing_report_json jsonb;

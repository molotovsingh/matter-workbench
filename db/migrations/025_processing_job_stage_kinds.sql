BEGIN;

ALTER TABLE processing_jobs
  DROP CONSTRAINT IF EXISTS processing_jobs_kind_check;

ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_kind_check
  CHECK (kind IN (
    'intake',
    'upload',
    'matter_init',
    'extract',
    'ocr',
    'source_labels',
    'list_of_dates',
    'case_timeline',
    'label_refresh',
    'matter_story',
    'posture_diagnosis',
    'preparation_run',
    'custom_skill',
    'skill_sample_output',
    'export',
    'validation'
  ));

COMMIT;

ALTER TABLE skill_ideas
  DROP CONSTRAINT IF EXISTS skill_ideas_status_check;

ALTER TABLE skill_ideas
  ADD CONSTRAINT skill_ideas_status_check
  CHECK (status IN ('incomplete', 'ready_for_review', 'parked', 'created', 'dismissed'));

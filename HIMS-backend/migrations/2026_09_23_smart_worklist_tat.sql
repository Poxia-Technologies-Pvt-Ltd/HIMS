-- Smart worklists: turnaround-time (TAT) targets. A test's own target wins;
-- otherwise its department's default applies; otherwise the system default in
-- utils/worklistTat.js. STAT / Urgent orders get a tighter fraction of it.
ALTER TABLE lab_tests      ADD COLUMN tat_minutes INT NULL;
ALTER TABLE lab_categories ADD COLUMN tat_minutes INT NULL;

-- Starting department defaults (minutes) — editable in Test Management.
UPDATE lab_categories SET tat_minutes = CASE name
  WHEN 'Hematology' THEN 120 WHEN 'Biochemistry' THEN 240 WHEN 'Clinical Pathology' THEN 180
  WHEN 'Serology' THEN 240 WHEN 'Immunology' THEN 480 WHEN 'Endocrinology' THEN 480
  WHEN 'Microbiology' THEN 1440 WHEN 'Toxicology' THEN 1440 WHEN 'Histopathology' THEN 2880
  WHEN 'Critical Care' THEN 60 ELSE NULL END
WHERE tat_minutes IS NULL;

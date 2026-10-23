-- Sample referrals cover two kinds of transfer:
--   Between labs      -> a different lab inside the SAME hospital
--   Between hospitals -> another facility (optionally a specific lab there)
-- A lab is an infrastructure row of type 'Lab'. lab_samples.holder_lab_id says
-- which lab currently has the tube (NULL = the lab the test was ordered for).
ALTER TABLE lab_samples
  ADD COLUMN holder_lab_id INT NULL AFTER holder_branch_id;

ALTER TABLE sample_referrals
  ADD COLUMN transfer_type ENUM('Between labs','Between hospitals') NOT NULL DEFAULT 'Between hospitals' AFTER bill_id,
  ADD COLUMN from_lab_id INT NULL AFTER from_branch_id,
  ADD COLUMN to_lab_id INT NULL AFTER to_branch_id,
  ADD COLUMN prior_holder_branch_id INT NULL,
  ADD COLUMN prior_holder_lab_id INT NULL;

-- Single-hospital HMIS.
--
-- The schema keeps its branch_id columns (every query scopes by them), but
-- there is exactly one row in `branches`: the hospital. Every user and record
-- belongs to it, nobody is network-level (Central / Sub-Central), and the
-- hospital's name, address and phone are edited in Settings, which keeps this
-- row in step (settingsController.updateSettings).
--
-- Apply once, after 2026_10_21_hmis_hr_opd.sql. Old logins are cleared
-- separately (2026_10_22_reset_accounts.sql); then create accounts with
-- node scripts/create_admin.js (first administrator only) or
-- node scripts/seed_hospital.js (one account per role plus starter data).

SET @hospital := (SELECT MIN(id) FROM branches WHERE status = 'Active');

-- Re-home everything that pointed at another facility (history logs excepted).
UPDATE device_api_keys   SET branch_id = @hospital        WHERE branch_id <> @hospital;
UPDATE infrastructure    SET branch_id = @hospital        WHERE branch_id IS NULL OR branch_id <> @hospital;
UPDATE lab_samples       SET holder_branch_id = @hospital WHERE holder_branch_id <> @hospital;
UPDATE sample_referrals  SET to_branch_id = @hospital     WHERE to_branch_id <> @hospital;
UPDATE patients          SET branch_id = @hospital        WHERE branch_id IS NULL OR branch_id <> @hospital;
UPDATE appointments      SET branch_id = @hospital        WHERE branch_id IS NULL OR branch_id <> @hospital;
UPDATE critical_alerts   SET branch_id = @hospital        WHERE branch_id IS NULL OR branch_id <> @hospital;
-- Other facilities stay as inactive rows: the append-only custody and audit
-- logs still name them.
UPDATE branches SET status = 'Inactive' WHERE id <> @hospital;
UPDATE branches SET parent_branch_id = NULL, branch_level = 'Hospital', facility_type = 'Hospital' WHERE id = @hospital;

-- The hospital profile in Settings is the source of truth for the name and contact details.
UPDATE branches b JOIN (SELECT * FROM hospital_settings ORDER BY id LIMIT 1) h
   SET b.branch_name = COALESCE(NULLIF(h.hospital_name, ''), b.branch_name),
       b.address = COALESCE(NULLIF(h.address, ''), b.address),
       b.contact_number = COALESCE(NULLIF(h.phone, ''), b.contact_number)
 WHERE b.id = @hospital;

-- No government HMIS integrations (CDAC e-Sushrut, CARE): without this row the
-- lab pages hide "Fetch CDAC Order" and the result/collection pushes skip.
DELETE FROM branch_hmis_config;

-- From here on every login belongs to the hospital; there is no network level.
ALTER TABLE users
  MODIFY COLUMN role_level ENUM('Central','Sub-Central','Branch') NOT NULL DEFAULT 'Branch';

-- Professional Tax differs by state: off until HR sets the slab in Attendance > Rules.
UPDATE hr_settings SET pt_threshold = 0, pt_amount = 0, pt_february_amount = 0;
ALTER TABLE hr_settings
  MODIFY COLUMN pt_threshold       DECIMAL(10,2) NOT NULL DEFAULT 0,
  MODIFY COLUMN pt_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  MODIFY COLUMN pt_february_amount DECIMAL(10,2) NOT NULL DEFAULT 0;

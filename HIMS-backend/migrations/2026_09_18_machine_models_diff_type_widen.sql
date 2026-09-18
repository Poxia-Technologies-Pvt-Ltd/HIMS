-- machine_models.diff_type was ENUM('3-Part','5-Part','N/A'), sized for
-- Hematology analyzers only. Machine Master's Diff Type is now scoped per
-- Department (see DEPARTMENT_DIFF_TYPES in HIMS-frontend/src/pages/Settings/
-- MachineMaster.jsx), with values like "Fully Automated Biochemistry
-- Analyzer" that don't fit the old enum — inserts were silently truncated/
-- rejected (WARN_DATA_TRUNCATED) instead of saving.
--
-- Widened to VARCHAR(100): longest current value is "Antimicrobial
-- Susceptibility Testing Analyzer" (~46 chars); allowlist validation of the
-- actual values still lives in machineModelController.js, not the schema.

ALTER TABLE machine_models MODIFY COLUMN diff_type VARCHAR(100) NOT NULL DEFAULT 'N/A';

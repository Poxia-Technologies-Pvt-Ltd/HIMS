-- Internal LOINC standardization for our lab test parameters — reference
-- copy. This file is NOT executed automatically. Run
-- `node scripts/run_loinc_migration.js` instead, which inlines the
-- equivalent idempotent SQL — same convention as
-- scripts/run_cdac_migration.js / scripts/run_care_migration.js.
--
-- Deliberately separate from care_loinc_parameter_map (CARE integration's
-- own LOINC bridge, scripts/care_integration_migration.sql) — this table is
-- integration-agnostic: it's our own canonical "what LOINC concept is this
-- parameter" reference, independent of any one hospital-system integration.
-- CARE's and any future CDAC LOINC-aware logic can both read from this
-- table instead of each maintaining their own copy.
--
-- Keyed by (parameter_name, specimen_context) — the same analyte name (e.g.
-- "Sodium", "pH") can legitimately mean two different LOINC concepts in our
-- data depending on which panel/specimen it's measured from (Serum/Plasma
-- vs arterial Blood Gas), confirmed by lab review rather than collapsed
-- into a single guessed row. Still NOT keyed by lab_test_parameters.id —
-- that would require the same LOINC code re-entered on every panel that
-- shares a specimen context.
CREATE TABLE IF NOT EXISTS lab_parameter_loinc_map (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  parameter_name          VARCHAR(200) NOT NULL,
  loinc_code              VARCHAR(20) DEFAULT NULL,
  loinc_long_common_name  VARCHAR(255) DEFAULT NULL,
  specimen_context        VARCHAR(100) DEFAULT NULL, -- e.g. "Urine", "Serum or Plasma", "Whole Blood / Arterial Blood"
  mapping_status          ENUM('Mapped','Unmapped','Needs Review') NOT NULL DEFAULT 'Unmapped',
  confidence              ENUM('High','Medium','Low') DEFAULT NULL,
  notes                   VARCHAR(500) DEFAULT NULL,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loinc_param_name_specimen (parameter_name, specimen_context)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

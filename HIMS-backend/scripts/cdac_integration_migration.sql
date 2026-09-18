-- CDAC (e-Sushrut HMIS) integration schema — reference copy.
-- This file is NOT executed automatically. Run `node scripts/run_cdac_migration.js`
-- instead, which inlines the equivalent idempotent SQL — same convention as
-- scripts/org_module_migration.js / scripts/branch_and_sequence_migration.sql.

-- Per-branch routing + config. Source of truth for "does this branch use CDAC,
-- Care HIMS, or neither" — seeded once from districts.name = 'Ramgarh', then
-- manually editable so rollout can be incremental.
CREATE TABLE IF NOT EXISTS branch_hmis_config (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  branch_id                 INT NOT NULL,
  integration_type          ENUM('CDAC','CARE','NONE') NOT NULL DEFAULT 'NONE',
  hmis_hosp_mapping_code    VARCHAR(50) DEFAULT NULL,
  api_access_key_override   VARCHAR(255) DEFAULT NULL,
  is_active                 TINYINT(1) NOT NULL DEFAULT 1,
  notes                     VARCHAR(255) DEFAULT NULL,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branch_hmis_config_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Correlates a local bill_item (one lab test on one bill) with CDAC's
-- requisition identifiers. One row per bill_item that originated from (or was
-- ever pushed to) CDAC.
CREATE TABLE IF NOT EXISTS cdac_lab_requisitions (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  bill_item_id            INT NOT NULL,
  branch_id               INT NOT NULL,
  hmis_hosp_mapping_code  VARCHAR(50) NOT NULL,
  hmis_patCrNo            VARCHAR(50) NOT NULL,
  hmis_episode_code       VARCHAR(50) DEFAULT NULL,
  hmis_episode_visitno    VARCHAR(50) DEFAULT NULL,
  hmis_req_no             VARCHAR(50) NOT NULL,
  hmis_req_dno            VARCHAR(50) NOT NULL,
  hmis_lab_code           VARCHAR(50) DEFAULT NULL,
  hmis_test_code          VARCHAR(50) DEFAULT NULL,
  hmis_test_name          VARCHAR(200) DEFAULT NULL,
  hmis_sample_code        VARCHAR(50) DEFAULT NULL,
  hmis_sample_name        VARCHAR(200) DEFAULT NULL,
  req_type                VARCHAR(10) DEFAULT NULL,
  cdac_inv_status         VARCHAR(10) DEFAULT NULL,
  last_pushed_status      VARCHAR(30) DEFAULT NULL,
  last_pushed_at          TIMESTAMP NULL DEFAULT NULL,
  last_push_error         TEXT DEFAULT NULL,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cdac_req_bill_item (bill_item_id),
  UNIQUE KEY uq_cdac_req_dno (hmis_req_dno),
  KEY idx_cdac_req_patcrno (hmis_patCrNo),
  KEY idx_cdac_req_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Raw cache of API 7 (getHmisHospMapDataRowData) master data. JSON-backed
-- since none of CDAC's 7 endpoints have documented response schemas.
CREATE TABLE IF NOT EXISTS cdac_master_data_cache (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  hmis_hosp_mapping_code  VARCHAR(50) NOT NULL,
  category                ENUM('LAB','SAMPLE','TEST','UOM','SAMPLE_MAPPING','PARAMETER','OTHER') NOT NULL,
  code                    VARCHAR(50) NOT NULL,
  name                    VARCHAR(255) DEFAULT NULL,
  raw_json                JSON DEFAULT NULL,
  synced_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cdac_master_data (hmis_hosp_mapping_code, category, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps CDAC's hmis_test_code to our internal lab_tests.id. Unmapped codes get
-- a placeholder lab_tests row at pull time (mirrors careController.resolveTests)
-- so an order is never silently dropped for lack of a mapping.
CREATE TABLE IF NOT EXISTS cdac_test_code_map (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  hmis_hosp_mapping_code  VARCHAR(50) NOT NULL,
  hmis_lab_code           VARCHAR(50) DEFAULT NULL,
  hmis_test_code          VARCHAR(50) NOT NULL,
  hmis_test_name          VARCHAR(200) DEFAULT NULL,
  hmis_sample_code        VARCHAR(50) DEFAULT NULL,
  lab_test_id             INT DEFAULT NULL,
  mapping_status          ENUM('Mapped','Placeholder','Unmapped') NOT NULL DEFAULT 'Unmapped',
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cdac_test_code (hmis_hosp_mapping_code, hmis_test_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps CDAC's parameter-level codes to our internal lab_test_parameters.id.
-- Schema only in this pass — CDAC's own docs flag ownership of this mapping
-- as unresolved; populating it is separate follow-up work.
CREATE TABLE IF NOT EXISTS cdac_parameter_map (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  hmis_hosp_mapping_code      VARCHAR(50) DEFAULT NULL,
  hmis_lab_code                VARCHAR(50) DEFAULT NULL,
  hmis_test_code              VARCHAR(50) DEFAULT NULL,
  hmis_sample_code            VARCHAR(50) DEFAULT NULL,
  hmis_parameter_code         VARCHAR(50) DEFAULT NULL,
  hmis_parent_parameter_code  VARCHAR(50) DEFAULT NULL,
  hmis_str_uom                VARCHAR(50) DEFAULT NULL,
  lab_test_parameter_id       INT DEFAULT NULL,
  mapping_status              ENUM('Mapped','Unmapped') NOT NULL DEFAULT 'Unmapped',
  notes                       VARCHAR(255) DEFAULT NULL,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit trail of every CDAC API call. For API 5 (report upload), the request
-- log stores payload metadata/length only, not the full base64 PDF blob.
CREATE TABLE IF NOT EXISTS cdac_integration_logs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  operation         VARCHAR(50) NOT NULL,
  hmis_request_type VARCHAR(10) DEFAULT NULL,
  bill_item_id      INT DEFAULT NULL,
  hmis_req_no       VARCHAR(50) DEFAULT NULL,
  hmis_req_dno      VARCHAR(50) DEFAULT NULL,
  hmis_patCrNo      VARCHAR(50) DEFAULT NULL,
  branch_id         INT DEFAULT NULL,
  request_payload   JSON DEFAULT NULL,
  response_payload  JSON DEFAULT NULL,
  http_status       INT DEFAULT NULL,
  success           TINYINT(1) NOT NULL DEFAULT 0,
  error_message     TEXT DEFAULT NULL,
  duration_ms       INT DEFAULT NULL,
  attempt           INT NOT NULL DEFAULT 1,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cdac_logs_bill_item (bill_item_id),
  KEY idx_cdac_logs_operation (operation, created_at),
  KEY idx_cdac_logs_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed branch_hmis_config from the district rule (no hardcoded IDs):
-- Ramgarh branches -> CARE (inactive placeholder, no sender built yet)
-- everything else  -> CDAC (hmis_hosp_mapping_code left NULL, filled in per branch later)
INSERT IGNORE INTO branch_hmis_config (branch_id, integration_type, is_active, notes)
SELECT b.id,
       CASE WHEN d.name = 'Ramgarh' THEN 'CARE' ELSE 'CDAC' END,
       CASE WHEN d.name = 'Ramgarh' THEN 0 ELSE 1 END,
       CASE WHEN d.name = 'Ramgarh' THEN 'Care HIMS outbound not yet built' ELSE 'hmis_hosp_mapping_code pending from CDAC' END
FROM branches b
JOIN districts d ON b.district_id = d.id;

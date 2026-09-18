-- Care HIMS (CARE / OHC Network) integration schema — reference copy.
-- This file is NOT executed automatically. Run `node scripts/run_care_migration.js`
-- instead, which inlines the equivalent idempotent SQL — same convention as
-- scripts/run_cdac_migration.js.

-- Additive columns on the existing routing table. branch_hmis_config already
-- has a UNIQUE branch_id row per branch and already routes Ramgarh branches to
-- integration_type='CARE' (seeded inactive by the CDAC migration, since no
-- sender existed yet). These sit unused on non-CARE rows, same as CDAC's
-- hmis_hosp_mapping_code/api_access_key_override already do on non-CDAC rows.
ALTER TABLE branch_hmis_config
  ADD COLUMN care_gateway_external_id VARCHAR(100) DEFAULT NULL, -- our gateway's external_id, sent as X-Gateway-Id
  ADD COLUMN care_sender_ip           VARCHAR(100) DEFAULT NULL, -- lab-analyzer device's registered endpoint_address, echoed as sender_ip
  ADD COLUMN care_oru_port            INT DEFAULT NULL,          -- diagnostic only, spec default 2575
  ADD COLUMN care_orm_mode            VARCHAR(20) DEFAULT NULL;  -- diagnostic only, spec default 'shared'

-- Correlates a local bill_item with CARE's order identifiers. One row per
-- bill_item that originated from a CARE ORM order. Global (not scoped to a
-- hospital code) — a CARE-registered gateway is deployment-wide.
CREATE TABLE IF NOT EXISTS care_lab_orders (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  bill_item_id          INT NOT NULL,
  branch_id             INT NOT NULL,
  placer_order_number   VARCHAR(50) NOT NULL,  -- ORC-2/OBR-2, echoed verbatim in the outbound ORU
  filler_order_number   VARCHAR(50) NOT NULL,  -- OBR-3, echoed verbatim; spec requires this be numeric
  loinc_code            VARCHAR(20) NOT NULL,  -- OBR-4.1 (panel/test LOINC)
  loinc_name            VARCHAR(200) DEFAULT NULL,
  coding_system         VARCHAR(20) DEFAULT NULL,
  message_control_id    VARCHAR(50) DEFAULT NULL, -- MSH-10 of the inbound ORM, traceability only
  device_ip             VARCHAR(50) DEFAULT NULL,
  device_port           INT DEFAULT NULL,
  orm_mode              VARCHAR(20) DEFAULT NULL,
  last_pushed_status    VARCHAR(30) DEFAULT NULL, -- 'RESULT_PUSHED'
  last_pushed_at        TIMESTAMP NULL DEFAULT NULL,
  last_push_error       TEXT DEFAULT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_care_order_bill_item (bill_item_id),
  UNIQUE KEY uq_care_order_filler (filler_order_number),
  KEY idx_care_order_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps LOINC panel/test codes (OBR-4.1) to our internal lab_tests.id. LOINC is
-- a public standard (unlike CDAC's proprietary codes) so this ships partially
-- pre-seeded with the codes from CARE's own sample messages, but still
-- 'Unmapped' since lab_test_id is installation-specific. Unmapped codes get a
-- placeholder lab_tests row at receive time, mirroring resolveCdacTest.
CREATE TABLE IF NOT EXISTS care_loinc_test_map (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  loinc_code     VARCHAR(20) NOT NULL,
  loinc_name     VARCHAR(200) DEFAULT NULL,
  lab_test_id    INT DEFAULT NULL,
  mapping_status ENUM('Mapped','Placeholder','Unmapped') NOT NULL DEFAULT 'Unmapped',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_care_loinc_test (loinc_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps LOINC component codes (OBX-3 on outbound results) to our internal
-- lab_test_parameters.id, scoped under the parent panel LOINC code.
CREATE TABLE IF NOT EXISTS care_loinc_parameter_map (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  loinc_code            VARCHAR(20) NOT NULL,  -- parent/panel LOINC (OBR-4.1 context)
  parameter_loinc_code  VARCHAR(20) NOT NULL,  -- component LOINC for OBX-3
  parameter_name        VARCHAR(200) NOT NULL, -- matched against lab_test_result.results_json[].parameter_name
  uom                   VARCHAR(50) DEFAULT NULL,
  lab_test_parameter_id INT DEFAULT NULL,
  mapping_status        ENUM('Mapped','Unmapped') NOT NULL DEFAULT 'Unmapped',
  notes                 VARCHAR(255) DEFAULT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_care_param (loinc_code, parameter_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit trail of every CARE call, both directions.
CREATE TABLE IF NOT EXISTS care_integration_logs (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  operation           VARCHAR(50) NOT NULL,  -- 'RECEIVE_ORDER' | 'PUSH_RESULT' | 'LIST_DEVICES'
  direction           ENUM('INBOUND','OUTBOUND') NOT NULL,
  care_lab_order_id   INT DEFAULT NULL,
  bill_item_id        INT DEFAULT NULL,
  filler_order_number VARCHAR(50) DEFAULT NULL,
  branch_id           INT DEFAULT NULL,
  request_payload     JSON DEFAULT NULL,
  response_payload    JSON DEFAULT NULL,
  http_status         INT DEFAULT NULL,
  success             TINYINT(1) NOT NULL DEFAULT 0,
  error_message       TEXT DEFAULT NULL,
  duration_ms         INT DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_care_logs_bill_item (bill_item_id),
  KEY idx_care_logs_operation (operation, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Starter LOINC seed — names only, 'Unmapped'. Never pre-linked to lab_test_id
-- (installation-specific), same reasoning as CDAC's sync-master-data seeding.
INSERT IGNORE INTO care_loinc_test_map (loinc_code, loinc_name, mapping_status) VALUES
  ('58410-2', 'CBC panel', 'Unmapped'),
  ('24323-8', 'Comprehensive metabolic panel', 'Unmapped'),
  ('24331-1', 'Lipid panel', 'Unmapped');

INSERT IGNORE INTO care_loinc_parameter_map (loinc_code, parameter_loinc_code, parameter_name, mapping_status) VALUES
  ('58410-2', '718-7',   'Hemoglobin',        'Unmapped'),
  ('58410-2', '6690-2',  'Leukocytes',        'Unmapped'),
  ('58410-2', '777-3',   'Platelets',         'Unmapped'),
  ('58410-2', '789-8',   'Erythrocytes',      'Unmapped'),
  ('58410-2', '4544-3',  'Hematocrit',        'Unmapped'),
  ('24323-8', '2345-7',  'Glucose',           'Unmapped'),
  ('24323-8', '3094-0',  'Urea Nitrogen',     'Unmapped'),
  ('24323-8', '2160-0',  'Creatinine',        'Unmapped'),
  ('24323-8', '2951-2',  'Sodium',            'Unmapped'),
  ('24323-8', '2823-3',  'Potassium',         'Unmapped'),
  ('24323-8', '2075-0',  'Chloride',          'Unmapped'),
  ('24323-8', '2028-9',  'Carbon Dioxide',    'Unmapped'),
  ('24323-8', '17861-6', 'Calcium',           'Unmapped'),
  ('24323-8', '2885-2',  'Total Protein',     'Unmapped'),
  ('24323-8', '1751-7',  'Albumin',           'Unmapped'),
  ('24323-8', '1975-2',  'Total Bilirubin',   'Unmapped'),
  ('24323-8', '6768-6',  'Alkaline Phosphatase', 'Unmapped'),
  ('24323-8', '1920-8',  'AST',               'Unmapped'),
  ('24323-8', '1742-6',  'ALT',               'Unmapped'),
  ('24331-1', '2093-3',  'Total Cholesterol', 'Unmapped'),
  ('24331-1', '2571-8',  'Triglycerides',     'Unmapped'),
  ('24331-1', '2085-9',  'HDL Cholesterol',   'Unmapped'),
  ('24331-1', '13457-7', 'LDL Cholesterol',   'Unmapped');

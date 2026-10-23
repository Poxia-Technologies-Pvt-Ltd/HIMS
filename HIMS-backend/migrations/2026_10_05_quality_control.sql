-- Internal Quality Control (IQC) and External Quality Assessment (EQAS).
--
-- qc_materials: one row per control lot + level + parameter on an analyzer,
-- carrying the target mean/SD the lab has established for that lot. A new lot
-- is a new row (old lots stay for history), so Levey-Jennings charts never mix
-- two lots' statistics.
--
-- qc_runs: every control value run, with the Westgard evaluation stored at the
-- time it was recorded (status + which rules fired), so the record shows what
-- the technician was told, even if the rule set is changed later.
--
-- eqas_results: one row per EQAS/PT sample result returned by a provider
-- (CMC Vellore, AIIMS, NIB, Bio-Rad EQAS ...). The SDI is computed from the
-- provider's assigned value and SD.

CREATE TABLE IF NOT EXISTS qc_materials (
  id             INT NOT NULL AUTO_INCREMENT,
  branch_id      INT NULL,
  machine_id     INT NULL,
  test_id        INT NULL,
  parameter_name VARCHAR(200) NOT NULL,
  unit           VARCHAR(50) NULL,
  material_name  VARCHAR(150) NOT NULL,
  lot_no         VARCHAR(80) NOT NULL,
  level          VARCHAR(20) NOT NULL DEFAULT 'Level 1',
  target_mean    DECIMAL(14,4) NOT NULL,
  target_sd      DECIMAL(14,4) NOT NULL,
  expiry_date    DATE NULL,
  rules          VARCHAR(100) NOT NULL DEFAULT '1-2s,1-3s,2-2s,R-4s,4-1s,10x',
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_qcm_branch (branch_id, active),
  KEY idx_qcm_machine (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS qc_runs (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  material_id       INT NOT NULL,
  branch_id         INT NULL,
  value             DECIMAL(14,4) NOT NULL,
  z_score           DECIMAL(8,3) NULL,
  run_at            DATETIME NOT NULL,
  status            ENUM('Accepted','Warning','Rejected') NOT NULL,
  violations        VARCHAR(200) NULL,
  corrective_action VARCHAR(500) NULL,
  performed_by      INT NULL,
  performed_by_name VARCHAR(200) NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_qcr_material (material_id, run_at),
  KEY idx_qcr_branch (branch_id, run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eqas_results (
  id                INT NOT NULL AUTO_INCREMENT,
  branch_id         INT NULL,
  provider          VARCHAR(150) NOT NULL,
  program_name      VARCHAR(150) NOT NULL,
  cycle             VARCHAR(60) NOT NULL,
  sample_code       VARCHAR(60) NULL,
  test_id           INT NULL,
  parameter_name    VARCHAR(200) NOT NULL,
  our_result        DECIMAL(14,4) NULL,
  assigned_value    DECIMAL(14,4) NULL,
  assigned_sd       DECIMAL(14,4) NULL,
  sdi               DECIMAL(8,3) NULL,
  performance       ENUM('Pending','Acceptable','Warning','Unacceptable') NOT NULL DEFAULT 'Pending',
  received_on       DATE NULL,
  submitted_on      DATE NULL,
  result_on         DATE NULL,
  corrective_action VARCHAR(500) NULL,
  recorded_by       INT NULL,
  recorded_by_name  VARCHAR(200) NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_eqas_branch (branch_id, cycle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Module 7 #1: technical validation and clinical / doctor authorization,
-- configurable per laboratory discipline (lab_categories row).
--
--   Two-level  Test Done -> Verified (technical validation) -> Approved (clinical authorization)
--   Single     Test Done -> Approved (one authorization step)
-- Who may perform each step, whether the people must differ, and whether
-- unflagged results are technically validated automatically are all set per
-- discipline; category_id 0 is the facility-wide default that disciplines
-- without their own row inherit.
CREATE TABLE IF NOT EXISTS lab_verification_workflows (
  category_id         INT NOT NULL,
  levels              ENUM('Two-level','Single') NOT NULL DEFAULT 'Two-level',
  technical_roles     VARCHAR(200) NOT NULL DEFAULT 'Lab Technician,Lab Head,Admin,Super Admin',
  clinical_roles      VARCHAR(200) NOT NULL DEFAULT 'Lab Head,Admin,Super Admin',
  enforce_segregation TINYINT(1) NOT NULL DEFAULT 1,   -- authorizer must differ from the tester and the technical validator
  auto_verify_normal  TINYINT(1) NOT NULL DEFAULT 0,   -- results with no flags skip manual technical validation
  updated_by          INT NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO lab_verification_workflows (category_id) VALUES (0);

ALTER TABLE lab_test_result ADD COLUMN approved_at TIMESTAMP NULL AFTER approved_by;
UPDATE lab_test_result SET approved_at = verified_at WHERE status = 'Approved' AND approved_at IS NULL;

-- Append-only history of every validation / authorization step (extended by the
-- verification-history work). Same protection as the sample custody log.
CREATE TABLE IF NOT EXISTS lab_result_audit (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  result_id   INT NOT NULL,
  sample_id   VARCHAR(60) NOT NULL,
  branch_id   INT NULL,
  action      VARCHAR(40) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status   VARCHAR(20) NULL,
  actor_id    INT NULL,
  actor_name  VARCHAR(200) NULL,
  actor_role  VARCHAR(50) NULL,
  note        VARCHAR(500) NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lra_result (result_id, created_at),
  KEY idx_lra_sample (sample_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS lab_result_audit_no_update;
DROP TRIGGER IF EXISTS lab_result_audit_no_delete;
CREATE TRIGGER lab_result_audit_no_update BEFORE UPDATE ON lab_result_audit
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'lab_result_audit is append-only';
CREATE TRIGGER lab_result_audit_no_delete BEFORE DELETE ON lab_result_audit
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'lab_result_audit is append-only';

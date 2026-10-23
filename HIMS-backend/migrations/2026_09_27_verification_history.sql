-- Module 7 #4: complete verification history — who did what and when, every
-- edit with before/after values and a reason, re-verification after an edit,
-- and cancellation / reissue of an authorized report with versioning.
--
--   Every save, edit, rerun, validation, authorization, amendment, cancellation
--   and reissue is an append-only row in lab_result_audit (with reason and a
--   before/after diff where values changed).
--   Editing a result after it was validated / authorized requires a reason,
--   snapshots the old content as a version, revokes the old signature and sends
--   the result back for validation and authorization (report_version + 1).
ALTER TABLE lab_test_result
  MODIFY status ENUM('Pending','Test Done','Verified','Approved','Rerun Requested','Cancelled') NOT NULL DEFAULT 'Pending',
  ADD COLUMN report_version INT NOT NULL DEFAULT 1;

ALTER TABLE lab_result_audit
  MODIFY action VARCHAR(80) NOT NULL,
  ADD COLUMN reason  VARCHAR(500) NULL,
  ADD COLUMN details JSON NULL,
  ADD COLUMN version INT NULL;

CREATE TABLE IF NOT EXISTS lab_result_versions (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  result_id         INT NOT NULL,
  version           INT NOT NULL,
  results_json      JSON NOT NULL,                 -- the content as it stood in this version
  status_at_change  VARCHAR(20) NULL,
  verified_by       INT NULL,
  approved_by       INT NULL,
  approved_at       TIMESTAMP NULL,
  signature_id      BIGINT NULL,
  superseded_reason VARCHAR(500) NOT NULL,
  superseded_by     INT NULL,
  superseded_by_name VARCHAR(200) NULL,
  superseded_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lrv_result (result_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS lab_result_versions_no_update;
DROP TRIGGER IF EXISTS lab_result_versions_no_delete;
CREATE TRIGGER lab_result_versions_no_update BEFORE UPDATE ON lab_result_versions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'lab_result_versions is append-only';
CREATE TRIGGER lab_result_versions_no_delete BEFORE DELETE ON lab_result_versions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'lab_result_versions is append-only';

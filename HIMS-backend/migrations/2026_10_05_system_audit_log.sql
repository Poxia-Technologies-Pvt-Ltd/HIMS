-- System-wide, tamper-evident audit trail (tender #103-106).
--
-- Every state-changing API call (and a few sensitive reads: report PDFs,
-- exports) is written here by middleware/auditTrail.js once the response has
-- been sent: who, from where, what, the outcome, and — for master-data edits —
-- the row before and after.
--
-- Tamper evidence: each row stores row_hash = SHA-256(prev_hash + the row's
-- content), chaining every entry to the one before it. Editing or deleting any
-- row breaks the chain from that point on, which GET /api/audit/verify reports.
-- On top of that the two triggers below refuse UPDATE and DELETE outright, so
-- the application account cannot rewrite history; purging under the
-- Government retention policy is a deliberate DBA action (drop trigger,
-- archive, purge, recreate) rather than something the app can do.

CREATE TABLE IF NOT EXISTS system_audit_log (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  occurred_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id      INT NULL,
  user_name    VARCHAR(200) NULL,
  user_role    VARCHAR(50) NULL,
  branch_id    INT NULL,
  ip_address   VARCHAR(64) NULL,
  user_agent   VARCHAR(255) NULL,
  method       VARCHAR(10) NOT NULL,
  path         VARCHAR(255) NOT NULL,
  module       VARCHAR(60) NULL,
  action       VARCHAR(120) NOT NULL,
  entity       VARCHAR(60) NULL,
  entity_id    VARCHAR(80) NULL,
  status_code  SMALLINT NULL,
  outcome      ENUM('Success','Failed','Denied') NOT NULL,
  request_data JSON NULL,
  before_data  JSON NULL,
  after_data   JSON NULL,
  prev_hash    CHAR(64) NOT NULL,
  row_hash     CHAR(64) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sal_time (occurred_at),
  KEY idx_sal_user (user_id, occurred_at),
  KEY idx_sal_entity (entity, entity_id),
  KEY idx_sal_module (module, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS system_audit_log_no_update;
CREATE TRIGGER system_audit_log_no_update BEFORE UPDATE ON system_audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'system_audit_log is append-only';

DROP TRIGGER IF EXISTS system_audit_log_no_delete;
CREATE TRIGGER system_audit_log_no_delete BEFORE DELETE ON system_audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'system_audit_log is append-only';

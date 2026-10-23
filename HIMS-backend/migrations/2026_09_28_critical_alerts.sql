-- Module 7 #5: critical-result notification workflow with documented
-- acknowledgement, configurable per laboratory discipline.
--
--   A result with a critical parameter raises an alert. Lab staff record each
--   attempt to notify the responsible clinician (who, how, when, outcome).
--   The alert closes only when someone documents that the clinician
--   acknowledged it WITH READ-BACK. An alert not notified within the
--   discipline's time limit shows as overdue (escalation). A discipline can
--   also require acknowledgement before the report may be authorized.
ALTER TABLE lab_verification_workflows
  ADD COLUMN critical_notify         TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN critical_notify_minutes INT NOT NULL DEFAULT 30,
  ADD COLUMN critical_block_approval TINYINT(1) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS critical_alerts (
  id                     BIGINT NOT NULL AUTO_INCREMENT,
  result_id              INT NOT NULL,
  sample_id              VARCHAR(60) NOT NULL,
  branch_id              INT NULL,
  patient_id             INT NULL,
  report_version         INT NOT NULL DEFAULT 1,
  parameters             JSON NOT NULL,             -- [{parameter, value, unit, flag, message}]
  status                 ENUM('Open','Acknowledged','Cleared') NOT NULL DEFAULT 'Open',
  notify_within_minutes  INT NOT NULL DEFAULT 30,
  block_approval         TINYINT(1) NOT NULL DEFAULT 1,
  raised_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  acknowledged_at        TIMESTAMP NULL,
  acknowledged_by_name   VARCHAR(200) NULL,         -- the clinician who acknowledged
  cleared_at             TIMESTAMP NULL,
  cleared_reason         VARCHAR(200) NULL,
  PRIMARY KEY (id),
  KEY idx_ca_result (result_id, status),
  KEY idx_ca_branch_status (branch_id, status, raised_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per attempt to reach the clinician — append-only.
CREATE TABLE IF NOT EXISTS critical_notifications (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  alert_id          BIGINT NOT NULL,
  method            ENUM('Phone','In person','SMS','WhatsApp','Email','Other') NOT NULL,
  outcome           ENUM('Acknowledged','No answer','Left message') NOT NULL,
  notified_to_name  VARCHAR(200) NULL,
  notified_to_role  VARCHAR(100) NULL,
  read_back         TINYINT(1) NOT NULL DEFAULT 0,   -- recipient repeated the values back
  recorded_by       INT NULL,
  recorded_by_name  VARCHAR(200) NULL,
  recorded_role     VARCHAR(50) NULL,
  note              VARCHAR(500) NULL,
  notified_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ip_address        VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_cn_alert (alert_id, notified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS critical_notifications_no_update;
DROP TRIGGER IF EXISTS critical_notifications_no_delete;
CREATE TRIGGER critical_notifications_no_update BEFORE UPDATE ON critical_notifications
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'critical_notifications is append-only';
CREATE TRIGGER critical_notifications_no_delete BEFORE DELETE ON critical_notifications
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'critical_notifications is append-only';

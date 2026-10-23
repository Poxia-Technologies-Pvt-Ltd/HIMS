-- Module 14 Equipment Management: preventive-maintenance schedules, due /
-- overdue alerts and a service history per analyzer. Overdue equipment only
-- WARNS (worklists, alert lists) — it never blocks testing.
CREATE TABLE IF NOT EXISTS equipment_pm_schedules (
  id               INT NOT NULL AUTO_INCREMENT,
  machine_id       INT NOT NULL,                       -- lab_machines.id
  task_name        VARCHAR(120) NOT NULL,
  task_type        ENUM('Preventive maintenance','Calibration','Quality control','Cleaning','Other') NOT NULL DEFAULT 'Preventive maintenance',
  frequency_unit   ENUM('Day','Week','Month','Year') NOT NULL,
  frequency_every  INT NOT NULL DEFAULT 1,
  warn_days_before INT NOT NULL DEFAULT 7,             -- start showing "due soon" this many days ahead
  last_done_at     DATE NULL,
  next_due_at      DATE NOT NULL,
  instructions     VARCHAR(500) NULL,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by       INT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pm_machine (machine_id, active),
  KEY idx_pm_due (active, next_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- What was actually done, by whom — append-only service history.
CREATE TABLE IF NOT EXISTS equipment_maintenance_log (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  machine_id        INT NOT NULL,
  schedule_id       INT NULL,
  task_name         VARCHAR(120) NOT NULL,
  task_type         VARCHAR(40) NOT NULL,
  performed_at      DATETIME NOT NULL,
  performed_by      INT NULL,
  performed_by_name VARCHAR(200) NOT NULL,
  outcome           ENUM('Completed','Completed with issues','Not completed') NOT NULL DEFAULT 'Completed',
  notes             VARCHAR(1000) NULL,
  parts_used        VARCHAR(500) NULL,
  vendor            VARCHAR(200) NULL,                 -- external service engineer / company, if any
  was_overdue       TINYINT(1) NOT NULL DEFAULT 0,
  due_was           DATE NULL,
  next_due_after    DATE NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ml_machine (machine_id, performed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS equipment_log_no_update;
DROP TRIGGER IF EXISTS equipment_log_no_delete;
CREATE TRIGGER equipment_log_no_update BEFORE UPDATE ON equipment_maintenance_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipment_maintenance_log is append-only';
CREATE TRIGGER equipment_log_no_delete BEFORE DELETE ON equipment_maintenance_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipment_maintenance_log is append-only';

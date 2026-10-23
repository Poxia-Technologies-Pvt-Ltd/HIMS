-- Spec item "Queue and Patient Flow Management" #1: token/queue generation
-- and status tracking for sample collection (registration was deliberately
-- left out of the queue).
--
-- Until now the "queue number" was computed on the fly per request
-- (labController.getWorklist / billingController WhatsApp message) — never
-- stored, so it could shift as the day's list changed, and there was no
-- status lifecycle. The pre-existing
-- queue_tokens table is doctor/department/appointment-shaped and unused, so
-- this is a separate, purpose-built engine rather than a repurposing of it.
--
-- Numbers come from an atomic per-branch/day/service-point counter
-- (queue_token_sequences), same LAST_INSERT_ID idiom as patient_reg_sequences.

CREATE TABLE IF NOT EXISTS queue_token_sequences (
  branch_id     INT NOT NULL,
  token_date    DATE NOT NULL,
  service_point ENUM('Sample Collection') NOT NULL,
  last_seq      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, token_date, service_point)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS patient_queue_tokens (
  id             INT NOT NULL AUTO_INCREMENT,
  branch_id      INT NOT NULL,
  token_date     DATE NOT NULL,
  service_point  ENUM('Sample Collection') NOT NULL,
  token_number   VARCHAR(20) NOT NULL,          -- plain running number, e.g. 34
  seq            INT NOT NULL,
  patient_reg_no VARCHAR(50) NULL,
  patient_name   VARCHAR(200) NULL,
  bill_id        INT NULL,
  priority       ENUM('Routine','Urgent','STAT') NOT NULL DEFAULT 'Routine',
  status         ENUM('Waiting','Called','In Service','Completed','Skipped','Cancelled') NOT NULL DEFAULT 'Waiting',
  counter        VARCHAR(50) NULL,              -- counter/desk that called it
  issued_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by      INT NULL,
  called_at      TIMESTAMP NULL,
  called_by      INT NULL,
  started_at     TIMESTAMP NULL,
  completed_at   TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token (branch_id, token_date, service_point, token_number),
  KEY idx_pqt_branch_day (branch_id, token_date, service_point, status),
  KEY idx_pqt_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

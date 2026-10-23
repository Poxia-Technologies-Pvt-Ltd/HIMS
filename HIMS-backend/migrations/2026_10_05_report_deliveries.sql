-- Report delivery tracking (tender #43, #44, #51, #52).
--
-- One row per attempt to put an authorised report in front of someone:
-- WhatsApp / e-mail sends, kiosk views and prints, patient-portal downloads,
-- HMIS pushes. Failed sends stay visible with their error so staff can resend
-- from the Report Delivery page; provider_message_id lets a provider webhook
-- (WhatsApp Cloud API) move a row on to Delivered / Read / Failed later.
--
-- patients.report_consent: NULL = not asked yet (treated as consent, the
-- pre-existing behaviour), 1 = agreed, 0 = refused digital delivery. A refusal
-- blocks WhatsApp/e-mail sends; the patient can still collect at the counter.

CREATE TABLE IF NOT EXISTS report_deliveries (
  id                  BIGINT NOT NULL AUTO_INCREMENT,
  sample_id           VARCHAR(60) NOT NULL,
  patient_id          INT NULL,
  branch_id           INT NULL,
  channel             ENUM('WhatsApp','Email','SMS','Kiosk view','Kiosk print','Portal download','HMIS push','Staff download') NOT NULL,
  recipient           VARCHAR(200) NULL,
  status              ENUM('Queued','Sent','Delivered','Read','Failed','Blocked') NOT NULL DEFAULT 'Queued',
  error               VARCHAR(500) NULL,
  provider            VARCHAR(40) NULL,
  provider_message_id VARCHAR(120) NULL,
  triggered_by        ENUM('Auto','Staff','Patient kiosk','Patient portal','Lobby board') NOT NULL,
  actor_id            INT NULL,
  actor_name          VARCHAR(200) NULL,
  ip_address          VARCHAR(64) NULL,
  resend_of           BIGINT NULL,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_rd_sample (sample_id),
  KEY idx_rd_status (status, created_at),
  KEY idx_rd_branch (branch_id, created_at),
  KEY idx_rd_provider_msg (provider_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE patients
  ADD COLUMN report_consent TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN report_consent_at DATETIME NULL DEFAULT NULL;

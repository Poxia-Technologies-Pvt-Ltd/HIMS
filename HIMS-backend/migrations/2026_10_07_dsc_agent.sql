-- Poxia DSC Agent (tender #36): doctors sign with the DSC on their own USB token.
-- The private key never leaves the token. The server prepares the report PDF and
-- the exact bytes to be signed; the agent on the doctor's PC signs them with the
-- token (after the doctor types the PIN locally) and the server assembles and
-- verifies the PDF signature, then releases the report.

-- A report waits as 'Pending' (signature created, not yet effective) until the
-- signed PDF is back; an abandoned attempt becomes 'Cancelled'.
ALTER TABLE report_signatures
  MODIFY COLUMN status ENUM('Valid','Revoked','Pending','Cancelled') NOT NULL DEFAULT 'Valid';

-- The certificate a doctor's token presented (public part only), recorded the
-- first time they sign and required to match afterwards.
ALTER TABLE user_dsc_certificates
  MODIFY COLUMN kind ENUM('Doctor','Hospital','Token') NOT NULL DEFAULT 'Doctor',
  MODIFY COLUMN p12_blob MEDIUMBLOB NULL,
  ADD COLUMN cert_der MEDIUMBLOB NULL,
  ADD COLUMN fingerprint CHAR(64) NULL,
  ADD COLUMN token_info VARCHAR(200) NULL,
  ADD KEY idx_dsc_fingerprint (fingerprint);

-- Per hospital: authorising a report is done with the doctor's USB token.
ALTER TABLE branch_signing_settings
  ADD COLUMN use_agent TINYINT(1) NOT NULL DEFAULT 0;

-- One row per signing attempt.
CREATE TABLE IF NOT EXISTS dsc_signing_jobs (
  id            CHAR(36) NOT NULL,
  result_id     INT NOT NULL,
  sample_id     VARCHAR(60) NOT NULL,
  branch_id     INT NULL,
  doctor_id     INT NOT NULL,
  signature_id  BIGINT NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  status        ENUM('Created','Prepared','Completing','Completed','Failed','Cancelled','Expired') NOT NULL DEFAULT 'Created',
  notes         VARCHAR(1000) NULL,
  approved_at   DATETIME(3) NOT NULL,
  summary       JSON NULL,
  pdf_unsigned  LONGBLOB NULL,
  pdf_sha256    CHAR(64) NULL,
  prepared_pdf  LONGBLOB NULL,
  attrs_der     BLOB NULL,
  hex_start     INT NULL,
  hex_end       INT NULL,
  signing_time  DATETIME(3) NULL,
  cert_der      MEDIUMBLOB NULL,
  chain_json    MEDIUMTEXT NULL,
  dsc_id        INT NULL,
  message       VARCHAR(500) NULL,
  agent_info    VARCHAR(300) NULL,
  ip_address    VARCHAR(64) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME NOT NULL,
  completed_at  DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_dsj_result (result_id, status),
  KEY idx_dsj_doctor (doctor_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

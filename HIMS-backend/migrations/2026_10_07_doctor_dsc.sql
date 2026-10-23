-- Doctors' Digital Signature Certificates (tender #36).
-- A hospital admin uploads a doctor's certificate (.pfx / .p12) for that hospital.
-- The file is stored exactly as issued — protected by its own password, which is
-- NEVER stored: the doctor types it each time they authorise a report. When a
-- report is authorised, the server signs it with the doctor's certificate and
-- keeps the signed PDF, so every later copy is that same signed document.
CREATE TABLE IF NOT EXISTS user_dsc_certificates (
  id           INT NOT NULL AUTO_INCREMENT,
  user_id      INT NOT NULL,
  branch_id    INT NULL,
  p12_blob     MEDIUMBLOB NOT NULL,
  common_name  VARCHAR(200) NULL,
  subject      VARCHAR(500) NULL,
  issuer       VARCHAR(500) NULL,
  serial       VARCHAR(100) NULL,
  valid_from   DATETIME NULL,
  valid_to     DATETIME NULL,
  status       ENUM('Active','Revoked') NOT NULL DEFAULT 'Active',
  uploaded_by  INT NULL,
  uploaded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by   INT NULL,
  revoked_at   TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_dsc_user (user_id, status),
  KEY idx_dsc_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The signed PDF produced when a doctor authorised a report.
CREATE TABLE IF NOT EXISTS signed_reports (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  signature_id  BIGINT NOT NULL,
  result_id     INT NOT NULL,
  sample_id     VARCHAR(60) NOT NULL,
  branch_id     INT NULL,
  dsc_id        INT NOT NULL,
  signer_id     INT NOT NULL,
  pdf           LONGBLOB NOT NULL,
  pdf_sha256    CHAR(64) NOT NULL,
  signed_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sr_signature (signature_id),
  KEY idx_sr_sample (sample_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Per-hospital policy: must a doctor have a DSC to authorise reports?
CREATE TABLE IF NOT EXISTS branch_signing_settings (
  branch_id   INT NOT NULL,
  require_dsc TINYINT(1) NOT NULL DEFAULT 0,
  updated_by  INT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

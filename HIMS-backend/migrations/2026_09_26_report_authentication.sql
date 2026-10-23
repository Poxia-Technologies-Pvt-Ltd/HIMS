-- Module 7 #3: electronic authentication of authorized reports, tied to the
-- authorizing doctor's own login.
--
-- * Each authorizing doctor keeps a signature profile on their user record:
--   medical registration number, designation and signature image.
-- * Authorizing a result requires the doctor to re-enter their login password
--   ("sign with your credentials"). A report_signatures row then records who
--   signed, when, from where, and a SHA-256 of the report content, sealed with
--   an HMAC only the server can produce.
-- * The printed report carries the signature, registration number and a QR
--   that opens a public verification page: authentic / modified since signing.
ALTER TABLE users
  ADD COLUMN registration_no      VARCHAR(60)  NULL,
  ADD COLUMN designation          VARCHAR(100) NULL,
  ADD COLUMN signature_image      MEDIUMTEXT   NULL,
  ADD COLUMN signature_updated_at TIMESTAMP    NULL;

CREATE TABLE IF NOT EXISTS report_signatures (
  id                 BIGINT NOT NULL AUTO_INCREMENT,
  result_id          INT NOT NULL,
  sample_id          VARCHAR(60) NOT NULL,
  branch_id          INT NULL,
  signer_id          INT NOT NULL,
  signer_name        VARCHAR(200) NOT NULL,
  signer_role        VARCHAR(50) NULL,
  registration_no    VARCHAR(60) NOT NULL,
  designation        VARCHAR(100) NULL,
  signature_image    MEDIUMTEXT NULL,             -- the image exactly as printed on this report
  method             VARCHAR(60) NOT NULL DEFAULT 'Login password re-authentication',
  content_hash       CHAR(64) NOT NULL,           -- SHA-256 of the canonical report content
  seal               CHAR(64) NOT NULL,           -- HMAC-SHA256 over hash | signer | time (server secret)
  signed_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ip_address         VARCHAR(64) NULL,
  status             ENUM('Valid','Revoked') NOT NULL DEFAULT 'Valid',
  revoked_at         TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_rs_result (result_id, status),
  KEY idx_rs_sample (sample_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS report_signatures_no_delete;
CREATE TRIGGER report_signatures_no_delete BEFORE DELETE ON report_signatures
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'report_signatures cannot be deleted';

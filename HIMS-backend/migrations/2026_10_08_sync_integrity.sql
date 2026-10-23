-- Integrity of data sent by the LIS Agent (tender #111). Each request carries a SHA-256 of
-- its body; the server checks it, echoes it back, and keeps a record of every mismatch.
-- A result also keeps the checksum of the request that carried it.
CREATE TABLE IF NOT EXISTS sync_integrity_events (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  occurred_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  method         VARCHAR(10) NULL,
  path           VARCHAR(255) NULL,
  claimed_sha256 CHAR(64) NULL,
  actual_sha256  CHAR(64) NULL,
  body_bytes     INT NULL,
  ip_address     VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_sie_time (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE lab_test_result ADD COLUMN capture_sha256 CHAR(64) NULL;

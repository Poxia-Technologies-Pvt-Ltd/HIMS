-- One-time passwords for the patient portal, report retrieval and the clinician portal
-- (tender #41, #48), and the register of referring clinicians (tender #41).

CREATE TABLE IF NOT EXISTS portal_otps (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  audience    ENUM('patient','clinician','kiosk') NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  code_hash   CHAR(64) NOT NULL,
  channel     VARCHAR(20) NULL,
  expires_at  DATETIME NOT NULL,
  attempts    TINYINT NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  ip          VARCHAR(64) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_phone (audience, phone, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referring_clinicians (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  registration_no VARCHAR(60) NULL,
  phone           VARCHAR(20) NOT NULL,
  email           VARCHAR(150) NULL,
  facility        VARCHAR(200) NULL,
  name_aliases    VARCHAR(500) NULL COMMENT 'other spellings used on orders, separated by |',
  status          ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  last_login_at   DATETIME NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clinician_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

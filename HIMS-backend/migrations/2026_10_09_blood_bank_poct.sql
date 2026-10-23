-- Blood bank and point-of-care testing modules (tender #123).

CREATE TABLE IF NOT EXISTS bb_donors (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  donor_no           VARCHAR(30) NOT NULL UNIQUE,
  first_name         VARCHAR(80) NOT NULL,
  last_name          VARCHAR(80) NULL,
  gender             VARCHAR(10) NOT NULL,
  dob                DATE NOT NULL,
  phone              VARCHAR(20) NULL,
  address            VARCHAR(255) NULL,
  abo                ENUM('A','B','AB','O','Unknown') NOT NULL DEFAULT 'Unknown',
  rh                 ENUM('Pos','Neg','Unknown') NOT NULL DEFAULT 'Unknown',
  last_donation_date DATE NULL,
  deferred_until     DATE NULL,
  deferral_reason    VARCHAR(255) NULL,
  branch_id          INT NULL,
  created_by         INT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bbd_branch (branch_id), INDEX idx_bbd_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bb_units (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  unit_no         VARCHAR(40) NOT NULL UNIQUE,
  donor_id        INT NULL,
  parent_unit_id  INT NULL,
  component       ENUM('Whole Blood','PRBC','FFP','Platelets','Cryoprecipitate','Plasma') NOT NULL,
  abo             ENUM('A','B','AB','O','Unknown') NOT NULL DEFAULT 'Unknown',
  rh              ENUM('Pos','Neg','Unknown') NOT NULL DEFAULT 'Unknown',
  volume_ml       SMALLINT NULL,
  collected_at    DATETIME NOT NULL,
  expires_at      DATETIME NOT NULL,
  status          ENUM('Quarantine','Available','Reserved','Issued','Used','Discarded','Expired') NOT NULL DEFAULT 'Quarantine',
  tti_status      ENUM('Pending','Cleared','Reactive') NOT NULL DEFAULT 'Pending',
  tti_json        JSON NULL,
  screening_json  JSON NULL COMMENT 'haemoglobin, weight, blood pressure, pulse at donation',
  storage_location VARCHAR(80) NULL,
  discard_reason  VARCHAR(255) NULL,
  branch_id       INT NOT NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bbu_stock (branch_id, status, component, abo, rh), INDEX idx_bbu_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bb_requests (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  request_no      VARCHAR(40) NOT NULL UNIQUE,
  patient_id      INT NULL,
  patient_name    VARCHAR(160) NOT NULL,
  patient_abo     ENUM('A','B','AB','O','Unknown') NOT NULL DEFAULT 'Unknown',
  patient_rh      ENUM('Pos','Neg','Unknown') NOT NULL DEFAULT 'Unknown',
  ward            VARCHAR(80) NULL,
  clinician       VARCHAR(120) NULL,
  component       ENUM('Whole Blood','PRBC','FFP','Platelets','Cryoprecipitate','Plasma') NOT NULL,
  units_requested TINYINT NOT NULL DEFAULT 1,
  urgency         ENUM('Routine','Urgent','Emergency') NOT NULL DEFAULT 'Routine',
  indication      VARCHAR(255) NULL,
  status          ENUM('Requested','Ready','Partly issued','Issued','Cancelled') NOT NULL DEFAULT 'Requested',
  branch_id       INT NOT NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bbr_status (branch_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bb_issues (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  request_id    INT NOT NULL,
  unit_id       INT NOT NULL,
  crossmatch    ENUM('Compatible','Incompatible','Not done (emergency)') NOT NULL,
  override_reason VARCHAR(255) NULL,
  issued_to     VARCHAR(120) NULL,
  issued_by     INT NULL,
  issued_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome       ENUM('Issued','Transfused','Returned','Wasted') NOT NULL DEFAULT 'Issued',
  outcome_at    DATETIME NULL,
  notes         VARCHAR(255) NULL,
  branch_id     INT NOT NULL,
  INDEX idx_bbi_req (request_id), INDEX idx_bbi_unit (unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bb_reactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  issue_id    INT NOT NULL,
  unit_id     INT NOT NULL,
  patient_name VARCHAR(160) NULL,
  reaction_type VARCHAR(80) NOT NULL,
  severity    ENUM('Mild','Moderate','Severe','Fatal') NOT NULL,
  details     VARCHAR(500) NULL,
  reported_by INT NULL,
  reported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  branch_id   INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Point-of-care testing
CREATE TABLE IF NOT EXISTS poct_devices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  branch_id   INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  model       VARCHAR(120) NULL,
  serial_no   VARCHAR(80) NULL,
  location    VARCHAR(120) NULL,
  tests       VARCHAR(500) NULL COMMENT 'comma separated test names this device runs',
  status      ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  qc_interval_hours SMALLINT NOT NULL DEFAULT 24,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pd_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS poct_operators (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  device_id    INT NOT NULL,
  user_id      INT NOT NULL,
  certified_until DATE NOT NULL,
  UNIQUE KEY uq_po (device_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS poct_qc (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  device_id    INT NOT NULL,
  level        VARCHAR(30) NOT NULL,
  lot_no       VARCHAR(60) NULL,
  expected     VARCHAR(60) NULL,
  observed     VARCHAR(60) NULL,
  passed       TINYINT(1) NOT NULL,
  note         VARCHAR(255) NULL,
  performed_by INT NULL,
  performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pq_dev (device_id, performed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS poct_results (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  branch_id    INT NOT NULL,
  device_id    INT NOT NULL,
  patient_id   INT NULL,
  patient_name VARCHAR(160) NOT NULL,
  test_name    VARCHAR(120) NOT NULL,
  lot_no       VARCHAR(60) NULL,
  value        VARCHAR(60) NOT NULL,
  unit         VARCHAR(30) NULL,
  ref_low      DECIMAL(12,3) NULL,
  ref_high     DECIMAL(12,3) NULL,
  crit_low     DECIMAL(12,3) NULL,
  crit_high    DECIMAL(12,3) NULL,
  flag         ENUM('Normal','Low','High','Critical low','Critical high','Qualitative') NOT NULL DEFAULT 'Normal',
  qc_override_reason VARCHAR(255) NULL,
  comment      VARCHAR(255) NULL,
  performed_by INT NULL,
  performed_by_name VARCHAR(160) NULL,
  performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_branch (branch_id, performed_at), INDEX idx_pr_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

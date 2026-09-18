-- Fixes two gaps in patient registration found during the procurement-spec
-- audit (spec item #1: "unique patient registration with configurable
-- identifiers and demographic fields"):
--
-- 1. reg_no used to be generated client-side as 'REG-' + a random 5-digit
--    number (HIMS-frontend PatientDetails.jsx), with no server-side retry on
--    collision — just a generic 400 on ER_DUP_ENTRY. patient_reg_sequences
--    backs a real atomic per-branch-per-year counter (see registerPatient in
--    patientController.js), collision-free by construction instead of by luck.
--
-- 2. Demographic fields were hardcoded SQL columns with no admin control
--    over which are required/shown, and no way to add a new field without a
--    schema change. patient_field_config lets an Admin toggle existing
--    fields and define new custom ones; patient_custom_field_values stores
--    values for the custom (non-column) fields as key/value pairs, since
--    those don't get their own patients column.

CREATE TABLE IF NOT EXISTS patient_reg_sequences (
  branch_id INT NOT NULL,
  year      INT NOT NULL,
  last_seq  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS patient_field_config (
  id            INT NOT NULL AUTO_INCREMENT,
  field_key     VARCHAR(100) NOT NULL,
  label         VARCHAR(150) NOT NULL,
  -- 'system' fields map to a real patients.<column> (firstName, dob, ...);
  -- 'custom' fields are admin-defined and live in patient_custom_field_values.
  field_source  ENUM('system','custom') NOT NULL DEFAULT 'custom',
  field_type    ENUM('text','textarea','number','date','select','checkbox') NOT NULL DEFAULT 'text',
  options_json  JSON DEFAULT NULL,              -- for field_type = 'select'
  is_required   TINYINT(1) NOT NULL DEFAULT 0,
  is_enabled    TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS patient_custom_field_values (
  id         INT NOT NULL AUTO_INCREMENT,
  patient_id INT NOT NULL,
  field_key  VARCHAR(100) NOT NULL,
  value      TEXT,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_patient_field (patient_id, field_key),
  CONSTRAINT fk_pcfv_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed the 'system' rows for every field already on the registration form,
-- so Machine Master-style admin UI has something to toggle from day one.
-- required/enabled here mirror current hardcoded behavior (first_name,
-- last_name are NOT NULL columns -> required; everything else optional).
INSERT IGNORE INTO patient_field_config (field_key, label, field_source, field_type, is_required, is_enabled, display_order) VALUES
  ('title',            'Title',                'system', 'text', 0, 1, 10),
  ('firstName',        'First Name',           'system', 'text', 1, 1, 20),
  ('middleName',       'Middle Name',          'system', 'text', 0, 1, 30),
  ('lastName',         'Last Name',            'system', 'text', 1, 1, 40),
  ('dob',              'Date of Birth',        'system', 'date', 0, 1, 50),
  ('gender',           'Gender',               'system', 'select', 0, 1, 60),
  ('aadharNumber',     'Aadhar Number',        'system', 'text', 0, 1, 70),
  ('abhaId',           'ABHA Number',          'system', 'text', 0, 1, 80),
  ('maritalStatus',    'Marital Status',       'system', 'text', 0, 1, 90),
  ('occupation',       'Occupation',           'system', 'text', 0, 1, 100),
  ('language',         'Language',             'system', 'text', 0, 1, 110),
  ('educationLevel',   'Education Level',      'system', 'text', 0, 1, 120),
  ('religion',         'Religion',             'system', 'text', 0, 1, 130),
  ('citizen',          'Citizenship',          'system', 'text', 0, 1, 140),
  ('emailId',          'Email ID',             'system', 'text', 0, 1, 150),
  ('telephone',        'Telephone',            'system', 'text', 0, 1, 160),
  ('address',          'Address',              'system', 'textarea', 0, 1, 170),
  ('suburb',           'Suburb',               'system', 'text', 0, 1, 180),
  ('city',             'City',                 'system', 'text', 0, 1, 190),
  ('country',          'Country',              'system', 'text', 0, 1, 200),
  ('postalCode',       'Postal Code',          'system', 'text', 0, 1, 210),
  ('kinName',          'Next of Kin Name',     'system', 'text', 0, 1, 220),
  ('kinRelation',      'Next of Kin Relation', 'system', 'text', 0, 1, 230),
  ('kinTelephone',     'Next of Kin Telephone','system', 'text', 0, 1, 240),
  ('kinAddress',       'Next of Kin Address',  'system', 'text', 0, 1, 250),
  ('payerType',        'Payer Type',           'system', 'text', 0, 1, 260),
  ('insuranceProvider','Insurance Provider',   'system', 'text', 0, 1, 270),
  ('policyNumber',     'Policy Number',        'system', 'text', 0, 1, 280);

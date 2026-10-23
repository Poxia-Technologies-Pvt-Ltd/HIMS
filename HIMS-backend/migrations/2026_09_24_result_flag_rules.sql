-- Module 6 #5: flagging of abnormal, critical, delta-check and technically
-- invalid results by CONFIGURABLE rules.
--
-- Per-parameter rules live on lab_test_parameters (edited in Test Management);
-- facility-wide defaults live in result_flag_settings. Critical limits are
-- deliberately NOT pre-filled: they are clinical decisions each laboratory
-- must set and sign off.
ALTER TABLE lab_test_parameters
  ADD COLUMN critical_low    DECIMAL(12,3) NULL,
  ADD COLUMN critical_high   DECIMAL(12,3) NULL,
  ADD COLUMN measurable_min  DECIMAL(12,3) NULL,   -- below this the reading is instrument noise / invalid
  ADD COLUMN measurable_max  DECIMAL(12,3) NULL,   -- above this the reading is out of the analytical range
  ADD COLUMN delta_percent   DECIMAL(6,2)  NULL,   -- flag if it moved more than this % since the previous result
  ADD COLUMN delta_absolute  DECIMAL(12,3) NULL,   -- ...or by more than this absolute amount
  ADD COLUMN delta_days      INT NULL;             -- only compare with results this recent

-- Roll-ups so worklists / verification can show and filter flagged results
-- without opening every result.
ALTER TABLE lab_test_result
  ADD COLUMN has_abnormal TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN has_critical TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN has_invalid  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN has_delta    TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS result_flag_settings (
  setting_key   VARCHAR(60) NOT NULL,
  setting_value VARCHAR(500) NULL,
  description   VARCHAR(255) NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO result_flag_settings (setting_key, setting_value, description) VALUES
  ('invalid_tokens',       '---,--,ERR,ERROR,OVER,INVALID,N/A,NA,NULL', 'Values an analyzer prints when it could not measure (all-asterisk / all-dash values are always invalid).'),
  ('invalid_analyzer_flags','OVER,ERR,ERROR,INVALID,E',                  'Analyzer flag codes that mean the reading is technically invalid.'),
  ('delta_enabled',        '1',                                          'Turn delta checks on (1) or off (0).'),
  ('delta_default_days',   '30',                                         'Compare with the patient''s previous result only if it is at most this many days old.'),
  ('delta_default_percent','50',                                         'Default delta limit (% change) for parameters with no delta rule of their own. Blank = no default.'),
  ('kids_max_age_years',   '12',                                         'Patients younger than this use the Children reference range.'),
  ('trust_analyzer_alerts','1',                                          'If no reference range is configured, fall back to the analyzer''s own H / L flag.');

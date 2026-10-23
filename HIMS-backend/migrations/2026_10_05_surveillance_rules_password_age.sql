-- Disease surveillance rules (tender #95-102).
--
-- The heatmap is now computed from approved lab results: each row here names a
-- notifiable disease, the lab tests that detect it (regex on lab_tests.test_name)
-- and the Government-approved thresholds that turn a positive-case count in the
-- selected window into LOW / MEDIUM / HIGH for a district. rise_alert_percent is
-- the window-on-window rise that raises an "emerging cluster" alert.
-- disease_surveillance (the older manual table) is still read, as an extra feed
-- for counts that come from outside this LIMS (e.g. IDSP), for Karnataka
-- districts only.

CREATE TABLE IF NOT EXISTS surveillance_diseases (
  id                 INT NOT NULL AUTO_INCREMENT,
  disease            VARCHAR(100) NOT NULL,
  test_pattern       VARCHAR(200) NOT NULL,
  medium_threshold   INT NOT NULL DEFAULT 5,
  high_threshold     INT NOT NULL DEFAULT 15,
  rise_alert_percent INT NOT NULL DEFAULT 50,
  cluster_min_cases  INT NOT NULL DEFAULT 3,
  active             TINYINT(1) NOT NULL DEFAULT 1,
  updated_by         INT NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_disease (disease)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO surveillance_diseases (disease, test_pattern, medium_threshold, high_threshold) VALUES
  ('Dengue',          'dengue',                              5, 15),
  ('Malaria',         'malaria|\\bMP\\b',                    3, 10),
  ('Typhoid',         'widal|typhoid|typhi',                 5, 15),
  ('Chikungunya',     'chikungunya',                         3, 10),
  ('Leptospirosis',   'lepto',                               2,  6),
  ('Scrub Typhus',    'scrub|tsutsugamushi',                 2,  6),
  ('Hepatitis A/E',   'hepatitis a|hepatitis e|\\bhav\\b|\\bhev\\b', 3, 10),
  ('Tuberculosis',    'tubercul|\\bafb\\b|cbnaat|genexpert|truenat', 3, 10),
  ('Cholera',         'cholera|vibrio',                      1,  3);

-- Password ageing (tender #107): when the password was last set, so login can
-- force a change once it is older than PASSWORD_MAX_AGE_DAYS.
ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL;

-- User deactivation (tender #107). The developer panel's activate/deactivate
-- toggle already writes users.is_active, but the column was never created, so
-- the toggle failed; login now refuses an account with is_active = 0.
ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;

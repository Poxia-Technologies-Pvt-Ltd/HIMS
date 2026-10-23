-- Analyzer breakdown → rerouted samples → final report (tender #18).
-- A breakdown ticket keeps the list of samples it affected and what became of each:
-- sent to another lab or hospital (the referral), moved to another analyzer, or held
-- until the repair — and, for each, whether the final report has been released.
CREATE TABLE IF NOT EXISTS equipment_ticket_samples (
  id              INT NOT NULL AUTO_INCREMENT,
  ticket_id       INT NOT NULL,
  sample_id       VARCHAR(60) NOT NULL,
  branch_id       INT NULL,
  action          ENUM('Referred','Moved to another analyzer','Held') NOT NULL,
  referral_id     INT NULL,
  alt_machine_id  INT NULL,
  note            VARCHAR(300) NULL,
  linked_by       INT NULL,
  linked_by_name  VARCHAR(200) NULL,
  linked_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_sample (ticket_id, sample_id),
  KEY idx_ets_sample (sample_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE sample_referrals ADD COLUMN ticket_id INT NULL;

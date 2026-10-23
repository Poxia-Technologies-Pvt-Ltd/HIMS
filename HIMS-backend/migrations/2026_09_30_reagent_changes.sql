-- Module 14 Equipment Management: reagent changes on analyzers.
-- Every reagent / consumable load is an append-only row (lot, expiry, who,
-- when, what it replaced). The current reagent per analyzer is the latest row
-- per reagent name; expired or nearly-expired reagents WARN on the worklists
-- and alert lists but never block testing. Each result also keeps a snapshot
-- of the lots on the analyzer when it was produced, for traceability.
CREATE TABLE IF NOT EXISTS equipment_reagent_changes (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  machine_id       INT NOT NULL,                       -- lab_machines.id
  reagent_name     VARCHAR(150) NOT NULL,
  lot_no           VARCHAR(80) NOT NULL,
  manufacturer     VARCHAR(120) NULL,
  slot             VARCHAR(60) NULL,                   -- position / channel on the analyzer
  expiry_date      DATE NOT NULL,
  opened_on        DATE NOT NULL,                      -- date the pack was put on board
  stability_days   INT NULL,                           -- on-board stability once opened, if the maker gives one
  replaced_lot_no  VARCHAR(80) NULL,                   -- the lot that was on board before
  changed_at       DATETIME NOT NULL,
  changed_by       INT NULL,
  changed_by_name  VARCHAR(200) NOT NULL,
  reason           ENUM('Empty','Expired','New lot','On-board stability','QC failure','Other') NOT NULL DEFAULT 'Empty',
  notes            VARCHAR(500) NULL,
  loaded_expired   TINYINT(1) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_rc_machine (machine_id, reagent_name, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS reagent_changes_no_update;
DROP TRIGGER IF EXISTS reagent_changes_no_delete;
CREATE TRIGGER reagent_changes_no_update BEFORE UPDATE ON equipment_reagent_changes
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipment_reagent_changes is append-only';
CREATE TRIGGER reagent_changes_no_delete BEFORE DELETE ON equipment_reagent_changes
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipment_reagent_changes is append-only';

ALTER TABLE lab_test_result ADD COLUMN reagent_lots JSON NULL;

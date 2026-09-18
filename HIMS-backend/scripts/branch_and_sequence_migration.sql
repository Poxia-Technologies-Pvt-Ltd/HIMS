-- ============================================================
-- Migration: Branch isolation + atomic lab sample sequence
-- ============================================================

-- 1. Atomic sample ID sequence table (per branch, per department range, per day)
DROP TABLE IF EXISTS `lab_sample_sequences`;
CREATE TABLE `lab_sample_sequences` (
  `branch_id` INT          NOT NULL,
  `seq_date`  DATE         NOT NULL,
  `dept_key`  VARCHAR(10)  NOT NULL DEFAULT '7000',
  `last_seq`  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`branch_id`, `seq_date`, `dept_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Helper procedure: add a column only if it doesn't exist
DROP PROCEDURE IF EXISTS add_col_if_missing;
DELIMITER //
CREATE PROCEDURE add_col_if_missing(
  IN tbl VARCHAR(64), IN col VARCHAR(64), IN col_def VARCHAR(128)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = tbl
      AND column_name  = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_col_if_missing('appointments',     'branch_id', 'INT NULL DEFAULT NULL');
CALL add_col_if_missing('departments',      'branch_id', 'INT NULL DEFAULT NULL');
CALL add_col_if_missing('duty_schedules',   'branch_id', 'INT NULL DEFAULT NULL');
CALL add_col_if_missing('billing_packages', 'branch_id', 'INT NULL DEFAULT NULL');

DROP PROCEDURE IF EXISTS add_col_if_missing;

-- 3. Helper procedure: add an index only if it doesn't exist
DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER //
CREATE PROCEDURE add_index_if_missing(
  IN tbl VARCHAR(64), IN idx VARCHAR(64), IN col VARCHAR(64)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = tbl
      AND index_name   = idx
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (`', col, '`)');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_index_if_missing('appointments',     'idx_appointments_branch',     'branch_id');
CALL add_index_if_missing('departments',      'idx_departments_branch',      'branch_id');
CALL add_index_if_missing('duty_schedules',   'idx_duty_branch',             'branch_id');
CALL add_index_if_missing('billing_packages', 'idx_billing_packages_branch', 'branch_id');

DROP PROCEDURE IF EXISTS add_index_if_missing;

-- ============================================================
-- Backfill existing rows to branch_id = 1 (main branch)
-- ============================================================
UPDATE `appointments`     SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE `departments`      SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE `duty_schedules`   SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE `billing_packages` SET branch_id = 1 WHERE branch_id IS NULL;

-- Migration: Add branch_id to AP invoices and purchase suggestions tables

DROP PROCEDURE IF EXISTS add_col_if_missing;
DELIMITER //
CREATE PROCEDURE add_col_if_missing(
  IN tbl VARCHAR(64), IN col VARCHAR(64), IN col_def VARCHAR(128)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_col_if_missing('inventory_supplier_invoices',   'branch_id', 'INT NULL DEFAULT NULL');
CALL add_col_if_missing('inventory_payments',            'branch_id', 'INT NULL DEFAULT NULL');
CALL add_col_if_missing('inventory_purchase_suggestions','branch_id', 'INT NULL DEFAULT NULL');

DROP PROCEDURE IF EXISTS add_col_if_missing;

UPDATE `inventory_supplier_invoices`    SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE `inventory_payments`             SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE `inventory_purchase_suggestions` SET branch_id = 1 WHERE branch_id IS NULL;

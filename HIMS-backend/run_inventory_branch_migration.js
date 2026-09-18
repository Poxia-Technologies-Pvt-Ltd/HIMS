import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const runMigration = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: true
  });

  const sql = `
    -- ============================================
    -- INVENTORY MULTI-BRANCH MIGRATION
    -- Adds branch_id to purchase and goods receipt tables
    -- ============================================

    SET @dbname = DATABASE();

    -- Add branch_id to purchase_requisitions
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'purchase_requisitions' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE purchase_requisitions ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_pr_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add branch_id to purchase_orders
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE purchase_orders ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_po_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add branch_id to goods_receipts
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'goods_receipts' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE goods_receipts ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_grn_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Ensure inventory_batches has branch_id (may already exist)
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'inventory_batches' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE inventory_batches ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_batches_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Ensure inventory_transactions has branch_id (may already exist)
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'inventory_transactions' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE inventory_transactions ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_transactions_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Update existing records to use default branch (1)
    UPDATE purchase_requisitions SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE purchase_orders SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE goods_receipts SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE inventory_batches SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE inventory_transactions SET branch_id = 1 WHERE branch_id IS NULL;
  `;

  try {
    console.log('Executing inventory multi-branch migration...');
    await connection.query(sql);
    console.log('✅ Migration successful! Inventory tables are now Multi-Branch enabled.');
    console.log('Tables updated: purchase_requisitions, purchase_orders, goods_receipts, inventory_batches, inventory_transactions');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await connection.end();
  }
};

runMigration();

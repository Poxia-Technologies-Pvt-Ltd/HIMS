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
    multipleStatements: false // Change to false for safer execution
  });

  const dbName = process.env.DB_NAME || 'meril-hims';
  
  // Tables that need branch_id
  const tablesToAlter = [
    'purchase_requisitions',
    'purchase_orders', 
    'goods_receipts',
    'inventory_batches',
    'inventory_transactions'
  ];

  console.log('Checking existing tables...');
  
  try {
    // Get list of existing tables
    const [existingTables] = await connection.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [dbName, tablesToAlter]
    );
    
    const existingTableNames = existingTables.map(t => t.TABLE_NAME);
    console.log('Found tables:', existingTableNames.join(', ') || 'None');
    
    if (existingTableNames.length === 0) {
      console.log('⚠️ No inventory tables found in database. Please run the main schema first.');
      console.log('File to import: /Users/stevejeraldicloud.com/Desktop/HMIS/meril-hims.sql');
      process.exit(0);
    }

    // Process each existing table
    for (const tableName of existingTableNames) {
      try {
        // Check if branch_id column already exists
        const [columns] = await connection.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'branch_id'`,
          [dbName, tableName]
        );
        
        if (columns.length > 0) {
          console.log(`✓ ${tableName}: branch_id column already exists`);
        } else {
          // Add branch_id column
          await connection.query(
            `ALTER TABLE ${tableName} 
             ADD COLUMN branch_id INT DEFAULT 1,
             ADD CONSTRAINT fk_${tableName.substring(0, 20)}_branch 
             FOREIGN KEY (branch_id) REFERENCES branches(id)`
          );
          console.log(`✓ ${tableName}: Added branch_id column`);
        }
        
        // Update NULL branch_ids to default (1)
        const [updateResult] = await connection.query(
          `UPDATE ${tableName} SET branch_id = 1 WHERE branch_id IS NULL`
        );
        if (updateResult.affectedRows > 0) {
          console.log(`  → Updated ${updateResult.affectedRows} rows to branch_id = 1`);
        }
        
      } catch (tableErr) {
        console.error(`❌ Error with ${tableName}:`, tableErr.message);
        // Continue with next table
      }
    }
    
    console.log('\n✅ Migration completed!');
    console.log('Tables processed:', existingTableNames.join(', '));
    
    // Show missing tables
    const missingTables = tablesToAlter.filter(t => !existingTableNames.includes(t));
    if (missingTables.length > 0) {
      console.log('\n⚠️ Missing tables (not in database):', missingTables.join(', '));
    }
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await connection.end();
  }
};

runMigration();

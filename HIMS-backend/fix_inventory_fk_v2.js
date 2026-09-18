import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const fixForeignKeys = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: false
  });

  console.log('🔧 Fixing inventory table foreign keys...\n');
  
  const tablesToFix = ['inventory_batches', 'inventory_transactions'];
  
  try {
    // Disable FK checks temporarily
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✓ Foreign key checks disabled');
    
    for (const table of tablesToFix) {
      console.log(`\n📋 Processing ${table}...`);
      
      try {
        // Drop ALL existing FK constraints on branch_id
        const [constraints] = await connection.query(`
          SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME 
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ? 
          AND COLUMN_NAME = 'branch_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [table]);
        
        for (const constraint of constraints) {
          console.log(`  → Dropping FK ${constraint.CONSTRAINT_NAME} (pointed to ${constraint.REFERENCED_TABLE_NAME})`);
          await connection.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${constraint.CONSTRAINT_NAME}`);
        }
        
        // Set all branch_ids to 1 (or NULL if they don't exist)
        await connection.query(`UPDATE ${table} SET branch_id = 1`);
        console.log(`  → Set all branch_ids to 1`);
        
        // Add correct FK pointing to branches(id)
        const fkName = `fk_${table.substring(0, 15)}_branch`;
        console.log(`  → Adding FK ${fkName} -> branches(id)`);
        await connection.query(`
          ALTER TABLE ${table} 
          ADD CONSTRAINT ${fkName} 
          FOREIGN KEY (branch_id) REFERENCES branches(id)
          ON DELETE SET NULL
        `);
        
        console.log(`  ✅ ${table} fixed`);
        
      } catch (err) {
        console.error(`  ❌ Error with ${table}:`, err.message);
      }
    }
    
    // Re-enable FK checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n✓ Foreign key checks re-enabled');
    console.log('\n✅ FK fix completed!');
    
  } catch (err) {
    console.error('❌ Failed:', err.message);
    // Try to re-enable FK checks even on error
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {}
  } finally {
    await connection.end();
  }
};

fixForeignKeys();

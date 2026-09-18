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
    // First, ensure we have a valid branch (id=1) in branches table
    const [branches] = await connection.query('SELECT id, branch_name FROM branches WHERE id = 1');
    if (branches.length === 0) {
      console.log('⚠️ Branch with id=1 not found in branches table');
      console.log('Creating default branch...');
      await connection.query(`
        INSERT INTO branches (id, branch_name, branch_code, status) 
        VALUES (1, 'Main Hospital', 'MAIN001', 'Active')
        ON DUPLICATE KEY UPDATE branch_name = 'Main Hospital'
      `);
    } else {
      console.log(`✓ Found default branch: ${branches[0].branch_name} (id=1)`);
    }
    
    for (const table of tablesToFix) {
      console.log(`\n📋 Processing ${table}...`);
      
      try {
        // Set all NULL branch_ids to 1
        const [updateResult] = await connection.query(
          `UPDATE ${table} SET branch_id = 1 WHERE branch_id IS NULL OR branch_id = 0`
        );
        console.log(`  → Set ${updateResult.affectedRows} NULL/0 branch_ids to 1`);
        
        // Check for any invalid branch_ids that don't exist in branches table
        const [invalidRows] = await connection.query(`
          SELECT DISTINCT b.branch_id 
          FROM ${table} b 
          LEFT JOIN branches br ON b.branch_id = br.id 
          WHERE br.id IS NULL AND b.branch_id IS NOT NULL
        `);
        
        if (invalidRows.length > 0) {
          const invalidIds = invalidRows.map(r => r.branch_id).join(', ');
          console.log(`  ⚠️ Found invalid branch_ids: ${invalidIds}`);
          
          // Update invalid branch_ids to 1
          await connection.query(
            `UPDATE ${table} SET branch_id = 1 
             WHERE branch_id IN (?)`,
            [invalidRows.map(r => r.branch_id)]
          );
          console.log(`  → Updated invalid branch_ids to 1`);
        }
        
        // Drop existing FK constraint if it points to wrong table
        const [constraints] = await connection.query(`
          SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME 
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ? 
          AND COLUMN_NAME = 'branch_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [table]);
        
        for (const constraint of constraints) {
          if (constraint.REFERENCED_TABLE_NAME !== 'branches') {
            console.log(`  → Dropping FK ${constraint.CONSTRAINT_NAME} (pointed to ${constraint.REFERENCED_TABLE_NAME})`);
            await connection.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${constraint.CONSTRAINT_NAME}`);
          }
        }
        
        // Add correct FK if not exists
        const hasCorrectFK = constraints.some(c => c.REFERENCED_TABLE_NAME === 'branches');
        if (!hasCorrectFK) {
          console.log(`  → Adding FK to branches(id)`);
          await connection.query(`
            ALTER TABLE ${table} 
            ADD CONSTRAINT fk_${table.substring(0, 15)}_branch 
            FOREIGN KEY (branch_id) REFERENCES branches(id)
            ON DELETE SET NULL
          `);
        }
        
        console.log(`  ✅ ${table} fixed`);
        
      } catch (err) {
        console.error(`  ❌ Error with ${table}:`, err.message);
      }
    }
    
    console.log('\n✅ FK fix completed!');
    
  } catch (err) {
    console.error('❌ Failed:', err.message);
  } finally {
    await connection.end();
  }
};

fixForeignKeys();

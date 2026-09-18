import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const fixSchema = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: false
  });

  console.log('🔧 Fixing inventory schema issues...\n');
  
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✓ Foreign key checks disabled');

    // 1. Rename vendors to vendors
    const [tables] = await connection.query("SHOW TABLES LIKE 'vendors'");
    if (tables.length > 0) {
      await connection.query('RENAME TABLE vendors TO vendors');
      console.log('✓ Renamed vendors to vendors');
    } else {
      const [vendorsCheck] = await connection.query("SHOW TABLES LIKE 'vendors'");
      if (vendorsCheck.length === 0) {
        // Create vendors table if neither exists
        await connection.query(`CREATE TABLE vendors (
          id int NOT NULL AUTO_INCREMENT,
          vendor_name varchar(200) NOT NULL,
          vendor_code varchar(50) NOT NULL,
          contact_person varchar(100) DEFAULT NULL,
          phone varchar(20) DEFAULT NULL,
          email varchar(100) DEFAULT NULL,
          address text,
          city varchar(100) DEFAULT NULL,
          state varchar(100) DEFAULT NULL,
          pincode varchar(10) DEFAULT NULL,
          gstin varchar(15) DEFAULT NULL,
          pan varchar(10) DEFAULT NULL,
          status enum('Active','Inactive') DEFAULT 'Active',
          created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY vendor_code (vendor_code),
          KEY status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        console.log('✓ Created vendors table');
      } else {
        console.log('○ vendors table already exists');
      }
    }

    // 2. Recreate inventory_batches with correct schema
    const [batchColumns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'inventory_batches'
    `);
    const columnNames = batchColumns.map(c => c.COLUMN_NAME);
    
    if (!columnNames.includes('batch_number')) {
      console.log('⚠️ inventory_batches missing columns, recreating...');
      await connection.query('DROP TABLE IF EXISTS inventory_batches');
      
      await connection.query(`CREATE TABLE inventory_batches (
        id int NOT NULL AUTO_INCREMENT,
        item_id int NOT NULL,
        batch_number varchar(100) NOT NULL,
        lot_number varchar(100) DEFAULT NULL,
        manufacturing_date date DEFAULT NULL,
        expiry_date date DEFAULT NULL,
        vendor_id int DEFAULT NULL,
        quantity_received decimal(10,2) NOT NULL DEFAULT '0.00',
        quantity_available decimal(10,2) NOT NULL DEFAULT '0.00',
        quantity_reserved decimal(10,2) NOT NULL DEFAULT '0.00',
        quantity_damaged decimal(10,2) NOT NULL DEFAULT '0.00',
        unit_cost decimal(10,2) NOT NULL DEFAULT '0.00',
        grn_id int DEFAULT NULL,
        status enum('Active','Quarantine','Expired','Empty') DEFAULT 'Active',
        open_vial_date date DEFAULT NULL,
        stability_days int DEFAULT NULL,
        branch_id INT DEFAULT 1,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY vendor_id (vendor_id),
        KEY item_id (item_id),
        KEY batch_number (batch_number),
        KEY expiry_date (expiry_date),
        KEY status (status),
        KEY branch_id (branch_id),
        CONSTRAINT inventory_batches_ibfk_1 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE CASCADE,
        CONSTRAINT inventory_batches_ibfk_2 FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE SET NULL,
        CONSTRAINT fk_inventory_batch_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
      console.log('✓ Recreated inventory_batches with correct schema');
    } else {
      console.log('○ inventory_batches schema correct');
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n✓ Foreign key checks re-enabled');
    console.log('\n✅ Schema fixes completed!');
    
  } catch (err) {
    console.error('❌ Fix failed:', err.message);
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {}
  } finally {
    await connection.end();
  }
};

fixSchema();

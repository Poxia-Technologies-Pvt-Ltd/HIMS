import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const importMissingTables = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: false
  });

  console.log('📦 Importing missing inventory tables...\n');
  
  const tables = [
    {
      name: 'inventory_item_master',
      sql: `CREATE TABLE IF NOT EXISTS inventory_item_master (
        id int NOT NULL AUTO_INCREMENT,
        item_code varchar(50) NOT NULL,
        item_name varchar(200) NOT NULL,
        category enum('Reagents','Consumables','Test Kits','Calibrators','Controls','Glassware','General Lab Supplies') NOT NULL,
        brand varchar(100) DEFAULT NULL,
        manufacturer varchar(200) DEFAULT NULL,
        unit enum('ml','liter','test','box','pack','piece','mg','g','kg') NOT NULL,
        min_stock_level decimal(10,2) NOT NULL DEFAULT '0.00',
        reorder_level decimal(10,2) NOT NULL DEFAULT '0.00',
        storage_condition varchar(200) DEFAULT NULL,
        cost_price decimal(10,2) NOT NULL DEFAULT '0.00',
        selling_cost decimal(10,2) NOT NULL DEFAULT '0.00',
        expiry_required tinyint(1) DEFAULT '0',
        lot_tracking tinyint(1) DEFAULT '0',
        status enum('Active','Inactive') DEFAULT 'Active',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY item_code (item_code),
        KEY category (category),
        KEY status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'inventory_stock',
      sql: `CREATE TABLE IF NOT EXISTS inventory_stock (
        id int NOT NULL AUTO_INCREMENT,
        item_id int NOT NULL,
        current_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        available_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        reserved_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        consumed_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        expired_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        damaged_stock decimal(10,2) NOT NULL DEFAULT '0.00',
        department_id int DEFAULT NULL,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY unique_item_dept (item_id,department_id),
        KEY department_id (department_id),
        KEY item_id (item_id),
        CONSTRAINT inventory_stock_ibfk_1 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE CASCADE,
        CONSTRAINT inventory_stock_ibfk_2 FOREIGN KEY (department_id) REFERENCES infrastructure (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'vendors',
      sql: `CREATE TABLE IF NOT EXISTS vendors (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'stock_transfers',
      sql: `CREATE TABLE IF NOT EXISTS stock_transfers (
        id int NOT NULL AUTO_INCREMENT,
        transfer_number varchar(50) NOT NULL,
        from_department int NOT NULL,
        to_department int NOT NULL,
        transfer_date date NOT NULL,
        status enum('Pending','In Transit','Received','Cancelled') DEFAULT 'Pending',
        requested_by int NOT NULL,
        approved_by int DEFAULT NULL,
        received_by int DEFAULT NULL,
        notes text,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY transfer_number (transfer_number),
        KEY from_department (from_department),
        KEY to_department (to_department),
        KEY requested_by (requested_by),
        KEY approved_by (approved_by),
        KEY received_by (received_by),
        CONSTRAINT stock_transfers_ibfk_1 FOREIGN KEY (from_department) REFERENCES infrastructure (id) ON DELETE RESTRICT,
        CONSTRAINT stock_transfers_ibfk_2 FOREIGN KEY (to_department) REFERENCES infrastructure (id) ON DELETE RESTRICT,
        CONSTRAINT stock_transfers_ibfk_3 FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT stock_transfers_ibfk_4 FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT stock_transfers_ibfk_5 FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'stock_transfer_items',
      sql: `CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id int NOT NULL AUTO_INCREMENT,
        transfer_id int NOT NULL,
        item_id int NOT NULL,
        batch_id int DEFAULT NULL,
        quantity decimal(10,2) NOT NULL,
        received_quantity decimal(10,2) DEFAULT '0.00',
        damaged_quantity decimal(10,2) DEFAULT '0.00',
        notes text,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY item_id (item_id),
        KEY batch_id (batch_id),
        KEY transfer_id (transfer_id),
        CONSTRAINT stock_transfer_items_ibfk_1 FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id) ON DELETE CASCADE,
        CONSTRAINT stock_transfer_items_ibfk_2 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE RESTRICT,
        CONSTRAINT stock_transfer_items_ibfk_3 FOREIGN KEY (batch_id) REFERENCES inventory_batches (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    }
  ];

  try {
    // Disable FK checks temporarily
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✓ Foreign key checks disabled');

    for (const table of tables) {
      try {
        await connection.query(table.sql);
        console.log(`✓ Created table: ${table.name}`);
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log(`○ Table exists: ${table.name}`);
        } else if (err.code === 'ER_CANNOT_ADD_FOREIGN') {
          console.log(`⚠️ ${table.name}: Created without FK (referenced table missing)`);
          const sqlWithoutFK = table.sql.replace(/,\s*CONSTRAINT[^)]+\)/g, ')');
          await connection.query(sqlWithoutFK);
          console.log(`✓ Created table without FK: ${table.name}`);
        } else {
          console.error(`❌ Error creating ${table.name}:`, err.message);
        }
      }
    }

    // Re-enable FK checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n✓ Foreign key checks re-enabled');
    console.log('\n✅ Missing inventory tables import completed!');
    
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {}
  } finally {
    await connection.end();
  }
};

importMissingTables();

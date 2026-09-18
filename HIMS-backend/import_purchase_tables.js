import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const importPurchaseTables = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: false
  });

  console.log('📦 Importing purchase tables...\n');
  
  const tables = [
    {
      name: 'purchase_requisitions',
      sql: `CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id int NOT NULL AUTO_INCREMENT,
        pr_number varchar(50) NOT NULL,
        department_id int DEFAULT NULL,
        requested_by int NOT NULL,
        request_date date NOT NULL,
        required_date date DEFAULT NULL,
        priority enum('Low','Normal','High','Urgent') DEFAULT 'Normal',
        total_amount decimal(10,2) DEFAULT '0.00',
        status enum('Draft','Submitted','Approved','Rejected','Converted to PO') DEFAULT 'Draft',
        notes text,
        branch_id INT DEFAULT 1,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY pr_number (pr_number),
        KEY requested_by (requested_by),
        KEY department_id (department_id),
        KEY status (status),
        KEY branch_id (branch_id),
        CONSTRAINT purchase_requisitions_ibfk_1 FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT purchase_requisitions_ibfk_2 FOREIGN KEY (department_id) REFERENCES infrastructure (id) ON DELETE SET NULL,
        CONSTRAINT fk_pr_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'purchase_requisition_items',
      sql: `CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id int NOT NULL AUTO_INCREMENT,
        pr_id int NOT NULL,
        item_id int NOT NULL,
        quantity_requested decimal(10,2) NOT NULL,
        quantity_approved decimal(10,2) DEFAULT NULL,
        unit_price decimal(10,2) DEFAULT NULL,
        total_price decimal(10,2) DEFAULT NULL,
        notes text,
        status enum('Pending','Approved','Rejected') DEFAULT 'Pending',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY item_id (item_id),
        KEY pr_id (pr_id),
        CONSTRAINT purchase_requisition_items_ibfk_1 FOREIGN KEY (pr_id) REFERENCES purchase_requisitions (id) ON DELETE CASCADE,
        CONSTRAINT purchase_requisition_items_ibfk_2 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'purchase_orders',
      sql: `CREATE TABLE IF NOT EXISTS purchase_orders (
        id int NOT NULL AUTO_INCREMENT,
        po_number varchar(50) NOT NULL,
        pr_id int DEFAULT NULL,
        vendor_id int NOT NULL,
        order_date date NOT NULL,
        expected_delivery date DEFAULT NULL,
        delivery_location int DEFAULT NULL,
        subtotal decimal(10,2) NOT NULL DEFAULT '0.00',
        tax_amount decimal(10,2) DEFAULT '0.00',
        total_amount decimal(10,2) NOT NULL DEFAULT '0.00',
        terms_conditions text,
        status enum('Draft','Sent','Partially Received','Fully Received','Cancelled') DEFAULT 'Draft',
        created_by int NOT NULL,
        branch_id INT DEFAULT 1,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY po_number (po_number),
        KEY pr_id (pr_id),
        KEY vendor_id (vendor_id),
        KEY delivery_location (delivery_location),
        KEY created_by (created_by),
        KEY status (status),
        KEY branch_id (branch_id),
        CONSTRAINT purchase_orders_ibfk_1 FOREIGN KEY (pr_id) REFERENCES purchase_requisitions (id) ON DELETE SET NULL,
        CONSTRAINT purchase_orders_ibfk_2 FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE RESTRICT,
        CONSTRAINT purchase_orders_ibfk_3 FOREIGN KEY (delivery_location) REFERENCES infrastructure (id) ON DELETE SET NULL,
        CONSTRAINT purchase_orders_ibfk_4 FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_po_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'purchase_order_items',
      sql: `CREATE TABLE IF NOT EXISTS purchase_order_items (
        id int NOT NULL AUTO_INCREMENT,
        po_id int NOT NULL,
        item_id int NOT NULL,
        quantity_ordered decimal(10,2) NOT NULL,
        quantity_received decimal(10,2) DEFAULT '0.00',
        quantity_damaged decimal(10,2) DEFAULT '0.00',
        unit_price decimal(10,2) NOT NULL,
        total_price decimal(10,2) NOT NULL,
        notes text,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY item_id (item_id),
        KEY po_id (po_id),
        CONSTRAINT purchase_order_items_ibfk_1 FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE CASCADE,
        CONSTRAINT purchase_order_items_ibfk_2 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'goods_receipts',
      sql: `CREATE TABLE IF NOT EXISTS goods_receipts (
        id int NOT NULL AUTO_INCREMENT,
        grn_number varchar(50) NOT NULL,
        po_id int DEFAULT NULL,
        vendor_id int NOT NULL,
        receipt_date date NOT NULL,
        invoice_number varchar(100) DEFAULT NULL,
        invoice_date date DEFAULT NULL,
        subtotal decimal(10,2) DEFAULT '0.00',
        tax_amount decimal(10,2) DEFAULT '0.00',
        total_amount decimal(10,2) DEFAULT '0.00',
        received_by int NOT NULL,
        approved_by int DEFAULT NULL,
        status enum('Pending','Approved','Rejected') DEFAULT 'Pending',
        notes text,
        branch_id INT DEFAULT 1,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY grn_number (grn_number),
        KEY po_id (po_id),
        KEY vendor_id (vendor_id),
        KEY received_by (received_by),
        KEY approved_by (approved_by),
        KEY status (status),
        KEY branch_id (branch_id),
        CONSTRAINT goods_receipts_ibfk_1 FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE SET NULL,
        CONSTRAINT goods_receipts_ibfk_2 FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE RESTRICT,
        CONSTRAINT goods_receipts_ibfk_3 FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT goods_receipts_ibfk_4 FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_grn_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    },
    {
      name: 'goods_receipt_items',
      sql: `CREATE TABLE IF NOT EXISTS goods_receipt_items (
        id int NOT NULL AUTO_INCREMENT,
        grn_id int NOT NULL,
        po_item_id int DEFAULT NULL,
        item_id int NOT NULL,
        quantity_received decimal(10,2) NOT NULL,
        quantity_damaged decimal(10,2) DEFAULT '0.00',
        unit_cost decimal(10,2) NOT NULL,
        total_cost decimal(10,2) NOT NULL,
        batch_number varchar(100) DEFAULT NULL,
        lot_number varchar(100) DEFAULT NULL,
        manufacturing_date date DEFAULT NULL,
        expiry_date date DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY item_id (item_id),
        KEY grn_id (grn_id),
        CONSTRAINT goods_receipt_items_ibfk_1 FOREIGN KEY (grn_id) REFERENCES goods_receipts (id) ON DELETE CASCADE,
        CONSTRAINT goods_receipt_items_ibfk_2 FOREIGN KEY (item_id) REFERENCES inventory_item_master (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    }
  ];

  try {
    // Disable FK checks temporarily to allow table creation in correct order
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
          // Try again without FK constraints
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
    console.log('\n✅ Purchase tables import completed!');
    
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    // Try to re-enable FK checks even on error
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {}
  } finally {
    await connection.end();
  }
};

importPurchaseTables();

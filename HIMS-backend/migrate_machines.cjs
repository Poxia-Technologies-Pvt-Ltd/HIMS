const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    console.log('Migrating lab_machines table...');
    
    try {
        await connection.query(`
            ALTER TABLE lab_machines 
            ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100) UNIQUE,
            ADD COLUMN IF NOT EXISTS interface_type VARCHAR(20),
            ADD COLUMN IF NOT EXISTS port_ip VARCHAR(255),
            ADD COLUMN IF NOT EXISTS baud_rate INT;
        `);
        console.log('Migration successful!');
    } catch (err) {
        // If IF NOT EXISTS is not supported by this MySQL version, we handle it
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('Columns already exist.');
        } else {
            console.error('Migration failed:', err);
        }
    } finally {
        await connection.end();
    }
}

migrate();

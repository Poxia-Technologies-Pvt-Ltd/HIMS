import db from './config/db.js';

async function fixSchema() {
    console.log('Verifying lab_machines schema...');
    try {
        const [columns] = await db.query('SHOW COLUMNS FROM lab_machines');
        const columnNames = columns.map(c => c.Field);
        
        const required = [
            { name: 'serial_number', type: 'VARCHAR(100) UNIQUE' },
            { name: 'interface_type', type: 'VARCHAR(20)' },
            { name: 'port_ip', type: 'VARCHAR(255)' },
            { name: 'baud_rate', type: 'INT' }
        ];

        for (const col of required) {
            if (!columnNames.includes(col.name)) {
                console.log(`Adding column ${col.name}...`);
                await db.query(`ALTER TABLE lab_machines ADD COLUMN ${col.name} ${col.type}`);
            }
        }
        console.log('Schema is up to date.');
        process.exit(0);
    } catch (err) {
        console.error('Schema fix failed:', err);
        process.exit(1);
    }
}

fixSchema();

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function recreateLabTables() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'meril',
      database: process.env.DB_NAME || 'meril_hmis'
    });

    console.log('Connected to database successfully');

    // Drop existing lab tables in correct order (due to foreign keys)
    console.log('Dropping existing lab tables...');
    const tables = ['lab_test_parameters', 'lab_tests', 'sample_containers', 'lab_categories'];
    
    for (const table of tables) {
      try {
        await connection.execute(`DROP TABLE IF EXISTS ${table}`);
        console.log(`Dropped table: ${table}`);
      } catch (error) {
        console.log(`Table ${table} doesn't exist or error dropping: ${error.message}`);
      }
    }

    // Create lab_categories table
    console.log('Creating lab_categories table...');
    await connection.execute(`
      CREATE TABLE lab_categories (
        id int(11) NOT NULL AUTO_INCREMENT,
        name varchar(100) NOT NULL UNIQUE,
        description text,
        status enum('Active', 'Inactive') DEFAULT 'Active',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create sample_containers table
    console.log('Creating sample_containers table...');
    await connection.execute(`
      CREATE TABLE sample_containers (
        id int(11) NOT NULL AUTO_INCREMENT,
        container_name varchar(100) NOT NULL,
        tube_color varchar(50),
        volume_ml decimal(5,2),
        additives text,
        storage_temperature varchar(50),
        special_instructions text,
        status enum('Active', 'Inactive') DEFAULT 'Active',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create lab_tests table
    console.log('Creating lab_tests table...');
    await connection.execute(`
      CREATE TABLE lab_tests (
        id int(11) NOT NULL AUTO_INCREMENT,
        test_code varchar(50) NOT NULL UNIQUE,
        test_name varchar(200) NOT NULL,
        category_id int(11) NOT NULL,
        sample_type varchar(100) NOT NULL,
        tube_color varchar(50),
        storage_conditions text,
        methodology text,
        status enum('Active', 'Inactive') DEFAULT 'Active',
        price decimal(10,2),
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (category_id) REFERENCES lab_categories(id) ON DELETE RESTRICT,
        INDEX idx_test_code (test_code),
        INDEX idx_category_id (category_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create lab_test_parameters table
    console.log('Creating lab_test_parameters table...');
    await connection.execute(`
      CREATE TABLE lab_test_parameters (
        id int(11) NOT NULL AUTO_INCREMENT,
        test_id int(11) NOT NULL,
        parameter_name varchar(200) NOT NULL,
        parameter_unit varchar(50),
        reference_range text,
        min_value decimal(10,2),
        max_value decimal(10,2),
        critical_min decimal(10,2),
        critical_max decimal(10,2),
        display_order int(11) DEFAULT 0,
        status enum('Active', 'Inactive') DEFAULT 'Active',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
        INDEX idx_test_id (test_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Insert default categories
    console.log('Inserting default categories...');
    const categories = [
      ['Hematology', 'Complete blood count and related tests'],
      ['Biochemistry', 'Chemical analysis of blood and body fluids'],
      ['Microbiology', 'Culture and sensitivity tests'],
      ['Serology', 'Antibody and antigen detection'],
      ['Histopathology', 'Tissue examination'],
      ['Immunology', 'Immune system tests'],
      ['Endocrinology', 'Hormone tests'],
      ['Toxicology', 'Drug and toxin analysis']
    ];

    for (const [name, description] of categories) {
      await connection.execute(
        'INSERT INTO lab_categories (name, description) VALUES (?, ?)',
        [name, description]
      );
    }

    // Insert default sample containers
    console.log('Inserting default sample containers...');
    const containers = [
      ['EDTA Tube', 'Purple', 3.0, 'EDTA (K2/K3)', '2-8°C'],
      ['Clot Activator Tube', 'Red', 5.0, 'Clot activator', 'Room Temperature'],
      ['Heparin Tube', 'Green', 5.0, 'Lithium Heparin', '2-8°C'],
      ['Fluoride Tube', 'Grey', 2.0, 'Sodium Fluoride', '2-8°C'],
      ['Citrate Tube', 'Blue', 2.7, 'Sodium Citrate', '2-8°C'],
      ['Plain Tube', 'No color', 10.0, 'No additives', 'Room Temperature']
    ];

    for (const [container_name, tube_color, volume_ml, additives, storage_temperature] of containers) {
      await connection.execute(
        'INSERT INTO sample_containers (container_name, tube_color, volume_ml, additives, storage_temperature) VALUES (?, ?, ?, ?, ?)',
        [container_name, tube_color, volume_ml, additives, storage_temperature]
      );
    }

    console.log('Lab tables created successfully!');
    
    // Verify tables exist
    const [createdTables] = await connection.execute("SHOW TABLES LIKE 'lab_%'");
    console.log('Created tables:', createdTables.map(t => Object.values(t)[0]));

  } catch (error) {
    console.error('Error creating lab tables:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

recreateLabTables().catch(console.error);

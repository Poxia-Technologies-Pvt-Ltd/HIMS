import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function createLabTables() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'meril',
      database: process.env.DB_NAME || 'meril_hmis'
    });

    console.log('Connected to database successfully');

    // Create lab_categories table
    console.log('Creating lab_categories table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lab_categories (
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
      CREATE TABLE IF NOT EXISTS sample_containers (
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
      CREATE TABLE IF NOT EXISTS lab_tests (
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
        INDEX test_code (test_code),
        INDEX category_id (category_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create lab_test_parameters table
    console.log('Creating lab_test_parameters table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lab_test_parameters (
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
        INDEX test_id (test_id)
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
      try {
        await connection.execute(
          'INSERT IGNORE INTO lab_categories (name, description) VALUES (?, ?)',
          [name, description]
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') {
          console.error('Error inserting category:', error.message);
        }
      }
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
      try {
        await connection.execute(
          'INSERT IGNORE INTO sample_containers (container_name, tube_color, volume_ml, additives, storage_temperature) VALUES (?, ?, ?, ?, ?)',
          [container_name, tube_color, volume_ml, additives, storage_temperature]
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') {
          console.error('Error inserting container:', error.message);
        }
      }
    }

    console.log('Lab tables created successfully!');
    
    // Verify tables exist
    const [tables] = await connection.execute("SHOW TABLES LIKE 'lab_%'");
    console.log('Created tables:', tables.map(t => Object.values(t)[0]));

  } catch (error) {
    console.error('Error creating lab tables:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createLabTables().catch(console.error);

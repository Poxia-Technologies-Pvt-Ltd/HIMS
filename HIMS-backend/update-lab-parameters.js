import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function updateLabParametersSchema() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'meril',
      database: process.env.DB_NAME || 'meril_hmis'
    });

    console.log('Connected to database successfully');

    // Drop existing lab_test_parameters table to recreate with new structure
    console.log('Dropping existing lab_test_parameters table...');
    await connection.execute('DROP TABLE IF EXISTS lab_test_parameters');

    // Create new lab_test_parameters table with demographic-specific reference ranges
    console.log('Creating updated lab_test_parameters table...');
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
        
        -- Demographic-specific reference ranges
        men_reference_range text,
        men_min_value decimal(10,2),
        men_max_value decimal(10,2),
        men_critical_min decimal(10,2),
        men_critical_max decimal(10,2),
        
        women_reference_range text,
        women_min_value decimal(10,2),
        women_max_value decimal(10,2),
        women_critical_min decimal(10,2),
        women_critical_max decimal(10,2),
        
        kids_reference_range text,
        kids_min_value decimal(10,2),
        kids_max_value decimal(10,2),
        kids_critical_min decimal(10,2),
        kids_critical_max decimal(10,2),
        
        -- Flag to use demographic-specific ranges or general range
        use_demographic_ranges tinyint(1) DEFAULT 0,
        
        display_order int(11) DEFAULT 0,
        status enum('Active', 'Inactive') DEFAULT 'Active',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
        INDEX idx_test_id (test_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('Lab test parameters table updated successfully!');

  } catch (error) {
    console.error('Error updating lab parameters schema:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

updateLabParametersSchema().catch(console.error);

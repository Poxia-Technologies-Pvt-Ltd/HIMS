import pool from '../config/db.js';

async function setup() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disease_surveillance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        district VARCHAR(100) NOT NULL,
        disease VARCHAR(100) NOT NULL,
        cases INT DEFAULT 0,
        trend VARCHAR(20),
        risk_level ENUM('LOW', 'MEDIUM', 'HIGH') DEFAULT 'LOW',
        recorded_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('disease_surveillance table created.');

    // Seed some data for Jharkhand districts
    const districts = [
      "Ranchi", "Dhanbad", "Bokaro", "East Singhbhum", "Hazaribagh", 
      "Palamu", "Deoghar", "Giridih", "Ramgarh", "Dumka", "Godda", "Sahibganj"
    ];
    const diseases = ["Dengue", "Malaria", "Typhoid", "Cholera"];

    for (const dist of districts) {
      for (const disease of diseases) {
        const cases = Math.floor(Math.random() * 150);
        const risk = cases > 100 ? 'HIGH' : (cases > 50 ? 'MEDIUM' : 'LOW');
        await pool.query(
          "INSERT INTO disease_surveillance (district, disease, cases, trend, risk_level, recorded_date) VALUES (?, ?, ?, ?, ?, CURDATE())",
          [dist, disease, cases, '+5%', risk]
        );
      }
    }
    console.log('Seeded initial data.');

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

setup();

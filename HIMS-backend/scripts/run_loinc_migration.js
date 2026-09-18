import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'meril-hims',
  port:     process.env.DB_PORT     || 8889,
  multipleStatements: true,
});

// Every code below was looked up against LOINC's own database (loinc.org),
// not recalled from memory alone — see the PR/commit this shipped in for
// the research trail. `confidence: 'Medium'` marks a parameter whose exact
// real-world context in OUR data doesn't perfectly match the single LOINC
// concept picked (e.g. a parameter used across both urine and blood
// contexts under one name) — those need a human sanity-check, not a
// guess-and-move-on. `mapping_status: 'Unmapped'` means no research
// confidently found a matching LOINC concept at all.
const LOINC_MAP = [
  // ── Urinalysis dipstick panel (all "Urine by Test strip") ──────────────
  { name: 'Bilirubin', code: '5770-3', long: 'Bilirubin.total [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'Blood', code: '5794-3', long: 'Hemoglobin.occult [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High', notes: 'Dipstick occult blood, not a hemoglobin mass/volume result.' },
  { name: 'Glucose', code: '25428-4', long: 'Glucose [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High', notes: 'Urine dipstick glucose — NOT serum/blood glucose, which is a different LOINC concept entirely.' },
  { name: 'Ketone', code: '2514-8', long: 'Ketones [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'Leukocytes', code: '5799-2', long: 'Leukocyte esterase [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High', notes: 'Dipstick leukocyte esterase, not a WBC count — different concept from the CBC "WBC" parameter below.' },
  { name: 'Nitrite', code: '5802-4', long: 'Nitrite [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'Protein', code: '20454-5', long: 'Protein [Presence] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'Specific Gravity', code: '5811-5', long: 'Specific gravity of Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'Urobilinogen', code: '20405-7', long: 'Urobilinogen [Mass/volume] in Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },

  // ── pH — used under BOTH urine dipstick AND arterial blood gas tests in
  // our data. Cross-checked and confirmed by lab review: split into two
  // rows, one per real specimen context, rather than picking one. A
  // resolver must pick the row matching the parent test's sample_type, not
  // just look up by parameter_name alone. ────────────────────────────────
  { name: 'pH', code: '5803-2', long: 'pH of Urine by Test strip', specimen: 'Urine', status: 'Mapped', confidence: 'High' },
  { name: 'pH', code: '2744-1', long: 'pH of Arterial blood', specimen: 'Arterial Blood', status: 'Mapped', confidence: 'High' },

  // ── CBC / hematology panel (all "Blood by Automated count") ────────────
  { name: 'WBC', code: '6690-2', long: 'Leukocytes [#/volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'RBC', code: '789-8', long: 'Erythrocytes [#/volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'HGB', code: '718-7', long: 'Hemoglobin [Mass/volume] in Blood', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'HCT', code: '4544-3', long: 'Hematocrit [Volume Fraction] of Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'MCH', code: '28539-5', long: 'MCH [Entitic mass]', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'MCHC', code: '28540-3', long: 'MCHC [Mass/volume]', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'RDW-CV', code: '788-0', long: 'Erythrocyte distribution width [Ratio] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'RDW-SD', code: '21000-5', long: 'Erythrocyte distribution width [Entitic volume] by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'PLT', code: '777-3', long: 'Platelets [#/volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'MPV', code: '32623-1', long: 'Platelet mean volume [Entitic volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'PCT', code: '51637-7', long: 'Plateletcrit [Volume Fraction] in Blood', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'PDW', code: '32207-3', long: 'Platelet distribution width [Entitic volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Lymph#', code: '731-0', long: 'Lymphocytes [#/volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Lymph%', code: '736-9', long: 'Lymphocytes/Leukocytes in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Gran#', code: '20482-6', long: 'Granulocytes [#/volume] in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Gran%', code: '19023-1', long: 'Granulocytes/Leukocytes in Blood by Automated count', specimen: 'Blood', status: 'Mapped', confidence: 'High' },

  // ── "Mid#"/"Mid%" — 3-part-differential analyzer terminology for
  // "everything that isn't lymphocytes or granulocytes" (monocytes +
  // eosinophils + basophils combined). LOINC has no single concept for
  // that composite bucket — it only defines the individual cell lines. ──
  { name: 'Mid#', code: null, long: null, specimen: 'Blood', status: 'Unmapped', confidence: null, notes: 'Analyzer-specific composite (monocytes+eosinophils+basophils) from 3-part differential — no single matching LOINC concept exists. Would need per-cell-line results (Monocytes#, Eosinophils#, Basophils#) to map properly.' },
  { name: 'Mid%', code: null, long: null, specimen: 'Blood', status: 'Unmapped', confidence: null, notes: 'Same composite-category issue as Mid# — no single matching LOINC concept.' },

  // ── Electrolytes — each of these is used across BOTH Serum/Plasma tests
  // AND Blood Gas Electrolytes (arterial/whole blood) in our data. Cross-
  // checked and confirmed by lab review: split into two rows per analyte,
  // one per real specimen context. A resolver must pick the row matching
  // the parent test's sample_type, not just look up by parameter_name. ───
  { name: 'Sodium', code: '2951-2', long: 'Sodium [Moles/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High' },
  { name: 'Sodium', code: '2947-0', long: 'Sodium [Moles/volume] in Blood', specimen: 'Whole Blood / Arterial Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Potassium', code: '2823-3', long: 'Potassium [Moles/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High' },
  { name: 'Potassium', code: '6298-4', long: 'Potassium [Moles/volume] in Blood', specimen: 'Whole Blood / Arterial Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Chloride', code: '2075-0', long: 'Chloride [Moles/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High' },
  { name: 'Chloride', code: '2069-3', long: 'Chloride [Moles/volume] in Blood', specimen: 'Whole Blood / Arterial Blood', status: 'Mapped', confidence: 'High' },
  { name: 'Ionized Calcium', code: '1994-3', long: 'Calcium.ionized [Moles/volume] in Blood', specimen: 'Whole Blood / Arterial Blood', status: 'Mapped', confidence: 'High', notes: 'Predominant context in our data (Blood Gas Electrolytes, Electrolyte with iCa). Arterial-specific alternative if a resolver needs to be that precise: 34581-9.' },
  { name: 'Ionized Calcium', code: '17863-2', long: 'Calcium.ionized [Mass/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Needs Review', confidence: 'Medium', notes: 'Our data doesn\'t show a pure Serum-only iCa test today (only "Whole Blood / Serum" combined), so this row is provisional for if/when one is added. Method-dependent per lab review — 12180-6 (by Ion-selective membrane electrode) is the alternative if that\'s the actual method used.' },

  // ── Renal panel ──────────────────────────────────────────────────────
  { name: 'CREAT', code: '2160-0', long: 'Creatinine [Mass/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High' },
  { name: 'URIC-ACID', code: '3084-1', long: 'Urate [Mass/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High', notes: 'LOINC\'s component name is "Urate" — same clinical test as "Uric Acid".' },
  { name: 'UREA', code: '3091-6', long: 'Urea [Mass/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Needs Review', confidence: 'Low', notes: 'Checked lab_test_parameters directly: min_value/max_value are both NULL for this row (test_id points to a deleted test), so there\'s no stored reference range to verify convention against. If the analyzer/report shows ~15-45 mg/dL it\'s Urea (this code, 3091-6); if it shows ~7-20 mg/dL it\'s Urea Nitrogen/BUN (LOINC 3094-0 instead) — confirm against the actual printed report or analyzer protocol, not something derivable from data currently in the system.' },

  // ── Misc ─────────────────────────────────────────────────────────────
  { name: 'Lithium', code: '14334-7', long: 'Lithium [Moles/volume] in Serum or Plasma', specimen: 'Serum or Plasma', status: 'Mapped', confidence: 'High' },
];

async function run() {
  const conn = await pool.getConnection();
  try {
    const [tbl] = await conn.query("SHOW TABLES LIKE 'lab_parameter_loinc_map'");
    if (tbl.length === 0) {
      await conn.query(`
        CREATE TABLE lab_parameter_loinc_map (
          id                      INT AUTO_INCREMENT PRIMARY KEY,
          parameter_name          VARCHAR(200) NOT NULL,
          loinc_code              VARCHAR(20) DEFAULT NULL,
          loinc_long_common_name  VARCHAR(255) DEFAULT NULL,
          specimen_context        VARCHAR(100) DEFAULT NULL,
          mapping_status          ENUM('Mapped','Unmapped','Needs Review') NOT NULL DEFAULT 'Unmapped',
          confidence              ENUM('High','Medium','Low') DEFAULT NULL,
          notes                   VARCHAR(500) DEFAULT NULL,
          created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_loinc_param_name_specimen (parameter_name, specimen_context)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ lab_parameter_loinc_map table created');
    } else {
      console.log('⏩ lab_parameter_loinc_map table already exists');
    }

    // ── Widen the unique key from (parameter_name) to
    // (parameter_name, specimen_context) — some parameters (pH, Sodium,
    // Potassium, Chloride, Ionized Calcium) genuinely need two rows, one
    // per real specimen context, after lab review confirmed the ambiguity
    // was real rather than something to pick-one-and-move-on from. ────────
    const [oldKey] = await conn.query(
      `SELECT COUNT(*) as n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lab_parameter_loinc_map'
         AND INDEX_NAME = 'uq_loinc_param_name'`
    );
    if (oldKey[0].n > 0) {
      await conn.query(`ALTER TABLE lab_parameter_loinc_map DROP INDEX uq_loinc_param_name`);
      await conn.query(`ALTER TABLE lab_parameter_loinc_map ADD UNIQUE KEY uq_loinc_param_name_specimen (parameter_name, specimen_context)`);
      console.log('✅ Widened unique key to (parameter_name, specimen_context)');
    } else {
      console.log('⏩ Unique key already widened');
    }

    let inserted = 0, updated = 0;
    for (const row of LOINC_MAP) {
      const [result] = await conn.query(
        `INSERT INTO lab_parameter_loinc_map
          (parameter_name, loinc_code, loinc_long_common_name, specimen_context, mapping_status, confidence, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           loinc_code = VALUES(loinc_code),
           loinc_long_common_name = VALUES(loinc_long_common_name),
           mapping_status = VALUES(mapping_status),
           confidence = VALUES(confidence),
           notes = VALUES(notes)`,
        [row.name, row.code || null, row.long || null, row.specimen || null, row.status, row.confidence || null, row.notes || null]
      );
      // affectedRows is 1 for a fresh insert, 2 for an update that changed a row, 0 for an update with no actual change
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    }
    console.log(`✅ lab_parameter_loinc_map populated: ${inserted} inserted, ${updated} updated, ${LOINC_MAP.length} total rows in source list`);

    // ── Prune rows no longer in the source list — e.g. the old single
    // 'Blood' Ionized Calcium row, superseded by the specimen-split rows
    // above. This script is the sole source of truth for this table. ─────
    const [existing] = await conn.query(`SELECT id, parameter_name, specimen_context FROM lab_parameter_loinc_map`);
    const wanted = new Set(LOINC_MAP.map(r => `${r.name} ${r.specimen || ''}`));
    const staleIds = existing
      .filter(r => !wanted.has(`${r.parameter_name} ${r.specimen_context || ''}`))
      .map(r => r.id);
    if (staleIds.length > 0) {
      await conn.query(`DELETE FROM lab_parameter_loinc_map WHERE id IN (?)`, [staleIds]);
      console.log(`✅ Pruned ${staleIds.length} stale row(s) no longer in the source list`);
    }

    const [summary] = await conn.query(
      `SELECT mapping_status, COUNT(*) as n FROM lab_parameter_loinc_map GROUP BY mapping_status`
    );
    console.log('Status breakdown:', summary.map(r => `${r.mapping_status}=${r.n}`).join(', '));

    console.log('\n✅ LOINC parameter map migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();

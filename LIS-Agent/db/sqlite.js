const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { app, safeStorage } = require("electron");

const dbPath = path.join(app.getPath("userData"), "lis_agent.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) return console.error("Failed to open LIS Agent DB:", err.message);
  // Cached patient sample results shouldn't be world-readable on multi-user machines.
  fs.chmod(dbPath, 0o600, (chmodErr) => {
    if (chmodErr) console.warn("Could not restrict lis_agent.db permissions:", chmodErr.message);
  });
});

// Keys whose values get OS-keychain-encrypted (via safeStorage) before hitting
// disk, instead of being stored as plain SQLite text.
const ENCRYPTED_KEYS = new Set(["authToken"]);
const ENC_PREFIX = "enc:v1:";

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptValue(value) {
  if (!canEncrypt()) {
    console.warn("[db] OS-level encryption unavailable — storing setting as plaintext.");
    return value;
  }
  return ENC_PREFIX + safeStorage.encryptString(value).toString("base64");
}

function decryptValue(stored) {
  if (stored == null || !stored.startsWith(ENC_PREFIX)) return stored;
  if (!canEncrypt()) {
    console.warn("[db] OS-level encryption unavailable — cannot decrypt stored setting.");
    return null;
  }
  return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64"));
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS analyzer_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_id TEXT UNIQUE,
      analyzer_name TEXT,
      model TEXT,
      port TEXT,
      baud INTEGER,
      lab_id INTEGER,
      lab_name TEXT,
      manufacturer TEXT,
      port_type TEXT,
      serial_number TEXT
    )
  `);
  // Migrate existing databases that predate port_type / serial_number / synced columns
  db.run(`ALTER TABLE analyzer_config ADD COLUMN port_type TEXT`, () => {});
  db.run(`ALTER TABLE analyzer_config ADD COLUMN serial_number TEXT`, () => {});
  // Whether this machine's config actually reached the HIMS-backend
  // lab_machines table — the UI "CLOUD SYNCED" badge reads this instead of
  // assuming every locally-saved machine also made it to the cloud.
  db.run(`ALTER TABLE analyzer_config ADD COLUMN synced INTEGER DEFAULT 0`, () => {});
  // The analyzer's own network address — only needed for a machine like the
  // Mindray BC-5130, which runs its own TCP server and must be dialed OUT to
  // rather than listened for (see startMindrayClient in tcpManager.js).
  db.run(`ALTER TABLE analyzer_config ADD COLUMN analyzer_ip TEXT`, () => {});
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Every completed analyzer session lands here FIRST, before any network
  // call — this is what makes "the machine still works with no internet"
  // true. Previously a completed session lived only in the in-memory
  // sessionAccumulator Map (serialManager.js/tcpManager.js): if the backend
  // POST failed (offline, backend down) it just stayed there hoping the
  // *next* incoming byte from the analyzer would trigger a retry, and if
  // the app restarted first, the result was gone with nothing to show for
  // it. Now every session is durably written here immediately, and the
  // retry queue (main/resultQueue.js) works entirely off this table instead
  // of anything in memory — the "Today's Test Results" and "Unmapped Test"
  // pages are both just views over it (kind='unmapped' with no sample_id
  // yet vs. everything else).
  db.run(`
    CREATE TABLE IF NOT EXISTS local_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'mapped',
      sample_id TEXT,
      bill_item_id TEXT,
      test_name TEXT,
      machine_no TEXT,
      machine_name TEXT,
      results_json TEXT NOT NULL,
      push_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      pushed_at TEXT
    )
  `);
  // A message that failed validation (tender #30) keeps its text and the reason, and is never pushed.
  db.run(`ALTER TABLE local_results ADD COLUMN raw_message TEXT`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_local_results_status ON local_results(push_status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_local_results_kind ON local_results(kind, sample_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_local_results_created ON local_results(created_at)`);

  // Every worklist entry this machine has successfully looked up while
  // online, kept around so a sample/patient ID an analyzer reports can still
  // be resolved to a real order during a network outage (see
  // worklistResolver.js) — without this, a lookup failure meant the whole
  // transmission was dropped rather than merely queued for later sync.
  db.run(`
    CREATE TABLE IF NOT EXISTS worklist_cache (
      sample_id TEXT PRIMARY KEY,
      bill_item_id TEXT,
      test_name TEXT,
      patient_name TEXT,
      cached_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Offline mode (tender #59): registration and sample collection keep working
  // with no network and are replayed to the server, oldest first, once it is back.
  // A patient registered offline gets a provisional ID (printed on the slip) now
  // and the official CRN when the registration syncs.
  db.run(`
    CREATE TABLE IF NOT EXISTS offline_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ref TEXT UNIQUE NOT NULL,
      provisional_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      patient_name TEXT,
      telephone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      force_new INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      matches_json TEXT,
      official_reg_no TEXT,
      patient_id INTEGER,
      link_note TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_offreg_status ON offline_registrations(status)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS offline_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      bill_number TEXT,
      patient_name TEXT,
      collected_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_offcol_status ON offline_collections(status, bill_id)`);
  // Today's orders at this facility, refreshed while online, so the collection
  // desk can be worked from the machine itself during an outage.
  db.run(`
    CREATE TABLE IF NOT EXISTS collection_cache (
      bill_id INTEGER PRIMARY KEY,
      order_json TEXT NOT NULL,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Thin promise wrappers for the offline tables.
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row || null); });
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

function saveSetting(key, value) {
  const toStore = ENCRYPTED_KEYS.has(key) && value != null ? encryptValue(value) : value;
  return new Promise((resolve, reject) => {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, toStore], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      resolve(ENCRYPTED_KEYS.has(key) ? decryptValue(row.value) : row.value);
    });
  });
}

function saveConfig(config) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO analyzer_config (unique_id, analyzer_name, model, port, baud, lab_id, lab_name, manufacturer, port_type, serial_number, synced, analyzer_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      config.uniqueId,
      config.name,
      config.model,
      config.port,
      config.baud,
      config.labId,
      config.labName,
      config.manufacturer,
      config.portType || null,
      config.serialNumber || null,
      config.synced ? 1 : 0,
      config.analyzerIp || null,
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );

    stmt.finalize();
  });
}

function getConfig() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM analyzer_config ORDER BY id DESC`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows); // Return all rows
    });
  });
}

function deleteConfig(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM analyzer_config WHERE id = ?`, [id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// ── local_results: the offline-durable result queue ─────────────────────────

// row: { kind, sample_id, bill_item_id, test_name, machine_no, machine_name,
//        results (array — stored as JSON), push_status }
function insertLocalResult(row) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO local_results
        (kind, sample_id, bill_item_id, test_name, machine_no, machine_name, results_json, push_status, last_error, raw_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.kind || 'mapped',
        row.sample_id || null,
        row.bill_item_id || null,
        row.test_name || null,
        row.machine_no || null,
        row.machine_name || null,
        JSON.stringify(row.results || []),
        row.push_status || 'pending',
        row.last_error || null,
        row.raw_message ? String(row.raw_message).slice(0, 4000) : null,
      ],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function updateLocalResultStatus(id, { push_status, last_error = null, pushed_at = null, incrementRetry = false }) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE local_results
       SET push_status = ?, last_error = ?, pushed_at = ?
           ${incrementRetry ? ', retry_count = retry_count + 1' : ''}
       WHERE id = ?`,
      [push_status, last_error, pushed_at, id],
      (err) => { if (err) reject(err); else resolve(true); }
    );
  });
}

// Maps a previously-unmapped row onto a real sample once the technician
// types it in (see UnmappedTests.jsx) — flips it to kind='mapped' and resets
// it to 'pending' so the retry engine picks it up and pushes it for real.
function mapLocalResult(id, sampleId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE local_results
       SET kind = 'mapped', sample_id = ?, push_status = 'pending', last_error = NULL
       WHERE id = ?`,
      [sampleId, id],
      (err) => { if (err) reject(err); else resolve(true); }
    );
  });
}

function getLocalResult(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM local_results WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row ? { ...row, results: JSON.parse(row.results_json || '[]') } : null);
    });
  });
}

// Everything created today (local device date), any kind/status — the full
// feed behind the "Today's Test Results" page.
function listTodayResults() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM local_results WHERE date(created_at, 'localtime') = date('now', 'localtime') ORDER BY id DESC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((r) => ({ ...r, results: JSON.parse(r.results_json || '[]') })));
      }
    );
  });
}

// Every unmapped result still waiting on a technician — not date-limited,
// since a run from yesterday that nobody has mapped yet shouldn't vanish
// from the list at midnight.
function listUnmappedResults() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM local_results WHERE kind = 'unmapped' AND sample_id IS NULL ORDER BY id DESC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((r) => ({ ...r, results: JSON.parse(r.results_json || '[]') })));
      }
    );
  });
}

function listFailedOrPendingMapped() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM local_results
       WHERE push_status IN ('pending', 'failed') AND NOT (kind = 'unmapped' AND sample_id IS NULL)
       ORDER BY id ASC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((r) => ({ ...r, results: JSON.parse(r.results_json || '[]') })));
      }
    );
  });
}

// ── worklist_cache: offline fallback for sample/patient ID lookups ──────────

function cacheWorklistEntry(sampleId, test) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO worklist_cache (sample_id, bill_item_id, test_name, patient_name, cached_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [sampleId, test.bill_item_id || null, test.test_name || null, test.patient_name || null],
      (err) => { if (err) reject(err); else resolve(true); }
    );
  });
}

function getCachedWorklistEntry(sampleId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM worklist_cache WHERE sample_id = ?`, [sampleId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

module.exports = {
  run, get, all,
  saveConfig, getConfig, deleteConfig, saveSetting, getSetting,
  insertLocalResult, updateLocalResultStatus, mapLocalResult, getLocalResult,
  listTodayResults, listUnmappedResults, listFailedOrPendingMapped,
  cacheWorklistEntry, getCachedWorklistEntry,
};

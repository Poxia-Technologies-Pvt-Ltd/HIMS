// Offline mode for registration and sample collection (tender #59).
//
// Both screens try the server first. When it cannot be reached they carry on
// from this machine: a patient registered offline gets a provisional ID that
// is printed on the slip, an order marked collected offline is remembered with
// the time it really happened, and everything is replayed to the backend,
// oldest first, as soon as the network is back (networkMonitor.js calls
// syncAll on reconnect; a 30-second sweep catches the rest).
//
// Nothing here is ever "best guess": an offline registration is synced with
// its own reference (clientRef) so a retry after a lost response can never
// create the patient twice, a possible duplicate of an existing patient waits
// for a person to decide, and a rejected item stays visible with the reason
// rather than silently disappearing.
const crypto = require('crypto');
const axios = require('./apiClient');
const db = require('../db/sqlite.js');
const networkMonitor = require('./networkMonitor');

const SWEEP_MS = 30_000;
const SNAPSHOT_MS = 2 * 60_000;
const TIMEOUT = 15_000;

let getWin = () => null;
let timer = null;
let syncing = false;
let lastSnapshotAt = 0;
let lastSnapshotError = null;

const setWindow = (windowGetter) => { getWin = windowGetter; };
const notify = () => {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('offline-sync-updated');
};

// A failure that says nothing about the item itself: the network, the server
// or this machine's key. The item stays queued and is tried again.
const isHold = (err) => !err.response || err.response.status >= 500 || [401, 403, 408, 429].includes(err.response.status);
const messageOf = (err) => err.response?.data?.message || err.message || 'Could not reach the server';
const isOffline = () => networkMonitor.isOnline() === false;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── Registration form fields ────────────────────────────────────────────────

// Used until the field config has been fetched once; the same defaults the
// backend ships with.
const DEFAULT_FIELDS = [
  { field_key: 'firstName', label: 'First Name', is_required: 1 },
  { field_key: 'lastName', label: 'Last Name', is_required: 1 },
];

async function getFieldConfig() {
  if (!isOffline()) {
    try {
      const res = await axios.get('/api/patients/field-config', { timeout: TIMEOUT });
      if (res.data?.success) {
        await db.saveSetting('cache:patientFieldConfig', JSON.stringify(res.data.fields));
        return { fields: res.data.fields, cached: false };
      }
    } catch { /* fall back to the saved copy */ }
  }
  const saved = await db.getSetting('cache:patientFieldConfig');
  if (saved) { try { return { fields: JSON.parse(saved), cached: true }; } catch { /* use defaults */ } }
  return { fields: DEFAULT_FIELDS, cached: true, defaults: true };
}

const clean = (form) => {
  const out = {};
  for (const [k, v] of Object.entries(form || {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
};

// The registration desk captures only these (see renderer/src/pages/Registration.jsx).
const DESK_FIELDS = new Set(['firstName', 'lastName', 'gender', 'dob', 'telephone', 'aadharNumber']);

async function missingRequired(payload) {
  const { fields } = await getFieldConfig();
  return fields
    .filter((f) => f.is_enabled !== 0 && f.is_required && f.field_source !== 'custom' && DESK_FIELDS.has(f.field_key))
    .filter((f) => {
      const v = payload[f.field_key];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map((f) => f.label);
}

// ── Provisional IDs ─────────────────────────────────────────────────────────

let idChain = Promise.resolve();
// OFF-<yymmdd>-<machine>-<nnn>: unique per machine and day, and obviously not
// a real CRN, so nobody mistakes it for one. Serialised so two quick saves
// never share a number.
function nextProvisionalId() {
  const next = idChain.then(async () => {
    let machine = await db.getSetting('offlineMachineCode');
    if (!machine) {
      machine = crypto.randomBytes(2).toString('hex').toUpperCase();
      await db.saveSetting('offlineMachineCode', machine);
    }
    const d = new Date();
    const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const key = `offlineSeq:${ymd}`;
    const n = Number(await db.getSetting(key) || 0) + 1;
    await db.saveSetting(key, String(n));
    return `OFF-${ymd}-${machine}-${String(n).padStart(3, '0')}`;
  });
  idChain = next.catch(() => {});
  return next;
}

// ── Registration ────────────────────────────────────────────────────────────

async function registerPatient(form) {
  const payload = clean(form);
  const missing = await missingRequired(payload);
  if (missing.length) return { ok: false, status: 400, message: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
  if (payload.telephone && !/^\d{10}$/.test(String(payload.telephone).replace(/\D/g, '').slice(-10))) {
    return { ok: false, status: 400, message: 'Enter a valid 10-digit mobile number.' };
  }

  if (payload.aadharNumber && !/^\d{12}$/.test(String(payload.aadharNumber))) {
    return { ok: false, status: 400, message: 'Aadhaar number must be 12 digits.' };
  }

  const clientRef = crypto.randomUUID();
  const base = { ...payload, regDate: payload.regDate || localDate(), clientRef };

  if (!isOffline()) {
    try {
      const res = await axios.post('/api/patients/register', base, { timeout: TIMEOUT });
      return { ok: true, mode: 'online', regNo: res.data.regNo, patientId: res.data.patientId };
    } catch (err) {
      // A real answer (validation, a rule): show it, nothing is queued.
      if (err.response && !isHold(err)) return { ok: false, status: err.response.status, message: messageOf(err) };
      // Otherwise the server could not be reached — fall through and keep it here.
    }
  }

  const provisionalId = await nextProvisionalId();
  const registeredAt = new Date().toISOString();
  const name = [payload.title, payload.firstName, payload.middleName, payload.lastName].filter(Boolean).join(' ');
  const { lastID } = await db.run(
    `INSERT INTO offline_registrations (client_ref, provisional_id, payload_json, patient_name, telephone)
     VALUES (?, ?, ?, ?, ?)`,
    [clientRef, provisionalId, JSON.stringify({ ...base, provisionalId, offlineRegisteredAt: registeredAt }), name, payload.telephone || null]);
  notify();
  return { ok: true, mode: 'offline', id: lastID, provisionalId, name, registeredAt };
}

const parseRow = (r) => ({
  ...r,
  payload: r.payload_json ? JSON.parse(r.payload_json) : null,
  matches: r.matches_json ? JSON.parse(r.matches_json) : [],
});

async function listRegistrations({ includeSynced = true } = {}) {
  const rows = await db.all(
    `SELECT * FROM offline_registrations ${includeSynced ? '' : "WHERE status <> 'synced'"} ORDER BY id DESC LIMIT 200`);
  return rows.map((r) => { const p = parseRow(r); delete p.payload_json; delete p.matches_json; return p; });
}

const norm = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const sameDay = (a, b) => !!a && !!b && String(a).slice(0, 10) === String(b).slice(0, 10);

// A genuine duplicate is the same name AND the same phone or birth date. A
// shared family phone alone is not one — the server's looser check returns
// those too, and they should not hold up every sync.
function probableDuplicates(payload, found) {
  return (found || []).filter((d) => norm(d.first_name) === norm(payload.firstName) && norm(d.last_name) === norm(payload.lastName)
    && ((payload.telephone && digits(d.telephone) === digits(payload.telephone)) || (payload.dob && sameDay(d.dob, payload.dob))));
}

async function syncOneRegistration(row) {
  const payload = JSON.parse(row.payload_json);
  try {
    if (!row.force_new) {
      const res = await axios.get('/api/patients/check-duplicate', {
        params: { telephone: payload.telephone, firstName: payload.firstName, lastName: payload.lastName, dob: payload.dob },
        timeout: TIMEOUT,
      });
      const dupes = probableDuplicates(payload, res.data?.duplicates);
      if (dupes.length) {
        await db.run("UPDATE offline_registrations SET status = 'review', matches_json = ?, last_error = NULL WHERE id = ?",
          [JSON.stringify(dupes.map((d) => ({ id: d.id, reg_no: d.reg_no, name: [d.first_name, d.last_name].filter(Boolean).join(' '), dob: d.dob, telephone: d.telephone, gender: d.gender }))), row.id]);
        return { held: false };
      }
    }
    const res = await axios.post('/api/patients/register', payload, { timeout: TIMEOUT });
    await db.run(
      "UPDATE offline_registrations SET status = 'synced', official_reg_no = ?, patient_id = ?, last_error = NULL, synced_at = ? WHERE id = ?",
      [res.data.regNo, res.data.patientId, new Date().toISOString(), row.id]);
    return { held: false };
  } catch (err) {
    const message = messageOf(err);
    if (isHold(err)) {
      await db.run('UPDATE offline_registrations SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?', [message, row.id]);
      return { held: true, unauthorized: err.response?.status === 401 };
    }
    // The server understood and refused (e.g. a rule that changed since): keep
    // it visible with the reason for a person to fix or discard.
    await db.run("UPDATE offline_registrations SET status = 'failed', last_error = ?, retry_count = retry_count + 1 WHERE id = ?", [message, row.id]);
    return { held: false };
  }
}

async function syncRegistrations() {
  const rows = await db.all("SELECT * FROM offline_registrations WHERE status = 'pending' ORDER BY id");
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const out = await syncOneRegistration(row);
    if (out.held) break; // the server is not reachable; the rest would fail the same way
  }
}

// action: 'use-existing' (it is that patient — link, create nothing)
//         'register-new'  (a different person — register anyway)
//         'retry'         (a failed one, try again)
//         'discard'       (a failed one that should not be registered)
async function resolveRegistration(id, { action, patientId, regNo } = {}) {
  const row = await db.get('SELECT * FROM offline_registrations WHERE id = ?', [id]);
  if (!row) return { ok: false, message: 'Registration not found.' };
  if (action === 'use-existing') {
    if (!regNo) return { ok: false, message: 'Choose which patient it is.' };
    await db.run(
      "UPDATE offline_registrations SET status = 'synced', official_reg_no = ?, patient_id = ?, link_note = 'Linked to an existing patient', synced_at = ? WHERE id = ?",
      [regNo, patientId || null, new Date().toISOString(), id]);
  } else if (action === 'register-new') {
    await db.run("UPDATE offline_registrations SET force_new = 1, status = 'pending', last_error = NULL WHERE id = ?", [id]);
  } else if (action === 'retry') {
    await db.run("UPDATE offline_registrations SET status = 'pending', last_error = NULL WHERE id = ?", [id]);
  } else if (action === 'discard') {
    if (row.status === 'synced') return { ok: false, message: 'Already registered.' };
    await db.run('DELETE FROM offline_registrations WHERE id = ?', [id]);
  } else {
    return { ok: false, message: 'Unknown action.' };
  }
  notify();
  if (!isOffline()) syncAll().catch(() => {});
  return { ok: true };
}

// ── Sample collection ───────────────────────────────────────────────────────

const PRIORITY = { STAT: 0, Urgent: 1, Routine: 2 };
const tokenNo = (o) => (Number(o.token_number) || 999999);

async function refreshSnapshot() {
  try {
    const res = await axios.get('/api/lab/collection/snapshot', { timeout: 30_000 });
    if (!res.data?.success) throw new Error(res.data?.message || 'Snapshot refused');
    const orders = res.data.orders || [];
    for (const o of orders) {
      // eslint-disable-next-line no-await-in-loop
      await db.run('INSERT OR REPLACE INTO collection_cache (bill_id, order_json, fetched_at) VALUES (?, ?, ?)',
        [o.bill_id, JSON.stringify(o), new Date().toISOString()]);
    }
    // Every specimen on today's orders also goes into the worklist cache, so an analyzer result
    // that arrives during an outage is matched to its order instead of waiting to be mapped by hand.
    for (const o of orders) {
      for (const c of o.containers || []) {
        const t = (c.tests || []).find((x) => !x.has_result) || (c.tests || [])[0];
        if (!t) continue;
        for (const key of [c.sample_id, c.short_id].filter(Boolean).map(String)) {
          // eslint-disable-next-line no-await-in-loop
          await db.cacheWorklistEntry(key, { bill_item_id: t.bill_item_id, test_name: t.test_name, patient_name: o.patient_name }).catch(() => {});
        }
      }
    }
    const keep = orders.map((o) => o.bill_id);
    if (keep.length) await db.run(`DELETE FROM collection_cache WHERE bill_id NOT IN (${keep.map(() => '?').join(',')})`, keep);
    else await db.run('DELETE FROM collection_cache');
    lastSnapshotAt = Date.now();
    lastSnapshotError = null;
    await db.saveSetting('collectionSnapshotAt', new Date(lastSnapshotAt).toISOString());
    notify();
    return { ok: true, count: orders.length };
  } catch (err) {
    lastSnapshotError = messageOf(err);
    return { ok: false, message: lastSnapshotError };
  }
}

// What collection has been recorded on this machine but not yet accepted by the
// server, per order.
async function pendingByBill() {
  const rows = await db.all("SELECT * FROM offline_collections WHERE status IN ('pending', 'failed') ORDER BY id");
  const map = new Map();
  for (const r of rows) map.set(r.bill_id, r);
  return map;
}

function overlay(order, pending) {
  if (!pending) return { ...order, collected_offline: false, sync_status: null, sync_error: null };
  return {
    ...order,
    containers: (order.containers || []).map((c) => (c.stage === 'Accessioned' ? { ...c, stage: 'Collected', collected_offline: true } : c)),
    collected_offline: true,
    collected_offline_at: pending.collected_at,
    sync_status: pending.status,
    sync_error: pending.last_error,
  };
}

const isCollected = (o) => (o.containers || []).length > 0 && (o.containers || []).every((c) => !c.sample_id || c.stage !== 'Accessioned');

async function listOrders({ search = '' } = {}) {
  const [rows, pending] = await Promise.all([db.all('SELECT order_json, fetched_at FROM collection_cache'), pendingByBill()]);
  const today = localDate();
  const q = norm(search);
  const list = [];
  for (const r of rows) {
    const o = JSON.parse(r.order_json);
    if (o.created_at && localDate(new Date(o.created_at)) !== today && !pending.has(o.bill_id)) continue;
    const view = overlay(o, pending.get(o.bill_id));
    const tests = (view.containers || []).flatMap((c) => (c.tests || []).map((t) => t.test_name));
    const hay = [view.patient_name, view.reg_no, view.bill_number, view.token_number].map(norm).join(' ');
    if (q && !hay.includes(q)) continue;
    list.push({
      bill_id: view.bill_id, bill_number: view.bill_number, patient_name: view.patient_name, reg_no: view.reg_no,
      token_number: view.token_number, priority: view.priority, tests, test_count: tests.length,
      sample_count: (view.containers || []).filter((c) => c.sample_id).length,
      collected: isCollected(view), collected_offline: view.collected_offline, sync_status: view.sync_status,
    });
  }
  list.sort((a, b) => (PRIORITY[a.priority] ?? 2) - (PRIORITY[b.priority] ?? 2) || tokenNo(a) - tokenNo(b) || a.bill_id - b.bill_id);
  const savedAt = await db.getSetting('collectionSnapshotAt');
  return { orders: list, snapshot_at: savedAt || null, snapshot_error: lastSnapshotError };
}

async function getOrder(billId) {
  const [row, pending] = await Promise.all([db.get('SELECT order_json FROM collection_cache WHERE bill_id = ?', [billId]), pendingByBill()]);
  if (!row) return null;
  const view = overlay(JSON.parse(row.order_json), pending.get(Number(billId)));
  return { ...view, collected: isCollected(view) };
}

// Marks every tube of the order collected. Tried against the server first;
// kept here with the real time if the server cannot be reached.
async function collectOrder(billId) {
  const id = Number(billId);
  const row = await db.get('SELECT order_json FROM collection_cache WHERE bill_id = ?', [id]);
  if (!row) return { ok: false, message: 'This order is not on this machine. Refresh while online.' };
  const order = JSON.parse(row.order_json);
  if (isCollected(order)) return { ok: true, mode: 'already' };
  const existing = await db.get("SELECT id FROM offline_collections WHERE bill_id = ? AND status IN ('pending', 'failed')", [id]);
  if (existing) return { ok: true, mode: 'offline', alreadyQueued: true };

  const collectedAt = new Date().toISOString();
  if (!isOffline()) {
    try {
      await axios.post(`/api/lab/collection/orders/${id}/collect`, {}, { timeout: TIMEOUT });
      for (const c of order.containers || []) if (c.stage === 'Accessioned') c.stage = 'Collected';
      await db.run('UPDATE collection_cache SET order_json = ? WHERE bill_id = ?', [JSON.stringify(order), id]);
      notify();
      return { ok: true, mode: 'online' };
    } catch (err) {
      if (err.response && !isHold(err)) return { ok: false, message: messageOf(err) };
    }
  }
  await db.run(
    'INSERT INTO offline_collections (bill_id, bill_number, patient_name, collected_at) VALUES (?, ?, ?, ?)',
    [id, order.bill_number, order.patient_name, collectedAt]);
  notify();
  return { ok: true, mode: 'offline', collectedAt };
}

async function syncCollections() {
  const rows = await db.all("SELECT * FROM offline_collections WHERE status = 'pending' ORDER BY id");
  let synced = 0;
  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await axios.post(`/api/lab/collection/orders/${row.bill_id}/collect`, { collected_at: row.collected_at, offline: true }, { timeout: TIMEOUT });
      // eslint-disable-next-line no-await-in-loop
      await db.run("UPDATE offline_collections SET status = 'synced', last_error = NULL, synced_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
      synced += 1;
    } catch (err) {
      const message = messageOf(err);
      if (isHold(err)) {
        // eslint-disable-next-line no-await-in-loop
        await db.run('UPDATE offline_collections SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?', [message, row.id]);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await db.run("UPDATE offline_collections SET status = 'failed', last_error = ?, retry_count = retry_count + 1 WHERE id = ?", [message, row.id]);
    }
  }
  return synced;
}

async function resolveCollection(id, { action } = {}) {
  if (action === 'retry') await db.run("UPDATE offline_collections SET status = 'pending', last_error = NULL WHERE id = ?", [id]);
  else if (action === 'discard') await db.run("DELETE FROM offline_collections WHERE id = ? AND status <> 'synced'", [id]);
  else return { ok: false, message: 'Unknown action.' };
  notify();
  if (!isOffline()) syncAll().catch(() => {});
  return { ok: true };
}

async function listCollections() {
  return db.all('SELECT * FROM offline_collections ORDER BY id DESC LIMIT 200');
}

// ── Whole-queue sync and status ─────────────────────────────────────────────

async function getState() {
  const [reg, col, savedAt] = await Promise.all([
    db.all('SELECT status, COUNT(*) AS n FROM offline_registrations GROUP BY status'),
    db.all('SELECT status, COUNT(*) AS n FROM offline_collections GROUP BY status'),
    db.getSetting('collectionSnapshotAt'),
  ]);
  const n = (rows, s) => Number(rows.find((r) => r.status === s)?.n || 0);
  return {
    online: networkMonitor.isOnline(),
    syncing,
    registrations: { pending: n(reg, 'pending'), review: n(reg, 'review'), failed: n(reg, 'failed'), synced: n(reg, 'synced') },
    collections: { pending: n(col, 'pending'), failed: n(col, 'failed'), synced: n(col, 'synced') },
    snapshot_at: savedAt || null,
    snapshot_error: lastSnapshotError,
  };
}

// One sweep at a time; a second request while one runs is simply absorbed.
async function syncAll({ force = false } = {}) {
  if (syncing) return { ok: false, message: 'Already syncing.' };
  if (isOffline()) return { ok: false, message: 'Still offline.' };
  syncing = true;
  notify();
  try {
    await syncRegistrations();
    await syncCollections();
    if (force || Date.now() - lastSnapshotAt > SNAPSHOT_MS) await refreshSnapshot();
    return { ok: true };
  } catch (err) {
    console.error('offline sync failed:', err.message);
    return { ok: false, message: err.message };
  } finally {
    syncing = false;
    notify();
  }
}

function start(windowGetter) {
  setWindow(windowGetter);
  if (timer) return;
  // Pick up where the last session left off (and fill the order cache).
  setTimeout(() => { if (!isOffline()) syncAll({ force: true }); }, 4000);
  timer = setInterval(() => { if (!isOffline()) syncAll(); }, SWEEP_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start, stop, setWindow, syncAll, getState,
  getFieldConfig, registerPatient, listRegistrations, resolveRegistration,
  listOrders, getOrder, collectOrder, refreshSnapshot, listCollections, resolveCollection,
  _test: { probableDuplicates, nextProvisionalId },
};

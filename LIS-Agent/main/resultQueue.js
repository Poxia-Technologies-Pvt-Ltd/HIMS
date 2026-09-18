// Single place that owns "did this result actually reach the backend" for
// every analyzer protocol (serialManager.js and tcpManager.js both call in
// here instead of POSTing to /api/lab/save-test-results directly). Every
// result is written to the local SQLite queue FIRST — see db/sqlite.js's
// local_results table — so a completed run is never lost to a network drop
// or an app restart, and is always visible in the Today's Test Results /
// Unmapped Test pages regardless of whether the push has succeeded yet.
const axios = require('./apiClient');
const db = require('../db/sqlite.js');

// A getter, not a captured window reference — the window is recreated when
// restored from the tray (see main.js's initAutoUpdate for the same
// pattern), so a snapshot taken once at startup would go stale/destroyed.
let getWin = () => null;
function setWindow(windowGetter) { getWin = windowGetter; }

function notify() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('local-results-updated');
}

// kind: 'mapped' when sample_id is known, 'unmapped' when the analyzer's
// session couldn't be tied to a real sample (no/garbled Patient ID) — an
// unmapped row is stored and shown for a technician to resolve by hand; it
// is never auto-pushed, since there is nothing valid to push yet.
async function enqueue({ kind = 'mapped', sample_id = null, bill_item_id = null, test_name = null, machine_no = null, machine_name = null, results = [] }) {
  const id = await db.insertLocalResult({ kind, sample_id, bill_item_id, test_name, machine_no, machine_name, results, push_status: 'pending' });
  notify();
  if (kind === 'mapped' && sample_id) {
    await pushOne(id);
  }
  return id;
}

async function pushOne(id) {
  const row = await db.getLocalResult(id);
  if (!row) return { ok: false, message: 'Result not found' };
  if (row.kind === 'unmapped' || !row.sample_id) {
    return { ok: false, message: 'This result has no sample ID yet — map it first.' };
  }

  try {
    const res = await axios.post('/api/lab/save-test-results', {
      bill_item_id: row.bill_item_id || undefined,
      sample_id: row.sample_id,
      machine_no: row.machine_no,
      test_name: row.test_name,
      results: row.results,
      status: 'Test Done',
    }, { timeout: 10000 });

    if (res.data?.success) {
      await db.updateLocalResultStatus(id, { push_status: 'pushed', pushed_at: new Date().toISOString() });
      notify();
      return { ok: true };
    }
    await db.updateLocalResultStatus(id, { push_status: 'failed', last_error: res.data?.message || 'Server rejected the result', incrementRetry: true });
    notify();
    return { ok: false, message: res.data?.message };
  } catch (err) {
    const message = err.response?.data?.message || err.message || 'Network error';
    await db.updateLocalResultStatus(id, { push_status: 'failed', last_error: message, incrementRetry: true });
    notify();
    return { ok: false, message };
  }
}

// Called by networkMonitor the moment connectivity returns, and by the
// "Retry All" button — same code path either way, since "the network is
// back" and "the technician asked to retry" should behave identically.
async function retryAll() {
  const rows = await db.listFailedOrPendingMapped();
  for (const row of rows) {
    await pushOne(row.id);
  }
  return rows.length;
}

module.exports = { setWindow, enqueue, pushOne, retryAll };

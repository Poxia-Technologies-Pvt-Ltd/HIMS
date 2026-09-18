// Resolves an analyzer-reported sample/patient ID to a real order — tried
// against the network first, then a local cache of every order this machine
// has already seen while online, so the lab keeps working through a network
// outage instead of every result from that stretch being silently dropped
// (which is what happened before: a failed /worklist-by-id fetch just
// returned null and the caller gave up on the whole transmission).
//
// Never returns null. Worst case — no network, no cache hit, no manual
// override, and no unsolicited-worklist auto-create possible offline — it
// hands back an unmapped placeholder (bill_item_id/sample_id both null) so
// the caller can still queue the result locally (resultQueue.js files it
// under kind:'unmapped') instead of discarding a real analyzer run.
const axios = require('./apiClient');
const db = require('../db/sqlite');

async function resolveWorklistEntry(sessionKey, { patientName = '', testNameFallback = 'Unmapped Test', manualInfo = null, allowAutoCreate = null } = {}) {
  if (manualInfo && manualInfo.sampleId) {
    return {
      bill_item_id: manualInfo.testId,
      sample_id: manualInfo.sampleId,
      patient_name: '(Mapped via UI)',
      test_name: manualInfo.testName || testNameFallback,
    };
  }

  // 1. Network lookup — the source of truth when reachable.
  try {
    const wlRes = await axios.get(`/api/lab/worklist-by-id/${sessionKey}`, { timeout: 5000 });
    if (wlRes.data.success && wlRes.data.test) {
      await db.cacheWorklistEntry(sessionKey, wlRes.data.test).catch(() => {});
      return wlRes.data.test;
    }
    // A clean "not found" response (still online) — no point falling back to
    // cache, an authoritative answer just said this order doesn't exist.
  } catch (err) {
    console.warn(`⚠️  Worklist fetch failed for "${sessionKey}" (offline?) — trying local cache: ${err.message}`);
    const cached = await db.getCachedWorklistEntry(sessionKey);
    if (cached) {
      console.log(`📦 Using cached worklist entry for "${sessionKey}" (offline).`);
      return cached;
    }
  }

  // 2. Auto-create server-side — only meaningful (and only attempted) online.
  const autoCreateAllowed = allowAutoCreate !== null
    ? allowAutoCreate
    : (await db.getSetting('allowUnsolicitedWorklistCreation')) === 'true';
  if (autoCreateAllowed) {
    try {
      const createRes = await axios.post('/api/lab/unsolicited-worklist', {
        sample_id: sessionKey, patient_name: patientName, test_name: testNameFallback,
      }, { timeout: 5000 });
      if (createRes.data.success && createRes.data.test) {
        console.log(`✅ Auto-created worklist entry for "${sessionKey}"`);
        return createRes.data.test;
      }
    } catch (err) {
      console.warn(`⚠️  Could not auto-create worklist entry for "${sessionKey}" (offline?): ${err.message}`);
    }
  }

  // 3. Nothing resolved — an unmapped placeholder, never a dropped result.
  console.log(`📥 "${sessionKey}" could not be resolved to an order — queuing as unmapped for manual mapping.`);
  return { bill_item_id: null, sample_id: null, patient_name: patientName, test_name: testNameFallback };
}

module.exports = { resolveWorklistEntry };

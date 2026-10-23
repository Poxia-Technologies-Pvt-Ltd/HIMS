// Offline engine of the Field app (tender #53, #57, #58): registration and sample collection that
// keep working with no network and are replayed to the server, oldest first, when it is back.
// Mirrors what the LIS Agent's offline desk does, so a camp team on a phone behaves the same as a
// laboratory PC. Nothing here touches the browser: the store and the network are passed in, so the
// whole flow can be run and tested on its own.
//
//   store: { put(name, rec), get(name, key), all(name), remove(name, key), clear(name) }
//   api:   async (method, url, body) => { status, data }   — throws when the network is unreachable

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "35" is an age, "1990" a year of birth — either becomes an approximate date of birth. */
export function dobFromAgeOrYear(raw, now = new Date()) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { error: 'Enter an age (0–120) or a birth year such as 1990.' };
  const n = Number(raw); const year = now.getFullYear();
  if (!Number.isInteger(n) || n < 0) return { error: 'Enter an age (0–120) or a birth year such as 1990.' };
  if (n <= 120) return { dob: `${year - n}-01-01` };
  if (n >= year - 120 && n <= year) return { dob: `${n}-01-01` };
  return { error: 'Enter an age (0–120) or a birth year such as 1990.' };
}

const norm = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

export function createFieldEngine({ store, api, now = () => new Date(), uuid = () => globalThis.crypto.randomUUID(), deviceCode = 'FLD' }) {
  const REG = 'registrations'; const COL = 'collections'; const ORD = 'orders'; const META = 'meta';

  async function nextProvisionalId() {
    const d = now(); const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const key = `seq:${ymd}`; const cur = (await store.get(META, key))?.value || 0;
    await store.put(META, { key, value: cur + 1 });
    return `OFF-${ymd}-${deviceCode}-${String(cur + 1).padStart(3, '0')}`;
  }

  // ── registration ───────────────────────────────────────────────────────────────────────────
  async function register(form) {
    const f = {}; for (const [k, v] of Object.entries(form || {})) f[k] = typeof v === 'string' ? v.trim() : v;
    if (!f.firstName || !f.lastName) return { ok: false, message: 'First name and last name are required.' };
    if (!f.gender) return { ok: false, message: 'Choose a gender.' };
    const age = dobFromAgeOrYear(f.ageOrYear, now()); if (age.error) return { ok: false, message: age.error };
    const phone = digits(f.telephone).slice(-10);
    if (phone.length !== 10) return { ok: false, message: 'Enter a valid 10-digit mobile number.' };
    if (f.aadharNumber && !/^\d{12}$/.test(f.aadharNumber)) return { ok: false, message: 'Aadhaar number must be 12 digits.' };
    const clientRef = uuid();
    const payload = { firstName: f.firstName, lastName: f.lastName, gender: f.gender, dob: age.dob, telephone: phone, regDate: localDate(now()), clientRef, ...(f.aadharNumber ? { aadharNumber: f.aadharNumber } : {}) };
    const rec = { id: clientRef, provisionalId: await nextProvisionalId(), name: `${f.firstName} ${f.lastName}`, phone, payload, status: 'pending', createdAt: now().toISOString(), error: null, matches: null, officialRegNo: null };
    await store.put(REG, rec);
    await syncRegistrations().catch(() => {});
    return { ok: true, record: await store.get(REG, rec.id) };
  }

  async function registerOne(rec) {
    try {
      if (!rec.forceNew) {
        const q = new URLSearchParams({ telephone: rec.payload.telephone, firstName: rec.payload.firstName, lastName: rec.payload.lastName, dob: rec.payload.dob });
        const dup = await api('GET', `/api/patients/check-duplicate?${q}`);
        const found = (dup.data?.duplicates || []).filter((d) => norm(d.first_name) === norm(rec.payload.firstName) && norm(d.last_name) === norm(rec.payload.lastName)
          && (digits(d.telephone).slice(-10) === rec.payload.telephone || String(d.dob || '').slice(0, 10) === rec.payload.dob));
        if (found.length) {
          await store.put(REG, { ...rec, status: 'review', error: null, matches: found.map((d) => ({ id: d.id, reg_no: d.reg_no, name: [d.first_name, d.last_name].filter(Boolean).join(' '), dob: d.dob, telephone: d.telephone })) });
          return { held: false };
        }
      }
      const res = await api('POST', '/api/patients/register', rec.payload);
      if (res.status === 401) return { held: true, unauthorized: true };
      if (res.status >= 500) { await store.put(REG, { ...rec, error: res.data?.message || `Server error ${res.status}` }); return { held: true }; }
      if (res.status >= 400 || res.data?.success === false) { await store.put(REG, { ...rec, status: 'failed', error: res.data?.message || `Refused (${res.status})` }); return { held: false }; }
      await store.put(REG, { ...rec, status: 'synced', error: null, officialRegNo: res.data?.regNo || null, patientId: res.data?.patientId || null, syncedAt: now().toISOString() });
      return { held: false };
    } catch { return { held: true, offline: true }; }
  }

  async function syncRegistrations() {
    const rows = (await store.all(REG)).filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let held = null;
    for (const r of rows) { const out = await registerOne(r); if (out.held) { held = out; break; } }
    return { held };
  }

  /** action: 'same-person' (link, create nothing) | 'different-person' (register anyway) | 'retry' | 'discard' */
  async function resolveRegistration(id, action) {
    const r = await store.get(REG, id); if (!r) return { ok: false, message: 'Not found.' };
    if (action === 'discard') { await store.remove(REG, id); return { ok: true }; }
    if (action === 'same-person') { const m = r.matches?.[0]; await store.put(REG, { ...r, status: 'synced', officialRegNo: m?.reg_no || null, patientId: m?.id || null, linked: true, matches: null }); return { ok: true }; }
    if (action === 'different-person') await store.put(REG, { ...r, status: 'pending', forceNew: true, matches: null, error: null });
    else if (action === 'retry') await store.put(REG, { ...r, status: 'pending', error: null });
    else return { ok: false, message: 'Unknown action.' };
    await syncRegistrations().catch(() => {});
    return { ok: true };
  }

  // ── sample collection ──────────────────────────────────────────────────────────────────────
  async function refreshOrders() {
    try {
      const res = await api('GET', '/api/lab/collection/snapshot');
      if (res.status !== 200 || !res.data?.success) return { ok: false, message: res.data?.message || `Could not refresh (${res.status})` };
      const orders = res.data.orders || [];
      await store.clear(ORD);
      for (const o of orders) await store.put(ORD, { id: o.bill_id, ...o });
      await store.put(META, { key: 'snapshotAt', value: now().toISOString() });
      return { ok: true, count: orders.length };
    } catch { return { ok: false, offline: true, message: 'Offline — showing the saved list.' }; }
  }

  const isCollected = (o) => (o.containers || []).length > 0 && (o.containers || []).every((c) => !c.sample_id || c.stage !== 'Accessioned');

  async function listOrders(search = '') {
    const [orders, cols] = await Promise.all([store.all(ORD), store.all(COL)]);
    const byBill = new Map(cols.map((c) => [c.billId, c]));
    const q = norm(search);
    return orders
      .filter((o) => !q || [o.patient_name, o.reg_no, o.bill_number, o.token_number].map(norm).join(' ').includes(q))
      .map((o) => { const c = byBill.get(o.bill_id); return { ...o, collected: isCollected(o) || !!c, pending: c?.status === 'pending' || c?.status === 'failed' ? c : null }; })
      .sort((a, b) => (a.collected - b.collected) || (Number(a.token_number) || 1e9) - (Number(b.token_number) || 1e9));
  }

  async function collect(billId) {
    const order = await store.get(ORD, billId); if (!order) return { ok: false, message: 'Order not found on this phone. Refresh the list while online.' };
    if (await store.get(COL, billId)) return { ok: true, already: true };
    await store.put(COL, { billId, billNumber: order.bill_number, patient: order.patient_name, collectedAt: now().toISOString(), status: 'pending', error: null });
    await syncCollections().catch(() => {});
    return { ok: true, record: await store.get(COL, billId) };
  }

  async function syncCollections() {
    const rows = (await store.all(COL)).filter((c) => c.status === 'pending').sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    for (const c of rows) {
      try {
        const res = await api('POST', `/api/lab/collection/orders/${c.billId}/collect`, { collected_at: c.collectedAt, offline: true });
        if (res.status === 401) return { held: true, unauthorized: true };
        if (res.status >= 500) { await store.put(COL, { ...c, error: res.data?.message || `Server error ${res.status}` }); return { held: true }; }
        if (res.status >= 400 || res.data?.success === false) await store.put(COL, { ...c, status: 'failed', error: res.data?.message || `Refused (${res.status})` });
        else await store.put(COL, { ...c, status: 'synced', error: null, syncedAt: now().toISOString() });
      } catch { return { held: true, offline: true }; }
    }
    return { held: false };
  }

  async function discardCollection(billId) { await store.remove(COL, billId); }

  async function syncAll() {
    const a = await syncRegistrations(); const b = a.held ? { held: a.held } : await syncCollections();
    return { held: a.held || b.held || null };
  }

  async function counts() {
    const [r, c] = await Promise.all([store.all(REG), store.all(COL)]);
    const n = (arr, s) => arr.filter((x) => x.status === s).length;
    return { pendingRegistrations: n(r, 'pending'), reviewRegistrations: n(r, 'review'), failedRegistrations: n(r, 'failed'), pendingCollections: n(c, 'pending'), failedCollections: n(c, 'failed') };
  }

  return { register, syncRegistrations, resolveRegistration, refreshOrders, listOrders, collect, syncCollections, discardCollection, syncAll, counts,
    listRegistrations: async () => (await store.all(REG)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), snapshotAt: async () => (await store.get(META, 'snapshotAt'))?.value || null };
}

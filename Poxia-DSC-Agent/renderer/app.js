/* global dsc */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

let state = null;
let certs = [];                 // certificates of the chosen token
let tokenId = '';
let certId = '';
let certsFor = '';              // which token `certs` belongs to
let busy = false;

// ── tabs ──
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${t.dataset.tab}`));
  if (t.dataset.tab === 'activity') loadActivity();
}));

async function loadCertificates() {
  if (!tokenId) { certs = []; certsFor = ''; return; }
  const r = await dsc.listCertificates(tokenId);
  certs = r.ok ? r.certificates : [];
  certsFor = tokenId;
  if (!certs.find((c) => c.id === certId)) certId = (certs.find((c) => c.usable) || certs[0] || {}).id || '';
}

function renderPills() {
  const a = $('pill-agent');
  a.className = `pill ${state.listening ? 'ok' : 'bad'}`;
  a.textContent = state.listening ? `Agent running on 127.0.0.1:${state.port}` : `Agent not running: ${state.listenError || 'unknown error'}`;
  const t = $('pill-token');
  const n = state.tokens.length;
  t.className = `pill ${n ? 'ok' : 'warn'}`;
  t.textContent = n ? `DSC token: ${state.tokens[0].label || state.tokens[0].model || 'connected'}${n > 1 ? ` (+${n - 1})` : ''}` : 'DSC token not detected';
  $('version').textContent = `Version ${state.version}`;
}

function certRows(selectable) {
  if (!certs.length) return '<p class="hint">No certificates were found on this token.</p>';
  return `<div class="certs">${certs.map((c) => `
    <label class="cert ${c.id === certId ? 'sel' : ''} ${c.usable ? '' : 'off'}">
      ${selectable ? `<input type="radio" name="cert" value="${esc(c.id)}" ${c.id === certId ? 'checked' : ''} ${c.usable ? '' : 'disabled'} />` : ''}
      <div><b>${esc(c.commonName)}</b>
        <span>${c.issuer ? `Issued by ${esc(c.issuer)}` : ''}${c.notAfter ? ` · valid until ${fmtDate(c.notAfter)}` : ''}${c.serial ? ` · serial ${esc(c.serial)}` : ''}</span>
        ${c.usable ? '' : `<span style="color:var(--bad)"> Cannot be used: ${esc(c.reason)}</span>`}</div>
    </label>`).join('')}</div>`;
}

function renderJob() {
  const box = $('job');
  const job = state.job;
  const live = job && ['loading', 'waiting', 'signing', 'done', 'failed', 'cancelled'].includes(job.status);
  box.classList.toggle('hidden', !live);
  if (!live) return;

  const s = job.summary || {};
  const summary = job.summary ? `<dl class="summary">
    <dt>Report</dt><dd>${esc(s.sample_id)}</dd><dt>Test</dt><dd>${esc(s.test)}</dd><dt>Patient</dt><dd>${esc(s.patient)} ${esc(s.patient_reg_no)}</dd>
    <dt>Hospital</dt><dd>${esc(s.hospital)}</dd><dt>Signing as</dt><dd>${esc(s.doctor)}</dd></dl>` : '';

  if (job.status === 'done') { box.innerHTML = `<h2>Signed</h2>${summary}<div class="banner ok">${esc(job.message || 'Report digitally signed and approved.')} You can go back to the LIMS.</div>`; return; }
  if (job.status === 'cancelled') { box.innerHTML = `<h2>Cancelled</h2>${summary}<div class="banner warn">${esc(job.message || 'Cancelled.')}</div>`; return; }
  if (job.status === 'failed') { box.innerHTML = `<h2>Not signed</h2>${summary}<div class="banner bad">${esc(job.error?.message || 'The report could not be signed.')} The report has NOT been released. Start the signing again from the LIMS.</div>`; return; }
  if (job.status === 'loading') { box.innerHTML = '<h2>Sign report</h2><p class="hint">Getting the report details from the LIMS…</p>'; return; }

  const token = state.tokens.find((t) => t.id === tokenId);
  const needPin = !(token && token.unlocked);
  const typedPin = $('pin') ? $('pin').value : '';   // a refresh must not wipe a half-typed PIN
  box.innerHTML = `
    <h2>Sign report</h2>
    ${summary}
    ${job.error ? `<div class="banner bad">${esc(job.error.message)}</div>` : ''}
    ${!state.tokens.length ? '<div class="banner warn">Insert your DSC token. The agent finds it by itself.</div>' : ''}
    ${state.tokens.length > 1 ? `<label>Token<select id="tokenSel">${state.tokens.map((t) => `<option value="${esc(t.id)}" ${t.id === tokenId ? 'selected' : ''}>${esc(t.label || t.model)} — ${esc(t.manufacturer)}</option>`).join('')}</select></label>` : ''}
    ${token?.pinFinalTry ? '<div class="banner warn">Only one PIN attempt is left before this token locks. Be careful.</div>' : ''}
    ${token?.pinLocked ? '<div class="banner bad">This token is locked. Contact your DSC provider to unlock it.</div>' : ''}
    ${state.tokens.length ? `<h3>Certificate</h3>${certRows(true)}` : ''}
    ${state.tokens.length ? (needPin
      ? '<label>DSC PIN <small>typed here only — it is not stored and not sent to the LIMS</small><input id="pin" class="pin" type="password" autocomplete="off" inputmode="numeric" /></label>'
      : '<div class="banner ok">Your token is unlocked — no PIN needed.</div>') : ''}
    <div class="actions">
      <button id="signBtn" class="primary" ${job.status === 'signing' || !state.tokens.length || token?.pinLocked || !certId ? 'disabled' : ''}>${job.status === 'signing' ? 'Signing…' : 'Sign report'}</button>
      <button id="cancelBtn" class="secondary" ${job.status === 'signing' ? 'disabled' : ''}>Cancel</button>
    </div>`;

  box.querySelectorAll('input[name=cert]').forEach((r) => r.addEventListener('change', () => { certId = r.value; renderJob(); }));
  const sel = $('tokenSel');
  if (sel) sel.addEventListener('change', async () => { tokenId = sel.value; await loadCertificates(); renderJob(); });
  const pin = $('pin');
  if (pin) { pin.value = typedPin; pin.focus(); pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') sign(); }); }
  $('signBtn').addEventListener('click', sign);
  $('cancelBtn').addEventListener('click', () => dsc.cancel());
}

async function sign() {
  if (busy) return;
  const pinEl = $('pin');
  busy = true;
  const pin = pinEl ? pinEl.value : '';
  if (pinEl) pinEl.value = '';
  const r = await dsc.submit({ tokenId, certId, pin });
  busy = false;
  if (!r.ok && r.message && state.job) state.job.error = { message: r.message };
  state = await dsc.getState();
  render();
}

function renderIdle() {
  const job = state.job;
  const live = job && ['loading', 'waiting', 'signing'].includes(job.status);
  $('idle').classList.toggle('hidden', !!live);
  if (live) return;
  const tokenHtml = state.tokens.length
    ? state.tokens.map((t) => `<li><b>${esc(t.label || t.model)}</b> <span class="hint">${esc(t.manufacturer)} ${esc(t.model)}${t.unlocked ? ' · unlocked' : ''}${t.pinLocked ? ' · LOCKED' : ''}</span></li>`).join('')
    : '<li class="hint">No DSC token detected. Insert your token. If it is plugged in and still not shown, its driver may not be installed — see Settings → PKCS#11 driver files.</li>';
  $('idle').innerHTML = `<h2>Ready</h2><p>Waiting for a report to sign. In the LIMS, open the report and press <b>Sign &amp; Approve</b>.</p>
    <h3>Tokens on this PC</h3><ul class="list">${tokenHtml}</ul>
    ${state.tokens.length ? `<h3>Certificates</h3>${certRows(false)}` : ''}`;
}

function renderSettings() {
  const c = state.config;
  if (document.activeElement && document.activeElement.closest('#settings')) return; // don't overwrite while editing
  $('s-servers').value = c.allowedServers.join('\n');
  $('s-origins').value = c.allowedOrigins.join('\n');
  $('s-libs').value = c.pkcs11Libraries.join('\n');
  $('s-idle').value = c.sessionIdleSeconds;
  $('s-port').value = c.port;
  $('s-login').checked = !!c.launchAtLogin;
  $('s-dev').value = c.devP12Path || '';
  $('lib-status').innerHTML = state.libraries.length
    ? state.libraries.map((l) => `<div class="${l.loaded ? 'okk' : 'nok'}">${l.loaded ? '✓ Loaded' : '✗ Could not load'} ${esc(l.path)}${l.error ? ` — ${esc(l.error)}` : ''}</div>`).join('')
    : '<div class="hint">No token driver was found on this PC. Install your token\'s driver, or add its PKCS#11 file above.</div>';
}

$('settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('settings-msg');
  const r = await dsc.saveSettings({
    allowedServers: $('s-servers').value, allowedOrigins: $('s-origins').value, pkcs11Libraries: $('s-libs').value,
    sessionIdleSeconds: $('s-idle').value, port: $('s-port').value, launchAtLogin: $('s-login').checked, devP12Path: $('s-dev').value,
  });
  msg.className = `msg ${r.ok ? 'ok' : 'bad'}`;
  msg.textContent = r.ok ? 'Saved.' : r.message;
  if (r.ok) { state = r.state; render(); }
  setTimeout(() => { msg.textContent = ''; }, 4000);
});

async function loadActivity() {
  const rows = await dsc.recentAudit();
  $('activity').innerHTML = rows.length
    ? rows.map((r) => `<li><time>${r.t ? new Date(r.t).toLocaleString('en-IN') : ''}</time><span><b>${esc(r.event)}</b> ${esc([r.token, r.serial, r.jobId, r.message, r.error].filter(Boolean).join(' · '))}</span></li>`).join('')
    : '<li class="hint">Nothing yet.</li>';
}

async function render() {
  if (!state.tokens.find((t) => t.id === tokenId)) tokenId = (state.tokens[0] || {}).id || '';
  if (tokenId && certsFor !== tokenId) await loadCertificates();
  if (!tokenId) { certs = []; certsFor = ''; certId = ''; }
  renderPills();
  renderJob();
  renderIdle();
  renderSettings();
}

dsc.onState(async (s) => { state = s; await render(); });
dsc.getState().then(async (s) => { state = s; await render(); });

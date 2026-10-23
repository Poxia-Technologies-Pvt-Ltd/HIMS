import { useState, useEffect, useCallback } from 'react';
import { Banknote, CreditCard, Smartphone, Globe, ShieldCheck, Wallet, BadgeIndianRupee, Percent, Link2, Monitor, Store } from 'lucide-react';
import '../../assets/CSS/Governance.css';
import '../../assets/CSS/PaymentSettings.css';
import { api, role } from '../../utils/govApi';

const METHOD_META = {
  Cash: { label: 'Cash', Icon: Banknote },
  Card: { label: 'Card', Icon: CreditCard },
  UPI: { label: 'UPI at counter', Icon: Smartphone },
  Online: { label: 'Online (Razorpay)', Icon: Globe },
  Insurance: { label: 'Insurance', Icon: ShieldCheck },
  Other: { label: 'Other', Icon: Wallet },
};
const RULE_TEXT = {
  'First registration': 'Once per patient — when the CRN is first created. Returning patients are not charged again.',
  'Every visit': 'On every bill.',
  'Renew after days': 'Once, then again only after the registration has expired.',
};
const canEdit = () => ['admin', 'super admin'].includes(role());

// Settings → Payment Settings: one configuration per hospital. Everything
// here is enforced on the server when a bill is created or paid.
export default function PaymentSettings() {
  const [branchId, setBranchId] = useState(localStorage.getItem('branch_id') || '');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api(`/api/payment-settings${branchId ? `?branch_id=${branchId}` : ''}`).then((d) => {
    if (!d.success) { setMsg({ ok: false, text: d.message }); return; }
    setData(d);
    setForm(d.settings ? { ...d.settings } : null);
    if (!branchId && d.branches?.length === 1) setBranchId(String(d.branches[0].id));
  }), [branchId]);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleMethod = (m) => setForm((f) => {
    const methods = f.methods.includes(m) ? f.methods.filter((x) => x !== m) : [...f.methods, m];
    return { ...f, methods, default_method: methods.includes(f.default_method) ? f.default_method : (methods[0] || '') };
  });

  const save = async () => {
    setSaving(true);
    const d = await api('/api/payment-settings', { method: 'PUT', body: { ...form, branch_id: branchId } });
    setSaving(false);
    setMsg({ ok: d.success, text: d.message });
    if (d.success) { setForm({ ...d.settings }); setData((x) => ({ ...x, settings: d.settings })); }
  };

  const dirty = form && data?.settings && JSON.stringify(form) !== JSON.stringify(data.settings);
  const ro = !canEdit();
  const rz = data?.razorpay;

  return (
    <div className="gv-page ps-page">
      <div className="gv-head">
        <div>
          <h1>Payment Settings</h1>
          <p>How this hospital charges and collects: the registration fee, accepted payment methods, discounts and online payment. These rules are applied by the server on every bill, at the counter and at the kiosk.</p>
        </div>
        <div className="gv-actions">
          {data?.branches?.length > 1 && (
            <select className="ps-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Choose hospital…</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
          )}
          {!ro && <button className="gv-btn" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>}
        </div>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {data && !form && <div className="gv-empty">Choose a hospital to see its payment settings.</div>}
      {form && !form.configured && <div className="gv-msg info">This hospital has no settings of its own yet — these are the defaults. Saving creates its own settings.</div>}

      {form && (
        <div className="ps-grid">
          {/* Registration fee */}
          <section className="gv-card ps-card">
            <div className="ps-card-head"><BadgeIndianRupee size={18} /><div><h3>Registration fee</h3><p>Charged when a patient is registered (CRN).</p></div>
              <label className="ps-switch"><input type="checkbox" disabled={ro} checked={form.reg_fee_enabled} onChange={(e) => set('reg_fee_enabled', e.target.checked)} /><span /></label>
            </div>
            {form.reg_fee_enabled ? (
              <div className="ps-body">
                <label className="ps-field"><span>Amount</span>
                  <div className="ps-affix"><b>₹</b><input type="number" min="0" step="1" disabled={ro} value={form.reg_fee_amount} onChange={(e) => set('reg_fee_amount', e.target.value)} /></div>
                </label>
                <div className="ps-field"><span>When to charge</span>
                  <div className="ps-options">
                    {data.options.reg_fee_rules.map((r) => (
                      <label key={r} className={`ps-option${form.reg_fee_rule === r ? ' on' : ''}`}>
                        <input type="radio" name="reg_rule" disabled={ro} checked={form.reg_fee_rule === r} onChange={() => set('reg_fee_rule', r)} />
                        <span><b>{r}</b><small>{RULE_TEXT[r]}</small></span>
                      </label>
                    ))}
                  </div>
                </div>
                {form.reg_fee_rule === 'Renew after days' && (
                  <label className="ps-field"><span>Registration valid for</span>
                    <div className="ps-affix right"><input type="number" min="1" max="3650" disabled={ro} value={form.reg_fee_validity_days} onChange={(e) => set('reg_fee_validity_days', e.target.value)} /><b>days</b></div>
                  </label>
                )}
              </div>
            ) : <div className="ps-body ps-off">No registration fee is charged at this hospital.</div>}
          </section>

          {/* Methods */}
          <section className="gv-card ps-card">
            <div className="ps-card-head"><Wallet size={18} /><div><h3>Payment methods</h3><p>What the billing counter can accept.</p></div></div>
            <div className="ps-body">
              <div className="ps-methods">
                {data.options.methods.map((m) => {
                  const { label, Icon } = METHOD_META[m];
                  const on = form.methods.includes(m);
                  return (
                    <button key={m} type="button" disabled={ro} className={`ps-method${on ? ' on' : ''}`} onClick={() => toggleMethod(m)}>
                      <Icon size={18} /><span>{label}</span><i>{on ? 'On' : 'Off'}</i>
                    </button>
                  );
                })}
              </div>
              <label className="ps-field"><span>Default method</span>
                <select className="ps-select" disabled={ro} value={form.default_method} onChange={(e) => set('default_method', e.target.value)}>
                  {form.methods.map((m) => <option key={m} value={m}>{METHOD_META[m].label}</option>)}
                </select>
              </label>
              <label className="ps-check"><input type="checkbox" disabled={ro} checked={form.allow_part_payment} onChange={(e) => set('allow_part_payment', e.target.checked)} />
                <span><b>Allow part payment</b><small>The patient may pay part now and the rest later. When off, the full amount must be collected.</small></span></label>
              <label className="ps-check"><input type="checkbox" disabled={ro} checked={form.prepaid_diagnostics !== false} onChange={(e) => set('prepaid_diagnostics', e.target.checked)} />
                <span><b>Lab tests and X-ray / scans paid before they are done</b><small>The bill must cover the tests before the lab or X-ray can start, unless pay-later is approved or a free scheme applies. The consultation fee may still stay due.</small></span></label>
            </div>
          </section>

          {/* Discount */}
          <section className="gv-card ps-card">
            <div className="ps-card-head"><Percent size={18} /><div><h3>Discounts</h3><p>Discount staff may give on a bill.</p></div>
              <label className="ps-switch"><input type="checkbox" disabled={ro} checked={form.allow_discount} onChange={(e) => set('allow_discount', e.target.checked)} /><span /></label>
            </div>
            {form.allow_discount ? (
              <div className="ps-body">
                <label className="ps-field"><span>Maximum discount</span>
                  <div className="ps-affix right"><input type="number" min="0" max="100" disabled={ro} value={form.max_discount_percent} onChange={(e) => set('max_discount_percent', e.target.value)} /><b>%</b></div>
                </label>
              </div>
            ) : <div className="ps-body ps-off">No discounts can be given at this hospital.</div>}
          </section>

          {/* Online */}
          <section className="gv-card ps-card">
            <div className="ps-card-head"><Globe size={18} /><div><h3>Online payment (Razorpay)</h3><p>Where patients may pay online.</p></div>
              <span className={`gv-badge ${rz?.configured ? 'ok' : 'bad'}`}>{rz?.configured ? `Connected · ${rz.mode}` : 'Not connected'}</span>
            </div>
            <div className="ps-body">
              {!rz?.configured && <div className="gv-msg bad">Razorpay keys are not set on the server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).</div>}
              {rz?.configured && !rz.webhook && <div className="gv-msg info">Webhook secret not set — payments still confirm through the browser and the 15-minute reconciliation.</div>}
              {!form.methods.includes('Online') && <div className="gv-msg info">Turn on "Online (Razorpay)" under Payment methods to use these.</div>}
              {[['online_counter', <Store size={14} />, 'At the billing counter', 'Razorpay Checkout on the billing screen (UPI QR, card, netbanking).'],
                ['online_link', <Link2 size={14} />, 'Payment link by SMS', 'Send the patient a link to pay from their phone.'],
                ['online_kiosk', <Monitor size={14} />, 'At the kiosk', 'Patients pay today\'s bill by UPI after taking their token.']].map(([k, icon, title, note]) => (
                <label key={k} className="ps-check">
                  <input type="checkbox" disabled={ro || !form.methods.includes('Online')} checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
                  <span><b className="ps-check-title">{icon} {title}</b><small>{note}</small></span>
                </label>
              ))}
              {form.online_link && (
                <label className="ps-field"><span>Payment link valid for</span>
                  <div className="ps-affix right"><input type="number" min="1" max="720" disabled={ro} value={form.link_expiry_hours} onChange={(e) => set('link_expiry_hours', e.target.value)} /><b>hours</b></div>
                </label>
              )}
              <div className="ps-off" style={{ marginTop: 6 }}>Online bills become invoices only after Razorpay confirms the payment. Free-scheme (NFDS) orders never need payment.</div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

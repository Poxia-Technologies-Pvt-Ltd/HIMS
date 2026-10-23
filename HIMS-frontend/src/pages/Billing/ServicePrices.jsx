import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { PageHead, Empty, Badge, Modal, Field } from '../../components/hmis/ui';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { get, post, put, money, hasRole } from '../../utils/hmisApi';
import { IMAGING_MODALITIES } from '../../data/imagingStudies';

// Prices for X-ray / scans, procedures and other services. The doctor's
// imaging orders and the desk's price-list items are charged from here; lab
// tests keep their own price list (Hospital Test Prices).
const CATEGORIES = ['Imaging', 'Procedure', 'Other'];
const MODALITIES = IMAGING_MODALITIES.map((m) => m.id);

export default function ServicePrices() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const canEdit = hasRole('admin', 'super admin', 'accounts manager');

  const load = useCallback(async () => {
    const r = await get('/api/billing/tariffs?all=1');
    if (r.ok) setRows(r.data.tariffs || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!cat || r.category === cat) && (!t || `${r.modality || ''} ${r.name} ${r.code || ''}`.toLowerCase().includes(t)));
  }, [rows, q, cat]);

  const save = async () => {
    const body = { ...edit, price: Number(edit.price) };
    const r = edit.id ? await put(`/api/billing/tariffs/${edit.id}`, body) : await post('/api/billing/tariffs', body);
    if (!r.ok) { showAlert(r.data.message || 'Could not save.', 'error'); return; }
    showAlert('Price saved. New charges use it from now on; bills already made keep their price.', 'success');
    setEdit(null);
    load();
  };

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} />}
      <PageHead title="Service Prices" subtitle="X-ray, scans, procedures and other charges. Lab test prices are under Hospital Test Prices.">
        {canEdit && <button type="button" className="hm-btn primary" onClick={() => setEdit({ category: 'Imaging', modality: 'X-Ray', name: '', code: '', price: '', is_active: 1 })}><Plus size={14} /> Add service</button>}
      </PageHead>
      <div className="hm-toolbar">
        <div className="grow sp-search">
          <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--text-soft)' }} />
          <input className="hm-input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services" />
        </div>
        <div className="hm-chips">
          {['', ...CATEGORIES].map((c) => <button key={c || 'all'} type="button" className={`hm-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c || 'All'}</button>)}
        </div>
      </div>
      <div className="hm-card">
        {shown.length === 0 ? <Empty>No services.</Empty> : (
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Service</th><th>Type</th><th>Code</th><th className="num">Price</th><th>Status</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.category === 'Imaging' ? `${t.modality} — ${t.name === '*' ? 'any other study' : t.name}` : t.name}</b>
                      {t.name === '*' && <span className="sub">Used when the doctor orders a study without its own price</span>}</td>
                    <td><Badge tone={t.category === 'Imaging' ? 'violet' : t.category === 'Procedure' ? 'amber' : ''}>{t.category}</Badge></td>
                    <td className="hm-muted">{t.code || '—'}</td>
                    <td className="num"><b>{money(t.price)}</b></td>
                    <td>{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}</td>
                    {canEdit && <td className="num"><button type="button" className="hm-btn sm" onClick={() => setEdit({ ...t })}>Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit price' : 'Add service'} onClose={() => setEdit(null)}
          footer={<><button type="button" className="hm-btn" onClick={() => setEdit(null)}>Close</button><button type="button" className="hm-btn primary" onClick={save}>Save</button></>}>
          <div className="hm-form">
            <Field label="Type">
              <select className="hm-select" value={edit.category} disabled={!!edit.id} onChange={(e) => setEdit((x) => ({ ...x, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            {edit.category === 'Imaging' && (
              <Field label="Imaging type">
                <select className="hm-select" value={edit.modality || ''} disabled={!!edit.id} onChange={(e) => setEdit((x) => ({ ...x, modality: e.target.value }))}>
                  {MODALITIES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
            )}
            <Field label={edit.category === 'Imaging' ? 'Study (e.g. Chest PA)' : 'Service name'} className="full">
              <input className="hm-input" value={edit.name === '*' ? 'any other study' : edit.name} disabled={edit.name === '*'} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} autoFocus />
            </Field>
            <Field label="Code (optional)"><input className="hm-input" value={edit.code || ''} onChange={(e) => setEdit((x) => ({ ...x, code: e.target.value }))} /></Field>
            <Field label="Price (₹)"><input className="hm-input" type="number" min="0" value={edit.price} onChange={(e) => setEdit((x) => ({ ...x, price: e.target.value }))} /></Field>
            {edit.id && (
              <label className="hm-check full"><input type="checkbox" checked={!!edit.is_active} onChange={(e) => setEdit((x) => ({ ...x, is_active: e.target.checked ? 1 : 0 }))} /> In use</label>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, BedDouble, Trash2 } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import { get, post, put, patch, del, hasRole, isCentral, todayIST } from '../../utils/hmisApi';

const ROOM_TYPES = ['OPD Cabin', 'Room', 'Ward', 'ICU', 'OT', 'Emergency', 'Procedure Room', 'Radiology', 'Lab', 'Pharmacy', 'Store', 'Office', 'Other'];
const BED_TYPES = ['General', 'Semi-Private', 'Private', 'ICU', 'HDU', 'NICU', 'PICU', 'Day Care'];
const BED_STATUSES = ['Available', 'Occupied', 'Cleaning', 'Reserved', 'Blocked', 'Maintenance'];
const BEDDED = ['Ward', 'ICU', 'Emergency', 'Room'];
const canAdmin = () => hasRole('admin', 'super admin');
const canSetBeds = () => hasRole('admin', 'super admin', 'nurse', 'receptionist', 'nursing superintendent', 'medical superintendent');

function RoomForm({ room, departments, branches, onClose, onSaved, showAlert }) {
  const [f, setF] = useState(() => ({
    name: '', room_number: '', type: 'OPD Cabin', department_id: '', block: '', floor: '', capacity: '', status: 'Available', notes: '', branch_id: '',
    ...Object.fromEntries(Object.entries(room || {}).map(([k, v]) => [k, v ?? ''])), is_active: room ? !!room.is_active : true,
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const r = room?.id ? await put(`/api/infra/update/${room.id}`, f) : await post('/api/infra/add', f);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    onSaved();
  };
  return (
    <Modal title={room?.id ? `Edit ${room.name}` : 'New room'} onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Save</button></>}>
      <div className="hm-form">
        {isCentral() && !room?.id && (
          <Field label="Facility *"><select className="hm-select" value={f.branch_id} onChange={set('branch_id')}><option value="">Select…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}</select></Field>
        )}
        <Field label="Name *"><input className="hm-input" value={f.name} onChange={set('name')} placeholder="e.g. Medicine OPD 1" /></Field>
        <Field label="Room number"><input className="hm-input" value={f.room_number} onChange={set('room_number')} placeholder="101" /></Field>
        <Field label="Type"><select className="hm-select" value={f.type} onChange={set('type')}>{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Department"><select className="hm-select" value={f.department_id} onChange={set('department_id')}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Block / wing"><input className="hm-input" value={f.block} onChange={set('block')} /></Field>
        <Field label="Floor"><input type="number" className="hm-input" value={f.floor} onChange={set('floor')} /></Field>
        <Field label="Capacity" hint="People it seats or patients it takes"><input type="number" min="0" className="hm-input" value={f.capacity} onChange={set('capacity')} /></Field>
        <Field label="Condition"><select className="hm-select" value={f.status} onChange={set('status')}>{['Available', 'Occupied', 'Maintenance'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Notes" className="full"><input className="hm-input" value={f.notes} onChange={set('notes')} /></Field>
        <label className="hm-check"><input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> In use</label>
      </div>
    </Modal>
  );
}

function BedsModal({ room, onClose, showAlert }) {
  const [beds, setBeds] = useState([]);
  const [add, setAdd] = useState({ prefix: `${(room.room_number || room.name).toString().slice(0, 3).toUpperCase()}-`, start_number: 1, count: 4, bed_type: room.type === 'ICU' ? 'ICU' : 'General', daily_rate: 0, has_oxygen: false, has_monitor: false, has_ventilator: false });
  const load = useCallback(() => get(`/api/infra/${room.id}/beds`).then((r) => {
    const list = r.data.beds || [];
    setBeds(list);
    setAdd((a) => ({ ...a, start_number: list.length + 1 }));
  }), [room.id]);
  useEffect(() => { load(); }, [load]);
  const addBeds = async () => {
    const r = await post(`/api/infra/${room.id}/beds`, add);
    if (!r.ok) return showAlert(r.data.message || 'Could not add beds', 'error');
    load();
  };
  const setStatus = async (b, status) => {
    const r = await patch(`/api/infra/beds/${b.id}/status`, { status });
    if (!r.ok) return showAlert(r.data.message || 'Could not update', 'error');
    load();
  };
  const remove = async (b) => {
    if (!window.confirm(`Remove bed ${b.bed_number}?`)) return;
    const r = await del(`/api/infra/beds/${b.id}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not remove', 'error');
    load();
  };
  return (
    <Modal wide title={`Beds · ${room.name}`} subtitle={`${beds.length} beds · ${beds.filter((b) => b.status === 'Available').length} available`} onClose={onClose}>
      {canAdmin() && (
        <div className="hm-form">
          <Field label="Label prefix"><input className="hm-input" value={add.prefix} onChange={(e) => setAdd({ ...add, prefix: e.target.value })} /></Field>
          <Field label="Start at"><input type="number" min="1" className="hm-input" value={add.start_number} onChange={(e) => setAdd({ ...add, start_number: e.target.value })} /></Field>
          <Field label="How many"><input type="number" min="1" max="100" className="hm-input" value={add.count} onChange={(e) => setAdd({ ...add, count: e.target.value })} /></Field>
          <Field label="Bed type"><select className="hm-select" value={add.bed_type} onChange={(e) => setAdd({ ...add, bed_type: e.target.value })}>{BED_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Daily charge (₹)"><input type="number" min="0" className="hm-input" value={add.daily_rate} onChange={(e) => setAdd({ ...add, daily_rate: e.target.value })} /></Field>
          <div className="hm-field" style={{ justifyContent: 'flex-end', gap: 4 }}>
            <label className="hm-check"><input type="checkbox" checked={add.has_oxygen} onChange={(e) => setAdd({ ...add, has_oxygen: e.target.checked })} /> Oxygen</label>
            <label className="hm-check"><input type="checkbox" checked={add.has_monitor} onChange={(e) => setAdd({ ...add, has_monitor: e.target.checked })} /> Monitor</label>
            <label className="hm-check"><input type="checkbox" checked={add.has_ventilator} onChange={(e) => setAdd({ ...add, has_ventilator: e.target.checked })} /> Ventilator</label>
          </div>
          <Field label=" "><button className="hm-btn primary" onClick={addBeds}><Plus size={14} /> Add beds</button></Field>
        </div>
      )}
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Bed</th><th>Type</th><th>Equipment</th><th className="num">Per day</th><th>Status</th><th /></tr></thead>
          <tbody>
            {beds.length === 0 && <tr><td colSpan={6}><Empty>No beds in this room yet.</Empty></td></tr>}
            {beds.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.bed_number}</strong></td>
                <td>{b.bed_type}</td>
                <td style={{ fontSize: 12 }}>{[b.has_oxygen && 'O₂', b.has_monitor && 'Monitor', b.has_ventilator && 'Ventilator'].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">₹{Number(b.daily_rate)}</td>
                <td>
                  {canSetBeds()
                    ? <select className="hm-select" style={{ width: 140 }} value={b.status} onChange={(e) => setStatus(b, e.target.value)}>{BED_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                    : <Badge>{b.status}</Badge>}
                </td>
                <td>{canAdmin() && <button className="hm-btn sm danger" onClick={() => remove(b)}><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Board({ onBeds }) {
  const [data, setData] = useState(null);
  const [type, setType] = useState('');
  const load = useCallback(() => get('/api/infra/board').then((r) => setData(r.data)), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const rooms = (data?.rooms || []).filter((r) => !type || r.type === type);
  const beds = (data?.rooms || []).reduce((a, r) => ({ total: a.total + r.beds_total, free: a.free + r.beds_available, used: a.used + r.beds_occupied }), { total: 0, free: 0, used: 0 });
  const opd = (data?.rooms || []).filter((r) => r.type === 'OPD Cabin');
  return (
    <>
      <div className="hm-stats">
        <Stat label="Rooms in use" value={data?.rooms?.length ?? '—'} />
        <Stat label="OPD cabins staffed now" value={`${opd.filter((r) => r.current.length).length}/${opd.length}`} />
        <Stat label="Beds available" value={`${beds.free}/${beds.total}`} tone={beds.total && beds.free / beds.total < 0.1 ? 'bad' : 'good'} />
        <Stat label="Beds occupied" value={beds.used} note={beds.total ? `${Math.round((beds.used / beds.total) * 100)}% occupancy` : ''} />
      </div>
      <div className="hm-toolbar">
        <select className="hm-select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All room types</option>{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="hm-muted" style={{ fontSize: 12.5 }}>Refreshes every minute · {todayIST()}</span>
      </div>
      {rooms.length === 0 ? <Empty>No rooms yet. Add them on the Rooms tab.</Empty> : (
        <div className="hm-rooms">
          {rooms.map((r) => (
            <div key={r.id} className={`hm-room ${r.status === 'Maintenance' ? 'maint' : r.current.length ? 'busy' : 'idle'}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><h4>{r.name}</h4><span className="hm-muted" style={{ fontSize: 12 }}>{r.type}{r.room_number ? ` · ${r.room_number}` : ''}{r.department_name ? ` · ${r.department_name}` : ''}</span></div>
                {r.status === 'Maintenance' && <Badge>Maintenance</Badge>}
              </div>
              {r.current.map((d, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <Badge tone="green">Now</Badge> <strong>{d.first_name} {d.last_name}</strong> <span className="hm-muted">until {d.end_time}</span>
                  {d.duty_type === 'OPD' && <span className="hm-muted"> · {d.waiting} waiting/booked</span>}
                </div>
              ))}
              {r.later.slice(0, 2).map((d, i) => (
                <div key={i} style={{ fontSize: 12.5 }} className="hm-muted">{d.start_time}–{d.end_time} {d.first_name} {d.last_name} ({d.duty_type})</div>
              ))}
              {!r.current.length && r.earlier.map((d, i) => (
                <div key={`e${i}`} style={{ fontSize: 12.5 }} className="hm-muted">Earlier: {d.start_time}–{d.end_time} {d.first_name} {d.last_name} ({d.duty_type})</div>
              ))}
              {!r.current.length && !r.later.length && !r.earlier.length && <div className="hm-muted" style={{ fontSize: 12.5 }}>No one rostered today</div>}
              {r.beds_total > 0 && (
                <button type="button" className="hm-btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onBeds(r)}>
                  <BedDouble size={13} /> {r.beds_available} free · {r.beds_occupied} occupied · {r.beds_total} beds
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function RoomManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [tab, setTab] = useState('board');
  const [rooms, setRooms] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [type, setType] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState(null);
  const [bedsFor, setBedsFor] = useState(null);

  const load = useCallback(() => get(`/api/infra${showInactive ? '?include_inactive=1' : ''}`).then((r) => setRooms(r.data.items || [])), [showInactive]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    get('/api/departments?is_active=true').then((r) => setDepartments(r.data.departments || []));
    if (isCentral()) get('/api/branches').then((r) => setBranches(r.data.branches || []));
  }, []);
  const shown = useMemo(() => rooms.filter((r) => !type || r.type === type), [rooms, type]);

  const remove = async (r) => {
    if (!window.confirm(`Delete ${r.name}?`)) return;
    const res = await del(`/api/infra/delete/${r.id}`);
    if (!res.ok) return showAlert(res.data.message || 'Could not delete', 'error');
    load();
  };

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4500} />}
      <PageHead title="Room Management" subtitle="Consultation rooms, wards, ICU and theatres, who is working in them, and their beds">
        {canAdmin() && <button className="hm-btn primary" onClick={() => setEdit({})}><Plus size={16} /> Add room</button>}
      </PageHead>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'board', label: 'Live board' }, { id: 'rooms', label: 'Rooms' }]} />

      {tab === 'board' && <Board onBeds={setBedsFor} />}
      {tab === 'rooms' && (
        <div className="hm-card">
          <div className="hm-card-head">
            <div className="hm-toolbar">
              <select className="hm-select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <label className="hm-check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show rooms not in use</label>
            </div>
            <span className="hm-muted" style={{ fontSize: 12.5 }}>{shown.length} rooms</span>
          </div>
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Room</th><th>Type</th><th>Department</th><th>Location</th><th className="num">Capacity</th><th>Beds</th><th>Condition</th><th /></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={8}><Empty>No rooms.</Empty></td></tr>}
                {shown.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                    <td><strong>{r.name}</strong>{r.room_number && <span className="sub">No. {r.room_number}</span>}</td>
                    <td>{r.type}</td>
                    <td>{r.department_name || '—'}</td>
                    <td>{[r.block, r.floor !== null && r.floor !== undefined ? `Floor ${r.floor}` : null].filter(Boolean).join(', ') || '—'}</td>
                    <td className="num">{r.capacity ?? '—'}</td>
                    <td>{r.beds_total ? `${r.beds_available}/${r.beds_total} free` : BEDDED.includes(r.type) ? <span className="hm-muted">none</span> : '—'}</td>
                    <td>{r.is_active ? <Badge>{r.status}</Badge> : <Badge>Not in use</Badge>}</td>
                    <td><div className="hm-actions">
                      {(BEDDED.includes(r.type) || r.beds_total > 0) && <button className="hm-btn sm" onClick={() => setBedsFor(r)}><BedDouble size={13} /> Beds</button>}
                      {canAdmin() && <button className="hm-btn sm" onClick={() => setEdit(r)}>Edit</button>}
                      {canAdmin() && <button className="hm-btn sm danger" onClick={() => remove(r)}><Trash2 size={13} /></button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && <RoomForm room={edit.id ? edit : null} departments={departments} branches={branches} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} showAlert={showAlert} />}
      {bedsFor && <BedsModal room={bedsFor} onClose={() => { setBedsFor(null); load(); }} showAlert={showAlert} />}
    </div>
  );
}

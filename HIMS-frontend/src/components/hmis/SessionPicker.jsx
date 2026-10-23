import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Zap, DoorOpen, X } from 'lucide-react';
import { Empty } from './ui';
import { get, todayIST, addDays, fmtDate, weekdayShort, money } from '../../utils/hmisApi';

// Doctor OPD sessions for a day and their slots, built for a front desk that
// books all day: who is in OPD now comes first, one click takes the next free
// slot or a walk-in, past slots stay out of the way, availability refreshes
// on its own, and the keyboard reaches everything (/ to search, Enter to take
// the next free slot of a single match).
//
// onSelect receives { session, time } for a slot, { session, walkIn: true }
// for a walk-in, or null when the choice is no longer available.

const REFRESH_MS = 30000;

const nowHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const inWords = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

// Where a session stands right now.
const sessionState = (s, date, now) => {
  if (date !== todayIST()) return { key: 'later', rank: 1, label: `${s.start_time}–${s.end_time}` };
  if (now >= s.end_time) return { key: 'over', rank: 3, label: 'OPD over' };
  if (now >= s.start_time) return { key: 'now', rank: 0, label: `In OPD now · till ${s.end_time}` };
  return { key: 'soon', rank: 1, label: `Starts ${s.start_time} · in ${inWords(toMin(s.start_time) - toMin(now))}` };
};

export default function SessionPicker({ date, setDate, selected, onSelect, allowWalkIn = false, autoFocus = false }) {
  const [dept, setDept] = useState('');
  const [doctorQ, setDoctorQ] = useState('');
  const [sessions, setSessions] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(nowHM);
  const [notice, setNotice] = useState('');
  const searchRef = useRef(null);

  const load = useCallback(async (silent) => {
    if (!silent) setSessions(null);
    const r = await get(`/api/appointments/sessions?date=${date}`);
    setSessions(r.data.sessions || []);
    setNow(nowHM());
  }, [date]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Another desk may take the chosen slot meanwhile; let go of it, say so.
  useEffect(() => {
    if (!selected || !sessions) return;
    const s = sessions.find((x) => x.id === selected.session.id);
    const stillOk = selected.walkIn ? !!s : s?.slots.some((sl) => sl.time === selected.time && sl.available > 0 && !sl.past);
    if (!stillOk) {
      onSelect(null);
      setNotice('The chosen slot was just taken at another desk. Pick another.');
    }
  }, [sessions, selected, onSelect]);

  // "/" jumps to the doctor search from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (autoFocus) searchRef.current?.focus(); }, [autoFocus]);

  const deptCounts = useMemo(() => {
    const m = new Map();
    (sessions || []).forEach((s) => m.set(s.department_name || 'Other', (m.get(s.department_name || 'Other') || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);

  const words = doctorQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => (sessions || [])
    .filter((s) => !dept || (s.department_name || 'Other') === dept)
    .filter((s) => {
      const hay = `dr ${s.first_name} ${s.last_name} ${s.designation || ''} ${s.qualification || ''} ${s.department_name || ''} ${s.room_name || ''} ${s.room_number || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((s) => ({ ...s, state: sessionState(s, date, now) }))
    .sort((a, b) => a.state.rank - b.state.rank || a.start_time.localeCompare(b.start_time)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sessions, dept, doctorQ, date, now]);

  const nextFree = (s) => s.slots.find((sl) => !sl.past && sl.available > 0);
  const pick = (choice) => { setNotice(''); onSelect(choice); };

  const onSearchKey = (e) => {
    if (e.key === 'Escape') setDoctorQ('');
    if (e.key === 'Enter' && shown.length === 1) {
      const s = shown[0];
      const free = nextFree(s);
      if (free) pick({ session: s, time: free.time });
      else if (allowWalkIn && s.state.key === 'now') pick({ session: s, walkIn: true });
    }
  };

  const today = todayIST();
  const pastCount = (s) => s.slots.filter((sl) => sl.past).length;

  return (
    <div className="sp">
      <div className="sp-bar">
        <div className="sp-dates">
          <button type="button" className="hm-btn sm" onClick={() => setDate(addDays(date, -1))} disabled={date <= today} aria-label="Previous day"><ChevronLeft size={14} /></button>
          <button type="button" className={`hm-chip${date === today ? ' on' : ''}`} onClick={() => setDate(today)}>Today</button>
          <button type="button" className={`hm-chip${date === addDays(today, 1) ? ' on' : ''}`} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
          <input type="date" className="hm-input" style={{ width: 150 }} min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <button type="button" className="hm-btn sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
        <div className="sp-search">
          <Search size={15} />
          <input ref={searchRef} className="hm-input" placeholder="Search doctor, specialty or room" value={doctorQ}
            onChange={(e) => setDoctorQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search doctor" />
          {doctorQ ? <button type="button" className="hm-x" onClick={() => setDoctorQ('')} aria-label="Clear search"><X size={14} /></button> : <kbd>/</kbd>}
        </div>
      </div>

      {deptCounts.length > 1 && (
        <div className="hm-chips">
          <button type="button" className={`hm-chip${!dept ? ' on' : ''}`} onClick={() => setDept('')}>All · {sessions.length}</button>
          {deptCounts.map(([name, n]) => (
            <button key={name} type="button" className={`hm-chip${dept === name ? ' on' : ''}`} onClick={() => setDept(dept === name ? '' : name)}>{name} · {n}</button>
          ))}
        </div>
      )}

      {notice && <div className="hm-note warn">{notice}</div>}

      {!sessions && <Empty>Loading doctors…</Empty>}
      {sessions?.length === 0 && <Empty>No doctor has OPD on {weekdayShort(date)}, {fmtDate(date)}. OPD sessions come from the Duty Roster.</Empty>}
      {sessions?.length > 0 && shown.length === 0 && <Empty>No doctor matches “{doctorQ || dept}” on {fmtDate(date)}.</Empty>}

      {shown.map((s) => {
        const free = nextFree(s);
        const isSel = selected?.session.id === s.id;
        const past = pastCount(s);
        const slots = showPast ? s.slots : s.slots.filter((sl) => !sl.past);
        const canWalkIn = allowWalkIn && s.state.key === 'now';
        return (
          <div key={s.id} className={`sp-card st-${s.state.key}${isSel ? ' on' : ''}`}>
            <div className="sp-head">
              <div className="sp-doc">
                <strong>Dr. {s.first_name} {s.last_name}</strong>
                <span>{[s.designation, s.qualification].filter(Boolean).join(' · ')}</span>
                <span className="sp-meta">{s.department_name} · {s.room_name}{s.room_number ? ` (${s.room_number})` : ''}</span>
              </div>
              <div className="sp-side">
                <span className={`sp-state ${s.state.key}`}>{s.state.label}</span>
                <span className="sp-fee">{money(s.consultation_fee)}</span>
                <span className="sp-free">{s.free ? `${s.free} place${s.free === 1 ? '' : 's'} left` : 'Fully booked'}</span>
              </div>
            </div>
            {s.state.key !== 'over' && (
              <div className="sp-quick">
                {free && (
                  <button type="button" className={`hm-btn sm${isSel && selected.time === free.time ? ' primary' : ''}`} onClick={() => pick({ session: s, time: free.time })}>
                    <Zap size={13} /> Next free {free.time}
                  </button>
                )}
                {canWalkIn && (
                  <button type="button" className={`hm-btn sm${isSel && selected.walkIn ? ' primary' : ''}`} onClick={() => pick({ session: s, walkIn: true })}>
                    <DoorOpen size={13} /> Walk-in now
                  </button>
                )}
              </div>
            )}
            {s.state.key !== 'over' || showPast ? (
              <div className="hm-slots">
                {slots.map((sl) => {
                  const on = isSel && !selected.walkIn && selected.time === sl.time;
                  const full = sl.available === 0;
                  const few = !full && sl.capacity > 1 && sl.available < sl.capacity;
                  return (
                    <button key={sl.time} type="button" disabled={sl.past || full}
                      className={`hm-slot${on ? ' on' : ''}${few ? ' few' : ''}${full ? ' full' : ''}`}
                      title={sl.past ? 'Time has passed' : full ? 'Fully booked' : `${sl.available} of ${sl.capacity} free`}
                      onClick={() => pick({ session: s, time: sl.time })}>
                      {sl.time}
                      {full ? <small>Full</small> : sl.capacity > 1 && <small>{sl.available} left</small>}
                    </button>
                  );
                })}
                {slots.length === 0 && <span className="hm-muted" style={{ fontSize: 13 }}>No slots left today{canWalkIn ? ' — use Walk-in now' : ''}.</span>}
              </div>
            ) : null}
            {past > 0 && !showPast && s.state.key === 'now' && (
              <span className="sp-past">{past} earlier slot{past === 1 ? '' : 's'} hidden</span>
            )}
          </div>
        );
      })}

      {sessions?.some((s) => s.slots.some((sl) => sl.past)) && (
        <label className="hm-check" style={{ fontSize: 12.5, color: 'var(--text-soft)' }}>
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past slots and finished sessions
        </label>
      )}
    </div>
  );
}

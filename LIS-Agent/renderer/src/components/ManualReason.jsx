import { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../apiBase';

// The reasons offered when a result is typed or changed by hand (the server
// holds the list, so the web app and the agent always agree).
export function useManualReasons() {
  const [reasons, setReasons] = useState([]);
  useEffect(() => {
    axios.get(`${API_BASE}/api/lab/manual-entry/reasons`).then((r) => setReasons(r.data?.reasons || [])).catch(() => {});
  }, []);
  return reasons;
}

// A reason is complete when one is chosen and, where the reason asks for it, a note of a few words.
export const reasonComplete = (reasons, code, note) => {
  const r = reasons.find((x) => x.code === code);
  return !!r && (!r.note_required || note.trim().length >= 5);
};

// Mandatory reason for entering / changing a result by hand.
export function ReasonPicker({ reasons, code, note, onCode, onNote, dark = false }) {
  const chosen = reasons.find((r) => r.code === code);
  const style = dark ? { background: '#0f172a', color: '#fff', borderColor: '#334155' } : undefined;
  return (
    <div className="mr-picker" style={{ display: 'grid', gap: 8 }}>
      <label className="field-group">
        <span className="field-label" style={dark ? { color: '#cbd5e1' } : undefined}>Reason for entering by hand <i style={{ color: '#dc2626', fontStyle: 'normal' }}>*</i></span>
        <select className="control" style={style} value={code} onChange={(e) => onCode(e.target.value)}>
          <option value="">Select a reason…</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </label>
      {chosen && (
        <input
          className="control" style={style} value={note} onChange={(e) => onNote(e.target.value)}
          placeholder={chosen.note_required ? 'Explain briefly (required)' : 'Note (optional)'}
        />
      )}
    </div>
  );
}

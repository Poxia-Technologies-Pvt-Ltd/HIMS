import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/* ─────────────────────────────────────────────────────────────
   Portal-based Searchable Select
   The dropdown is rendered into document.body so it is NEVER
   clipped by overflow:hidden / overflow:auto on any ancestor.
───────────────────────────────────────────────────────────── */
const SearchableSelect = ({
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  displayField = 'label',
  valueField = 'value',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch]  = useState('');
  const [pos, setPos]        = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef(null);
  const searchRef  = useRef(null);
  const dropRef    = useRef(null);

  const selected = options.find(o => o[valueField] === value);
  const filtered = options.filter(o =>
    o[displayField].toLowerCase().includes(search.toLowerCase())
  );

  /* Position the portal dropdown under the trigger */
  const openDropdown = () => {
    if (disabled) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH = Math.min(260, filtered.length * 38 + 52);

    setPos({
      top:    spaceBelow > dropH ? rect.bottom + window.scrollY + 4
                                 : rect.top + window.scrollY - dropH - 4,
      left:   rect.left  + window.scrollX,
      width:  rect.width,
    });
    setIsOpen(true);
  };

  /* Re-position on scroll / resize while open */
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos(p => ({ ...p, top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX }));
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen]);

  /* Close on outside click */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (
        dropRef.current    && !dropRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  /* Focus search input when opened */
  useEffect(() => {
    if (isOpen && searchRef.current) searchRef.current.focus();
  }, [isOpen]);

  const handleSelect = (opt) => {
    onChange(opt[valueField]);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <>
      {/* Trigger */}
      <div
        ref={triggerRef}
        className={`ss-trigger ${isOpen ? 'ss-open' : ''} ${disabled ? 'ss-disabled' : ''}`}
        onClick={openDropdown}
        role="combobox"
        aria-expanded={isOpen}
      >
        <span className={selected ? 'ss-value' : 'ss-placeholder'}>
          {selected ? selected[displayField] : placeholder}
        </span>
        <svg
          className={`ss-chevron ${isOpen ? 'ss-chevron-up' : ''}`}
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Portal dropdown — lives in <body>, never clipped */}
      {isOpen && createPortal(
        <div
          ref={dropRef}
          className="ss-dropdown"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {/* Search */}
          <div className="ss-search-row">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="ss-search-input"
              placeholder={searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>

          {/* Options */}
          <div className="ss-options">
            {filtered.length > 0 ? filtered.map(opt => (
              <div
                key={opt[valueField]}
                className={`ss-option ${opt[valueField] === value ? 'ss-option-selected' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleSelect(opt)}
              >
                {opt[displayField]}
              </div>
            )) : (
              <div className="ss-no-results">No results found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ─────────────────────────────────────────────────────────────
   Schedule New Duty Modal
───────────────────────────────────────────────────────────── */
const ScheduleDutyModal = ({ doctors = [], rooms = [], onClose, onSubmit }) => {
  const [form, setForm] = useState({
    doctorId:  '',
    roomId:    '',
    dutyDate:  '',
    startTime: '',
    endTime:   '',
    notes:     '',
  });
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.doctorId)  return setError('Please select a laboratory personnel.');
    if (!form.roomId)    return setError('Please assign a laboratory/room.');
    if (!form.dutyDate)  return setError('Please pick a date.');
    if (!form.startTime) return setError('Please set a start time.');
    if (!form.endTime)   return setError('Please set an end time.');
    if (form.startTime >= form.endTime) return setError('End time must be after start time.');
    setError('');
    onSubmit(form);
  };

  const doctorOptions = doctors.map(d => ({
    value: d.id.toString(),
    label: `${d.first_name} ${d.last_name} (${d.role || 'Staff'}${d.department ? ` - ${d.department}` : ''})`,
  }));

  const roomOptions = rooms.map(r => ({
    value: r.id.toString(),
    label: `${r.name}${r.block ? ` · ${r.block}` : ''}${r.floor ? `, Floor ${r.floor}` : ''}`,
  }));

  /* Close on overlay click */
  const handleOverlay = (e) => { if (e.target === e.currentTarget) onClose(); };

  return createPortal(
    <div className="sdm-overlay" onClick={handleOverlay}>
      <div className="sdm-modal" role="dialog" aria-modal="true" aria-labelledby="sdm-title">

        {/* ── Header ── */}
        <div className="sdm-header">
          <div className="sdm-header-accent" />
          <h2 id="sdm-title" className="sdm-title">Schedule New Duty</h2>
          <button className="sdm-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="sdm-body">

            {error && (
              <div className="sdm-error">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            {/* Personnel */}
            <div className="sdm-field">
              <label className="sdm-label">
                Select Personnel <span className="sdm-required">*</span>
              </label>
              <SearchableSelect
                options={doctorOptions}
                value={form.doctorId}
                onChange={v => set('doctorId', v)}
                placeholder="— Choose Doctor or Staff —"
                searchPlaceholder="Search by name or role…"
              />
            </div>

            {/* Laboratory */}
            <div className="sdm-field">
              <label className="sdm-label">
                Assign Room / Facility <span className="sdm-required">*</span>
              </label>
              <SearchableSelect
                options={roomOptions}
                value={form.roomId}
                onChange={v => set('roomId', v)}
                placeholder="— Choose a room —"
                searchPlaceholder="Search by room name or block…"
              />
            </div>

            {/* Date */}
            <div className="sdm-field">
              <label className="sdm-label">
                Duty Date <span className="sdm-required">*</span>
              </label>
              <input
                type="date"
                className="sdm-input"
                value={form.dutyDate}
                onChange={e => set('dutyDate', e.target.value)}
                required
              />
            </div>

            {/* Time row */}
            <div className="sdm-time-row">
              <div className="sdm-field">
                <label className="sdm-label">
                  Start Time <span className="sdm-required">*</span>
                </label>
                <div className="sdm-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <input
                    type="time"
                    className="sdm-input sdm-input-padded"
                    value={form.startTime}
                    onChange={e => set('startTime', e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="sdm-time-divider">→</div>
              <div className="sdm-field">
                <label className="sdm-label">
                  End Time <span className="sdm-required">*</span>
                </label>
                <div className="sdm-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <input
                    type="time"
                    className="sdm-input sdm-input-padded"
                    value={form.endTime}
                    onChange={e => set('endTime', e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="sdm-field">
              <label className="sdm-label">Duty Instructions <span className="sdm-optional">(optional)</span></label>
              <textarea
                className="sdm-input sdm-textarea"
                rows={3}
                placeholder="Brief description of the lab duty or shift…"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>

          </div>

          {/* ── Footer ── */}
          <div className="sdm-footer">
            <button type="button" className="sdm-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="sdm-btn-submit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Confirm Schedule
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export { SearchableSelect, ScheduleDutyModal };
export default ScheduleDutyModal;
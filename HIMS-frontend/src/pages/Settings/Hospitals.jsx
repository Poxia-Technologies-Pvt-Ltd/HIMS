import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Plus,
  Search,
  Map as MapIcon,
  Grid,
  Layout,
  Building2,
  Building,
  Home,
  Phone,
  Tag,
  MapPin,
  Globe,
  ArrowUp,
  X,
  Loader2
} from 'lucide-react';
import '../../assets/CSS/Hospitals.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Role / Auth Helpers ─────────────────────────────────────────────────────
const roleLevel = () => localStorage.getItem('role_level') || 'Central';
const userBranchId = () => localStorage.getItem('branch_id') || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });
const canEdit = (branch) => {
  const rl = roleLevel();
  if (rl === 'Central') return true;
  if (rl === 'Sub-Central' && branch.branch_level !== 'Central') return true;
  if (rl === 'Branch' && branch.id?.toString() === userBranchId()) return true;
  return false;
};

// ─── Colors ──────────────────────────────────────────────────────────────────
const LEVEL_COLOR = {
  Central: '#0d2554',
  'Sub-Central': '#1a56db',
  Center: '#0ea5e9',
};
const LEVEL_R = { Central: 38, 'Sub-Central': 28, Center: 20 };
const BADGE_CLASS = { Central: 'badge-central', 'Sub-Central': 'badge-sub', Center: 'badge-center' };
const DOT_CLASS = { Central: 'dot-central', 'Sub-Central': 'dot-sub', Center: 'dot-center' };
const TOP_CLASS = { Central: 'top-central', 'Sub-Central': 'top-sub', Center: 'top-center' };

// ─── EMPTY CENTER DATA ────────────────────────────────────────────────────────
const EMPTY_CENTER = {
  district_id: '', branch_name: '', category: '',
  hospital_code: '', hmis_hosp_mapping_code: '', address: '', contact_number: '',
  branch_level: 'Center', parent_branch_id: '',
  latitude: '', longitude: ''
};

// ─── Ranchi District Bounds ───────────────────────────────────────────────────
const RANCHI_CENTER = [23.3441, 85.3096];
const RANCHI_ZOOM = 11;

// ─── Graph Layout: Radial Tree ────────────────────────────────────────────────
function computeLayout(tree, width, height) {
  const nodes = [];
  const edges = [];
  const cx = width / 2;
  const cy = height / 2;

  function place(node, angle, radius, parentNode = null) {
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const placed = { ...node, x, y };
    nodes.push(placed);
    if (parentNode) edges.push({ from: parentNode, to: placed });

    const childCount = node.children?.length || 0;
    if (childCount === 0) return;

    const spread = childCount === 1 ? 0 : Math.PI * 1.2;
    const step = childCount > 1 ? spread / (childCount - 1) : 0;
    const startA = angle - spread / 2;
    const childR = radius + (node.branch_level === 'Central' ? 180 : 130);

    node.children.forEach((child, i) => {
      place(child, startA + i * step, childR, placed);
    });
  }

  tree.forEach((root, i) => {
    const angle = (i / tree.length) * 2 * Math.PI - Math.PI / 2;
    place(root, angle, tree.length === 1 ? 0 : 200, null);
  });

  return { nodes, edges };
}

// ─── Build Tree from flat list ────────────────────────────────────────────────
function buildTree(list) {
  const map = {};
  list.forEach(b => { map[b.id] = { ...b, children: [] }; });
  const roots = [];
  list.forEach(b => {
    if (b.parent_branch_id && map[b.parent_branch_id]) {
      map[b.parent_branch_id].children.push(map[b.id]);
    } else {
      roots.push(map[b.id]);
    }
  });
  return roots;
}

// ─── GRAPH COMPONENT ─────────────────────────────────────────────────────────
function NetworkGraph({ branches, selectedId, onSelect }) {
  const svgRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [dims, setDims] = useState({ w: 900, h: 600 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: width, h: height });
    });
    if (svgRef.current) obs.observe(svgRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  const tree = useMemo(() => buildTree(branches), [branches]);
  const layout = useMemo(() => computeLayout(tree, dims.w, dims.h), [tree, dims]);

  const onMouseDown = (e) => {
    if (e.target.closest('.graph-node-group')) return;
    setDrag({ sx: e.clientX - pan.x, sy: e.clientY - pan.y });
  };
  const onMouseMove = (e) => {
    if (!drag) return;
    setPan({ x: e.clientX - drag.sx, y: e.clientY - drag.sy });
    setTooltip(t => ({ ...t, visible: false }));
  };
  const onMouseUp = () => setDrag(null);

  const onWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(2.5, Math.max(0.3, z - e.deltaY * 0.001)));
  };

  useEffect(() => {
    const el = svgRef.current;
    if (el) el.addEventListener('wheel', onWheel, { passive: false });
    return () => { if (el) el.removeEventListener('wheel', onWheel); };
  }, []);

  const zoomIn = () => setZoom(z => Math.min(2.5, z + 0.15));
  const zoomOut = () => setZoom(z => Math.max(0.3, z - 0.15));
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="h-graph-bg" />
      <svg
        ref={svgRef}
        className="h-graph-svg"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#cbd5e1" />
          </marker>
          {Object.entries(LEVEL_COLOR).map(([level, color]) => (
            <radialGradient key={level} id={`grd-${level.replace(' ', '')}`} cx="35%" cy="30%" r="65%">
              <stop offset="0%" stopColor={color} stopOpacity="0.85" />
              <stop offset="100%" stopColor={color} stopOpacity="1" />
            </radialGradient>
          ))}
        </defs>
        <g transform={transform}>
          {layout.edges.map((e, i) => {
            const midX = (e.from.x + e.to.x) / 2;
            const midY = (e.from.y + e.to.y) / 2 - 20;
            return (
              <path
                key={i}
                d={`M ${e.from.x} ${e.from.y} Q ${midX} ${midY} ${e.to.x} ${e.to.y}`}
                fill="none"
                stroke={selectedId === e.from.id || selectedId === e.to.id ? '#3b82f6' : '#cbd5e1'}
                strokeWidth={selectedId === e.from.id || selectedId === e.to.id ? 2 : 1.5}
                strokeDasharray={selectedId === e.from.id || selectedId === e.to.id ? 'none' : '5,4'}
                opacity={0.7}
              />
            );
          })}
          {layout.nodes.map(node => {
            const r = LEVEL_R[node.branch_level] || 20;
            const isSelected = selectedId === node.id;
            const grdId = `grd-${(node.branch_level || 'Center').replace(' ', '')}`;
            return (
              <g
                key={node.id}
                className="graph-node-group"
                onClick={() => onSelect(node)}
                onMouseEnter={(e) => {
                  const rect = svgRef.current.getBoundingClientRect();
                  setTooltip({ visible: true, x: e.clientX - rect.left, y: e.clientY - rect.top, text: node.branch_name });
                }}
                onMouseLeave={() => setTooltip(t => ({ ...t, visible: false }))}
              >
                {isSelected && (
                  <circle cx={node.x} cy={node.y} r={r + 10} fill="none"
                    stroke="#3b82f6" strokeWidth="2" opacity="0.5" strokeDasharray="4 3">
                    <animateTransform attributeName="transform" type="rotate"
                      from={`0 ${node.x} ${node.y}`} to={`360 ${node.x} ${node.y}`}
                      dur="8s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle className="graph-node-outer" cx={node.x} cy={node.y} r={r + 5}
                  fill={LEVEL_COLOR[node.branch_level] || '#0ea5e9'} opacity={0.12} />
                <circle cx={node.x} cy={node.y} r={r}
                  fill={`url(#${grdId})`}
                  stroke={isSelected ? '#3b82f6' : 'white'}
                  strokeWidth={isSelected ? 3 : 2} />
                <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                  fill="white" fontSize={r > 28 ? 9 : 7} fontWeight="700"
                  fontFamily="Syne, sans-serif" letterSpacing="0.3" style={{ pointerEvents: 'none' }}>
                  {node.hospital_code}
                </text>
                <text x={node.x} y={node.y + r + 14} textAnchor="middle" dominantBaseline="middle"
                  fill={isSelected ? '#1a56db' : '#334155'}
                  fontSize={r > 28 ? 11 : 10} fontWeight={isSelected ? '700' : '600'}
                  fontFamily="Figtree, sans-serif" style={{ pointerEvents: 'none' }}>
                  {node.branch_name.length > 18 ? node.branch_name.slice(0, 16) + '…' : node.branch_name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className={`h-tooltip ${tooltip.visible ? 'visible' : ''}`} style={{ left: tooltip.x, top: tooltip.y }}>
        {tooltip.text}
      </div>
      <div className="h-graph-controls">
        <button className="h-ctrl-btn" onClick={zoomIn} title="Zoom in">+</button>
        <button className="h-ctrl-btn" onClick={zoomOut} title="Zoom out">−</button>
        <button className="h-ctrl-btn" onClick={reset} title="Reset view" style={{ fontSize: 13 }}>⌂</button>
      </div>
      <div style={{
        position: 'absolute', bottom: 20, left: 16,
        background: 'white', border: '1px solid #e2e8f0',
        borderRadius: 8, padding: '6px 12px',
        fontSize: 11, fontWeight: 700, color: '#475569',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)', letterSpacing: '0.5px'
      }}>
        {layout.nodes.length} nodes · {layout.edges.length} connections
      </div>
    </div>
  );
}

// ─── GEOCODE helper (shared) ──────────────────────────────────────────────────
async function geocodeOne(address) {
  const query = encodeURIComponent(`${address}, Ranchi, Jharkhand, India`);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=in`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'HospitalNetworkApp/1.0' } }
  );
  const data = await res.json();
  if (!data.length) throw new Error('Not found');
  return { lat: parseFloat(data[0].lat).toFixed(7), lng: parseFloat(data[0].lon).toFixed(7) };
}

// ─── MAP COMPONENT ────────────────────────────────────────────────────────────
function MapView({ branches, selectedId, onSelect, onCoordsUpdate }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef({});
  const [leafletReady, setLeafletReady] = useState(false);

  // Bulk geocoding state
  const [showFixer, setShowFixer] = useState(false);
  const [fixStatuses, setFixStatuses] = useState({}); // id → 'idle'|'loading'|'done'|'error'
  const [batchRunning, setBatchRunning] = useState(false);

  // Load Leaflet CSS + JS dynamically
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!leafletReady || !mapRef.current || leafletRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { center: RANCHI_CENTER, zoom: RANCHI_ZOOM, zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const ranchiBoundary = [
      [23.5800, 85.0500], [23.6200, 85.1500], [23.6500, 85.2500], [23.6300, 85.3800],
      [23.6000, 85.4800], [23.5500, 85.5500], [23.5000, 85.6000], [23.4200, 85.6200],
      [23.3500, 85.6000], [23.2800, 85.5500], [23.2200, 85.4800], [23.1800, 85.4000],
      [23.1500, 85.3000], [23.1600, 85.2000], [23.1900, 85.1200], [23.2500, 85.0600],
      [23.3200, 85.0200], [23.4000, 85.0100], [23.4800, 85.0200], [23.5800, 85.0500],
    ];
    L.polygon(ranchiBoundary, { color: '#1a56db', weight: 2, fillColor: '#dbeafe', fillOpacity: 0.12, dashArray: '6 4' }).addTo(map);
    L.marker([23.3441, 85.3096], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:rgba(13,37,84,0.85);color:white;font-size:11px;font-weight:700;font-family:Syne,sans-serif;padding:3px 9px;border-radius:20px;white-space:nowrap;letter-spacing:1px;text-transform:uppercase;pointer-events:none;">Ranchi District</div>`,
        iconAnchor: [50, 10],
      })
    }).addTo(map);
    leafletRef.current = map;
    return () => { map.remove(); leafletRef.current = null; };
  }, [leafletReady]);

  // Add / update markers
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    branches.forEach(b => {
      const lat = parseFloat(b.latitude);
      const lng = parseFloat(b.longitude);
      if (isNaN(lat) || isNaN(lng)) return;
      const color = LEVEL_COLOR[b.branch_level] || '#0ea5e9';
      const size = b.branch_level === 'Central' ? 44 : b.branch_level === 'Sub-Central' ? 36 : 28;
      const ring = selectedId === b.id ? `box-shadow:0 0 0 3px #3b82f6,0 2px 8px rgba(0,0,0,0.25);` : `box-shadow:0 2px 8px rgba(0,0,0,0.2);`;
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;${ring}cursor:pointer;font-size:8px;font-weight:800;color:white;font-family:Syne,sans-serif;letter-spacing:0.3px;text-align:center;line-height:1.1;padding:3px;">${b.hospital_code}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -(size / 2 + 4)],
      });
      const marker = L.marker([lat, lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-family:Figtree,sans-serif;min-width:180px;"><div style="font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:#0f172a;margin-bottom:4px;">${b.branch_name}</div><div style="font-size:11px;font-weight:700;color:${color};background:${color}18;padding:2px 7px;border-radius:4px;display:inline-block;margin-bottom:8px;">${b.hospital_code}</div><div style="font-size:12px;color:#475569;display:flex;flex-direction:column;gap:4px;">${b.district_name ? `<span>📍 ${b.district_name}</span>` : ''} ${b.branch_level ? `<span>🏷 ${b.branch_level}</span>` : ''} ${b.contact_number ? `<span>📞 ${b.contact_number}</span>` : ''} ${b.address ? `<span style="font-size:11px;">📌 ${b.address}</span>` : ''}</div></div>`, { maxWidth: 260 })
        .on('click', () => onSelect(b));
      markersRef.current[b.id] = marker;
    });
  }, [branches, leafletReady]);

  // Highlight selected
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const b = branches.find(br => br.id?.toString() === id?.toString());
      if (!b) return;
      const color = LEVEL_COLOR[b.branch_level] || '#0ea5e9';
      const size = b.branch_level === 'Central' ? 44 : b.branch_level === 'Sub-Central' ? 36 : 28;
      const isSel = selectedId?.toString() === id?.toString();
      const ring = isSel ? `box-shadow:0 0 0 3px #3b82f6,0 2px 8px rgba(0,0,0,0.25);transform:scale(1.15);` : `box-shadow:0 2px 8px rgba(0,0,0,0.2);`;
      marker.setIcon(L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;${ring}cursor:pointer;font-size:8px;font-weight:800;color:white;font-family:Syne,sans-serif;letter-spacing:0.3px;text-align:center;line-height:1.1;padding:3px;">${b.hospital_code}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -(size / 2 + 4)],
      }));
      if (isSel) {
        const lat = parseFloat(b.latitude), lng = parseFloat(b.longitude);
        if (!isNaN(lat) && !isNaN(lng)) { map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: true }); marker.openPopup(); }
      }
    });
  }, [selectedId, branches]);

  // ── Geocode single facility ──────────────────────────────────
  const geocodeSingle = async (b) => {
    if (!b.address) return;
    setFixStatuses(s => ({ ...s, [b.id]: 'loading' }));
    try {
      const { lat, lng } = await geocodeOne(b.address);
      await onCoordsUpdate(b.id, lat, lng);
      setFixStatuses(s => ({ ...s, [b.id]: 'done' }));
    } catch {
      setFixStatuses(s => ({ ...s, [b.id]: 'error' }));
    }
  };

  // ── Geocode all missing — with 1.2s delay between requests (Nominatim rate limit) ──
  const geocodeAll = async () => {
    const missing = branches.filter(b => !b.latitude && !b.longitude && b.address);
    if (!missing.length) return;
    setBatchRunning(true);
    for (const b of missing) {
      setFixStatuses(s => ({ ...s, [b.id]: 'loading' }));
      try {
        const { lat, lng } = await geocodeOne(b.address);
        await onCoordsUpdate(b.id, lat, lng);
        setFixStatuses(s => ({ ...s, [b.id]: 'done' }));
      } catch {
        setFixStatuses(s => ({ ...s, [b.id]: 'error' }));
      }
      await new Promise(r => setTimeout(r, 1200));
    }
    setBatchRunning(false);
  };

  const branchesWithCoords = branches.filter(b => !isNaN(parseFloat(b.latitude)) && !isNaN(parseFloat(b.longitude)));
  const branchesMissingCoords = branches.filter(b => isNaN(parseFloat(b.latitude)) || isNaN(parseFloat(b.longitude)));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Map Legend */}
      <div className="h-map-legend">
        <div className="h-map-legend-title">Legend</div>
        {[
          { color: '#0d2554', label: 'Central Hub' },
          { color: '#1a56db', label: 'Sub-Central Hub' },
          { color: '#0ea5e9', label: 'Center / Lab' },
        ].map(l => (
          <div className="h-map-legend-row" key={l.label}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: l.color, flexShrink: 0, display: 'inline-block', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{l.label}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
          {branchesWithCoords.length} / {branches.length} mapped
        </div>
      </div>

      {/* Missing coords banner */}
      {branchesMissingCoords.length > 0 && (
        <div className="h-map-fix-banner">
          <div className="h-map-fix-banner-left">
            <div className="h-map-fix-banner-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div>
              <div className="h-map-fix-banner-title">
                {branchesMissingCoords.length} {branchesMissingCoords.length === 1 ? 'facility' : 'facilities'} not on map
              </div>
              <div className="h-map-fix-banner-sub">Auto-detect coordinates from their addresses</div>
            </div>
          </div>
          <button className="h-map-fix-btn" onClick={() => setShowFixer(f => !f)}>
            {showFixer ? 'Hide' : 'Fix Now'}
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
              style={{ transform: showFixer ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}

      {/* Fixer drawer */}
      {showFixer && branchesMissingCoords.length > 0 && (
        <div className="h-map-fixer-drawer">
          <div className="h-map-fixer-header">
            <span className="h-map-fixer-header-title">
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              Geocode from address
            </span>
            <button
              className="btn-geocode-all"
              onClick={geocodeAll}
              disabled={batchRunning}
            >
              {batchRunning ? (
                <>
                  <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    style={{ animation: 'spin 0.8s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Running…
                </>
              ) : (
                <>
                  <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.08-8.53" />
                  </svg>
                  Geocode All ({branchesMissingCoords.filter(b => b.address).length})
                </>
              )}
            </button>
          </div>

          <div className="h-map-fixer-list">
            {branchesMissingCoords.map(b => {
              const status = fixStatuses[b.id] || 'idle';
              return (
                <div key={b.id} className={`h-map-fixer-row ${status}`}>
                  <div className="h-map-fixer-row-info">
                    <span className={`h-node-dot ${DOT_CLASS[b.branch_level] || 'dot-center'}`} style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="h-map-fixer-row-name">{b.branch_name}</div>
                      {b.address
                        ? <div className="h-map-fixer-row-addr">{b.address}</div>
                        : <div className="h-map-fixer-row-no-addr">No address — edit to add one</div>
                      }
                    </div>
                  </div>
                  <div className="h-map-fixer-row-action">
                    {status === 'loading' && (
                      <svg width="16" height="16" fill="none" stroke="#3b82f6" strokeWidth="2" viewBox="0 0 24 24"
                        style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    )}
                    {status === 'done' && (
                      <span className="h-fixer-status-done">
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Placed
                      </span>
                    )}
                    {status === 'error' && (
                      <span className="h-fixer-status-error">
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Not found
                      </span>
                    )}
                    {(status === 'idle' || status === 'error') && b.address && (
                      <button
                        className="h-fixer-single-btn"
                        onClick={() => geocodeSingle(b)}
                        disabled={batchRunning}
                      >
                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                        Locate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!leafletReady && (
        <div className="h-loading" style={{ position: 'absolute', inset: 0, background: 'rgba(240,244,248,0.9)', zIndex: 10 }}>
          <svg width="24" height="24" fill="none" stroke="#94a3b8" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 12a9 9 0 1 1-6.219-8.56">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
            </path>
          </svg>
          Loading map…
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Hospitals() {
  const [branches, setBranches] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [states, setStates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'grid' | 'map'
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);

  const [showDistrictModal, setShowDistrictModal] = useState(false);
  const [showCenterModal, setShowCenterModal] = useState(false);
  const [editDistrictId, setEditDistrictId] = useState(null);
  const [editCenterId, setEditCenterId] = useState(null);

  const [districtData, setDistrictData] = useState({ name: '' });
  const [centerData, setCenterData] = useState(EMPTY_CENTER);
  const [formStateId, setFormStateId] = useState('');

  // Geocoding state
  const [geoStatus, setGeoStatus] = useState('idle'); // 'idle' | 'loading' | 'found' | 'error'
  const [geoResults, setGeoResults] = useState([]);
  const [geoError, setGeoError] = useState('');
  const miniMapRef = useRef(null);
  const miniLeafRef = useRef(null);
  const miniPinRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const districtId = localStorage.getItem('district_id') || '';
      const [branchRes, statesRes] = await Promise.all([
        fetch(`${API_BASE}/api/branches?role_level=${roleLevel()}&district_id=${districtId}`, { headers: authHdr() }),
        fetch(`${API_BASE}/api/org/states`, { headers: authHdr() }),
      ]);
      const data = await branchRes.json();
      if (data.success) {
        setBranches(data.branches || []);
        setCategories(data.categories || []);
        setDistricts(data.districts || []);
      }
      const stData = await statesRes.json();
      if (stData.success) setStates(stData.states || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return branches;
    const q = search.toLowerCase();
    return branches.filter(b =>
      b.branch_name?.toLowerCase().includes(q) ||
      b.hospital_code?.toLowerCase().includes(q) ||
      b.district_name?.toLowerCase().includes(q)
    );
  }, [branches, search]);

  const stats = useMemo(() => ({
    total: branches.length,
    central: branches.filter(b => b.branch_level === 'Central').length,
    sub: branches.filter(b => b.branch_level === 'Sub-Central').length,
    centers: branches.filter(b => b.branch_level === 'Center' || !b.branch_level).length,
  }), [branches]);

  const handleCreateDistrict = async (e) => {
    e.preventDefault();
    const url = editDistrictId ? `${API_BASE}/api/branches/district/${editDistrictId}` : `${API_BASE}/api/branches/district`;
    const method = editDistrictId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify(districtData) });
      const data = await res.json();
      if (data.success) { setShowDistrictModal(false); setDistrictData({ name: '' }); setEditDistrictId(null); fetchData(); }
      else alert(data.message || 'Error');
    } catch (err) { console.error(err); }
  };

  const handleDeleteDistrict = async (id) => {
    if (!window.confirm('Delete this district?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/branches/district/${id}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) fetchData(); else alert(data.message || 'Error');
    } catch (err) { console.error(err); }
  };

  const handleCreateCenter = async (e) => {
    e.preventDefault();
    const url = editCenterId ? `${API_BASE}/api/branches/center/${editCenterId}` : `${API_BASE}/api/branches/center`;
    const method = editCenterId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify(centerData) });
      const data = await res.json();
      if (data.success) { setShowCenterModal(false); setEditCenterId(null); setCenterData(EMPTY_CENTER); fetchData(); }
      else alert(data.message || 'Error');
    } catch (err) { console.error(err); }
  };

  const handleDeleteCenter = async (id) => {
    if (!window.confirm('Delete this facility? Records linked to it may be affected.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/branches/center/${id}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) { if (selectedNode?.id === id) setSelectedNode(null); fetchData(); }
      else alert(data.message || 'Error');
    } catch (err) { console.error(err); }
  };

  const openEditCenter = (branch) => {
    setEditCenterId(branch.id);
    setCenterData({
      district_id: branch.district_id,
      branch_name: branch.branch_name,
      category: branch.category || '',
      hospital_code: branch.hospital_code,
      hmis_hosp_mapping_code: branch.hmis_hosp_mapping_code || '',
      address: branch.address || '',
      contact_number: branch.contact_number || '',
      branch_level: branch.branch_level || 'Center',
      parent_branch_id: branch.parent_branch_id || '',
      latitude: branch.latitude || '',
      longitude: branch.longitude || '',
    });
    const dist = districts.find(d => d.id == branch.district_id);
    setFormStateId(dist?.state_id ? String(dist.state_id) : '');
    setShowCenterModal(true);
  };

  const openNewCenter = () => {
    setEditCenterId(null);
    setCenterData(EMPTY_CENTER);
    setFormStateId('');
    setGeoStatus('idle');
    setGeoResults([]);
    setGeoError('');
    setGeoStatus('idle');
    setGeoResults([]);
    setGeoError('');
    setShowCenterModal(true);
  };

  // ── Geocode address via Nominatim ──────────────────────────────
  const geocodeAddress = async () => {
    const addr = centerData.address.trim();
    if (!addr) return;
    setGeoStatus('loading');
    setGeoResults([]);
    setGeoError('');
    try {
      const query = encodeURIComponent(`${addr}, Ranchi, Jharkhand, India`);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=5&countrycodes=in`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'HospitalNetworkApp/1.0' } }
      );
      const data = await res.json();
      if (data.length === 0) {
        setGeoStatus('error');
        setGeoError('No location found. Try a shorter or simpler address.');
      } else {
        setGeoResults(data);
        setGeoStatus('found');
        // Auto-select top result
        pickGeoResult(data[0]);
      }
    } catch {
      setGeoStatus('error');
      setGeoError('Could not reach geocoding service. Check your connection.');
    }
  };

  const pickGeoResult = (result) => {
    const lat = parseFloat(result.lat).toFixed(7);
    const lng = parseFloat(result.lon).toFixed(7);
    setCenterData(prev => ({ ...prev, latitude: lat, longitude: lng }));
    setGeoStatus('found');
    // Update mini map pin
    if (miniLeafRef.current && window.L) {
      const latlng = [parseFloat(lat), parseFloat(lng)];
      miniLeafRef.current.setView(latlng, 15);
      if (miniPinRef.current) miniPinRef.current.setLatLng(latlng);
    }
  };

  // ── Mini map inside modal ──────────────────────────────────────
  useEffect(() => {
    if (!showCenterModal) {
      if (miniLeafRef.current) { miniLeafRef.current.remove(); miniLeafRef.current = null; }
      return;
    }
    if (!miniMapRef.current || miniLeafRef.current) return;
    if (!window.L) return;

    const L = window.L;
    const lat = parseFloat(centerData.latitude) || RANCHI_CENTER[0];
    const lng = parseFloat(centerData.longitude) || RANCHI_CENTER[1];

    const map = L.map(miniMapRef.current, {
      center: [lat, lng],
      zoom: centerData.latitude ? 15 : 11,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    const pinIcon = L.divIcon({
      className: '',
      html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;
        background:#1a56db;border:3px solid white;
        box-shadow:0 2px 6px rgba(0,0,0,0.35);
        transform:rotate(-45deg)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 18],
    });

    const marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);

    // Allow dragging pin to fine-tune
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setCenterData(prev => ({
        ...prev,
        latitude: pos.lat.toFixed(7),
        longitude: pos.lng.toFixed(7),
      }));
    });

    miniLeafRef.current = map;
    miniPinRef.current = marker;

    return () => {
      map.remove();
      miniLeafRef.current = null;
      miniPinRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCenterModal]);

  // Update pin when lat/lng changes from inputs
  useEffect(() => {
    if (!miniLeafRef.current || !miniPinRef.current) return;
    const lat = parseFloat(centerData.latitude);
    const lng = parseFloat(centerData.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      miniPinRef.current.setLatLng([lat, lng]);
      miniLeafRef.current.setView([lat, lng], miniLeafRef.current.getZoom());
    }
  }, [centerData.latitude, centerData.longitude]);

  return (
    <div className="hospitals-page">

      {/* ── Topbar ──────────────────────────────────────────────── */}
      <header className="h-topbar">
        <div className="h-topbar-left">
          <div className="h-topbar-icon">
            <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>
          </div>
          <div>
            <div className="h-topbar-title">Hospital Network</div>
            <div className="h-topbar-sub">District · Sub-Central · Centers</div>
          </div>
        </div>
        <div className="h-topbar-right">
          {roleLevel() === 'Central' && (
            <button className="btn-secondary" onClick={() => { setEditDistrictId(null); setDistrictData({ name: '' }); setShowDistrictModal(true); }}>
              + Add District Hub
            </button>
          )}
          {(roleLevel() === 'Central' || roleLevel() === 'Sub-Central') && (
            <button className="btn-primary" onClick={openNewCenter}>
              + Add New Center
            </button>
          )}
        </div>
      </header>

      {/* ── Stats Strip ─────────────────────────────────────────── */}
      <div className="h-stats-strip">
        {[
          { label: 'Total Facilities', val: stats.total, icon: <Building2 size={18} />, cls: 'navy' },
          { label: 'Central Hubs', val: stats.central, icon: <Building size={18} />, cls: 'navy' },
          { label: 'Sub-Central', val: stats.sub, icon: <Home size={18} />, cls: 'blue' },
          { label: 'Centers / Labs', val: stats.centers, icon: <Layout size={18} />, cls: 'sky' },
        ].map(s => (
          <div className="h-stat-cell" key={s.label}>
            <div className={`h-stat-icon ${s.cls}`}>{s.icon}</div>
            <div>
              <div className="h-stat-num">{s.val}</div>
              <div className="h-stat-lbl">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="h-body">

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside className="h-sidebar">
          <div className="h-sidebar-section">
            <div className="h-sidebar-label">Search</div>
            <div className="h-search">
              <svg className="h-search-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input type="text" placeholder="Name, code, district…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="h-node-list">
            {filtered.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                No facilities found
              </div>
            )}
            {filtered.map(b => (
              <div
                key={b.id}
                className={`h-node-item ${selectedNode?.id === b.id ? 'selected' : ''}`}
                onClick={() => setSelectedNode(b)}
              >
                <span className={`h-node-dot ${DOT_CLASS[b.branch_level] || 'dot-center'}`} />
                <span className="h-node-item-name">{b.branch_name}</span>
                <span className="h-node-item-code">{b.hospital_code}</span>
              </div>
            ))}
          </div>

          <div className="h-sidebar-section">
            <div className="h-sidebar-label">Legend</div>
            <div className="h-legend">
              {[
                { level: 'Central', dot: 'dot-central', label: 'Central Hub' },
                { level: 'Sub-Central', dot: 'dot-sub', label: 'Sub-Central Hub' },
                { level: 'Center', dot: 'dot-center', label: 'Center / Lab' },
              ].map(l => (
                <div className="h-legend-row" key={l.level}>
                  <span className={`h-legend-dot ${l.dot}`} />
                  <span className="h-legend-text">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Canvas / Grid / Map ────────────────────────────── */}
        <div className="h-graph-area">

          {/* View toggle — now 3 buttons */}
          <div className="h-view-toggle">
            <button className={`h-vtbtn ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
                <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
              </svg>
              Graph
            </button>
            <button className={`h-vtbtn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
              <Grid size={14} />
              Grid
            </button>
            <button className={`h-vtbtn ${viewMode === 'map' ? 'active' : ''}`} onClick={() => setViewMode('map')}>
              <MapIcon size={14} />
              Map
            </button>
          </div>

          {loading ? (
            <div className="h-loading">
              <Loader2 size={24} className="h-spin" />
              Loading facilities…
            </div>
          ) : branches.length === 0 ? (
            <div className="h-empty">
              <Building2 size={48} />
              No facilities added yet
            </div>
          ) : viewMode === 'graph' ? (
            <NetworkGraph
              branches={filtered.length > 0 ? filtered : branches}
              selectedId={selectedNode?.id}
              onSelect={(node) => setSelectedNode(prev => prev?.id === node.id ? null : node)}
            />
          ) : viewMode === 'map' ? (
            <MapView
              branches={filtered.length > 0 ? filtered : branches}
              selectedId={selectedNode?.id}
              onSelect={(node) => setSelectedNode(prev => prev?.id === node.id ? null : node)}
            />
          ) : (
            <div className="h-grid">
              {filtered.map(b => (
                <div
                  key={b.id}
                  className="h-grid-card"
                  onClick={() => setSelectedNode(prev => prev?.id === b.id ? null : b)}
                >
                  <div className={`h-grid-card-top ${TOP_CLASS[b.branch_level] || 'top-center'}`} />
                  <div className="h-grid-card-body">
                    <div className="h-gc-row1">
                      <div className="h-gc-name">{b.branch_name}</div>
                      <div className="h-gc-code">{b.hospital_code}</div>
                    </div>
                    <div className={`h-gc-badge ${BADGE_CLASS[b.branch_level] || 'badge-center'}`}>
                      {b.branch_level || 'Center'}
                    </div>
                    <div className="h-gc-fields">
                      <div className="h-gc-field"><MapPin size={14} /><span><strong>{b.district_name}</strong></span></div>
                      {b.category && <div className="h-gc-field"><Tag size={14} /><span>{b.category}</span></div>}
                      {b.contact_number && <div className="h-gc-field"><Phone size={14} /><span>{b.contact_number}</span></div>}
                      {b.parent_branch_name && <div className="h-gc-field"><ArrowUp size={14} /><span>Reports to <strong>{b.parent_branch_name}</strong></span></div>}
                    </div>
                  </div>
                  {canEdit(b) && (
                    <div className="h-grid-card-foot">
                      <button className="btn-ghost" onClick={e => { e.stopPropagation(); openEditCenter(b); }}>Edit</button>
                      <button className="btn-danger" onClick={e => { e.stopPropagation(); handleDeleteCenter(b.id); }}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Node Detail Panel ─────────────────────────────── */}
          {selectedNode && (
            <div className="h-detail-panel">
              <div className="h-detail-header">
                <span className={`h-detail-badge ${BADGE_CLASS[selectedNode.branch_level] || 'badge-center'}`}>
                  {selectedNode.branch_level || 'Center'}
                </span>
                <button className="h-detail-close" onClick={() => setSelectedNode(null)}><X size={16} /></button>
              </div>
              <div className="h-detail-name">{selectedNode.branch_name}</div>
              <div className="h-detail-code">{selectedNode.hospital_code}</div>
              <div className="h-detail-rows">
                {[
                  { icon: <MapPin size={14} />, label: 'District', val: selectedNode.district_name },
                  { icon: <Tag size={14} />, label: 'Category', val: selectedNode.category },
                  { icon: <Phone size={14} />, label: 'Contact', val: selectedNode.contact_number },
                  { icon: <MapPin size={14} />, label: 'Address', val: selectedNode.address },
                  { icon: <ArrowUp size={14} />, label: 'Reports To', val: selectedNode.parent_branch_name },
                  { icon: <Globe size={14} />, label: 'Coordinates', val: selectedNode.latitude && selectedNode.longitude ? `${selectedNode.latitude}, ${selectedNode.longitude}` : null },
                ].filter(r => r.val).map(r => (
                  <div className="h-detail-row" key={r.label}>
                    <div className="h-detail-row-icon">{r.icon}</div>
                    <div>
                      <div className="h-detail-row-label">{r.label}</div>
                      <div className="h-detail-row-val">{r.val}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Quick "View on Map" button */}
              {selectedNode.latitude && selectedNode.longitude && viewMode !== 'map' && (
                <div style={{ padding: '0 16px 12px' }}>
                  <button
                    className="btn-map-view"
                    onClick={() => setViewMode('map')}
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
                    </svg>
                    View on Map
                  </button>
                </div>
              )}
              {canEdit(selectedNode) && (
                <div className="h-detail-actions">
                  <button className="btn-ghost" onClick={() => openEditCenter(selectedNode)}>Edit</button>
                  <button className="btn-danger" onClick={() => handleDeleteCenter(selectedNode.id)}>Delete</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── District Modal ──────────────────────────────────────── */}
      {showDistrictModal && (
        <div className="h-modal-overlay" onClick={() => setShowDistrictModal(false)}>
          <div className="h-modal" onClick={e => e.stopPropagation()}>
            <div className="h-modal-header">
              <h2>{editDistrictId ? 'Edit District Hub' : 'Add District Hub'}</h2>
              <button className="h-detail-close" onClick={() => setShowDistrictModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateDistrict}>
              <div className="h-modal-body">
                <div className="h-form-group">
                  <label>District Name</label>
                  <input required type="text" value={districtData.name}
                    onChange={e => setDistrictData({ ...districtData, name: e.target.value })}
                    placeholder="e.g. Dhanbad" />
                </div>
              </div>
              <div className="h-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowDistrictModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editDistrictId ? 'Save Changes' : 'Create District'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Center Modal ────────────────────────────────────────── */}
      {showCenterModal && (
        <div className="h-modal-overlay" onClick={() => setShowCenterModal(false)}>
          <div className="h-modal" onClick={e => e.stopPropagation()}>
            <div className="h-modal-header">
              <h2>{editCenterId ? 'Edit Health Center' : 'Add Health Center / Lab'}</h2>
              <button className="h-detail-close" onClick={() => setShowCenterModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateCenter}>
              <div className="h-modal-body">
                {(roleLevel() === 'Central' || roleLevel() === 'Sub-Central') && (
                  <>
                    <div className="h-form-group">
                      <label>Branch Level</label>
                      <select value={centerData.branch_level} onChange={e => setCenterData({ ...centerData, branch_level: e.target.value })}>
                        <option value="Central">Central Hub</option>
                        <option value="Sub-Central">Sub-Central (District) Hub</option>
                        <option value="Center">Primary Center / Lab</option>
                      </select>
                    </div>
                    <div className="h-form-group">
                      <label>Reporting To (Parent Branch)</label>
                      <select value={centerData.parent_branch_id} onChange={e => setCenterData({ ...centerData, parent_branch_id: e.target.value })}>
                        <option value="">None (Independent)</option>
                        {branches.filter(b => b.id !== editCenterId).map(b => (
                          <option key={b.id} value={b.id}>{b.branch_name} ({b.hospital_code})</option>
                        ))}
                      </select>
                    </div>
                    <div className="h-form-group">
                      <label>State</label>
                      <select value={formStateId} onChange={e => { setFormStateId(e.target.value); setCenterData({ ...centerData, district_id: '' }); }}>
                        <option value="">Select State…</option>
                        {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="h-form-group">
                      <label>District</label>
                      <select required value={centerData.district_id} onChange={e => setCenterData({ ...centerData, district_id: e.target.value })} disabled={!formStateId}>
                        <option value="">{formStateId ? 'Select District…' : 'Select a state first'}</option>
                        {(formStateId ? districts.filter(d => String(d.state_id) === formStateId) : districts).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div className="h-form-group">
                      <label>Facility Category</label>
                      <select required value={centerData.category} onChange={e => setCenterData({ ...centerData, category: e.target.value })}>
                        <option value="">Select Category…</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div className="h-form-group">
                  <label>Center Name</label>
                  <input required type="text" value={centerData.branch_name}
                    onChange={e => setCenterData({ ...centerData, branch_name: e.target.value })}
                    placeholder="e.g. Dhanbad PHC" />
                </div>
                <div className="h-form-group">
                  <label>Hospital Code</label>
                  <input required type="text" value={centerData.hospital_code}
                    onChange={e => setCenterData({ ...centerData, hospital_code: e.target.value.toUpperCase() })}
                    placeholder="e.g. DPHC" maxLength="10" />
                </div>
                <div className="h-form-group">
                  <label>CDAC Hospital Mapping Code <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional — hmis_hosp_mapping_code, assigned by CDAC)</span></label>
                  <input type="text" value={centerData.hmis_hosp_mapping_code}
                    onChange={e => setCenterData({ ...centerData, hmis_hosp_mapping_code: e.target.value })}
                    placeholder="e.g. 10000 — leave blank if not yet known, or if this branch uses Care HIMS instead" />
                </div>
                <div className="h-form-group">
                  <label>Contact Number</label>
                  <input type="text" value={centerData.contact_number}
                    onChange={e => setCenterData({ ...centerData, contact_number: e.target.value })} />
                </div>
                <div className="h-form-group">
                  <label>Full Address</label>
                  <textarea required value={centerData.address}
                    onChange={e => setCenterData({ ...centerData, address: e.target.value })} />
                </div>

                {/* ── Map Coordinates + Geocoding ── */}
                <div className="h-coords-section">
                  <div className="h-form-coords-label">
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
                    </svg>
                    Map Location
                    <span style={{ fontWeight: 400, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </div>

                  {/* Geocode button */}
                  <button
                    type="button"
                    className={`btn-geocode ${geoStatus === 'loading' ? 'loading' : ''}`}
                    onClick={geocodeAddress}
                    disabled={!centerData.address.trim() || geoStatus === 'loading'}
                  >
                    {geoStatus === 'loading' ? (
                      <>
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }}>
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Searching…
                      </>
                    ) : (
                      <>
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                        </svg>
                        Pick location from address
                      </>
                    )}
                  </button>

                  {/* No address hint */}
                  {!centerData.address.trim() && (
                    <div className="h-geo-hint">Fill in the Full Address above first, then click to auto-detect location</div>
                  )}

                  {/* Error */}
                  {geoStatus === 'error' && (
                    <div className="h-geo-error">
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {geoError}
                    </div>
                  )}

                  {/* Multiple results picker */}
                  {geoStatus === 'found' && geoResults.length > 1 && (
                    <div className="h-geo-results">
                      <div className="h-geo-results-label">Multiple matches — tap to select:</div>
                      {geoResults.map((r, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`h-geo-result-item ${centerData.latitude === parseFloat(r.lat).toFixed(7) ? 'active' : ''}`}
                          onClick={() => pickGeoResult(r)}
                        >
                          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                          </svg>
                          <span>{r.display_name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Mini map preview */}
                  <div
                    className={`h-mini-map-wrap ${centerData.latitude || geoStatus === 'found' ? 'visible' : ''}`}
                  >
                    <div ref={miniMapRef} className="h-mini-map" />
                    <div className="h-mini-map-hint">
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z" />
                        <circle cx="12" cy="9" r="2.5" />
                      </svg>
                      Drag the pin to fine-tune
                    </div>
                  </div>

                  {/* Manual lat/lng inputs */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                    <div className="h-form-group" style={{ marginBottom: 0 }}>
                      <label>Latitude</label>
                      <input type="number" step="any" value={centerData.latitude}
                        onChange={e => setCenterData({ ...centerData, latitude: e.target.value })}
                        placeholder="23.3441" />
                    </div>
                    <div className="h-form-group" style={{ marginBottom: 0 }}>
                      <label>Longitude</label>
                      <input type="number" step="any" value={centerData.longitude}
                        onChange={e => setCenterData({ ...centerData, longitude: e.target.value })}
                        placeholder="85.3096" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="h-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCenterModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editCenterId ? 'Save Changes' : 'Create Center'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
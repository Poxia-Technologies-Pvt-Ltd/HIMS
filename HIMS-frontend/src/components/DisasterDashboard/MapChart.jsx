import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { loadKarnatakaDistricts, polygonDistrict } from "../../utils/karnatakaDistricts";

const WIDTH = 800;
const HEIGHT = 600;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const RISK_COLOR = { HIGH: '#ef4444', MEDIUM: '#eab308', LOW: '#22c55e' };
const RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

// Karnataka district map. `data` is one entry per district (worst risk across
// diseases); Vijayanagara's figures are drawn on Ballari's polygon.
const MapChart = ({ data = [], onDistrictClick }) => {
  const [geographies, setGeographies] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadKarnatakaDistricts()
      .then((geo) => { if (!cancelled) setGeographies(geo.features || []); })
      .catch(() => { if (!cancelled) setGeographies([]); });
    return () => { cancelled = true; };
  }, []);

  const pathGenerator = useMemo(() => {
    if (!geographies.length) return null;
    const projection = geoMercator().fitSize([WIDTH, HEIGHT], { type: 'FeatureCollection', features: geographies });
    return geoPath().projection(projection);
  }, [geographies]);

  // Polygon name -> the district entries drawn on it.
  const byPolygon = useMemo(() => {
    const m = {};
    for (const d of data) (m[polygonDistrict(d.district).toLowerCase()] ||= []).push(d);
    return m;
  }, [data]);

  const entriesFor = (geo) => byPolygon[(geo.properties.name || '').toLowerCase()] || [];
  const worst = (entries) => entries.reduce((w, e) => (!w || RANK[e.risk_level] > RANK[w.risk_level] ? e : w), null);

  const handleMouseEnter = (geo) => {
    const entries = entriesFor(geo);
    const w = worst(entries);
    setTooltip({
      name: entries.length ? entries.map((e) => e.district).join(' / ') : geo.properties.name,
      lines: entries.flatMap((e) => e.diseases.map((x) => `${x.disease}: ${x.cases} (${x.trend})`)),
      cases: entries.reduce((a, e) => a + e.cases, 0),
      risk: w ? { label: w.risk_level, color: RISK_COLOR[w.risk_level] } : { label: 'No cases', color: '#64748b' },
    });
  };

  const handleClick = (geo) => {
    const w = worst(entriesFor(geo));
    if (w && onDistrictClick) onDistrictClick(w);
  };

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.002)));
  }, []);
  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origin: pan };
  };
  const handlePointerMove = (e) => {
    if (!dragState.current) return;
    const { startX, startY, origin } = dragState.current;
    setPan({ x: origin.x + (e.clientX - startX) / zoom, y: origin.y + (e.clientY - startY) / zoom });
  };
  const handlePointerUp = () => { dragState.current = null; };

  return (
    <div style={{ height: "100%", position: "relative", cursor: "crosshair", overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <g transform={`translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2 + pan.x} ${-HEIGHT / 2 + pan.y})`}>
          {pathGenerator && geographies.map((geo, i) => {
            const w = worst(entriesFor(geo));
            return (
              <path
                key={geo.properties.code ?? i}
                d={pathGenerator(geo)}
                fill={w ? RISK_COLOR[w.risk_level] : "#f1f5f9"}
                stroke="#94a3b8"
                strokeWidth={1 / zoom}
                onMouseEnter={() => handleMouseEnter(geo)}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => handleClick(geo)}
                style={{ outline: "none", cursor: w ? "pointer" : "default" }}
              />
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div className="map-tooltip">
          <h4 className="tooltip-title">{tooltip.name}</h4>
          <div>
            {tooltip.lines.map((l) => <div key={l} className="tooltip-row"><span className="tooltip-disease">{l}</span></div>)}
            <div className="tooltip-row"><span>Positive cases:</span><span>{tooltip.cases}</span></div>
            <div className="tooltip-row" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "8px", marginTop: "8px" }}>
              <span>Risk Status:</span>
              <span style={{ backgroundColor: `${tooltip.risk.color}20`, color: tooltip.risk.color, padding: "2px 8px", borderRadius: "12px", border: `1px solid ${tooltip.risk.color}50` }}>
                {tooltip.risk.label}
              </span>
            </div>
          </div>
        </div>
      )}
      <p style={{ fontSize: "10px", color: "var(--text-soft)", position: "absolute", bottom: "8px", width: "100%", textAlign: "center", fontStyle: "italic" }}>
        Mouse wheel to zoom, drag to pan, click a coloured district for details.
      </p>
    </div>
  );
};

export default MapChart;

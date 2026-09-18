import React, { useState, useEffect, useRef, useCallback } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { JHARKHAND_DATA, getRiskLevel } from "../../data/disasterMockData";

// GeoJSON URL for Jharkhand districts
const geoUrl = "https://raw.githubusercontent.com/shuklaneerajdev/IndiaStateTopojsonFiles/master/Jharkhand.geojson";

const WIDTH = 800;
const HEIGHT = 600;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const projection = geoMercator()
  .scale(9000)
  .center([85.3, 23.8])
  .translate([WIDTH / 2, HEIGHT / 2]);
const pathGenerator = geoPath().projection(projection);

const getDistrictName = (geo) =>
  geo.properties.district || geo.properties.NAME_2 || geo.properties.dist_name;

const MapChart = ({ data = [], onDistrictClick }) => {
  const [geographies, setGeographies] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(geoUrl)
      .then((res) => res.json())
      .then((geojson) => {
        if (!cancelled) setGeographies(geojson.features || []);
      })
      .catch(() => {
        if (!cancelled) setGeographies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const findDistrictData = (geo) => {
    const districtName = getDistrictName(geo);
    const districtData = data.find(
      (d) => d.district.toLowerCase() === (districtName || "").toLowerCase()
    );
    return { districtName, districtData };
  };

  const handleMouseEnter = (geo) => {
    const { districtName, districtData } = findDistrictData(geo);

    if (districtData) {
      const riskColor = districtData.risk_level === 'HIGH' ? '#ef4444' : (districtData.risk_level === 'MEDIUM' ? '#eab308' : '#22c55e');
      setTooltip({
        name: districtData.district,
        disease: districtData.disease,
        cases: districtData.cases,
        risk: { label: districtData.risk_level, color: riskColor }
      });
    } else {
      setTooltip({
        name: districtName || "Unknown District",
        cases: "No Data",
        risk: { label: "N/A", color: "#334155" }
      });
    }
  };

  const handleGeographyClick = (geo) => {
    const { districtData } = findDistrictData(geo);
    if (districtData && onDistrictClick) {
      onDistrictClick(districtData);
    }
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
    setPan({
      x: origin.x + (e.clientX - startX) / zoom,
      y: origin.y + (e.clientY - startY) / zoom
    });
  };

  const handlePointerUp = () => {
    dragState.current = null;
  };

  return (
    <div style={{ height: "100%", position: "relative", cursor: "crosshair", overflow: "hidden" }}>
      <div style={{ width: "100%", height: "100%" }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: "100%", height: "100%", touchAction: "none" }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <g
            transform={`translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2 + pan.x} ${-HEIGHT / 2 + pan.y})`}
          >
            {geographies.map((geo, i) => {
              const { districtName } = findDistrictData(geo);
              const d = data.find(item =>
                item.district.toLowerCase() === (districtName || "").toLowerCase()
              );
              const riskColor = d ? (d.risk_level === 'HIGH' ? '#ef4444' : (d.risk_level === 'MEDIUM' ? '#eab308' : '#22c55e')) : "#f1f5f9";

              return (
                <path
                  key={geo.id ?? districtName ?? i}
                  d={pathGenerator(geo)}
                  fill={riskColor}
                  stroke="#cbd5e1"
                  strokeWidth={1 / zoom}
                  onMouseEnter={() => handleMouseEnter(geo)}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => handleGeographyClick(geo)}
                  style={{ outline: "none", cursor: "pointer" }}
                />
              );
            })}
          </g>
        </svg>

        {/* Tooltip Overlay */}
        {tooltip && (
          <div className="map-tooltip">
            <h4 className="tooltip-title">{tooltip.name}</h4>
            <div>
              <div className="tooltip-row">
                <span>Disease:</span>
                <span className="tooltip-disease">{tooltip.disease || '—'}</span>
              </div>
              <div className="tooltip-row">
                <span>Total Cases:</span>
                <span>{tooltip.cases}</span>
              </div>
              <div className="tooltip-row" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "8px", marginTop: "8px" }}>
                <span>Risk Status:</span>
                <span
                  style={{ backgroundColor: `${tooltip.risk.color}20`, color: tooltip.risk.color, padding: "2px 8px", borderRadius: "12px", border: `1px solid ${tooltip.risk.color}50` }}
                >
                  {tooltip.risk.label}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <p style={{ fontSize: "10px", color: "var(--text-soft)", position: "absolute", bottom: "8px", width: "100%", textAlign: "center", fontStyle: "italic" }}>
        Use mouse wheel to zoom. Click and drag to pan.
      </p>
    </div>
  );
};

export default MapChart;

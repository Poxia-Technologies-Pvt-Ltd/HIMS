// Karnataka district boundaries ship with the app (public/geo/), so maps do
// not depend on a third-party host at runtime. The boundary file uses the
// 2011-census names; the districts table uses today's official names. This
// maps one to the other. Vijayanagara (carved out of Ballari in 2021) has no
// polygon of its own and is drawn inside Ballari's.

export const KARNATAKA_GEOJSON_URL = '/geo/karnataka-districts.geojson';
export const KARNATAKA_CENTER = [15.0, 76.2];
export const BENGALURU = [12.9716, 77.5946];

const ALIASES = {
  bangalore: 'Bengaluru Urban',
  'bangalore urban': 'Bengaluru Urban',
  'bangalore rural': 'Bengaluru Rural',
  belgaum: 'Belagavi',
  bellary: 'Ballari',
  bijapur: 'Vijayapura',
  chamrajnagar: 'Chamarajanagar',
  chamarajanagara: 'Chamarajanagar',
  chikkaballapura: 'Chikkaballapur',
  chikmagalur: 'Chikkamagaluru',
  gulbarga: 'Kalaburagi',
  mysore: 'Mysuru',
  shimoga: 'Shivamogga',
  tumkur: 'Tumakuru',
  bagalkote: 'Bagalkot',
};

export const canonicalDistrict = (name) => {
  const key = String(name || '').trim().toLowerCase();
  return ALIASES[key] || String(name || '').trim();
};

// The polygon a district's data is drawn on.
export const polygonDistrict = (name) => (String(name || '').trim().toLowerCase() === 'vijayanagara' ? 'Ballari' : canonicalDistrict(name));

let cached = null;
export function loadKarnatakaDistricts() {
  cached ||= fetch(KARNATAKA_GEOJSON_URL)
    .then((r) => r.json())
    .then((g) => ({
      ...g,
      features: (g.features || []).map((f) => ({ ...f, properties: { ...f.properties, name: canonicalDistrict(f.properties.district) } })),
    }))
    .catch((e) => { cached = null; throw e; });
  return cached;
}

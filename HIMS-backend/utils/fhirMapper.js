// Maps LIMS records to HL7 FHIR R4 resources (tender #83, #87). Pure functions: no database, no
// request objects, so every mapping can be tested on its own. The read API is in
// controllers/fhirController.js.

export const FHIR_BASE_PATH = '/api/fhir';
export const SYS = {
  uhid: 'urn:ka-lims:identifier:uhid',
  abha: 'https://healthid.ndhm.gov.in',
  abhaAddress: 'https://healthid.ndhm.gov.in/address',
  facility: 'urn:ka-lims:identifier:facility-code',
  barcode: 'urn:ka-lims:identifier:order-barcode',
  sample: 'urn:ka-lims:identifier:sample',
  testCode: 'urn:ka-lims:code:test',
  parameter: 'urn:ka-lims:code:parameter',
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org',
  interp: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
  category: 'http://terminology.hl7.org/CodeSystem/observation-category',
  v2_0074: 'http://terminology.hl7.org/CodeSystem/v2-0074',
};

const iso = (d) => {
  if (!d) return undefined;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
};
const dateOnly = (d) => {
  if (!d) return undefined;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return undefined;
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};
const clean = (o) => {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete o[k];
  }
  return o;
};
const ref = (type, id, display) => clean({ reference: `${type}/${id}`, display });

export const meta = (lastUpdated) => clean({ lastUpdated: iso(lastUpdated) });

export function operationOutcome(severity, code, text) {
  return { resourceType: 'OperationOutcome', issue: [{ severity, code, details: { text } }] };
}

const GENDER = { male: 'male', m: 'male', female: 'female', f: 'female', other: 'other', o: 'other', transgender: 'other' };
export const fhirGender = (g) => GENDER[String(g || '').trim().toLowerCase()] || 'unknown';

export function organization(b) {
  return clean({
    resourceType: 'Organization', id: String(b.id),
    identifier: b.hospital_code ? [{ system: SYS.facility, value: b.hospital_code }] : undefined,
    active: b.status ? b.status === 'Active' : true,
    name: b.branch_name,
    address: b.district ? [{ district: b.district, state: b.state || undefined, country: 'IN' }] : undefined,
  });
}

export function patient(p) {
  const given = [p.first_name, p.middle_name].filter(Boolean);
  const phone = String(p.telephone || '').replace(/\D/g, '');
  const identifiers = [
    p.reg_no && { use: 'usual', type: { text: 'UHID' }, system: SYS.uhid, value: String(p.reg_no) },
    p.abha_id && { type: { text: 'ABHA number' }, system: SYS.abha, value: String(p.abha_id) },
    p.abha_address && { type: { text: 'ABHA address' }, system: SYS.abhaAddress, value: String(p.abha_address) },
  ].filter(Boolean);
  // The Aadhaar number is deliberately not exposed through this interface.
  return clean({
    resourceType: 'Patient', id: String(p.id), meta: meta(p.updated_at || p.created_at),
    identifier: identifiers,
    active: true,
    name: [clean({ use: 'official', text: [p.title, ...given, p.last_name].filter(Boolean).join(' '), family: p.last_name, given, prefix: p.title ? [p.title] : undefined })],
    telecom: [phone && { system: 'phone', value: phone, use: 'mobile' }, p.email_id && { system: 'email', value: p.email_id }].filter(Boolean),
    gender: fhirGender(p.gender),
    birthDate: dateOnly(p.dob),
    address: [clean({ use: 'home', text: p.address, city: p.city, postalCode: p.postal_code, country: p.country || 'IN' })].filter((a) => Object.keys(a).length > 1),
    managingOrganization: p.branch_id ? ref('Organization', p.branch_id) : undefined,
  });
}

// bill_items.status → ServiceRequest.status
export const SR_STATUS = { Pending: 'active', Collected: 'active', 'In Progress': 'active', 'Test Done': 'active', Completed: 'completed', Approved: 'completed', Cancelled: 'revoked' };
export const srStatusToItemStatuses = (fhir) => Object.entries(SR_STATUS).filter(([, v]) => v === fhir).map(([k]) => k);

export function serviceRequest(r) {
  const coding = [];
  if (r.loinc_code) coding.push({ system: SYS.loinc, code: r.loinc_code, display: r.loinc_display || r.service_name });
  const localCode = r.test_code || r.service_code;
  if (localCode) coding.push({ system: SYS.testCode, code: String(localCode), display: r.service_name });
  const priority = /stat/i.test(r.priority || '') ? 'stat' : /urgent/i.test(r.priority || '') ? 'urgent' : 'routine';
  return clean({
    resourceType: 'ServiceRequest', id: String(r.id), meta: meta(r.updated_at || r.created_at),
    identifier: [r.lab_barcode && { system: SYS.barcode, value: r.lab_barcode }, r.short_id && { type: { text: 'Short ID' }, system: SYS.barcode, value: String(r.short_id) }].filter(Boolean),
    status: SR_STATUS[r.status] || 'unknown', intent: 'order',
    category: [{ coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] }],
    priority,
    code: clean({ coding, text: r.service_name }),
    subject: ref('Patient', r.patient_id, r.patient_name),
    authoredOn: iso(r.bill_created_at || r.created_at),
    requester: r.referring_clinician ? { display: r.referring_clinician } : undefined,
    performer: r.branch_id ? [ref('Organization', r.branch_id)] : undefined,
    specimen: r.sample_id ? [ref('Specimen', r.sample_id)] : undefined,
    note: r.clinical_notes ? [{ text: r.clinical_notes }] : undefined,
  });
}

const SPECIMEN_STATUS = { Disposed: 'unavailable', Rejected: 'unsatisfactory' };
export function specimen(s) {
  return clean({
    resourceType: 'Specimen', id: String(s.sample_id), meta: meta(s.updated_at),
    identifier: [{ system: SYS.sample, value: String(s.sample_id) }],
    status: SPECIMEN_STATUS[s.stage] || 'available',
    type: s.sample_type ? { text: s.sample_type } : undefined,
    subject: s.patient_id ? ref('Patient', s.patient_id) : undefined,
    receivedTime: iso(s.received_at),
    parent: s.parent_sample_id ? [ref('Specimen', s.parent_sample_id)] : undefined,
    request: s.request_id ? [ref('ServiceRequest', s.request_id)] : undefined,
    collection: s.collected_at ? { collectedDateTime: iso(s.collected_at) } : undefined,
    container: s.tube_color ? [{ description: `${s.tube_color} tube` }] : undefined,
  });
}

// "4.00-10.00", "<5", ">=3.5", "Negative" → FHIR referenceRange
export function referenceRange(text) {
  if (!text) return undefined;
  const t = String(text).trim();
  const num = (x) => (x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : undefined);
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return [{ low: { value: num(m[1]) }, high: { value: num(m[2]) }, text: t }];
  m = t.match(/^(<=|<|≤)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return [{ high: { value: num(m[2]) }, text: t }];
  m = t.match(/^(>=|>|≥)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return [{ low: { value: num(m[2]) }, text: t }];
  return [{ text: t }];
}

const INTERP = { L: ['L', 'Low'], H: ['H', 'High'], N: ['N', 'Normal'], LL: ['LL', 'Critical low'], HH: ['HH', 'Critical high'], A: ['A', 'Abnormal'], I: ['IND', 'Indeterminate'] };
export function interpretation(p) {
  let code = String(p.flag || p.analyzer_flag || '').toUpperCase();
  if (p.is_critical) code = /^L/.test(code) ? 'LL' : /^H/.test(code) ? 'HH' : 'A';
  if (/invalid/i.test(p.result_flag || '')) code = 'I';
  const hit = INTERP[code];
  return hit ? [{ coding: [{ system: SYS.interp, code: hit[0], display: hit[1] }] }] : undefined;
}

export const observationId = (resultId, index) => `${resultId}-${index + 1}`;
export const parseObservationId = (id) => {
  const m = String(id).match(/^(\d+)-(\d+)$/);
  return m ? { resultId: Number(m[1]), index: Number(m[2]) - 1 } : null;
};

export function observation(row, param, index) {
  const approved = row.status === 'Approved';
  const raw = param.result_value;
  const numeric = raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw)) && !/invalid/i.test(param.result_flag || '');
  const unit = param.unit && param.unit !== '-' ? param.unit : undefined;
  return clean({
    resourceType: 'Observation', id: observationId(row.id, index), meta: meta(row.updated_at),
    status: approved ? 'final' : 'preliminary',
    category: [{ coding: [{ system: SYS.category, code: 'laboratory', display: 'Laboratory' }] }],
    code: { coding: [{ system: SYS.parameter, code: String(param.parameter_name), display: String(param.parameter_name) }], text: String(param.parameter_name) },
    subject: row.patient_id ? ref('Patient', row.patient_id) : undefined,
    effectiveDateTime: iso(row.tested_at),
    issued: iso(row.approved_at || row.verified_at),
    performer: row.branch_id ? [ref('Organization', row.branch_id)] : undefined,
    valueQuantity: numeric ? clean({ value: Number(raw), unit, system: unit ? SYS.ucum : undefined, code: unit }) : undefined,
    valueString: !numeric && raw !== undefined && raw !== null && raw !== '' ? String(raw) : undefined,
    dataAbsentReason: raw === undefined || raw === null || raw === '' ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'not-performed' }] } : undefined,
    interpretation: interpretation(param),
    note: param.flag_reasons?.length ? [{ text: param.flag_reasons.map((f) => f.message).join('; ') }] : undefined,
    specimen: row.sample_id ? ref('Specimen', row.sample_id) : undefined,
    basedOn: row.bill_item_id ? [ref('ServiceRequest', row.bill_item_id)] : undefined,
    referenceRange: referenceRange(param.reference_range),
  });
}

const REPORT_STATUS = { Approved: 'final', 'Test Done': 'preliminary', Verified: 'preliminary', Pending: 'registered' };
export function diagnosticReport(row, params = []) {
  const coding = [];
  if (row.loinc_code) coding.push({ system: SYS.loinc, code: row.loinc_code, display: row.loinc_display || row.test_name });
  if (row.test_code) coding.push({ system: SYS.testCode, code: String(row.test_code), display: row.test_name });
  return clean({
    resourceType: 'DiagnosticReport', id: String(row.id), meta: meta(row.updated_at),
    identifier: row.sample_id ? [{ system: SYS.sample, value: String(row.sample_id) }] : undefined,
    basedOn: row.bill_item_id ? [ref('ServiceRequest', row.bill_item_id)] : undefined,
    status: REPORT_STATUS[row.status] || 'unknown',
    category: [{ coding: [{ system: SYS.v2_0074, code: 'LAB', display: 'Laboratory' }] }],
    code: clean({ coding, text: row.test_name }),
    subject: row.patient_id ? ref('Patient', row.patient_id) : undefined,
    effectiveDateTime: iso(row.tested_at),
    issued: iso(row.approved_at || row.verified_at),
    performer: row.branch_id ? [ref('Organization', row.branch_id)] : undefined,
    specimen: row.sample_id ? [ref('Specimen', row.sample_id)] : undefined,
    result: params.map((_, i) => ref('Observation', observationId(row.id, i))),
    conclusion: row.has_critical ? 'Contains critical value(s).' : undefined,
  });
}

export function searchBundle({ resources, total, selfUrl, nextUrl }) {
  return clean({
    resourceType: 'Bundle', type: 'searchset', timestamp: new Date().toISOString(), total,
    link: [{ relation: 'self', url: selfUrl }, nextUrl && { relation: 'next', url: nextUrl }].filter(Boolean),
    entry: resources.map((r) => ({ fullUrl: `${FHIR_BASE_PATH}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
  });
}

export function capabilityStatement(baseUrl, version = '1.0.0') {
  const search = (names) => names.map(([name, type]) => ({ name, type }));
  const res = (type, profile, params, extra = {}) => ({
    type, profile, interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search(params), ...extra,
  });
  return {
    resourceType: 'CapabilityStatement', status: 'active', date: new Date().toISOString(), kind: 'instance',
    publisher: 'HMIS', name: 'HmisFhirApi', title: 'HMIS FHIR R4 read API',
    software: { name: 'HMIS', version }, implementation: { description: 'HMIS FHIR R4 API', url: baseUrl },
    fhirVersion: '4.0.1', format: ['json', 'application/fhir+json'],
    rest: [{
      mode: 'server',
      documentation: 'Read-only. Bearer token or integration key; results are limited to the facilities the credential may see. Aadhaar numbers are never returned.',
      security: { cors: false, service: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'Bearer' }] }] },
      resource: [
        res('Patient', 'http://hl7.org/fhir/StructureDefinition/Patient', [['_id', 'token'], ['identifier', 'token'], ['name', 'string'], ['family', 'string'], ['given', 'string'], ['birthdate', 'date'], ['gender', 'token'], ['phone', 'token']],
          { operation: [{ name: 'everything', definition: 'http://hl7.org/fhir/OperationDefinition/Patient-everything' }] }),
        res('ServiceRequest', 'http://hl7.org/fhir/StructureDefinition/ServiceRequest', [['_id', 'token'], ['patient', 'reference'], ['status', 'token'], ['authored', 'date'], ['identifier', 'token'], ['code', 'token']]),
        res('Specimen', 'http://hl7.org/fhir/StructureDefinition/Specimen', [['_id', 'token'], ['patient', 'reference'], ['identifier', 'token']]),
        res('Observation', 'http://hl7.org/fhir/StructureDefinition/Observation', [['_id', 'token'], ['patient', 'reference'], ['date', 'date'], ['status', 'token'], ['code', 'token']]),
        res('DiagnosticReport', 'http://hl7.org/fhir/StructureDefinition/DiagnosticReport', [['_id', 'token'], ['patient', 'reference'], ['status', 'token'], ['date', 'date'], ['identifier', 'token'], ['code', 'token']]),
        res('Organization', 'http://hl7.org/fhir/StructureDefinition/Organization', [['_id', 'token'], ['name', 'string'], ['identifier', 'token']]),
      ],
    }],
  };
}

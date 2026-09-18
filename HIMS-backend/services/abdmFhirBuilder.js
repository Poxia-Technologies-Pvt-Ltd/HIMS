import { randomUUID } from "crypto";
import db from "../config/db.js";

const fhirDate = (d) =>
  d ? new Date(d).toISOString() : new Date().toISOString();

const patientResource = (p, refId) => ({
  fullUrl: `Patient/${refId}`,
  resource: {
    resourceType: "Patient",
    id: refId,
    name: [
      {
        use: "official",
        text: [p.first_name, p.middle_name, p.last_name]
          .filter(Boolean)
          .join(" "),
      },
    ],
    gender:
      { male: "male", female: "female", m: "male", f: "female" }[
        (p.gender || "").toLowerCase()
      ] || "unknown",
    birthDate: p.dob ? new Date(p.dob).toISOString().slice(0, 10) : undefined,
  },
});

// ── OPD Consultation bundle ──────────────────────────────────────────────────
async function buildConsultationBundle(consultationId) {
  const [[consult]] = await db.query(
    `SELECT c.*, p.first_name, p.middle_name, p.last_name, p.gender, p.dob, p.reg_no
       FROM consultations c
       JOIN patients p ON p.reg_no = c.patient_reg_no
      WHERE c.id = ? LIMIT 1`,
    [consultationId]
  );
  if (!consult) throw new Error(`Consultation ${consultationId} not found`);

  const patientRef = `Patient/${consult.reg_no}`;
  const encounterId = randomUUID();
  const compositionId = randomUUID();
  const timestamp = fhirDate(consult.consultation_date);

  const entries = [
    patientResource(consult, consult.reg_no),
    {
      fullUrl: `Encounter/${encounterId}`,
      resource: {
        resourceType: "Encounter",
        id: encounterId,
        status: "finished",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB" },
        subject: { reference: patientRef },
        period: { start: timestamp },
        reasonCode: consult.diagnosis
          ? [{ text: consult.diagnosis }]
          : undefined,
      },
    },
  ];

  const sectionEntries = [];

  if (consult.chief_complaints) {
    const condId = randomUUID();
    entries.push({
      fullUrl: `Condition/${condId}`,
      resource: {
        resourceType: "Condition",
        id: condId,
        subject: { reference: patientRef },
        encounter: { reference: `Encounter/${encounterId}` },
        note: [{ text: consult.chief_complaints }],
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-category",
                code: "encounter-diagnosis",
              },
            ],
          },
        ],
      },
    });
    sectionEntries.push({ reference: `Condition/${condId}` });
  }

  entries.unshift({
    fullUrl: `Composition/${compositionId}`,
    resource: {
      resourceType: "Composition",
      id: compositionId,
      status: "final",
      type: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "371530004",
            display: "Clinical consultation report",
          },
        ],
      },
      subject: { reference: patientRef },
      date: timestamp,
      title: "OPD Consultation Record",
      section: [
        {
          title: "Chief Complaints & Assessment",
          entry: sectionEntries,
          text: {
            status: "generated",
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${[
              consult.chief_complaints && `<p><b>Chief Complaints:</b> ${consult.chief_complaints}</p>`,
              consult.subjective && `<p><b>Subjective:</b> ${consult.subjective}</p>`,
              consult.objective && `<p><b>Objective:</b> ${consult.objective}</p>`,
              consult.diagnosis && `<p><b>Assessment:</b> ${consult.diagnosis}</p>`,
              consult.plan && `<p><b>Plan:</b> ${consult.plan}</p>`,
            ]
              .filter(Boolean)
              .join("")}</div>`,
          },
        },
      ],
    },
  });

  return { resourceType: "Bundle", id: randomUUID(), type: "document", timestamp, entry: entries };
}

// ── Prescription bundle ──────────────────────────────────────────────────────
async function buildPrescriptionBundle(consultationId) {
  const [[consult]] = await db.query(
    `SELECT c.consultation_date, c.patient_reg_no,
            p.first_name, p.middle_name, p.last_name, p.gender, p.dob, p.reg_no
       FROM consultations c
       JOIN patients p ON p.reg_no = c.patient_reg_no
      WHERE c.id = ? LIMIT 1`,
    [consultationId]
  );
  if (!consult) throw new Error(`Consultation ${consultationId} not found`);

  const [medicines] = await db.query(
    `SELECT medicine_name, dosage, frequency, duration, route, instructions,
            sig_morning, sig_afternoon, sig_evening, sig_night, stop_date
       FROM digital_prescriptions WHERE consultation_id = ?`,
    [consultationId]
  );

  const patientRef = `Patient/${consult.reg_no}`;
  const compositionId = randomUUID();
  const timestamp = fhirDate(consult.consultation_date);

  const entries = [patientResource(consult, consult.reg_no)];
  const medRefs = [];

  for (const med of medicines) {
    const medReqId = randomUUID();
    entries.push({
      fullUrl: `MedicationRequest/${medReqId}`,
      resource: {
        resourceType: "MedicationRequest",
        id: medReqId,
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: med.medicine_name },
        subject: { reference: patientRef },
        dosageInstruction: [
          {
            text: [med.dosage, med.frequency, med.duration, med.route, med.instructions]
              .filter(Boolean)
              .join(" | "),
            route: med.route ? { text: med.route } : undefined,
          },
        ],
        dispenseRequest: med.stop_date
          ? { validityPeriod: { end: new Date(med.stop_date).toISOString().slice(0, 10) } }
          : undefined,
      },
    });
    medRefs.push({ reference: `MedicationRequest/${medReqId}` });
  }

  entries.unshift({
    fullUrl: `Composition/${compositionId}`,
    resource: {
      resourceType: "Composition",
      id: compositionId,
      status: "final",
      type: {
        coding: [{ system: "http://snomed.info/sct", code: "440545006", display: "Prescription record" }],
      },
      subject: { reference: patientRef },
      date: timestamp,
      title: "Prescription",
      section: [{ title: "Medications Prescribed", entry: medRefs }],
    },
  });

  return { resourceType: "Bundle", id: randomUUID(), type: "document", timestamp, entry: entries };
}

// ── Lab Orders bundle ────────────────────────────────────────────────────────
async function buildLabBundle(consultationId) {
  const [[consult]] = await db.query(
    `SELECT c.consultation_date, c.patient_reg_no,
            p.first_name, p.middle_name, p.last_name, p.gender, p.dob, p.reg_no
       FROM consultations c
       JOIN patients p ON p.reg_no = c.patient_reg_no
      WHERE c.id = ? LIMIT 1`,
    [consultationId]
  );
  if (!consult) throw new Error(`Consultation ${consultationId} not found`);

  const [labOrders] = await db.query(
    `SELECT dlo.urgency, dlo.clinical_indication, lt.test_name, lt.test_code
       FROM doctor_lab_orders dlo
       LEFT JOIN lab_tests lt ON lt.id = dlo.test_id
      WHERE dlo.consultation_id = ?`,
    [consultationId]
  );

  const patientRef = `Patient/${consult.reg_no}`;
  const compositionId = randomUUID();
  const timestamp = fhirDate(consult.consultation_date);

  const entries = [patientResource(consult, consult.reg_no)];
  const drRefs = [];

  for (const order of labOrders) {
    const drId = randomUUID();
    entries.push({
      fullUrl: `DiagnosticReport/${drId}`,
      resource: {
        resourceType: "DiagnosticReport",
        id: drId,
        status: "registered",
        subject: { reference: patientRef },
        code: {
          coding: order.test_code
            ? [{ system: "http://loinc.org", code: order.test_code, display: order.test_name }]
            : [],
          text: order.test_name || "Lab Test",
        },
        conclusion: order.clinical_indication || undefined,
        effectiveDateTime: timestamp,
      },
    });
    drRefs.push({ reference: `DiagnosticReport/${drId}` });
  }

  entries.unshift({
    fullUrl: `Composition/${compositionId}`,
    resource: {
      resourceType: "Composition",
      id: compositionId,
      status: "final",
      type: {
        coding: [{ system: "http://snomed.info/sct", code: "4241000179101", display: "Laboratory report" }],
      },
      subject: { reference: patientRef },
      date: timestamp,
      title: "Lab Orders",
      section: [{ title: "Lab Tests Ordered", entry: drRefs }],
    },
  });

  return { resourceType: "Bundle", id: randomUUID(), type: "document", timestamp, entry: entries };
}

// ── Bill / Invoice bundle ────────────────────────────────────────────────────
async function buildBillBundle(billId) {
  const [[bill]] = await db.query(
    `SELECT b.*, p.first_name, p.middle_name, p.last_name, p.gender, p.dob, p.reg_no
       FROM bills b
       JOIN patients p ON p.id = b.patient_id
      WHERE b.id = ? LIMIT 1`,
    [billId]
  );
  if (!bill) throw new Error(`Bill ${billId} not found`);

  const [items] = await db.query(
    `SELECT service_name, service_type, quantity, unit_price, total_price FROM bill_items WHERE bill_id = ?`,
    [billId]
  );

  const patientRef = `Patient/${bill.reg_no}`;
  const invoiceId = randomUUID();
  const compositionId = randomUUID();
  const timestamp = fhirDate(bill.created_at);

  const entries = [
    patientResource(bill, bill.reg_no),
    {
      fullUrl: `Invoice/${invoiceId}`,
      resource: {
        resourceType: "Invoice",
        id: invoiceId,
        status: "issued",
        subject: { reference: patientRef },
        date: timestamp,
        totalNet: { value: bill.total_amount, currency: "INR" },
        lineItem: items.map((item) => ({
          chargeItemCodeableConcept: { text: item.service_name },
          priceComponent: [
            { type: "base", amount: { value: item.unit_price, currency: "INR" } },
          ],
        })),
      },
    },
  ];

  entries.unshift({
    fullUrl: `Composition/${compositionId}`,
    resource: {
      resourceType: "Composition",
      id: compositionId,
      status: "final",
      type: {
        coding: [{ system: "http://snomed.info/sct", code: "308335008", display: "Patient encounter procedure" }],
      },
      subject: { reference: patientRef },
      date: timestamp,
      title: "Encounter Invoice",
      section: [{ title: "Invoice", entry: [{ reference: `Invoice/${invoiceId}` }] }],
    },
  });

  return { resourceType: "Bundle", id: randomUUID(), type: "document", timestamp, entry: entries };
}

// ── Public entry point ───────────────────────────────────────────────────────
export async function buildBundle(careContextRef) {
  const match = careContextRef.match(/^(CONSULT|PRESC|LAB|BILL)-(\d+)$/);
  if (!match) throw new Error(`Unknown care context reference format: ${careContextRef}`);

  const [, type, id] = match;
  switch (type) {
    case "CONSULT": return buildConsultationBundle(id);
    case "PRESC":   return buildPrescriptionBundle(id);
    case "LAB":     return buildLabBundle(id);
    case "BILL":    return buildBillBundle(id);
    default:        throw new Error(`Unknown care context type: ${type}`);
  }
}

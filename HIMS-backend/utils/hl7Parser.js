/**
 * Parses a raw HL7 ORM^O01 message string.
 * Returns { messageControlId, patient, orders }
 */
export function parseORM(rawMessage) {
  const segments = rawMessage.split(/\r|\n/).map(s => s.trim()).filter(Boolean);

  let messageControlId = '';
  let patient = {};
  const orders = [];

  for (const seg of segments) {
    const fields = seg.split('|');
    const segId = fields[0];

    if (segId === 'MSH') {
      // MSH-10 is index 9 (0-based after splitting by |)
      messageControlId = fields[9] || '';
    }

    if (segId === 'PID') {
      // PID-3: patient identifier list (first component is the ID)
      const pid3 = (fields[3] || '').split('^');
      patient.externalId = pid3[0] || '';

      // PID-5: name — last^first^middle
      const pid5 = (fields[5] || '').split('^');
      patient.lastName   = pid5[0] || '';
      patient.firstName  = pid5[1] || '';
      patient.middleName = pid5[2] || '';

      // PID-7: DOB
      patient.dob = fields[7] || null;

      // PID-8: gender (M/F/U → Male/Female/Other)
      const g = (fields[8] || '').toUpperCase();
      patient.gender = g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Other';

      // PID-13: home phone number
      patient.phone = (fields[13] || '').split('^')[0] || '';
    }

    if (segId === 'OBR') {
      // OBR-4: universal service identifier — code^name^system
      // e.g. LOINC: "58410-2^CBC panel^LN"
      const obr4 = (fields[4] || '').split('^');
      orders.push({
        testCode:     obr4[0] || '',
        testName:     obr4[1] || obr4[0] || 'Unknown Test',
        codingSystem: obr4[2] || '',   // e.g. "LN" for LOINC
        // OBR-2/OBR-3: placer/filler order numbers. Must be echoed back
        // verbatim in the outbound ORU (OBR-3 is required to be numeric per
        // the CARE spec) — this is how CARE correlates our result with its
        // original order, since our own sample_id format can't be used here.
        placerOrderNumber: fields[2] || '',
        fillerOrderNumber: fields[3] || '',
      });
    }
  }

  return { messageControlId, patient, orders };
}

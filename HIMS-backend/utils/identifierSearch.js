// Shared "find this patient by whatever the operator has to hand" clause.
//
// At a CARE site the person at the desk may be holding any one of five
// identifiers, and which one depends on where the patient came from:
//   • our own reg_no / sample id        (printed on our label)
//   • CARE UHID                         (their hospital number — we store it
//                                        as reg_no 'CARE-<uhid>', so a bare
//                                        UHID must still match)
//   • ABHA number                       (national health id)
//   • phone                             (what the patient actually remembers)
//   • CARE patient UUID                 (from the scraper / their screens)
//
// Rather than five search boxes, one box tries them all. Kept in one place so
// the worklist, the reports list and the verification queue cannot drift into
// supporting different subsets — the operator should not have to remember
// which screen accepts which identifier.

/**
 * @param {string} search  raw user input
 * @param {object} alias   table aliases in the calling query
 * @returns {{clause: string, params: any[]}} empty clause when there's nothing to match on
 */
export function identifierSearchClause(search, alias = {}) {
  const term = String(search || '').trim();
  if (!term) return { clause: '', params: [] };

  const p = alias.patients || 'p';
  const bi = alias.billItems || 'bi';
  const sampleCol = alias.sampleId || `${bi}.sample_id`;
  const testNameCol = alias.testName;

  const like = `%${term}%`;
  const parts = [
    `${p}.reg_no LIKE ?`,
    // A bare UHID typed without our prefix still has to find the patient we
    // registered as CARE-<uhid>.
    `${p}.reg_no LIKE ?`,
    `${p}.abha_id LIKE ?`,
    `CONCAT(${p}.first_name, ' ', COALESCE(${p}.last_name, '')) LIKE ?`,
    `${sampleCol} LIKE ?`,
    `${bi}.care_patient_external_id LIKE ?`,
  ];
  const params = [like, `%CARE-${term}%`, like, like, like, like];

  // Phone numbers are stored inconsistently (+91 prefix, spaces, hyphens), so
  // compare digits only. Added ONLY when the term actually contains a digit —
  // stripping non-digits from a name leaves an empty string, and LIKE '%%'
  // matches every row, which silently turned a name search into "show all"
  // (searching "Sheetal" returned all 14 rows instead of her 5).
  const digits = term.replace(/[^0-9]/g, '');
  if (digits.length >= 4) {
    parts.push(
      `REPLACE(REPLACE(REPLACE(COALESCE(${p}.telephone, ''), '+', ''), '-', ''), ' ', '') LIKE ?`
    );
    params.push(`%${digits}%`);
  }

  if (testNameCol) {
    parts.push(`${testNameCol} LIKE ?`);
    params.push(like);
  }

  return { clause: ` AND (${parts.join(' OR ')})`, params };
}

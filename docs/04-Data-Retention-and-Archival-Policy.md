# Karnataka LIMS — Data Retention and Archival Policy

Tender reference: data-retention and archival policy (requirement 120).
Audience: the Department's data owners and legal advisers, hospital administrators, laboratory heads, system administrators and auditors.
Status: draft for adoption. Retention periods are **proposals [confirm]**: they must be fixed by the Department with legal advice, because they depend on the Government's record-keeping orders, the accreditation standard each laboratory follows, and the applicable data-protection law. Where this document describes what the system does today, it says so.

## 1. Purpose and principles

1. Keep clinical, financial and audit records for as long as care, accreditation, audit and law require, and no longer.
2. Records are not altered once released; corrections create a new version with the reason recorded.
3. Archiving moves data out of day-to-day use without changing it. Deletion is a controlled, approved and recorded act, and is blocked while a legal hold applies.
4. Personal data is collected for laboratory care and public-health reporting only, is shown to staff on a need-to-know basis, and is protected during storage, archive and disposal.
5. The Department is the owner of the data. The solution provider processes it on the Department's behalf and returns or destroys it at the end of the contract as the Department directs.

## 2. Retention schedule **[confirm all periods]**

"Active" is the period the record is kept in the live system; "Archive" is the further period in cold storage before disposal. Periods run from the date the record was finalised (report authorised, bill settled, entry made).

| Data class | Held in | Active | Archive | Basis and notes |
|---|---|---|---|---|
| Patient identity and registration | `patients`, `visits` | 3 years after the last visit | to 10 years after the last visit | Medical-record practice for outpatient records is commonly a minimum of 3 years; paediatric, medico-legal and chronic-disease cases are kept longer. Fix with the Department. |
| Test orders, results, authorised reports and their signatures | `lab_test_result`, `lab_samples`, signed report PDFs | 3 years | to 10 years | Reports carry a content hash and (where enabled) a digital signature; the archived copy must keep both so the report remains verifiable. |
| Critical-result alerts and acknowledgements | `critical_alerts` | 3 years | to 10 years | Evidence of timely notification. |
| Sample rejection, referral and tracking | `sample_rejections`, `sample_referrals`, `lab_samples` | 3 years | to 7 years | |
| Physical specimens | Laboratory store | Per the laboratory's accredited procedure (typically days to weeks for most tests) | n/a | Disposal is recorded in the sample's disposal fields. |
| Quality records (IQC, EQAS, corrective actions) | `qc_runs`, `eqas_results` | 5 years | to 10 years | Accreditation assessors look back over at least the last assessment cycle. |
| Equipment, maintenance, breakdown and reagent-lot records | `equipment_*` | Life of the equipment + 3 years | to 10 years | Needed to trace a result to the analyzer and reagent lot that produced it. |
| Billing, payments and refunds | `bills`, `bill_items`, `bill_payments`, `payment_gateway_transactions` | 6 years | to 8 years | Tax and audit practice; online-payment records must match the gateway's settlement reports. |
| Audit trail | `system_audit_log` | Life of the system | not disposed | Append-only and hash-chained; never edited or deleted. If volume requires, older months are exported to read-only storage together with the chain value that links them to the live log. |
| Integrity events | `sync_integrity_events` | 3 years | to 7 years | |
| User accounts of staff who have left | `users` | Disabled immediately; kept 3 years | anonymised thereafter | Names must remain on historical reports and audit entries; credentials are removed on leaving. |
| Doctor certificates and signing jobs | `user_dsc_certificates`, `dsc_signing_jobs` | Validity of certificate + 1 year | to 7 years | Needed to validate old signatures; private keys are never stored when the token is used. |
| Analyzer raw messages and rejected frames (laboratory PC) | Agent local store | 90 days | none | Diagnostic only. Results themselves are held under the result rule above. |
| Unmatched analyzer results | `lab_test_result` (sample prefix `UNMAPPED-`) | 24 hours | none | **Implemented**: an hourly job deletes results that were never mapped to an order. |
| Blood-bank records: donors, donations, screening results, component preparation, issue, transfusion outcome and reactions | `bb_*` | 10 years | to 30 years | Traceability from donor to recipient must outlive the patient record; follow the blood-bank licence and the Department's order **[confirm]**. |
| Point-of-care results, device quality control and operator certification | `poct_*` | 5 years | to 10 years | Same as quality records; results of care also follow the patient-result rule. |
| One-time sign-in codes | `portal_otps` | 1 day | none | **Implemented**: removed nightly. |
| Register of referring clinicians | `referring_clinicians` | While active + 3 years | anonymised thereafter | |
| Mobile Field app data on a phone | Phone storage | Until sent; today's collection list only | none | Removed on sign-out and clearing app data. |
| Prescription images and uploads | `uploads/` | 3 years | to 7 years | Same as the visit they belong to. |
| Notification logs (WhatsApp, e-mail, report delivery) | report-delivery tables | 1 year | to 3 years | |
| Application and access logs | Server log files | 1 year | to 2 years | Security investigation. |
| Backups | Backup store | 14 days of daily backups; monthly copies for 12 months **[confirm]** | n/a | Backups follow the retention of the data they contain; a deletion becomes final in backups when the last backup holding it expires. |
| De-identified statistics | Dashboards, exports | Indefinite | n/a | Contain no direct identifiers. |

## 3. Archival

### 3.1 What the system does today
Nothing is archived or deleted automatically except the unmatched-results rule above. All other data remains in the live database. Growth is managed by sizing and by the archival procedure below.

### 3.2 Procedure for archiving a period
1. **Select.** The data owner approves a cut-off date for each data class (records finalised before it and past the Active period).
2. **Export.** Produce a read-only export of those records, keeping identifiers, timestamps, version history, report hash and signature information. Use Data Export (CSV) for tabular data and keep the signed report PDFs as they were issued.
3. **Protect.** Store the export on separate, access-controlled storage; record its SHA-256 checksum; keep two copies at different locations; encrypt at rest.
4. **Verify.** Open a sample, compare record counts and checksums, and verify a sample of archived report signatures and hashes.
5. **Record.** Log the archive in an archive register: period, classes, counts, checksum, location, approver, date.
6. **Remove from live only after step 4 is signed off.** Deleting from the live database follows section 4.

### 3.3 Retrieval
A request to see archived records is made to the data owner with the patient or report identifier and the reason. The record is restored read-only into a review schema or provided as a verified export; it is not re-opened for editing. Retrievals are logged.

## 4. Disposal

1. A disposal list is prepared from the retention schedule and reviewed by the data owner, the laboratory head and the information-security officer.
2. **Legal hold.** Anything subject to an investigation, audit, litigation, insurance or grievance is excluded until released in writing.
3. Approved disposal is performed by an administrator, recorded in the audit trail and the archive register with counts and the approval reference.
4. Digital media are erased with a method appropriate to the media; printed matter is shredded; the certificate of destruction is filed.
5. Backups containing disposed data expire under their own schedule; the register notes the date the last copy will disappear.

## 5. Patient rights and data protection

Requests to correct, access or erase personal data are handled by the facility's data-protection contact and the Department. Corrections are made as new versions. Erasure is refused or deferred while a retention duty or legal hold applies, and the patient is told why. Personal data is not used for purposes other than care, quality, billing, public-health reporting and audit. Third parties that receive personal data on the system's behalf — the payment gateway, the WhatsApp/e-mail providers and the external service that reads prescription photos for auto-billing — are listed in the Department's data-processing register with their location and safeguards **[confirm; decide whether prescription images may leave the Government environment]**. The Department determines the legal basis, notices and consent wording **[confirm with legal counsel against the current data-protection law and health-data guidelines]**.

## 6. Security of retained data

Role-based access with facility scoping; encrypted transport; passwords hashed; certificate passwords encrypted; append-only audit; exports and downloads audited; archived copies encrypted, checksummed and held in two locations; periodic restore tests (see the Business Continuity and Disaster Recovery Procedure).

## 7. Responsibilities

| Role | Responsibility |
|---|---|
| Data owner (Department) | Approves the schedule, cut-off dates, disposals and legal holds |
| Facility head / laboratory head | Applies the schedule locally; confirms specimen and paper-record disposal |
| System administrator | Performs exports, archives and approved deletions; maintains the register |
| Information-security officer | Reviews disposal lists; checks archive protection |
| Auditor | Samples the register and verifies integrity of archived audit data |
| Solution provider | Provides the tools, supports retrieval, destroys or returns data at contract end as directed |

## 8. Work that follows adoption

Fix the periods in section 2; schedule the archive jobs and register; implement automated exports for large tables once the periods are final; run the first archive review twelve months after go-live.

## 9. Review

Reviewed yearly, when legislation or the Department's orders change, and at contract renewal.

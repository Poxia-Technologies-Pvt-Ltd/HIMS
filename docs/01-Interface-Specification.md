# Karnataka LIMS — Interface Specification

Tender reference: §Integration — formal interface specification (requirement 85).
Audience: Department / NFDS technical teams, third-party integrators, hospital IT.

## 1. Scope and conventions

This document specifies every interface through which the LIMS exchanges data with people, devices and other systems. Section 8 lists the interfaces that are specified but not yet connected. The complete list of server endpoints is generated from the code and is attached as Appendix A.

| Item | Convention |
|---|---|
| Base URL | `https://<deployment host>` (production: `https://ka-lims.poxiatechnologies.com`). All API paths begin with `/api`. |
| Transport | HTTPS only, TLS 1.2 or higher. HSTS is sent with a one-year max-age. |
| Format | JSON, UTF-8. Maximum request body 50 MB. Dates are ISO-8601; times are server local time (IST). |
| Success / error envelope | `{ "success": true, ... }` or `{ "success": false, "message": "<reason>", "code": "<optional machine code>" }`. HTTP status carries the class of failure (400 validation, 401 not signed in, 403 not permitted, 404, 409 conflict, 422 rejected by an integrity or business rule, 429 rate limited, 500). |
| Identifiers | Numeric surrogate keys for records; patients have a registration number (UHID), samples a sample ID/barcode, bills a bill number. |
| Time-outs and retries | Clients retry only idempotent reads automatically. Queued uploads from the LIS Agent are retried with back-off until accepted. |

## 2. Interface catalogue

| ID | Interface | Direction | Protocol / format | Authentication | Status |
|---|---|---|---|---|---|
| I-01 | Web application ↔ API | Browser to server | REST / JSON | Session cookie + CSRF token, or Bearer token | In service |
| I-02 | LIS Agent ↔ API | Lab PC to server | REST / JSON | Device key (`X-Device-Key`) | In service |
| I-03 | Analyzer ↔ LIS Agent | Instrument to lab PC | ASTM E1394 / LIS2-A2, HL7 v2.x over MLLP, vendor text and binary frames; serial and TCP | Physical / network segment | In service (per-model protocol files) |
| I-04 | Poxia DSC Agent ↔ browser and API | Doctor's PC | Local HTTP on 127.0.0.1 and REST | One-time job token | Built; hardware verification pending |
| I-05 | Razorpay | Server to payment gateway, and webhook back | REST / JSON, HMAC-signed webhook | API key; webhook signature | In service when keys are configured |
| I-06 | WhatsApp notification service | Server to bot | REST / JSON | Private network | In service |
| I-07 | E-mail (SMTP) | Server to mail relay | SMTP with STARTTLS | SMTP credentials | In service |
| I-08 | Report verification (QR) | Public to server | HTTPS GET | None (content hash proves authenticity) | In service |
| I-09 | Data export | Admin / auditor to server | CSV over HTTPS | Roles Admin, Super Admin, Auditor | In service |
| I-10 | CDAC e-Sushrut HMIS | Server to HMIS | REST / JSON | Bearer token + `HMIS-EXT-USER` + `API-ACCESS-KEY` | Implemented; disabled until credentials are issued |
| I-11 | CARE HMIS gateway | Server to/from CARE | REST / JSON, signed JWT with published JWKS | Gateway key pair | Implemented; disabled in this deployment |
| I-12 | TV token display and kiosk | Display / kiosk to server | HTTPS | Kiosk session; branch pinned | In service |
| I-13 | HL7 FHIR R4 API | Government platforms and partner systems to server | REST / JSON (`application/fhir+json`), read and search | Bearer token or integration device key | In service (read-only) |
| I-14 | Patient and clinician portals | Public to server | HTTPS, one-time code by SMS or WhatsApp | Mobile number + one-time code (+ captcha) | In service |
| I-15 | Field (mobile) application | Phone to server | REST / JSON from an installable web app | Staff sign-in | In service |
| I-16 | SMS gateway | Server to provider | HTTP GET or POST, configurable | Provider key in the URL or headers | Ready; needs a provider account |

## 3. I-01 Web application ↔ API

**Authentication.** `POST /api/auth/login` with staff ID/e-mail, password and captcha. On success the server sets an HTTP-only, Secure cookie and returns a CSRF token that must accompany every state-changing request (`X-CSRF-Token`). Programmatic clients may send `Authorization: Bearer <token>` instead; such requests are exempt from the browser-origin check but not from authorisation.

**Authorisation.** Every route is guarded by a role list (Appendix A, Access column). Facility scoping is applied inside handlers: state-level users see every facility, district users their district, facility users their facility.

**Protections.** Origin and Host allow-lists, per-IP rate limiting, per-account lock-out after repeated failures, password policy (8–128 characters with upper/lower case, digit and symbol; 90-day expiry), idle-session logout, and an append-only hash-chained audit log of every state-changing request.

**Integrity of uploads.** A client may send `X-Body-SHA256: <hex SHA-256 of the exact request body>`. The server hashes the bytes it received, answers `422 INTEGRITY_MISMATCH` if they differ, records the event, and echoes `X-Received-Body-SHA256` on success so the sender can confirm what arrived.

## 4. I-02 LIS Agent ↔ API

The LIS Agent is the Windows application that runs next to the analyzers. It authenticates with a device key issued by an administrator and bound to one facility.

| Purpose | Request |
|---|---|
| Verify the device key | `POST /api/dev-keys/verify` |
| Machine protocol for a configured analyzer | `GET /api/lab/machine-protocol/:model` |
| Analyzers configured for a lab | `GET /api/lab/machines/:labId` |
| Worklist for a patient or sample (bi-directional query) | `GET /api/lab/worklist-by-id/:id` |
| Analyzer-initiated results with no order | `GET /api/lab/unsolicited-worklist` |
| Upload results | `POST /api/lab/save-test-results` |
| Analyzer events (connect, fault) | `POST /api/lab/analyzer-event` |
| Offline sample collection snapshot and collection | `GET /api/lab/collection/snapshot`, `POST /api/lab/collection/orders/:id/collect` |
| Offline registration | `GET /api/patients/field-config`, `POST /api/patients/check-duplicate`, `POST /api/patients/register` |
| Sample referrals | `GET/POST /api/lab/referrals`, `POST /api/lab/referrals/receive`, `POST /api/lab/referrals/:id/cancel` |
| Reagent and maintenance alerts | `GET /api/lab/reagents/alerts`, `GET /api/lab/maintenance/alerts` |

**Result upload.** Body: sample ID, analyzer, and a list of results each carrying parameter name, value, unit, flags and entry mode (`Auto` or `Manual`). Manual entries must carry a reason code and text. The agent sends `X-Body-SHA256`; the server stores it with the result (`capture_sha256`).

**Offline behaviour.** All uploads pass through a single local queue. When the network is unavailable the item stays queued and is sent in order when the connection returns; offline registration and sample collection are reconciled with duplicate checks on arrival.

## 5. I-03 Analyzer ↔ LIS Agent

The agent connects to each analyzer over a serial port (RS-232/USB) or TCP, using the protocol recorded for that model in the protocol library (one JSON file per model; currently Alta Hematology, CellTac-S, CelQuant 5 Plus, CelQuant Edge, CliniQuant Micro, HDC-Lyte Plus, HDC-Lyte Pro, Laura Smart and ST-200CL). HL7 analyzers of the Mindray, Alta, Agape and DIRUI families are recognised by name on serial and TCP. A new model is added by supplying its protocol file; no server change is needed.

| Protocol | Framing | Checks applied before a result is accepted |
|---|---|---|
| ASTM E1394 / LIS2-A2 | ENQ/ACK/STX…ETX/EOT, frame number and two-hex-digit checksum | Frame checksum; record order (H, P, O, R, L); mandatory fields |
| HL7 v2.x | MLLP (`0x0B … 0x1C 0x0D`) | Segment structure (MSH, PID, OBR, OBX); OBX value, identifier and units present; acknowledgement `MSA|AA` or `MSA|AR` when rejected |
| Vendor text print-outs | Line-oriented | Required report fields present; numeric values parse |
| Vendor binary frames | Start/end markers, length and checksum | Frame length and checksum |

A result that fails validation is **not** uploaded. It is stored locally as *Rejected* with the reasons and the raw message, shown to the operator, and can be investigated; it is never silently dropped or silently accepted. Results that validate but cannot be matched to an order are held in the unmapped list for manual mapping.

**Two-way operation (worklist download).** When an analyzer asks the LIS what to run on a sample, the agent looks the sample up (`GET /api/lab/worklist-by-id/:id?all=1`, which returns every test still to run with its code, and the patient) and answers in the analyzer's own protocol, from its saved copy of today's orders when the network is down:

| Analyzer asks with | The agent replies with |
|---|---|
| HL7 `ORM^O01` (sample in ORC-3, no results) | `ORR^O02`: MSA, PID, and an ORC/OBR pair for each test |
| HL7 `QRY^Q02` or `QRY^Q01` (sample in QRD-8) | `DSR^Q03`: the query echoed, then the patient and test codes in DSP lines |
| ASTM `Q` record | ENQ, then `H`, `P`, `O` (one `^^^CODE` per test, priority R/A/S) and `L|1|N` frames, each acknowledged, then EOT; `L|1|I` (no information) when there is no order |

Test codes are the LIMS test code (LOINC where there is no code). The wording of these replies follows the HL7 2.3.1 and ASTM E1394 forms the supported analyzer families use; a model whose layout differs is adjusted in its protocol file and verified on the instrument before it is relied on.

## 6. Other interfaces

**I-04 Poxia DSC Agent.** The agent listens on `127.0.0.1:8765` only. It checks the browser `Origin` against its allow-list and the `Host` header against DNS rebinding. Local API: `GET /health`, `/version`, `/tokens`, `/certificates?token=…`, `POST /sign`, `GET /jobs/:id`, `POST /cancel`. The server prepares the exact signed-attribute bytes (`/api/lab/dsc-agent/jobs/:id/prepare`), the agent has the USB token sign them after the doctor types the PIN locally, and the server verifies the signature against the certificate before embedding it (PAdES-style PDF signature, SHA-256 with RSA). The PIN never leaves the doctor's PC; the document is never sent to the agent. Job endpoints: `POST /api/lab/dsc-agent/jobs`, `GET .../jobs/:id`, `.../session`, `.../prepare`, `.../complete`, `.../fail`, `.../cancel`. Each job token is valid for 10 minutes and one report.

**I-05 Razorpay.** Server-to-Razorpay calls create orders, payment links and QR codes (`/api/payments/razorpay/order`, `/link`, `/verify`); the return path is the signed webhook `POST /api/payments/razorpay/webhook` (HMAC-SHA256 over the raw body with the webhook secret) plus a 15-minute reconciliation job that settles payments whose callback never arrived. Bills are created only after payment is confirmed (payment-first), and a webhook can be replayed safely.

**I-06 WhatsApp.** The server posts the message and the report/invoice link to the notification bot on the private network (`WHATSAPP_BOT_URL`). Delivery status is recorded in the report-delivery log.

**I-07 SMTP.** Used for password-reset and notification e-mail. Host, port, user and sender name are configuration values.

**I-08 Report verification.** Each report carries a QR code and a content hash. `GET /api/lab/report-verify/:id` (public, rate-limited) returns whether the hash matches a report issued by the system, without exposing clinical data beyond what the printed report shows.

**I-09 Data export.** `GET /api/export/tables`, `/api/export/table/:name` (CSV), `/api/export/data-dictionary` (CSV) and `/api/export/api-catalogue`. Every export is itself written to the audit trail.

**I-12 Display and kiosk.** The TV display reads the current token queue for one facility. The self-service kiosk uses `/api/lab/kiosk-payment/*` (identify, tests, order, qr, link, status, verify, cancel) and `/api/lab/kiosk-token`: search by UHID or phone, create a payment-first order, and show the Razorpay QR or send a link to the patient's phone.

## 6A. I-13 HL7 FHIR R4 API

Base: `/api/fhir`. Read and search only; writes return `405` with an OperationOutcome. Discovery: `GET /api/fhir/metadata` (CapabilityStatement, public). Responses are `application/fhir+json`; errors are OperationOutcome resources.

| Resource | Interactions | Search parameters | Built from |
|---|---|---|---|
| Patient | read, search-type, `$everything` | `_id`, `identifier` (UHID, ABHA number or address), `name`, `family`, `given`, `birthdate`, `gender`, `phone` | Registered patients. The Aadhaar number is never returned. |
| ServiceRequest | read, search-type | `_id`, `patient`, `status`, `authored`, `identifier` (order barcode / sample), `code` | Laboratory order lines, coded with the test's LOINC code where present |
| Specimen | read, search-type | `_id`, `patient`, `identifier` | Samples with collection and receipt times |
| DiagnosticReport | read, search-type | `_id`, `patient`, `status`, `date`, `identifier`, `code` | Test results; `final` once authorised, `preliminary` before |
| Observation | read, search-type | `_id`, `patient`, `date`, `status`, `code` | One per parameter, with UCUM units, reference range, interpretation and critical flag |
| Organization | read, search-type | `_id`, `name`, `identifier` | Facilities |

Paging uses `_count` (maximum 100) and `_page`; the Bundle carries `self` and `next` links. Observation search is paged by test result, so it reports no `total`. A credential sees only what the application would show it: state users everything, district users their district, facility users and integration keys their own facility. Every FHIR read is written to the audit trail. Identifier systems: `urn:ka-lims:identifier:uhid`, `https://healthid.ndhm.gov.in` (ABHA), `urn:ka-lims:identifier:order-barcode`; test codes use `http://loinc.org` where recorded. Write interactions (placing orders through FHIR) are not offered; ordering uses I-01 and the HL7 order endpoint.

## 6B. I-14 One-time-code sign-in

`POST /api/patients/portal/otp/request` (mobile, captcha) → always answers the same, whether or not the number is registered; `POST /api/patients/portal/otp/verify` (mobile, code) → sign-in token, or a list when several people share the number. The clinician portal uses `/api/clinician-portal/otp/request` and `/otp/verify`, then `GET /api/clinician-portal/reports` and `/reports/:sampleId/pdf`; a clinician sees only orders that name them as referrer. Codes are six digits, valid five minutes, stored only as a keyed hash, single use, locked after five wrong tries, at most three requested per number per 15 minutes. They go by SMS when a gateway is configured and by WhatsApp otherwise. Setting `PORTAL_REQUIRE_OTP=true` stops the date-of-birth-only patient sign-in.

## 6C. I-16 SMS gateway

Configured by environment values, not code: `SMS_GATEWAY_URL` with `{phone}`, `{message}`, `{sender}`, `{template_id}` placeholders, `SMS_GATEWAY_METHOD` (GET or POST), `SMS_GATEWAY_BODY`, `SMS_GATEWAY_HEADERS`, `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID` and `SMS_OTP_TEMPLATE` (which must equal the registered template). Any provider that accepts an HTTP call works.

## 7. Master data and code systems

Tests carry an internal test code and an optional LOINC code and display name; units use UCUM-style strings as entered by the laboratory. Branch, district and state master data is maintained in the Organisation module and can be exported through I-09. Patient identity may carry an ABHA number and, where the registering user enters it, an Aadhaar number.

## 8. Specified but not yet connected

| Interface | Position |
|---|---|
| HL7 FHIR write interactions (placing orders and submitting results through FHIR) | The FHIR API is read-only (I-13); ordering uses I-01 and the HL7 order endpoint. |
| Aadhaar eSign through an Application Service Provider | Requires an ESP agreement; the DSC flow in I-04 is the supported signing method. |
| National and State government platforms (NFDS, e-Hospital, ABDM gateway) | Endpoints, keys and onboarding are issued by the owning agency; the interfaces I-10 and I-11 are the existing pattern for such integrations. |

## 9. Change control

Interfaces are versioned with the application release. A change that alters a request or response in a way existing clients cannot ignore is announced in the release notes and, for the LIS Agent, delivered with an agent update before the server change is enabled. The endpoint index in Appendix A is regenerated for every release with `node HIMS-backend/scripts/generate-doc-appendices.mjs`.

## Appendix A — API endpoint index

(Generated; see `docs/generated/api-endpoints.md`.)

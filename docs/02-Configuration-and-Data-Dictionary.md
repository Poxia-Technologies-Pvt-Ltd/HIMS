# Karnataka LIMS — Configuration and Data Dictionary

Tender reference: configuration and data-dictionary documentation (requirement 126).
Audience: system administrators, hospital IT, the Department's technical reviewers and any successor maintainer.

## 1. System overview

| Component | Technology | Where it runs |
|---|---|---|
| Web application | React single-page application served by nginx | Application server (container `ka_frontend`) |
| API | Node.js (Express), stateless | Application server (container `ka_backend`) |
| Database | MySQL 8.0, one schema `ka-lims` | Application server (container `ka_mysql`, data volume `ka_mysql_data`, not published to the host network) |
| LIS Agent | Electron application with a local SQLite queue | Windows PC in each laboratory, next to the analyzers |
| Poxia DSC Agent | Electron application, PKCS#11 | Each signing doctor's Windows PC |
| TV display / self-service kiosk | Browser pages served by the same API | Waiting-area display and kiosk terminal |
| Notification bot | WhatsApp service reached on a private network | Shared bot container |

A single deployment serves all facilities; every record carries the facility (`branch_id`) it belongs to, and users are confined to their level (state, district, facility) by the API.

## 2. Configuration layers

Configuration is held in four layers. Change the lowest layer that does the job.

1. **Environment (server).** Secrets and deployment addresses. Set in the deployment's environment file (never committed) and read at start-up; changing a value needs a restart.
2. **Settings screens (administrators).** Behaviour that hospital or state administrators change without a deployment.
3. **Master data (administrators).** Lists the system works from: facilities, tests, parameters, analyzers, prices, schemes.
4. **Agent settings (laboratory PC).** Serial/TCP connection, API address and device key of each LIS Agent.

### 2.1 Environment variables

| Variable | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | Must be `production` on live servers | Several security controls depend on it |
| `PORT` | API listening port | Container maps to the host loopback only |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database connection | |
| `JWT_SECRET` | Signs staff sessions | Long random value; rotating it signs everyone out |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS` | Browser origins and Host headers accepted | HTTPS origins only in production; add the agent's origin for local testing |
| `FRONTEND_URL`, `PUBLIC_API_URL` | Public addresses used in links and messages | |
| `COOKIE_DOMAIN` | Only when the cookie is shared across sub-domains | |
| `PASSWORD_MAX_AGE_DAYS` | Password expiry (default 90) | |
| `DEVELOPER_EMAIL`, `DEVELOPER_JWT_SECRET` | Separate developer-portal login | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME` | Outgoing e-mail | |
| `WHATSAPP_BOT_URL` | Notification bot address | |
| `OTP_CHANNEL` | How one-time codes are sent: `auto` (SMS if a gateway is set, otherwise WhatsApp), `sms` or `whatsapp` | |
| `SMS_GATEWAY_URL`, `SMS_GATEWAY_METHOD`, `SMS_GATEWAY_BODY`, `SMS_GATEWAY_HEADERS`, `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID`, `SMS_OTP_TEMPLATE` | HTTP SMS gateway (see Interface Specification, I-16) | Blank = SMS off |
| `PORTAL_REQUIRE_OTP` | `true` stops the date-of-birth-only patient sign-in | |
| `WHATSAPP_PROVIDER`, `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_REPORT_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | WhatsApp Cloud API provider settings | Only when the Cloud API is used |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Online payments | Payments are disabled until set |
| `REPORT_DSC_P12_PATH`, `REPORT_DSC_P12_BASE64`, `REPORT_DSC_P12_PASSWORD` | Hospital document-signing certificate (server-side signing) | Alternative to uploading certificates in the screen |
| `DSC_VAULT_KEY` | Key that encrypts stored certificate passwords | Losing it makes stored certificate passwords unrecoverable |
| `DSC_TRUSTED_ROOTS_PATH` | PEM bundle of trusted certifying-authority roots | Enables certificate-chain verification |
| `CDAC_*` (base URL, bearer token, ext-user, access key or key map, timeouts, retries) | e-Sushrut HMIS integration | Blank = integration off |
| `CARE_*` (backend URL, API key, gateway key id and private key, JWKS cache, timeout) | CARE HMIS gateway | Blank = integration off |

### 2.2 Settings screens

| Screen (menu) | What it controls |
|---|---|
| Settings → Digital Signature (DSC) | Require a digital signature on reports; sign with the hospital certificate or each doctor's own USB token; certificate registration and reset |
| Payment Settings | Which payment modes are accepted at the counter and kiosk; online-payment behaviour |
| Hospital Test Prices | Price of each test per facility |
| Billing Packages, Free Schemes | Package definitions and free/subsidised scheme rules |
| Patient Field Config | Which registration fields are shown, required and validated |
| Report Signing | Hospital signing certificate upload and status |
| LIS-Agent Keys | Issue, list and revoke device keys, one per laboratory PC |
| CDAC Mapping | Map LIMS tests to e-Sushrut codes |
| Machine Master, Machine Network, Parameter Names | Analyzer models, installed analyzers per laboratory, and the names under which analyzers report each parameter |
| Test Management | Test catalogue: code, category, sample type, tube, methodology, TAT target, price, reference ranges |
| Hospital Network, Org Management, Hospital Infrastructure | Facilities, districts, hierarchy, labs, rooms |
| Staff Management, Duty Roster | Users, roles, facility mapping, rosters |
| Referring Clinicians | Register of clinicians who may sign in at `/clinician-portal` (mobile number, registration number, other spellings used on orders) |
| Blood Bank | Donors, donations, screening, components, stock, requests, issue, outcomes, reactions |
| Point-of-Care Tests | POCT devices, certified operators, daily quality control, bedside results |

### 2.3 Roles

Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Doctor, Receptionist, Sample Collector, Programme Officer, Auditor. Each route lists the roles that may use it (Appendix A of the Interface Specification). A user also has a level (Central / Sub-Central / Branch) that limits which facilities they can see.

### 2.4 Defaults worth knowing

| Setting | Default |
|---|---|
| Password rule | 8–128 characters, upper and lower case, digit and symbol; expires after 90 days |
| Account lock-out | After repeated failed sign-ins, with a 24-hour window |
| Session | 30-day token with idle-session logout in the browser |
| Critical-result acknowledgement | 30 minutes unless the alert sets otherwise |
| Signing-job validity (DSC Agent) | 10 minutes, one report |
| Unmatched analyzer results | Removed automatically after 24 hours if never mapped |
| One-time sign-in codes | Valid 5 minutes, 5 tries, 3 per number per 15 minutes; removed after a day |
| Blood-unit shelf life | Whole blood and red cells 35 days, platelets 5 days, plasma and cryoprecipitate 1 year (`utils/bloodBank.js`) |
| Blood donor interval | 90 days (men), 120 days (women); Hb ≥ 12.5 g/dL, weight ≥ 45 kg, age 18–65 |
| Returned blood | Usable again only if back within 30 minutes of issue |

## 3. Change and release procedure

1. Database changes are SQL files in `HIMS-backend/migrations`, named by date. Each is applied once, in order, on staging and then production; the application never drops data in a migration.
2. The API and web application are rebuilt as containers from the repository (`docker compose -f docker-compose.ka.yml up -d --build`).
3. The LIS Agent and DSC Agent are built by the release workflows and installed per PC; the agent updates itself from the download location when a newer version is published.
4. Before a release: back up the database (`ops/backup-ka-lims.sh`), apply migrations, deploy, check `GET /` and the sign-in page, and review the audit trail for errors.

## 4. Data model

The database holds the modules below. The complete table-by-table dictionary (every column, type, nullability, key, default and foreign key) is Appendix B and is generated from the live schema by `node HIMS-backend/scripts/generate-doc-appendices.mjs`; the same dictionary can be downloaded as CSV by an administrator from Data Export.

| Module | Main tables | Notes |
|---|---|---|
| Organisation | `branches`, `districts`, `departments`, `infrastructure` | Every record is tied to a facility; `branches.district_id` places it in a district |
| Patients & visits | `patients`, `visits`, `bills`, `bill_items` | `patients.reg_no` is the UHID; a bill item is one ordered service |
| Laboratory | `lab_tests`, `lab_samples`, `lab_test_result`, `sample_rejections`, `sample_referrals`, `critical_alerts`, `lab_machines` | `lab_test_result.results_json` holds the parameter values; `entry_mode` and `manual_reason` mark manual entries; `capture_sha256` is the integrity checksum of the upload |
| Quality | `qc_materials`, `qc_runs`, `eqas_results`, `equipment_tickets`, `equipment_pm_schedules`, `equipment_reagent_changes` | IQC with Westgard rules, EQAS, breakdowns, preventive maintenance, reagent lots |
| Billing & payments | `bills`, `bill_payments`, `payment_gateway_transactions`, `branch_payment_settings`, `free_schemes` | Online payments are recorded with the gateway reference |
| Inventory | `inventory_items`, `inventory_batches`, `inventory_stock`, `inventory_transactions`, purchase and transfer tables | Batch and expiry tracking |
| Users & signing | `users`, `device_api_keys`, `user_dsc_certificates`, `dsc_signing_jobs` | Passwords are hashed; certificate passwords are encrypted with `DSC_VAULT_KEY` |
| Audit | `system_audit_log`, `sync_integrity_events` | The audit log is append-only (database triggers refuse update and delete) and hash-chained |
| Surveillance | `disease_surveillance`, `surveillance_diseases` | Feeds the disease heat-map |
| Blood bank | `bb_donors`, `bb_units`, `bb_requests`, `bb_issues`, `bb_reactions` | A unit is one donation or one component made from it (`parent_unit_id`); `status` runs Quarantine → Available → Issued → Used, or Discarded / Expired |
| Point of care | `poct_devices`, `poct_operators`, `poct_qc`, `poct_results` | A result records the device, the operator, the QC state and any reason for testing without current QC |
| Portals | `portal_otps`, `referring_clinicians` | One-time codes are stored as a keyed hash and removed after a day |

**Keys and identifiers.** Primary keys are integers except where a business identifier is the natural key (for example `lab_samples.sample_id`). Foreign keys are shown in Appendix B under *Refers to*.

**Personal data.** Name, age/sex, phone, address, ABHA and Aadhaar numbers (where entered) are held in `patients`. Access is by role and facility; reads of exports are audited. The retention and archival of these records is governed by the Data Retention and Archival Policy.

## Appendix B — Data dictionary

(Generated; see `docs/generated/data-dictionary.md`.)

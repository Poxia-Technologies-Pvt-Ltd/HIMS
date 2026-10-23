# Appendix — API endpoint index

Generated 2026-10-08 from the route files (515 endpoints). Access is as declared in code; business rules inside a handler (for example facility scoping) apply in addition.

## /api/appointments

| Method | Path | Access |
|---|---|---|
| GET | /api/appointments | Signed-in user |
| POST | /api/appointments/book | Signed-in user |

## /api/audit

| Method | Path | Access |
|---|---|---|
| GET | /api/audit | Roles: Admin, Super Admin, Auditor |
| GET | /api/audit/export | Roles: Admin, Super Admin, Auditor |
| GET | /api/audit/sync-integrity | Roles: Admin, Super Admin, Auditor |
| GET | /api/audit/verify | Roles: Admin, Super Admin, Auditor |

## /api/auth

| Method | Path | Access |
|---|---|---|
| GET | /api/auth/captcha | Public / own check |
| POST | /api/auth/change-password | Signed-in user |
| POST | /api/auth/forgot-password | Public / own check |
| POST | /api/auth/login | Public / own check |
| POST | /api/auth/logout | Public / own check |
| POST | /api/auth/register | Roles: Admin, Lab Head, Doctor |
| POST | /api/auth/reset-password | Public / own check |

## /api/barcodes

| Method | Path | Access |
|---|---|---|
| POST | /api/barcodes/generate | Signed-in user |
| GET | /api/barcodes/sample/:sampleId | Signed-in user |

## /api/billing-packages

| Method | Path | Access |
|---|---|---|
| GET | /api/billing-packages | Signed-in user |
| POST | /api/billing-packages | Roles: Admin, Super Admin |
| DELETE | /api/billing-packages/:id | Roles: Admin, Super Admin |
| GET | /api/billing-packages/:id | Signed-in user |
| PUT | /api/billing-packages/:id | Roles: Admin, Super Admin |
| GET | /api/billing-packages/department/:department | Signed-in user |

## /api/billing

| Method | Path | Access |
|---|---|---|
| DELETE | /api/billing/:id | Roles: Admin, Super Admin |
| GET | /api/billing/:id | Signed-in user |
| PUT | /api/billing/:id | Roles: Admin, Super Admin, Receptionist |
| POST | /api/billing/:id/cancel-order | Roles: Admin, Super Admin, Receptionist |
| GET | /api/billing/:id/order-status | Signed-in user |
| POST | /api/billing/:id/payment | Roles: Admin, Super Admin, Receptionist |
| GET | /api/billing/:id/pdf | Signed-in user |
| GET | /api/billing/all | Signed-in user |
| POST | /api/billing/create | Roles: Admin, Super Admin, Receptionist |
| GET | /api/billing/patient/:regNo | Signed-in user |
| GET | /api/billing/patients/list | Signed-in user |
| POST | /api/billing/send-whatsapp | Roles: Admin, Super Admin, Receptionist |
| GET | /api/billing/services/available | Signed-in user |

## /api/blood-bank

| Method | Path | Access |
|---|---|---|
| POST | /api/blood-bank/donations | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/donors | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| POST | /api/blood-bank/donors | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| POST | /api/blood-bank/donors/:id/defer | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/issues | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| POST | /api/blood-bank/issues/:id/outcome | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/reactions | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| POST | /api/blood-bank/reactions | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/requests | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| POST | /api/blood-bank/requests | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor |
| POST | /api/blood-bank/requests/:id/cancel | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| POST | /api/blood-bank/requests/:id/issue | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/requests/:id/units | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| GET | /api/blood-bank/summary | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/blood-bank/units | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| POST | /api/blood-bank/units/:id/discard | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| POST | /api/blood-bank/units/:id/process | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |
| POST | /api/blood-bank/units/:id/screening | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician |

## /api/branches

| Method | Path | Access |
|---|---|---|
| GET | /api/branches | Public / own check |
| POST | /api/branches/categories | Roles: Admin, Super Admin |
| DELETE | /api/branches/categories/:id | Roles: Admin, Super Admin |
| PUT | /api/branches/categories/:id | Roles: Admin, Super Admin |
| POST | /api/branches/center | Roles: Admin, Super Admin |
| DELETE | /api/branches/center/:id | Roles: Admin, Super Admin |
| PUT | /api/branches/center/:id | Roles: Admin, Super Admin |
| PATCH | /api/branches/center/:id/block | Roles: Admin, Super Admin |
| POST | /api/branches/district | Roles: Admin, Super Admin |
| DELETE | /api/branches/district/:id | Roles: Admin, Super Admin |
| PUT | /api/branches/district/:id | Roles: Admin, Super Admin |

## /api/care-bridge

| Method | Path | Access |
|---|---|---|
| POST | /api/care-bridge/import | Public / own check |
| POST | /api/care-bridge/mark-saved | Public / own check |
| GET | /api/care-bridge/results/:requestId | Public / own check |

## /api/care

| Method | Path | Access |
|---|---|---|
| GET | /api/care/abha-dashboard | Signed-in user |
| GET | /api/care/devices | Signed-in user |
| GET | /api/care/logs | Signed-in user |
| GET | /api/care/loinc-mappings | Signed-in user |
| POST | /api/care/loinc-mappings/:id/confirm | Roles: Admin, Super Admin |
| POST | /api/care/loinc-mappings/auto-map | Roles: Admin, Super Admin |
| GET | /api/care/loinc-parameter-mappings | Signed-in user |
| POST | /api/care/loinc-parameter-mappings | Roles: Admin, Super Admin |
| POST | /api/care/loinc-parameter-mappings/import | Roles: Admin, Super Admin |

## /api/cdac

| Method | Path | Access |
|---|---|---|
| GET | /api/cdac/branch-config | Signed-in user |
| POST | /api/cdac/branch-config | Roles: Admin, Super Admin |
| GET | /api/cdac/logs | Signed-in user |
| GET | /api/cdac/parameter-mappings | Signed-in user |
| POST | /api/cdac/parameter-mappings | Roles: Admin, Super Admin |
| POST | /api/cdac/parameter-mappings/import | Roles: Admin, Super Admin |
| POST | /api/cdac/pull-order | Signed-in user |
| POST | /api/cdac/sync-master-data | Roles: Admin, Super Admin |
| GET | /api/cdac/test-mappings | Signed-in user |
| POST | /api/cdac/test-mappings/:id/confirm | Roles: Admin, Super Admin |
| POST | /api/cdac/test-mappings/auto-map | Roles: Admin, Super Admin |

## /api/clinicians

| Method | Path | Access |
|---|---|---|
| GET | /api/clinicians | Roles: Admin, Super Admin, Lab Head, Receptionist |
| POST | /api/clinicians | Roles: Admin, Super Admin, Lab Head, Receptionist |
| PUT | /api/clinicians/:id | Roles: Admin, Super Admin, Lab Head, Receptionist |

## /api/consultations

| Method | Path | Access |
|---|---|---|
| POST | /api/consultations | Signed-in user |
| GET | /api/consultations/:appointmentId | Signed-in user |
| POST | /api/consultations/auto-bill | Signed-in user |
| GET | /api/consultations/followup-due | Signed-in user |
| GET | /api/consultations/patient/:regNo/history | Signed-in user |
| GET | /api/consultations/patient/:regNo/lab-trends | Signed-in user |
| GET | /api/consultations/patient/:regNo/timeline | Signed-in user |
| POST | /api/consultations/send-summary-sms | Signed-in user |
| POST | /api/consultations/templates | Signed-in user |
| GET | /api/consultations/templates/:doctorId | Signed-in user |
| DELETE | /api/consultations/templates/:id | Signed-in user |
| GET | /api/consultations/today | Signed-in user |

## /api/dashboard

| Method | Path | Access |
|---|---|---|
| GET | /api/dashboard/branch | Signed-in user |
| GET | /api/dashboard/central | Signed-in user |
| GET | /api/dashboard/stats | Signed-in user |
| GET | /api/dashboard/sub-central | Signed-in user |

## /api/departments

| Method | Path | Access |
|---|---|---|
| GET | /api/departments | Signed-in user |
| POST | /api/departments | Roles: Admin, Super Admin |
| DELETE | /api/departments/:id | Roles: Admin, Super Admin |
| GET | /api/departments/:id | Signed-in user |
| PUT | /api/departments/:id | Roles: Admin, Super Admin |

## /api/dev-keys

| Method | Path | Access |
|---|---|---|
| GET | /api/dev-keys | Roles: Admin |
| POST | /api/dev-keys | Roles: Admin |
| DELETE | /api/dev-keys/:id | Roles: Admin |
| POST | /api/dev-keys/verify | Device key or signed-in user |

## /api/dev

| Method | Path | Access |
|---|---|---|
| GET | /api/dev/brands | Public / own check |
| POST | /api/dev/districts | Public / own check |
| GET | /api/dev/hospitals | Public / own check |
| POST | /api/dev/hospitals | Public / own check |
| DELETE | /api/dev/hospitals/:id | Public / own check |
| PUT | /api/dev/hospitals/:id | Public / own check |
| GET | /api/dev/labs | Public / own check |
| POST | /api/dev/labs | Public / own check |
| DELETE | /api/dev/labs/:id | Public / own check |
| PUT | /api/dev/labs/:id | Public / own check |
| POST | /api/dev/logout | Public / own check |
| POST | /api/dev/send-otp | Public / own check |
| GET | /api/dev/stats | Public / own check |
| GET | /api/dev/users | Public / own check |
| POST | /api/dev/users | Public / own check |
| PUT | /api/dev/users/:id | Public / own check |
| PATCH | /api/dev/users/:id/reset-password | Public / own check |
| PATCH | /api/dev/users/:id/toggle | Public / own check |
| POST | /api/dev/verify-otp | Public / own check |

## /api/disaster

| Method | Path | Access |
|---|---|---|
| GET | /api/disaster/alerts | Signed-in user |
| GET | /api/disaster/resources | Signed-in user |
| GET | /api/disaster/rules | Signed-in user |
| PUT | /api/disaster/rules/:id | Roles: Admin, Super Admin, Programme Officer |
| GET | /api/disaster/surveillance | Signed-in user |

## /api/duty

| Method | Path | Access |
|---|---|---|
| GET | /api/duty | Signed-in user |
| DELETE | /api/duty/:id | Roles: Admin, Super Admin, Lab Head |
| POST | /api/duty/add | Roles: Admin, Super Admin, Lab Head |
| GET | /api/duty/available | Signed-in user |
| GET | /api/duty/slots | Signed-in user |

## /api/equipment

| Method | Path | Access |
|---|---|---|
| PUT | /api/equipment/machines/:id/install-location | Roles: Admin, Super Admin, Lab Head |
| POST | /api/equipment/machines/:id/location-check | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/equipment/registry | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| PUT | /api/equipment/registry/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/equipment/tickets | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| POST | /api/equipment/tickets | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| PUT | /api/equipment/tickets/:id | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/equipment/tickets/:id/samples | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| POST | /api/equipment/tickets/:id/samples | Roles: Admin, Super Admin, Lab Head, Lab Technician |

## /api/export

| Method | Path | Access |
|---|---|---|
| GET | /api/export/api-catalogue | Roles: Admin, Super Admin, Auditor |
| GET | /api/export/data-dictionary | Roles: Admin, Super Admin, Auditor |
| GET | /api/export/table/:name | Roles: Admin, Super Admin, Auditor |
| GET | /api/export/tables | Roles: Admin, Super Admin, Auditor |

## /api/fhir

| Method | Path | Access |
|---|---|---|
| GET | /api/fhir/DiagnosticReport | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/DiagnosticReport/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/metadata | Public / own check |
| GET | /api/fhir/Observation | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Observation/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Organization | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Organization/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Patient | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Patient/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Patient/:id/:op | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/ServiceRequest | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/ServiceRequest/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Specimen | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |
| GET | /api/fhir/Specimen/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Auditor, Programme Officer, Doctor |

## /api/free-schemes

| Method | Path | Access |
|---|---|---|
| GET | /api/free-schemes | Signed-in user |
| POST | /api/free-schemes | Roles: Admin, Super Admin |
| DELETE | /api/free-schemes/:id | Roles: Admin, Super Admin |
| PUT | /api/free-schemes/:id | Roles: Admin, Super Admin |

## /api/hl7

| Method | Path | Access |
|---|---|---|
| POST | /api/hl7/patient/register | Public / own check |
| GET | /api/hl7/patient/search | Public / own check |

## /api/infra

| Method | Path | Access |
|---|---|---|
| GET | /api/infra | Signed-in user |
| POST | /api/infra/add | Roles: Admin, Super Admin |
| DELETE | /api/infra/delete/:id | Roles: Admin, Super Admin |
| PUT | /api/infra/update/:id | Roles: Admin, Super Admin |

## /api/inventory-network

| Method | Path | Access |
|---|---|---|
| GET | /api/inventory-network/branch | Signed-in user |
| GET | /api/inventory-network/central | Signed-in user |
| GET | /api/inventory-network/overall | Signed-in user |
| GET | /api/inventory-network/sub-central | Signed-in user |

## /api/inventory

| Method | Path | Access |
|---|---|---|
| GET | /api/inventory/alerts/expired | Signed-in user |
| GET | /api/inventory/alerts/expiry | Signed-in user |
| GET | /api/inventory/alerts/low-stock | Signed-in user |
| GET | /api/inventory/batches | Signed-in user |
| POST | /api/inventory/batches | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/inventory/batches/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/inventory/batches/:id/open-vial | Signed-in user |
| POST | /api/inventory/consume-reagents | Signed-in user |
| GET | /api/inventory/consumption-logs | Signed-in user |
| GET | /api/inventory/dashboard | Signed-in user |
| GET | /api/inventory/goods-receipts | Signed-in user |
| POST | /api/inventory/goods-receipts | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/goods-receipts/:id | Signed-in user |
| PUT | /api/inventory/goods-receipts/:id/approve | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/items | Signed-in user |
| POST | /api/inventory/items | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/inventory/items/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/items/:id | Signed-in user |
| PUT | /api/inventory/items/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/items/categories | Signed-in user |
| GET | /api/inventory/pending-grn | Signed-in user |
| GET | /api/inventory/purchase-orders | Signed-in user |
| POST | /api/inventory/purchase-orders | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/purchase-orders/:id | Signed-in user |
| PUT | /api/inventory/purchase-orders/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/purchase-requisitions | Signed-in user |
| POST | /api/inventory/purchase-requisitions | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/purchase-requisitions/:id | Signed-in user |
| PUT | /api/inventory/purchase-requisitions/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/inventory/purchase-requisitions/:id/approve | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/qc-inventory | Signed-in user |
| GET | /api/inventory/reagent-mappings | Signed-in user |
| POST | /api/inventory/reagent-mappings | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/inventory/reagent-mappings/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/inventory/reagent-mappings/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/reports/consumption | Signed-in user |
| GET | /api/inventory/reports/expiry | Signed-in user |
| GET | /api/inventory/reports/low-stock | Signed-in user |
| GET | /api/inventory/reports/purchase | Signed-in user |
| GET | /api/inventory/reports/reagent-usage | Signed-in user |
| GET | /api/inventory/reports/stock-ledger | Signed-in user |
| GET | /api/inventory/stock | Signed-in user |
| POST | /api/inventory/stock/adjust | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/stock/batches | Signed-in user |
| GET | /api/inventory/stock/transactions | Signed-in user |
| GET | /api/inventory/tests/:test_id/reagents | Signed-in user |
| GET | /api/inventory/transfers | Signed-in user |
| POST | /api/inventory/transfers | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/transfers/:id | Signed-in user |
| PUT | /api/inventory/transfers/:id/approve | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/inventory/transfers/:id/receive | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/vendors | Signed-in user |
| POST | /api/inventory/vendors | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/inventory/vendors/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/vendors/:id | Signed-in user |
| PUT | /api/inventory/vendors/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/inventory/vendors/purchase-summary | Signed-in user |

## /api/lab

| Method | Path | Access |
|---|---|---|
| POST | /api/lab/acknowledge-test | Signed-in user |
| GET | /api/lab/activity-logs | Signed-in user |
| POST | /api/lab/analyzer-event | Signed-in user |
| GET | /api/lab/analyzer-logs | Signed-in user |
| GET | /api/lab/approved-reports | Signed-in user |
| POST | /api/lab/attach-result | Signed-in user |
| POST | /api/lab/book-tests | Signed-in user |
| GET | /api/lab/categories | Signed-in user |
| POST | /api/lab/categories | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/lab/categories/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/categories/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/collection/orders | Signed-in user |
| GET | /api/lab/collection/orders/:bill_id | Signed-in user |
| POST | /api/lab/collection/orders/:bill_id/collect | Signed-in user |
| POST | /api/lab/collection/reprint | Signed-in user |
| GET | /api/lab/collection/snapshot | Signed-in user |
| GET | /api/lab/containers | Signed-in user |
| POST | /api/lab/containers | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/lab/containers/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/containers/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/critical-alerts | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/critical-alerts/:id/notify | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/dsc-agent/jobs | Signed-in user |
| GET | /api/lab/dsc-agent/jobs/:id | Signed-in user |
| POST | /api/lab/dsc-agent/jobs/:id/cancel | Signed-in user |
| POST | /api/lab/dsc-agent/jobs/:id/complete | Public / own check |
| POST | /api/lab/dsc-agent/jobs/:id/fail | Public / own check |
| POST | /api/lab/dsc-agent/jobs/:id/prepare | Public / own check |
| GET | /api/lab/dsc-agent/jobs/:id/session | Public / own check |
| POST | /api/lab/dsc/:id/revoke | Roles: Admin, Super Admin |
| GET | /api/lab/dsc/mine | Signed-in user |
| PUT | /api/lab/dsc/settings | Roles: Admin, Super Admin |
| POST | /api/lab/dsc/upload | Roles: Admin, Super Admin |
| GET | /api/lab/dsc/users | Roles: Admin, Super Admin |
| POST | /api/lab/generate-parameters | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/generate-report-pdf/:sampleId | Signed-in user |
| POST | /api/lab/generate-sample-id | Signed-in user |
| GET | /api/lab/hospital-code/:userId | Signed-in user |
| POST | /api/lab/kiosk-payment/cancel | Public / own check |
| POST | /api/lab/kiosk-payment/identify | Public / own check |
| POST | /api/lab/kiosk-payment/link | Public / own check |
| POST | /api/lab/kiosk-payment/order | Public / own check |
| POST | /api/lab/kiosk-payment/qr | Public / own check |
| GET | /api/lab/kiosk-payment/status/:txnId | Public / own check |
| GET | /api/lab/kiosk-payment/tests | Public / own check |
| POST | /api/lab/kiosk-payment/verify | Public / own check |
| POST | /api/lab/kiosk-print-report | Public / own check |
| GET | /api/lab/kiosk-queue | Public / own check |
| GET | /api/lab/kiosk-reports | Public / own check |
| POST | /api/lab/kiosk-send-ready | Public / own check |
| GET | /api/lab/kiosk-stats | Public / own check |
| POST | /api/lab/kiosk-token | Public / own check |
| GET | /api/lab/kiosk-tokens | Public / own check |
| POST | /api/lab/kiosk-view-report | Public / own check |
| GET | /api/lab/labs | Signed-in user |
| GET | /api/lab/machine-by-serial/:serialNumber | Signed-in user |
| GET | /api/lab/machine-models | Roles: Admin |
| POST | /api/lab/machine-models | Roles: Admin |
| GET | /api/lab/machine-protocol/:model | Signed-in user |
| GET | /api/lab/machine-stats | Signed-in user |
| POST | /api/lab/machines | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/lab/machines/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/machines/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/machines/:labId | Signed-in user |
| POST | /api/lab/machines/sync | Signed-in user |
| GET | /api/lab/maintenance/alerts | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/maintenance/apply-standard | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/maintenance/history/:machineId | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/maintenance/overview | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/maintenance/schedules | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/maintenance/schedules/:id | Roles: Admin, Super Admin, Lab Head |
| POST | /api/lab/maintenance/schedules/:id/complete | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/manual-entry/form/:billItemId | Signed-in user |
| GET | /api/lab/manual-entry/reasons | Signed-in user |
| POST | /api/lab/map-analyzer-tests | Roles: Admin, Super Admin, Lab Head |
| POST | /api/lab/map-unmapped-test | Signed-in user |
| POST | /api/lab/merge-samples | Signed-in user |
| GET | /api/lab/mergeable | Signed-in user |
| GET | /api/lab/my-signature | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/my-signature | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/network-machines | Signed-in user |
| GET | /api/lab/open-tests | Signed-in user |
| GET | /api/lab/parameter-codes | Roles: Admin |
| POST | /api/lab/parameter-codes | Roles: Admin |
| GET | /api/lab/pending-verifications | Signed-in user |
| GET | /api/lab/reagents/alerts | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/reagents/change | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/reagents/history/:machineId | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/reagents/overview | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/reagents/stock | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| GET | /api/lab/referral-facilities | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| GET | /api/lab/referrals | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| POST | /api/lab/referrals | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| POST | /api/lab/referrals/:id/cancel | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| POST | /api/lab/referrals/receive | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| GET | /api/lab/rejection-reasons | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| GET | /api/lab/rejections | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| GET | /api/lab/report-details/:sampleId | Signed-in user |
| GET | /api/lab/report-signing/status | Roles: Admin, Super Admin |
| POST | /api/lab/report-signing/test | Roles: Admin, Super Admin |
| GET | /api/lab/report-verify/:id | Public / own check |
| GET | /api/lab/report/:sampleId | Public / own check |
| POST | /api/lab/request-rerun | Roles: Admin, Super Admin, Lab Head |
| POST | /api/lab/resend-report-whatsapp/:sampleId | Signed-in user |
| GET | /api/lab/result-flag-settings | Signed-in user |
| PUT | /api/lab/result-flag-settings | Roles: Admin, Super Admin, Lab Head |
| POST | /api/lab/results/:id/cancel | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/results/:id/history | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/results/:id/reissue | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/sample-types | Signed-in user |
| POST | /api/lab/sample-types | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/lab/sample-types/:id | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/lab/sample-types/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/samples | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| POST | /api/lab/samples/:sample_id/aliquots | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| GET | /api/lab/samples/custody | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| GET | /api/lab/samples/events | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| GET | /api/lab/samples/lookup | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| POST | /api/lab/samples/reject | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor |
| POST | /api/lab/samples/scan | Roles: Admin, Super Admin, Lab Head, Lab Technician, Lab Doctor, Phlebotomist, Sample Collector |
| POST | /api/lab/save-test-results | Signed-in user |
| GET | /api/lab/suggested-lab | Signed-in user |
| GET | /api/lab/test-results/:sampleId | Signed-in user |
| GET | /api/lab/tests | Signed-in user |
| POST | /api/lab/tests | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/tests-general | Signed-in user |
| DELETE | /api/lab/tests/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/tests/:id | Signed-in user |
| PUT | /api/lab/tests/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/lab/track/:referenceNumber | Signed-in user |
| GET | /api/lab/unmapped-results | Signed-in user |
| POST | /api/lab/unmerge-sample | Signed-in user |
| POST | /api/lab/unsolicited-worklist | Signed-in user |
| POST | /api/lab/update-test-status | Signed-in user |
| GET | /api/lab/verification-workflows | Signed-in user |
| PUT | /api/lab/verification-workflows/:category_id | Roles: Admin, Super Admin, Lab Head |
| POST | /api/lab/verify-test | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| POST | /api/lab/whatsapp-send-report | Public / own check |
| GET | /api/lab/worklist | Signed-in user |
| GET | /api/lab/worklist-by-id/:id | Signed-in user |
| GET | /api/lab/worklist/version | Signed-in user |

## /api/org

| Method | Path | Access |
|---|---|---|
| DELETE | /api/org/beds/:id | Roles: Admin, Super Admin |
| DELETE | /api/org/blocks/:id | Roles: Admin, Super Admin |
| DELETE | /api/org/holidays/:id | Roles: Admin, Super Admin |
| DELETE | /api/org/specialties/:id | Roles: Admin, Super Admin |
| DELETE | /api/org/states/:id | Roles: Admin, Super Admin |
| DELETE | /api/org/working-hours/:id | Roles: Admin, Super Admin |

## /api/patients

| Method | Path | Access |
|---|---|---|
| GET | /api/patients/:regNo/chart | Signed-in user |
| GET | /api/patients/check-duplicate | Signed-in user |
| GET | /api/patients/consultants | Signed-in user |
| GET | /api/patients/field-config | Signed-in user |
| POST | /api/patients/field-config | Roles: Admin, Super Admin |
| DELETE | /api/patients/field-config/:field_key | Roles: Admin, Super Admin |
| POST | /api/patients/merge | Roles: Admin, Super Admin |
| GET | /api/patients/phone-lookup/:phone | Signed-in user |
| POST | /api/patients/portal/login | Public / own check |
| POST | /api/patients/portal/otp/request | Public / own check |
| POST | /api/patients/portal/otp/verify | Public / own check |
| GET | /api/patients/portal/profile/:phone | Public / own check |
| GET | /api/patients/portal/reports/:phone | Public / own check |
| GET | /api/patients/portal/reports/:phone/:sampleId | Public / own check |
| GET | /api/patients/portal/reports/:phone/:sampleId/pdf | Public / own check |
| POST | /api/patients/register | Signed-in user |
| GET | /api/patients/search | Signed-in user |

## /api/payment-settings

| Method | Path | Access |
|---|---|---|
| GET | /api/payment-settings | Roles: Admin, Super Admin, Auditor |
| PUT | /api/payment-settings | Roles: Admin, Super Admin |
| GET | /api/payment-settings/billing | Roles: Admin, Super Admin, Receptionist |

## /api/payments

| Method | Path | Access |
|---|---|---|
| GET | /api/payments/bills/:billId | Roles: Admin, Super Admin, Receptionist, Auditor |
| GET | /api/payments/config | Signed-in user |
| POST | /api/payments/razorpay/checkout-failed | Roles: Admin, Super Admin, Receptionist |
| POST | /api/payments/razorpay/link | Roles: Admin, Super Admin, Receptionist |
| POST | /api/payments/razorpay/order | Roles: Admin, Super Admin, Receptionist |
| POST | /api/payments/razorpay/verify | Roles: Admin, Super Admin, Receptionist |
| POST | /api/payments/razorpay/webhook | Public / own check |
| POST | /api/payments/reconcile | Roles: Admin, Super Admin, Receptionist |
| GET | /api/payments/transactions | Roles: Admin, Super Admin, Receptionist, Auditor |
| POST | /api/payments/transactions/:id/cancel | Roles: Admin, Super Admin, Receptionist |
| POST | /api/payments/transactions/:id/check | Roles: Admin, Super Admin, Receptionist |

## /api/poct

| Method | Path | Access |
|---|---|---|
| GET | /api/poct/devices | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor, Auditor, Programme Officer |
| POST | /api/poct/devices | Roles: Admin, Super Admin, Lab Head, Lab Doctor |
| PUT | /api/poct/devices/:id | Roles: Admin, Super Admin, Lab Head, Lab Doctor |
| GET | /api/poct/devices/:id/operators | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor, Auditor, Programme Officer |
| POST | /api/poct/devices/:id/operators | Roles: Admin, Super Admin, Lab Head, Lab Doctor |
| DELETE | /api/poct/devices/:id/operators/:userId | Roles: Admin, Super Admin, Lab Head, Lab Doctor |
| GET | /api/poct/devices/:id/qc | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor, Auditor, Programme Officer |
| POST | /api/poct/devices/:id/qc | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor |
| GET | /api/poct/results | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor, Auditor, Programme Officer |
| POST | /api/poct/results | Roles: Admin, Super Admin, Lab Head, Lab Doctor, Lab Technician, Doctor |

## /api/prescriptions

| Method | Path | Access |
|---|---|---|
| POST | /api/prescriptions/finalize-billing | Roles: Admin, Doctor, Lab Head, Lab Technician |
| POST | /api/prescriptions/process-ai | Public / own check |

## /api/privilege-review

| Method | Path | Access |
|---|---|---|
| GET | /api/privilege-review | Roles: Admin, Super Admin, Auditor |
| POST | /api/privilege-review/complete | Roles: Admin, Super Admin |
| GET | /api/privilege-review/export | Roles: Admin, Super Admin, Auditor |
| GET | /api/privilege-review/history | Roles: Admin, Super Admin, Auditor |

## /api/programme

| Method | Path | Access |
|---|---|---|
| GET | /api/programme/dashboard | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| GET | /api/programme/export | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |

## /api/public/upload

| Method | Path | Access |
|---|---|---|
| POST | /api/public/upload/analyze | Public / own check |
| POST | /api/public/upload/submit | Public / own check |

## /api/quality

| Method | Path | Access |
|---|---|---|
| GET | /api/quality/dashboard | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| GET | /api/quality/eqas | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| POST | /api/quality/eqas | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/quality/eqas/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/quality/materials | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| POST | /api/quality/materials | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/quality/materials/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/quality/materials/:id/runs | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| GET | /api/quality/options | Roles: Admin, Super Admin, Lab Head, Lab Technician, Programme Officer, Auditor |
| POST | /api/quality/runs | Roles: Admin, Super Admin, Lab Head, Lab Technician |
| PUT | /api/quality/runs/:id/corrective-action | Roles: Admin, Super Admin, Lab Head, Lab Technician |

## /api/queue

| Method | Path | Access |
|---|---|---|
| GET | /api/queue/audit/events | Signed-in user |
| GET | /api/queue/audit/tokens | Signed-in user |
| GET | /api/queue/tokens | Signed-in user |
| PUT | /api/queue/tokens/:id/status | Signed-in user |

## /api/report-delivery

| Method | Path | Access |
|---|---|---|
| GET | /api/report-delivery | Roles: Admin, Super Admin, Lab Head, Lab Technician, Receptionist, Auditor |
| POST | /api/report-delivery/:id/resend | Roles: Admin, Super Admin, Lab Head, Lab Technician, Receptionist |
| PUT | /api/report-delivery/consent/:patientId | Roles: Admin, Super Admin, Lab Head, Lab Technician, Receptionist |
| GET | /api/report-delivery/consent/:sampleId | Roles: Admin, Super Admin, Lab Head, Lab Technician, Receptionist |
| POST | /api/report-delivery/send | Roles: Admin, Super Admin, Lab Head, Lab Technician, Receptionist |

## /api/settings

| Method | Path | Access |
|---|---|---|
| GET | /api/settings | Signed-in user |
| PUT | /api/settings | Roles: Admin, Super Admin |

## /api/staff

| Method | Path | Access |
|---|---|---|
| DELETE | /api/staff/:id | Signed-in user |
| PUT | /api/staff/:id | Signed-in user |
| PATCH | /api/staff/:id/reset-password | Signed-in user |
| PATCH | /api/staff/:id/unlock | Signed-in user |
| POST | /api/staff/add | Signed-in user |
| GET | /api/staff/doctors | Signed-in user |
| GET | /api/staff/list | Signed-in user |
| GET | /api/staff/stats | Signed-in user |

## /api/test-prices

| Method | Path | Access |
|---|---|---|
| GET | /api/test-prices | Roles: Admin, Super Admin, Receptionist, Auditor |
| PUT | /api/test-prices | Roles: Admin, Super Admin |

## /api/v2/inventory/analytics

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/analytics | Signed-in user |

## /api/v2/inventory/ap

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/ap/invoices | Signed-in user |
| POST | /api/v2/inventory/ap/invoices | Roles: Admin, Super Admin |
| GET | /api/v2/inventory/ap/ledger/:vendor_id | Signed-in user |
| POST | /api/v2/inventory/ap/payments | Roles: Admin, Super Admin |
| GET | /api/v2/inventory/ap/stats | Signed-in user |

## /api/v2/inventory/batches

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/batches | Signed-in user |
| POST | /api/v2/inventory/batches | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/v2/inventory/batches/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/v2/inventory/batches/:id | Signed-in user |
| PUT | /api/v2/inventory/batches/:id | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/items

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/items | Signed-in user |
| POST | /api/v2/inventory/items | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/v2/inventory/items/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/v2/inventory/items/:id | Signed-in user |
| PUT | /api/v2/inventory/items/:id | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/mappings

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/mappings | Signed-in user |
| POST | /api/v2/inventory/mappings | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/v2/inventory/mappings/:id | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/procurement

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/procurement/orders | Signed-in user |
| POST | /api/v2/inventory/procurement/orders | Roles: Admin, Super Admin, Lab Head |
| POST | /api/v2/inventory/procurement/orders/:id/send-email | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/v2/inventory/procurement/orders/:id/status | Roles: Admin, Super Admin, Lab Head |
| GET | /api/v2/inventory/procurement/requisitions | Signed-in user |
| POST | /api/v2/inventory/procurement/requisitions | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/v2/inventory/procurement/requisitions/:id/status | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/suggestions

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/suggestions | Signed-in user |
| PUT | /api/v2/inventory/suggestions/:id | Roles: Admin, Super Admin, Lab Head |
| POST | /api/v2/inventory/suggestions/generate | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/transactions

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/transactions | Signed-in user |
| POST | /api/v2/inventory/transactions | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/transfers

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/transfers | Signed-in user |
| POST | /api/v2/inventory/transfers | Roles: Admin, Super Admin, Lab Head |
| PUT | /api/v2/inventory/transfers/:id/status | Roles: Admin, Super Admin, Lab Head |

## /api/v2/inventory/vendors

| Method | Path | Access |
|---|---|---|
| GET | /api/v2/inventory/vendors | Signed-in user |
| POST | /api/v2/inventory/vendors | Roles: Admin, Super Admin, Lab Head |
| DELETE | /api/v2/inventory/vendors/:id | Roles: Admin, Super Admin, Lab Head |
| GET | /api/v2/inventory/vendors/:id | Signed-in user |
| PUT | /api/v2/inventory/vendors/:id | Roles: Admin, Super Admin, Lab Head |

## /api/whatsapp

| Method | Path | Access |
|---|---|---|
| GET | /api/whatsapp/webhook | Public / own check |
| POST | /api/whatsapp/webhook | Public / own check |

## Root-level endpoints

| Method | Path | Access |
|---|---|---|
| GET | /health/status | Public / own check |
| GET | /openid-configuration | Public / own check |
| POST | /send-order | Public / own check |

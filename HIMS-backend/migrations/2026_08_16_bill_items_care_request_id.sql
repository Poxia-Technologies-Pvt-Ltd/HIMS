-- CARE's per-order identifier, read off the order's own details page by the
-- browser extension. The orders list carries only the PATIENT uuid (already in
-- care_patient_external_id), which repeats across that patient's tests and so
-- cannot identify a single order.
--
-- Needed to fill results back into CARE: the technician opens CARE's result
-- entry page, which shows "Request id: <uuid>", and the extension has to find
-- our result for exactly that order.
--
-- Additive and idempotent-by-inspection: nullable, no default change, no
-- backfill. Rows billed before this migration simply have NULL and are not
-- eligible for auto-fill until re-scraped.

ALTER TABLE bill_items
  ADD COLUMN care_request_id VARCHAR(64) NULL AFTER care_patient_external_id;

CREATE INDEX idx_bill_items_care_request_id ON bill_items (care_request_id);

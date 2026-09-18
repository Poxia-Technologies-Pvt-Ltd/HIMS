-- When a technician confirmed they saved this result into CARE.
--
-- CARE is what forwards a result to ABHA — we never push to ABHA ourselves.
-- So the only fact worth recording on our side is "this result is now in
-- CARE", and the only thing that knows it is the person who pressed save on
-- CARE's form. The extension asks them to confirm, and that confirmation
-- lands here.
--
-- Deliberately NOT inferred from the auto-fill: filling a form is not saving
-- it. A result typed in and then abandoned would otherwise be reported as
-- being in the national record when it is not.
--
-- Additive: nullable, no default change, no backfill. Rows predating this
-- migration are simply unconfirmed.

ALTER TABLE bill_items
  ADD COLUMN care_saved_at DATETIME NULL AFTER care_request_id,
  ADD COLUMN care_saved_by VARCHAR(120) NULL AFTER care_saved_at;

CREATE INDEX idx_bill_items_care_saved_at ON bill_items (care_saved_at);

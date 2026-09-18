-- Spec item #5 gap ("Test catalog, panels/profiles, sample type, priority,
-- referring facility/clinician and clinical notes"): orders (bills) had no
-- priority, no referring-facility field, and no clinical-notes field —
-- referring clinician existed only as patients.consultant_name, a
-- patient-level default rather than something that can vary order to order.
--
-- Modeled at the bill (order) level, not per bill_item (per-test): priority/
-- referring/clinical-notes describe the requisition as a whole, same as how
-- bills.notes already works for billing notes.

ALTER TABLE bills
  ADD COLUMN priority ENUM('Routine','Urgent','STAT') NOT NULL DEFAULT 'Routine' AFTER status,
  ADD COLUMN referring_facility VARCHAR(200) NULL AFTER priority,
  ADD COLUMN referring_clinician VARCHAR(150) NULL AFTER referring_facility,
  ADD COLUMN clinical_notes TEXT NULL AFTER referring_clinician;

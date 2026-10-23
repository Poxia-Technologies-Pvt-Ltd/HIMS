-- Spec "Barcode-Based Sample Management" #3: multiple samples and aliquots
-- per order.
--
-- Multiple samples per order already worked (one bill -> one sample ID per
-- test, and tests can be merged onto one tube). What was missing is the
-- other direction: splitting a received sample into child tubes
-- ("aliquots") — an analyzer tube, an archive tube, a referral tube — each
-- with its own barcode, its own stage/location history, and a link back to
-- the parent. An aliquot's ID is the parent's ID plus -A1, -A2… so it stays
-- traceable to the original at a glance; it is registered in
-- lab_sample_ids like every other ID, so it is unique across facilities.

ALTER TABLE lab_samples
  ADD COLUMN parent_sample_id VARCHAR(60) NULL AFTER branch_id,
  ADD COLUMN aliquot_no       INT NULL AFTER parent_sample_id,
  ADD COLUMN purpose          VARCHAR(80) NULL AFTER aliquot_no,   -- analysis / archive / referral / retest …
  ADD COLUMN volume_ml        DECIMAL(6,2) NULL AFTER purpose,
  ADD KEY idx_ls_parent (parent_sample_id);

ALTER TABLE sample_events
  MODIFY event_type ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered','Aliquoted') NOT NULL;

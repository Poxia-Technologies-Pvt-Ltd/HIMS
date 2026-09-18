-- When several of a patient's tests were merged onto one sample.
--
-- One tube of serum can run LFT and KFT together, so the technician may give
-- a group of tests a single sample ID and short code. The shared sample_id is
-- what actually groups them; this column records that the sharing was a
-- deliberate act rather than a collision, so the UI can show it and offer to
-- split it again.
--
-- Additive: nullable, no default change, no backfill.

ALTER TABLE bill_items ADD COLUMN merged_at DATETIME NULL AFTER short_id;

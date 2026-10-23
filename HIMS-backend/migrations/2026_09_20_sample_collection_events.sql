-- Sample collection desk: label reprints and test merges are custody events
-- too — a reprinted label is a duplicate of something that identifies a
-- patient's blood, and a merge changes which barcode a test travels under,
-- so both belong in the log (sample_events).
ALTER TABLE sample_events
  MODIFY event_type ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered','Aliquoted','Reprinted','Merged') NOT NULL;

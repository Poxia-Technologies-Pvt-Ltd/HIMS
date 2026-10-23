-- Spec "Barcode-Based Sample Management" #5: chain of custody with user,
-- location and timestamp at each critical step.
--
-- `station` records WHERE each step happened (facility + desk / workstation /
-- analyzer), alongside the existing user and timestamp. `location` keeps its
-- meaning: where the specimen was put (rack, freezer…). Steps recorded from a
-- LIS-Agent workstation are attributed to that workstation (device label),
-- since the agent authenticates as a machine, not a person.
ALTER TABLE sample_events
  ADD COLUMN station VARCHAR(160) NULL AFTER location;

-- The custody log is evidence: enforce append-only in the database, not just
-- in application code. Any UPDATE or DELETE — from the app, a script or a
-- console session — is refused.
DROP TRIGGER IF EXISTS sample_events_no_update;
DROP TRIGGER IF EXISTS sample_events_no_delete;
CREATE TRIGGER sample_events_no_update BEFORE UPDATE ON sample_events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sample_events is append-only (chain of custody)';
CREATE TRIGGER sample_events_no_delete BEFORE DELETE ON sample_events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sample_events is append-only (chain of custody)';

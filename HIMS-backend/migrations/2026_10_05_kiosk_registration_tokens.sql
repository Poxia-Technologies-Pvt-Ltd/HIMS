-- Kiosk self-service tokens (tender #9, #47).
--
-- A Registration queue alongside Sample Collection: a patient with no order
-- yet takes a Registration token at the kiosk; one who is already registered
-- and has lab tests today gets their order's Sample Collection token.
--
-- issued_via records where a token came from, so the queue audit and reports
-- can tell counter-issued tokens from kiosk ones.

ALTER TABLE queue_token_sequences
  MODIFY service_point ENUM('Sample Collection','Registration') NOT NULL;

ALTER TABLE patient_queue_tokens
  MODIFY service_point ENUM('Sample Collection','Registration') NOT NULL,
  ADD COLUMN issued_via ENUM('Counter','Kiosk') NOT NULL DEFAULT 'Counter' AFTER issued_by;

ALTER TABLE queue_token_events
  MODIFY service_point ENUM('Sample Collection','Registration') NOT NULL;

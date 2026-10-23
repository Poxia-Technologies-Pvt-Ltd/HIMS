-- Offline mode for the LIS-Agent (tender #59): registrations made while the
-- network was down carry the agent's own reference, so a retry after a lost
-- response can never register the same patient twice, and the official
-- record keeps the provisional ID that was printed on the paper slip.
ALTER TABLE patients
  ADD COLUMN client_ref VARCHAR(48) NULL,
  ADD COLUMN provisional_id VARCHAR(40) NULL,
  ADD COLUMN offline_registered_at DATETIME NULL,
  ADD UNIQUE KEY uq_patients_client_ref (client_ref);

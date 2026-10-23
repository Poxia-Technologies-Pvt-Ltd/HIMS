-- A hospital's own Document Signer Certificate (tender #36): one certificate per
-- hospital, set up once by its admin and applied automatically to every report a
-- doctor of that hospital authorises. (Individual doctors' Class 3 DSCs sit on
-- USB tokens and cannot be exported; a Document Signer Certificate is issued to
-- the organisation precisely for server-side signing.)
--   kind          'Hospital' (user_id NULL) or 'Doctor' (their own certificate)
--   password_enc  the certificate's password, encrypted with the server's vault
--                 key, when the admin chose "sign automatically"; NULL = the
--                 signer types the password every time
ALTER TABLE user_dsc_certificates
  MODIFY COLUMN user_id INT NULL,
  ADD COLUMN kind ENUM('Doctor','Hospital') NOT NULL DEFAULT 'Doctor' AFTER user_id,
  ADD COLUMN password_enc TEXT NULL,
  ADD KEY idx_dsc_branch_kind (branch_id, kind, status);

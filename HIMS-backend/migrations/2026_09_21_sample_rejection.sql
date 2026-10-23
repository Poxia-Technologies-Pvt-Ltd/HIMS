-- Spec "Barcode-Based Sample Management" #4: sample rejection with reason
-- codes, recollection workflow and alerts.
--
-- A technician rejects a sample that arrived unfit (haemolysed, clotted,
-- insufficient, mislabelled…). The tube is retired (stage Rejected), a NEW
-- sample ID is issued for the same tests so the patient can be recalled for
-- recollection, and the collector desk / LIS-Agent show an alert until the
-- replacement is collected. Nothing is deleted: the rejected sample, its
-- custody log and the rejection record all stay.

ALTER TABLE lab_samples
  MODIFY stage ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Rejected') NOT NULL DEFAULT 'Accessioned';

ALTER TABLE sample_events
  MODIFY event_type ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered','Aliquoted','Reprinted','Merged','Rejected','Recollection') NOT NULL;

CREATE TABLE IF NOT EXISTS sample_rejection_reasons (
  code        VARCHAR(30) NOT NULL,
  label       VARCHAR(120) NOT NULL,
  category    ENUM('Specimen quality','Quantity','Identification','Handling') NOT NULL,
  note_required TINYINT(1) NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO sample_rejection_reasons (code, label, category, note_required, sort_order) VALUES
  ('HEMOLYZED',   'Haemolysed specimen',                    'Specimen quality', 0, 10),
  ('CLOTTED',     'Clotted specimen (anticoagulated tube)', 'Specimen quality', 0, 20),
  ('LIPEMIC',     'Grossly lipaemic specimen',              'Specimen quality', 0, 30),
  ('CONTAMINATED','Contaminated specimen',                  'Specimen quality', 0, 40),
  ('QNS',         'Quantity not sufficient',                'Quantity',         0, 50),
  ('OVERFILLED',  'Tube over/under-filled (wrong ratio)',   'Quantity',         0, 60),
  ('WRONG_TUBE',  'Wrong tube / anticoagulant',             'Handling',         0, 70),
  ('LEAKED',      'Leaked or broken container',             'Handling',         0, 80),
  ('DELAYED',     'Delay in transport / stability exceeded','Handling',         0, 90),
  ('UNLABELLED',  'Unlabelled or label unreadable',         'Identification',   0, 100),
  ('MISMATCH',    'Label does not match request',           'Identification',   0, 110),
  ('OTHER',       'Other (specify)',                        'Handling',         1, 999);

CREATE TABLE IF NOT EXISTS sample_rejections (
  id                 BIGINT NOT NULL AUTO_INCREMENT,
  sample_id          VARCHAR(60) NOT NULL,          -- the rejected sample
  branch_id          INT NOT NULL,
  bill_id            INT NOT NULL,
  reason_code        VARCHAR(30) NOT NULL,
  reason_label       VARCHAR(120) NOT NULL,         -- snapshot, survives edits to the master
  note               VARCHAR(255) NULL,
  tests              VARCHAR(500) NULL,             -- snapshot of tests that were on it
  status             ENUM('Recollection Pending','Recollected') NOT NULL DEFAULT 'Recollection Pending',
  recollect_sample_id VARCHAR(60) NOT NULL,         -- the replacement sample's ID
  rejected_by        INT NULL,
  rejected_by_name   VARCHAR(200) NULL,
  rejected_device    VARCHAR(120) NULL,
  rejected_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recollected_at     TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_sr_branch_status (branch_id, status, rejected_at),
  KEY idx_sr_sample (sample_id),
  KEY idx_sr_recollect (recollect_sample_id),
  KEY idx_sr_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Spec "Barcode-Based Sample Management" #6: referral samples between
-- facilities with barcode continuity.
--
-- A sample keeps the SAME barcode for its whole life. Its ID already embeds
-- the facility that issued it (LAB-{hospital}-{date}-{NNNN}) and is unique
-- across all facilities, so it can travel to another lab without relabelling.
-- The referral only changes who HOLDS the tube:
--   lab_samples.branch_id        -> the facility that issued the barcode (never changes)
--   lab_samples.holder_branch_id -> the facility that currently has it (NULL = the issuer)
-- Results are saved against the original bill item, so they belong to the
-- referring facility's patient record and report as usual.

ALTER TABLE lab_samples
  MODIFY stage ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Rejected','In Transit') NOT NULL DEFAULT 'Accessioned',
  ADD COLUMN holder_branch_id INT NULL AFTER branch_id,
  ADD KEY idx_ls_holder (holder_branch_id, stage);

ALTER TABLE sample_events
  MODIFY event_type ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered','Aliquoted','Reprinted','Merged','Rejected','Recollection','Referred','Referral Received','Referral Cancelled') NOT NULL;

CREATE TABLE IF NOT EXISTS sample_referrals (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  sample_id         VARCHAR(60) NOT NULL,
  bill_id           INT NOT NULL,
  from_branch_id    INT NOT NULL,
  to_branch_id      INT NOT NULL,
  reason            VARCHAR(160) NOT NULL,
  consignment_ref   VARCHAR(80) NULL,          -- courier / vehicle / consignment note
  dispatch_remarks  VARCHAR(255) NULL,         -- e.g. cold chain requirements
  prior_stage       VARCHAR(20) NOT NULL,      -- stage before dispatch (restored on cancel)
  tests             VARCHAR(500) NULL,         -- snapshot of tests requested
  status            ENUM('In Transit','Received','Cancelled') NOT NULL DEFAULT 'In Transit',
  dispatched_by     INT NULL,
  dispatched_by_name VARCHAR(200) NULL,
  dispatched_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by       INT NULL,
  received_by_name  VARCHAR(200) NULL,
  received_at       TIMESTAMP NULL,
  receipt_condition VARCHAR(160) NULL,         -- condition noted on arrival
  cancelled_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_srf_sample (sample_id, status),
  KEY idx_srf_to (to_branch_id, status, dispatched_at),
  KEY idx_srf_from (from_branch_id, status, dispatched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

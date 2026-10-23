-- Spec "Barcode-Based Sample Management" #2: barcode-based accessioning,
-- acknowledgement, collection, receipt, processing, storage and disposal
-- status — plus, since every stage change is logged with who/where/when,
-- the chain-of-custody record (#5).
--
-- bill_items.status tracks a TEST (Pending/Collected/In Progress/…), and
-- several tests can share one physical sample (merged samples), so the
-- physical sample's journey gets its own table keyed by sample_id — the
-- string printed on the label's barcode.
--
--   Accessioned  ID issued + label printed (at billing)
--   Collected    specimen taken from the patient
--   Received     arrived at / accepted by the lab
--   Processing   on the bench / analyzer
--   Stored       retained (rack / freezer / location recorded)
--   Disposed     discarded (method recorded)

CREATE TABLE IF NOT EXISTS lab_samples (
  sample_id       VARCHAR(60) NOT NULL,
  branch_id       INT NOT NULL,
  stage           ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed') NOT NULL DEFAULT 'Accessioned',
  location        VARCHAR(120) NULL,          -- where it is now (bench, rack, freezer…)
  disposal_method VARCHAR(80) NULL,
  accessioned_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  collected_at    TIMESTAMP NULL,
  received_at     TIMESTAMP NULL,
  processing_at   TIMESTAMP NULL,
  stored_at       TIMESTAMP NULL,
  disposed_at     TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sample_id),
  KEY idx_ls_branch_stage (branch_id, stage),
  KEY idx_ls_accessioned (branch_id, accessioned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only custody log: one row per change, written in the same
-- transaction as the change. No update/delete path exists in the app and no
-- foreign key — these rows must outlive the sample they describe. Actor
-- name/role are snapshotted so the record stays correct after staff changes.
CREATE TABLE IF NOT EXISTS sample_events (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  sample_id   VARCHAR(60) NOT NULL,
  branch_id   INT NOT NULL,
  event_type  ENUM('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered') NOT NULL,
  from_stage  VARCHAR(20) NULL,
  to_stage    VARCHAR(20) NOT NULL,
  location    VARCHAR(120) NULL,
  note        VARCHAR(255) NULL,
  auto        TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = advanced by the system, not a scan
  actor_id    INT NULL,
  actor_name  VARCHAR(200) NULL,
  actor_role  VARCHAR(50) NULL,
  ip_address  VARCHAR(64) NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_se_sample (sample_id, created_at),
  KEY idx_se_branch_time (branch_id, created_at),
  KEY idx_se_actor (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

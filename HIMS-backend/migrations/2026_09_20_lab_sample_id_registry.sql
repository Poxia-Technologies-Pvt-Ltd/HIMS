-- Guarantees a generated sample ID can never be issued twice, at any facility.
--
-- Uniqueness so far rested on branches.hospital_code being unique — true
-- today, but only by convention downstream: a facility left without a code,
-- or a code re-assigned after IDs were issued under it, would silently mint
-- a colliding ID. bill_items.sample_id can't carry a UNIQUE key itself
-- (several merged tests deliberately share one sample), so every ID the
-- generator hands out is also recorded here, where the key applies. The
-- INSERT happens in the same transaction as the bill, so a rolled-back bill
-- leaves no registry row behind.

CREATE TABLE IF NOT EXISTS lab_sample_ids (
  sample_id  VARCHAR(60) NOT NULL,
  branch_id  INT NOT NULL,
  seq_date   DATE NOT NULL,
  dept_key   VARCHAR(10) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sample_id),
  KEY idx_lsi_branch_date (branch_id, seq_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- IDs already issued: register them so a future collision with any of them
-- is caught too. LEFT JOIN + branch 0 for items whose bill no longer exists
-- (rows carried over from the seeded dump) — their IDs stay reserved even
-- though the owning facility can't be recovered.
INSERT IGNORE INTO lab_sample_ids (sample_id, branch_id, seq_date, created_at)
SELECT bi.sample_id, COALESCE(MIN(b.branch_id), 0), DATE(MIN(bi.created_at)), MIN(bi.created_at)
FROM bill_items bi
LEFT JOIN bills b ON b.id = bi.bill_id
WHERE bi.sample_id LIKE 'LAB-%'
GROUP BY bi.sample_id;

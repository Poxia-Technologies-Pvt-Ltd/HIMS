-- Spec item "Queue and Patient Flow Management" #4: audit of token
-- generation, service point, timestamps and completion.
--
-- patient_queue_tokens only ever holds each token's CURRENT state (plus the
-- last timestamp of each stage), so it can't say who did what in what order,
-- or show a token being skipped and recalled. This is the append-only event
-- log behind it: one row per state change, written in the same transaction
-- as the change itself so the two can't disagree. There is deliberately no
-- update/delete path anywhere in the application, and no foreign key —
-- audit rows must outlive anything they describe.
--
-- actor_name / actor_role are snapshotted at write time rather than joined
-- later, so the record still reads correctly after a user is renamed,
-- changes role or is removed.

CREATE TABLE IF NOT EXISTS queue_token_events (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  token_id      INT NOT NULL,
  branch_id     INT NOT NULL,
  service_point ENUM('Sample Collection') NOT NULL,
  token_number  VARCHAR(20) NOT NULL,
  event_type    ENUM('Issued','Called','Recalled','Started','Completed','Skipped','Cancelled') NOT NULL,
  from_status   VARCHAR(20) NULL,
  to_status     VARCHAR(20) NOT NULL,
  counter       VARCHAR(50) NULL,
  actor_id      INT NULL,
  actor_name    VARCHAR(200) NULL,
  actor_role    VARCHAR(50) NULL,
  ip_address    VARCHAR(64) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_qte_token (token_id, created_at),
  KEY idx_qte_branch_time (branch_id, created_at),
  KEY idx_qte_actor (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tokens issued before this table existed: give each an 'Issued' event so
-- the log is complete from the token's first appearance.
INSERT INTO queue_token_events
  (token_id, branch_id, service_point, token_number, event_type, from_status, to_status, actor_id, actor_name, created_at)
SELECT t.id, t.branch_id, t.service_point, t.token_number, 'Issued', NULL, 'Waiting',
       t.issued_by, CONCAT(u.first_name, ' ', u.last_name), t.issued_at
FROM patient_queue_tokens t
LEFT JOIN users u ON u.id = t.issued_by
WHERE NOT EXISTS (SELECT 1 FROM queue_token_events e WHERE e.token_id = t.id);

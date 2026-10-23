-- Periodic privilege review (tender #107): when each user last signed in (so dormant
-- accounts show up), and a record of every review a reviewer completed.
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS privilege_reviews (
  id             INT NOT NULL AUTO_INCREMENT,
  branch_id      INT NULL,                       -- NULL = reviewed for the whole system
  reviewed_by    INT NOT NULL,
  reviewer_name  VARCHAR(200) NULL,
  reviewed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note           VARCHAR(1000) NULL,
  users_total    INT NOT NULL DEFAULT 0,
  flagged_total  INT NOT NULL DEFAULT 0,
  snapshot       JSON NULL,                      -- every user and flag as reviewed
  PRIMARY KEY (id),
  KEY idx_pr_branch (branch_id, reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

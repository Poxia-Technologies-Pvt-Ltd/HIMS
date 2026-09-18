-- Master list of free-diagnostic scheme names (NFDS, Ayushman Bharat, ...)
-- so staff pick from a dropdown instead of typing the scheme name freehand
-- on every billing package / order. Referenced by billing_packages.scheme_name
-- and bills.scheme_name (both stay plain VARCHAR, not a foreign key, since a
-- scheme can be renamed/deactivated here without needing to rewrite every
-- historical package/order that already used the old name).

CREATE TABLE IF NOT EXISTS free_schemes (
  id         INT NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO free_schemes (name) VALUES ('NFDS');

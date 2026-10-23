-- Equipment breakdown ticketing, geo-mapping / geo-fencing and the analyzer
-- integration registry (tender #27, #81, #130-132).
--
-- equipment_tickets: a breakdown or service call from report to closure. The
-- downtime it represents is reported_at -> resolved_at.
--
-- lab_machines geo columns: install_lat/lng is the approved installation point
-- captured at commissioning; geofence_radius_m the allowed boundary around it.
-- Each location check (from a browser at the facility, or any client that can
-- report coordinates) updates last_seen_* and geofence_status; a check outside
-- the boundary opens a 'Geo-fence breach' ticket automatically.
--
-- lab_machines registry columns: protocol, mapping version and the validation
-- status of the interface, as the tender's analyzer integration registry asks.

CREATE TABLE IF NOT EXISTS equipment_tickets (
  id               INT NOT NULL AUTO_INCREMENT,
  ticket_no        VARCHAR(30) NOT NULL,
  machine_id       INT NOT NULL,
  branch_id        INT NULL,
  category         VARCHAR(60) NOT NULL,
  priority         ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  description      VARCHAR(1000) NOT NULL,
  status           ENUM('Open','In Progress','Resolved','Closed') NOT NULL DEFAULT 'Open',
  assigned_to      VARCHAR(200) NULL,
  resolution       VARCHAR(1000) NULL,
  reported_by      INT NULL,
  reported_by_name VARCHAR(200) NULL,
  reported_at      DATETIME NOT NULL,
  resolved_at      DATETIME NULL,
  closed_at        DATETIME NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_ticket_no (ticket_no),
  KEY idx_et_machine (machine_id, status),
  KEY idx_et_branch (branch_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE lab_machines
  ADD COLUMN install_lat DECIMAL(10,7) NULL,
  ADD COLUMN install_lng DECIMAL(10,7) NULL,
  ADD COLUMN geofence_radius_m INT NOT NULL DEFAULT 200,
  ADD COLUMN installed_on DATE NULL,
  ADD COLUMN last_seen_lat DECIMAL(10,7) NULL,
  ADD COLUMN last_seen_lng DECIMAL(10,7) NULL,
  ADD COLUMN last_seen_at DATETIME NULL,
  ADD COLUMN geofence_status ENUM('Unknown','Inside','Outside') NOT NULL DEFAULT 'Unknown',
  ADD COLUMN protocol VARCHAR(40) NULL,
  ADD COLUMN mapping_version VARCHAR(20) NULL,
  ADD COLUMN validation_status ENUM('Not validated','In validation','Validated','Suspended') NOT NULL DEFAULT 'Not validated',
  ADD COLUMN validated_on DATE NULL,
  ADD COLUMN validated_by VARCHAR(150) NULL;

ALTER TABLE branches
  ADD COLUMN latitude DECIMAL(10,7) NULL,
  ADD COLUMN longitude DECIMAL(10,7) NULL;

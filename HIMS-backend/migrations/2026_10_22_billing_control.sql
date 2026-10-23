-- Billing control: nothing the hospital does goes unbilled, and no money moves
-- without a trace.
--
--  patient_charges    every service creates a charge where it happens (OP
--                     booking -> consultation, doctor's orders -> lab /
--                     imaging). The billing desk turns charges into bills.
--  service_tariffs    prices for imaging and other services (lab tests keep
--                     their own price list).
--  billing_approvals  pay-later credit, cancellations, item cancellations and
--                     concessions: requested by the desk, approved by Admin /
--                     Accounts Manager, never by the requester.
--  cash_closings      each cashier closes their shift against the receipts.
--  bills              gap-free invoice numbers; credit and cancellation details.
--  bill_payments      refunds are their own rows (kind = Refund), never edits.

CREATE TABLE IF NOT EXISTS patient_charges (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  branch_id       INT           NOT NULL,
  patient_id      INT           NOT NULL,
  reg_no          VARCHAR(50)   NOT NULL,
  source_type     ENUM('Consultation','Laboratory','Imaging','Procedure','Other') NOT NULL,
  source_id       INT           NULL,          -- appointment / doctor_lab_orders / radiology_orders id
  appointment_id  INT           NULL,
  consultation_id INT           NULL,
  service_id      INT           NULL,          -- lab_tests.id or service_tariffs.id
  description     VARCHAR(255)  NOT NULL,
  quantity        INT           NOT NULL DEFAULT 1,
  unit_price      DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  status          ENUM('Unbilled','Billed','Cancelled') NOT NULL DEFAULT 'Unbilled',
  bill_id         INT           NULL,
  ordered_by      INT           NULL,
  cancelled_by    INT           NULL,
  cancel_reason   VARCHAR(255)  NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_charge_source (source_type, source_id),
  KEY idx_charge_patient_status (patient_id, status),
  KEY idx_charge_branch_status (branch_id, status, created_at),
  KEY idx_charge_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS service_tariffs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  category    ENUM('Imaging','Procedure','Other') NOT NULL,
  modality    VARCHAR(40)   NULL,              -- radiology_orders.modality for imaging
  name        VARCHAR(150)  NOT NULL,           -- study / service; '*' = any study of the modality
  code        VARCHAR(30)   NULL,
  price       DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  updated_by  INT           NULL,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tariff (category, modality, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Starting prices; the hospital edits them in Billing > Service Prices.
INSERT IGNORE INTO service_tariffs (category, modality, name, price) VALUES
  ('Imaging','X-Ray','*',350), ('Imaging','X-Ray','Chest PA',300), ('Imaging','X-Ray','KUB',350),
  ('Imaging','X-Ray','Lumbar spine AP/Lat',500), ('Imaging','X-Ray','Cervical spine AP/Lat',500), ('Imaging','X-Ray','Knee AP/Lat',450),
  ('Imaging','Ultrasound','*',900), ('Imaging','Ultrasound','Abdomen & Pelvis',1000), ('Imaging','Ultrasound','Obstetric (pregnancy)',900),
  ('Imaging','Ultrasound','Doppler – lower limb',1800), ('Imaging','Ultrasound','Doppler – carotid',1800),
  ('Imaging','ECG','*',200), ('Imaging','Echo','*',1500),
  ('Imaging','CT','*',3000), ('Imaging','CT','Brain plain',2500), ('Imaging','CT','Chest (HRCT)',3500), ('Imaging','CT','CT angiography',7000),
  ('Imaging','MRI','*',6000), ('Imaging','MRI','Brain',6000), ('Imaging','MRI','Lumbar spine',6500),
  ('Imaging','Mammography','*',1500), ('Imaging','DEXA Scan','*',1800),
  ('Procedure',NULL,'Dressing (small)',100), ('Procedure',NULL,'Dressing (large)',250), ('Procedure',NULL,'Injection charge',50),
  ('Procedure',NULL,'IV cannulation',150), ('Procedure',NULL,'Nebulisation',150), ('Procedure',NULL,'Suturing (per wound)',400),
  ('Procedure',NULL,'Plaster application',800), ('Other',NULL,'Medical certificate',100), ('Other',NULL,'Duplicate record copy',50);

CREATE TABLE IF NOT EXISTS billing_approvals (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT           NOT NULL,
  kind          ENUM('Credit','Cancel bill','Cancel item','Concession') NOT NULL,
  patient_id    INT           NULL,
  bill_id       INT           NULL,
  bill_item_id  INT           NULL,
  charge_ids    JSON          NULL,             -- for Credit: the charges it covers
  amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  refund_method ENUM('Cash','Card','UPI','Other') NULL,
  reason        VARCHAR(500)  NOT NULL,
  status        ENUM('Pending','Approved','Rejected','Withdrawn','Used') NOT NULL DEFAULT 'Pending',
  requested_by  INT           NOT NULL,
  requested_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by    INT           NULL,
  decided_at    DATETIME      NULL,
  decision_note VARCHAR(500)  NULL,
  result        JSON          NULL,             -- what the approval did (refund receipt, amounts)
  KEY idx_appr_branch_status (branch_id, status),
  KEY idx_appr_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cash_closings (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  branch_id        INT           NOT NULL,
  user_id          INT           NOT NULL,
  user_name        VARCHAR(200)  NULL,
  from_payment_id  BIGINT        NULL,
  to_payment_id    BIGINT        NULL,
  receipts_count   INT           NOT NULL DEFAULT 0,
  totals           JSON          NOT NULL,      -- { Cash: {in, out}, Card: {...}, ... }
  system_cash      DECIMAL(12,2) NOT NULL DEFAULT 0, -- cash received minus cash refunded
  declared_cash    DECIMAL(12,2) NOT NULL DEFAULT 0,
  difference       DECIMAL(12,2) NOT NULL DEFAULT 0,
  note             VARCHAR(500)  NULL,
  closed_at        DATETIME      NOT NULL,
  KEY idx_closing_user (user_id, closed_at),
  KEY idx_closing_branch (branch_id, closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gap-free invoice numbers, one series per facility per financial year.
CREATE TABLE IF NOT EXISTS invoice_counters (
  branch_id  INT      NOT NULL,
  fy         CHAR(7)  NOT NULL,                 -- e.g. 2026-27
  last_no    INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bills must be transactional: a bill, its lines, charges and receipts are
-- written together or not at all (the LIMS copy had bills on MyISAM).
ALTER TABLE bills ENGINE=InnoDB;

ALTER TABLE bills
  ADD COLUMN invoice_no         VARCHAR(30)  NULL AFTER bill_number,
  ADD COLUMN on_credit          TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN credit_approval_id INT          NULL,
  ADD COLUMN cancelled_at       DATETIME     NULL,
  ADD COLUMN cancelled_by       INT          NULL,
  ADD COLUMN cancel_reason      VARCHAR(500) NULL,
  ADD UNIQUE KEY uq_bills_invoice_no (invoice_no);

ALTER TABLE bill_items
  MODIFY COLUMN service_type ENUM('Appointment','Laboratory','Pharmacy','Other','Registration','Charge','Imaging','Procedure') NOT NULL,
  MODIFY COLUMN status ENUM('Pending','Collected','In Progress','Test Done','Completed','Active','Inactive','Cancelled') DEFAULT 'Pending',
  ADD COLUMN charge_id INT NULL,
  ADD KEY idx_bill_items_charge (charge_id);

ALTER TABLE bill_payments
  ADD COLUMN kind        ENUM('Receipt','Refund') NOT NULL DEFAULT 'Receipt' AFTER receipt_no,
  ADD COLUMN approval_id INT NULL;

ALTER TABLE branch_payment_settings
  ADD COLUMN prepaid_diagnostics TINYINT(1) NOT NULL DEFAULT 1;

-- Medicines in the pharmacy store (Inventory > Item Master), so the doctor
-- can see what is in stock while prescribing.
ALTER TABLE inventory_item_master
  MODIFY COLUMN category ENUM('Consumable','Reagent','Equipment','Medicine') NOT NULL;

-- Existing OPD bookings from today on get their consultation charge.
INSERT IGNORE INTO patient_charges (branch_id, patient_id, reg_no, source_type, source_id, appointment_id, description, quantity, unit_price, amount, ordered_by)
SELECT a.branch_id, p.id, a.reg_no, 'Consultation', a.id, a.id,
       CONCAT('Consultation — ', a.doctor, IF(a.department IS NULL, '', CONCAT(' (', a.department, ')'))), 1, a.consultation_fee, a.consultation_fee, a.doctor_id
  FROM appointments a JOIN patients p ON p.reg_no = a.reg_no
 WHERE a.roster_entry_id IS NOT NULL AND a.consultation_fee > 0 AND a.appt_date >= CURDATE()
   AND a.status IN ('Scheduled','Checked In','In Consultation','Completed');

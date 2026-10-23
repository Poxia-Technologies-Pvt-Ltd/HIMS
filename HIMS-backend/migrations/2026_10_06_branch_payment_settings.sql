-- Payment settings per hospital (Settings → Payment Settings).
--
-- Registration fee: whether the hospital charges one, how much, and when —
-- 'First registration' (once per patient, when the CRN is created),
-- 'Every visit', or 'Renew after days' (an OPD-card validity period). Bills
-- are checked on the server: a fee that is not due is removed from the order.
-- Hospitals with no row here fall back to the defaults (fee from
-- hospital_settings.registration_fee, charged on first registration only).
--
-- Also: which payment methods the counter accepts, the default method,
-- discount limits, part payment, and where Razorpay may be used.

CREATE TABLE IF NOT EXISTS branch_payment_settings (
  branch_id               INT NOT NULL,
  reg_fee_enabled         TINYINT(1) NOT NULL DEFAULT 1,
  reg_fee_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  reg_fee_rule            ENUM('First registration','Every visit','Renew after days') NOT NULL DEFAULT 'First registration',
  reg_fee_validity_days   INT NOT NULL DEFAULT 365,
  methods                 VARCHAR(120) NOT NULL DEFAULT 'Cash,Card,UPI,Online,Insurance,Other',
  default_method          VARCHAR(20) NOT NULL DEFAULT 'Cash',
  allow_discount          TINYINT(1) NOT NULL DEFAULT 1,
  max_discount_percent    DECIMAL(5,2) NOT NULL DEFAULT 100,
  allow_part_payment      TINYINT(1) NOT NULL DEFAULT 1,
  online_counter          TINYINT(1) NOT NULL DEFAULT 1,
  online_link             TINYINT(1) NOT NULL DEFAULT 1,
  online_kiosk            TINYINT(1) NOT NULL DEFAULT 1,
  link_expiry_hours       INT NOT NULL DEFAULT 48,
  updated_by              INT NULL,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Registration fee lines get their own type, so "has this patient already
-- paid it?" is a reliable query (older bills used 'Other' + the line's name).
ALTER TABLE bill_items
  MODIFY service_type ENUM('Appointment','Laboratory','Pharmacy','Other','Registration') NOT NULL;

-- Re-type registration fees already billed, so patients registered before
-- this change are not charged again.
UPDATE bill_items SET service_type = 'Registration'
 WHERE service_type = 'Other' AND service_name LIKE 'Registration Fee%';

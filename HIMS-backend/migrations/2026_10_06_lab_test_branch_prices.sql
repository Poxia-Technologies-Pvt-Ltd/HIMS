-- Hospital-specific test prices.
--
-- lab_tests.price is the state default rate. A facility can carry its own
-- price for any test here; bills are priced server-side from this table,
-- falling back to the default when a facility has no price of its own. The
-- price the patient pays (counter, kiosk or Razorpay) is therefore always the
-- price list of the facility that bills them, never a figure sent by a browser.

CREATE TABLE IF NOT EXISTS lab_test_branch_prices (
  branch_id  INT NOT NULL,
  test_id    INT NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id, test_id),
  KEY idx_ltbp_test (test_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

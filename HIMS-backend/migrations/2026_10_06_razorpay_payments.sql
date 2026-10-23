-- Online payments through Razorpay (tender #7), for paid investigations only —
-- free-scheme (NFDS) bills have nothing due and never reach the gateway.
--
-- payment_gateway_transactions: one row per payment attempt sent to Razorpay —
-- a Checkout order taken at the counter, or a payment link sent to the
-- patient's phone. Its status moves Created -> Paid / Failed / Expired /
-- Cancelled from the browser callback (signature-verified), the Razorpay
-- webhook, or reconciliation, whichever arrives first; applying it to the bill
-- is idempotent, so the same payment can never be counted twice.
--
-- bill_payments: the receipt ledger — every amount received against a bill,
-- at the counter or online, with its own receipt number and reference (the
-- Razorpay payment id for online payments). bills.paid_amount stays the
-- running total the rest of the app already reads.

CREATE TABLE IF NOT EXISTS payment_gateway_transactions (
  id                 BIGINT NOT NULL AUTO_INCREMENT,
  bill_id            INT NOT NULL,
  branch_id          INT NULL,
  gateway            VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  kind               ENUM('Checkout','Payment link') NOT NULL,
  amount             DECIMAL(10,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  gateway_ref        VARCHAR(60) NOT NULL,            -- order_… (Checkout) or plink_… (link)
  gateway_payment_id VARCHAR(60) NULL,                -- pay_…
  short_url          VARCHAR(255) NULL,               -- payment link URL
  status             ENUM('Created','Paid','Failed','Expired','Cancelled') NOT NULL DEFAULT 'Created',
  pay_method         VARCHAR(30) NULL,                -- upi / card / netbanking / wallet, as reported by Razorpay
  error              VARCHAR(500) NULL,
  created_by         INT NULL,
  created_by_name    VARCHAR(200) NULL,
  paid_at            DATETIME NULL,
  last_checked_at    DATETIME NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_gateway_ref (gateway, gateway_ref),
  KEY idx_pgt_bill (bill_id),
  KEY idx_pgt_status (status, created_at),
  KEY idx_pgt_branch (branch_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bill_payments (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  receipt_no       VARCHAR(40) NULL,
  bill_id          INT NOT NULL,
  branch_id        INT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  method           ENUM('Cash','Card','UPI','Insurance','Other','Online') NOT NULL,
  channel          ENUM('Counter','Razorpay Checkout','Razorpay Link') NOT NULL DEFAULT 'Counter',
  reference        VARCHAR(120) NULL,                 -- Razorpay payment id, UTR, card slip no.
  gateway_txn_id   BIGINT NULL,
  received_by      INT NULL,
  received_by_name VARCHAR(200) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_receipt (receipt_no),
  UNIQUE KEY uniq_gateway_txn (gateway_txn_id),
  KEY idx_bp_bill (bill_id),
  KEY idx_bp_branch (branch_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE bills
  MODIFY payment_method ENUM('Cash','Card','UPI','Insurance','Other','Online') NULL DEFAULT 'Cash';

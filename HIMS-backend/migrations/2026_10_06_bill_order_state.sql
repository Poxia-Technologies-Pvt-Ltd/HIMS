-- Payment-first orders. An order paid online is saved as 'Awaiting payment'
-- with a provisional ORD-… reference and its priced items in pending_order;
-- it has no invoice number, test lines, sample IDs, queue token or worklist
-- entry until Razorpay confirms full payment. Settlement then assigns the
-- BILL-… number and creates all of them in the same transaction
-- (billingController.fulfilOrder). An unpaid order can be cancelled, e.g. to
-- take cash instead. Counter-paid bills are 'Confirmed' at creation, as before.
ALTER TABLE bills
  ADD COLUMN order_state ENUM('Awaiting payment','Confirmed','Cancelled') NOT NULL DEFAULT 'Confirmed' AFTER status,
  ADD COLUMN pending_order JSON NULL AFTER order_state;

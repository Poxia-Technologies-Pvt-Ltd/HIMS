-- Spec item #6: "Configurable billing/charge fields where required, without
-- making billing a prerequisite for NFDS free-diagnostic workflows."
--
-- bill_items/bills double as the lab order-tracking entity throughout this
-- codebase (worklist, sample ID generation, results, reports all join
-- through bills) — replacing that with a separate order table independent
-- of billing is a large, risky rewrite to take on right before a demo.
-- Scoped instead to what the requirement actually needs: money/payment
-- should never gate a free-scheme (e.g. NFDS) order. A bill row still gets
-- created (that's how the order enters the lab workflow), but for
-- billing_type = 'Free_Scheme' the backend forces charges to zero and marks
-- payment settled automatically — see createBill/updateBill in
-- billingController.js. No manual pricing, no payment-collection step, no
-- "Pending" balance sitting against a scheme patient.

ALTER TABLE bills
  ADD COLUMN billing_type ENUM('Standard','Free_Scheme') NOT NULL DEFAULT 'Standard' AFTER clinical_notes,
  ADD COLUMN scheme_name VARCHAR(100) NULL AFTER billing_type;

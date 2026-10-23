-- Kiosk payments by on-screen UPI QR (Razorpay QR Codes).
-- A gateway attempt can now be a UPI QR, and its receipts carry that channel.
ALTER TABLE payment_gateway_transactions
  MODIFY COLUMN kind ENUM('Checkout','Payment link','UPI QR') NOT NULL;
ALTER TABLE bill_payments
  MODIFY COLUMN channel ENUM('Counter','Razorpay Checkout','Razorpay Link','Razorpay QR') NOT NULL DEFAULT 'Counter';

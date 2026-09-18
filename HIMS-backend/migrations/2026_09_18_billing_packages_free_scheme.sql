-- Lets a billing package itself be marked as a free-diagnostic scheme (e.g.
-- NFDS), so staff select it like any other package instead of manually
-- toggling "Free Scheme" and typing the scheme name on every order. See
-- BillingPackages.jsx (package definition) and Billing.jsx's
-- handlePackageSelect (auto-applies billing_type = Free_Scheme on select).

ALTER TABLE billing_packages
  ADD COLUMN is_free_scheme TINYINT(1) NOT NULL DEFAULT 0 AFTER discount_percent,
  ADD COLUMN scheme_name VARCHAR(100) NULL AFTER is_free_scheme;

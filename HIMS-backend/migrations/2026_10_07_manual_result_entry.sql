-- Manual result entry (tender #33): a result typed or changed by hand always
-- carries the reason it was entered that way, on the result itself as well as
-- in its audit trail.
ALTER TABLE lab_test_result
  ADD COLUMN entry_mode VARCHAR(10) NULL,
  ADD COLUMN manual_reason_code VARCHAR(30) NULL,
  ADD COLUMN manual_reason VARCHAR(500) NULL;

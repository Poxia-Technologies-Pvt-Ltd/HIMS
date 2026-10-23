-- Reagent changes draw from stock: choosing a stock batch fills in the lot and
-- expiry, and issues the pack(s) from inventory (an OUT transaction).
ALTER TABLE equipment_reagent_changes
  ADD COLUMN inventory_item_id  INT NULL,
  ADD COLUMN inventory_batch_id INT NULL,
  ADD COLUMN quantity_issued    INT NULL;

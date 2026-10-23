# Appendix — Data dictionary

Generated 2026-10-08 from the database schema: 175 tables, 2402 columns.

## Audit & governance

### privilege_reviews

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | yes | MUL |  |  |
| reviewed_by | int | no |  |  |  |
| reviewer_name | varchar(200) | yes |  |  |  |
| reviewed_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| note | varchar(1000) | yes |  |  |  |
| users_total | int | no |  | 0 |  |
| flagged_total | int | no |  | 0 |  |
| snapshot | json | yes |  |  |  |

### sync_integrity_events

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| occurred_at | timestamp(3) | no | MUL | CURRENT_TIMESTAMP(3) |  |
| method | varchar(10) | yes |  |  |  |
| path | varchar(255) | yes |  |  |  |
| claimed_sha256 | char(64) | yes |  |  |  |
| actual_sha256 | char(64) | yes |  |  |  |
| body_bytes | int | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |

### system_audit_log

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| occurred_at | timestamp(3) | no | MUL | CURRENT_TIMESTAMP(3) |  |
| user_id | int | yes | MUL |  |  |
| user_name | varchar(200) | yes |  |  |  |
| user_role | varchar(50) | yes |  |  |  |
| branch_id | int | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |
| user_agent | varchar(255) | yes |  |  |  |
| method | varchar(10) | no |  |  |  |
| path | varchar(255) | no |  |  |  |
| module | varchar(60) | yes | MUL |  |  |
| action | varchar(120) | no |  |  |  |
| entity | varchar(60) | yes | MUL |  |  |
| entity_id | varchar(80) | yes |  |  |  |
| status_code | smallint | yes |  |  |  |
| outcome | enum('Success','Failed','Denied') | no |  |  |  |
| request_data | json | yes |  |  |  |
| before_data | json | yes |  |  |  |
| after_data | json | yes |  |  |  |
| prev_hash | char(64) | no |  |  |  |
| row_hash | char(64) | no |  |  |  |

## Billing & payments

### bill_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bill_id | int | no | MUL |  |  |
| service_type | enum('Appointment','Laboratory','Pharmacy','Other','Registration') | no |  |  |  |
| service_id | int | yes |  |  |  |
| service_name | varchar(200) | no |  |  |  |
| service_code | varchar(50) | yes |  |  |  |
| lab_id | int | yes | MUL |  |  |
| lab_barcode | varchar(100) | yes |  |  |  |
| sample_id | varchar(50) | yes | MUL |  |  |
| short_id | varchar(10) | yes |  |  |  |
| merged_at | datetime | yes |  |  |  |
| quantity | int | yes |  | 1 |  |
| unit_price | decimal(10,2) | no |  |  |  |
| total_price | decimal(10,2) | no |  |  |  |
| status | enum('Pending','Collected','In Progress','Test Done','Completed','Active','Inactive') | yes |  | Pending |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| collected_by | int | yes |  |  |  |
| care_accession_id | bigint | yes | UNI |  |  |
| care_gateway_id | varchar(64) | yes |  |  |  |
| care_patient_external_id | varchar(100) | yes |  |  |  |
| care_request_id | varchar(64) | yes | MUL |  |  |
| care_saved_at | datetime | yes | MUL |  |  |
| care_saved_by | varchar(120) | yes |  |  |  |

### bill_payments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| receipt_no | varchar(40) | yes | UNI |  |  |
| bill_id | int | no | MUL |  |  |
| branch_id | int | yes | MUL |  |  |
| amount | decimal(10,2) | no |  |  |  |
| method | enum('Cash','Card','UPI','Insurance','Other','Online') | no |  |  |  |
| channel | enum('Counter','Razorpay Checkout','Razorpay Link','Razorpay QR') | no |  | Counter |  |
| reference | varchar(120) | yes |  |  |  |
| gateway_txn_id | bigint | yes | UNI |  |  |
| received_by | int | yes |  |  |  |
| received_by_name | varchar(200) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### billing

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| reg_no | varchar(50) | no | MUL |  | patients.reg_no |
| invoice_items | json | yes |  |  |  |
| discount_percent | decimal(5,2) | yes |  | 0.00 |  |
| total_amount | decimal(10,2) | no |  |  |  |
| payment_method | varchar(50) | yes |  |  |  |
| status | varchar(50) | yes |  | Pending |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### billing_packages

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| package_id | varchar(50) | no | UNI |  |  |
| name | varchar(100) | no |  |  |  |
| department | varchar(100) | no |  |  |  |
| description | text | yes |  |  |  |
| items | json | no |  |  |  |
| discount_percent | decimal(5,2) | yes |  | 0.00 |  |
| is_free_scheme | tinyint(1) | no |  | 0 |  |
| scheme_name | varchar(100) | yes |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### bills

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bill_number | varchar(50) | no | UNI |  |  |
| visit_id | varchar(30) | yes | MUL |  |  |
| patient_id | int | no | MUL |  |  |
| patient_name | varchar(200) | yes |  |  |  |
| patient_phone | varchar(20) | yes |  |  |  |
| total_amount | decimal(10,2) | no |  | 0.00 |  |
| discount_amount | decimal(10,2) | yes |  | 0.00 |  |
| net_amount | decimal(10,2) | no |  | 0.00 |  |
| paid_amount | decimal(10,2) | yes |  | 0.00 |  |
| payment_status | enum('Pending','Partial','Paid','Cancelled') | yes | MUL | Pending |  |
| payment_method | enum('Cash','Card','UPI','Insurance','Other','Online') | yes |  | Cash |  |
| bill_date | timestamp | no |  | CURRENT_TIMESTAMP |  |
| lab_barcode | varchar(50) | yes |  |  |  |
| lab_qr_code | text | yes |  |  |  |
| notes | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| order_state | enum('Awaiting payment','Confirmed','Cancelled') | no |  | Confirmed |  |
| pending_order | json | yes |  |  |  |
| priority | enum('Routine','Urgent','STAT') | no |  | Routine |  |
| referring_facility | varchar(200) | yes |  |  |  |
| referring_clinician | varchar(150) | yes |  |  |  |
| clinical_notes | text | yes |  |  |  |
| billing_type | enum('Standard','Free_Scheme') | no |  | Standard |  |
| scheme_name | varchar(100) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL | 1 |  |
| admission_id | int | yes | MUL |  |  |
| created_by | int | yes |  |  |  |

### free_schemes

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no | UNI |  |  |
| description | varchar(255) | yes |  |  |  |
| is_active | tinyint(1) | no |  | 1 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### payment_gateway_transactions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| bill_id | int | no | MUL |  |  |
| branch_id | int | yes | MUL |  |  |
| gateway | varchar(20) | no | MUL | razorpay |  |
| kind | enum('Checkout','Payment link','UPI QR') | no |  |  |  |
| amount | decimal(10,2) | no |  |  |  |
| currency | char(3) | no |  | INR |  |
| gateway_ref | varchar(60) | no |  |  |  |
| gateway_payment_id | varchar(60) | yes |  |  |  |
| short_url | varchar(255) | yes |  |  |  |
| status | enum('Created','Paid','Failed','Expired','Cancelled') | no | MUL | Created |  |
| pay_method | varchar(30) | yes |  |  |  |
| error | varchar(500) | yes |  |  |  |
| created_by | int | yes |  |  |  |
| created_by_name | varchar(200) | yes |  |  |  |
| paid_at | datetime | yes |  |  |  |
| last_checked_at | datetime | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

## Equipment

### equipment_maintenance_log

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| machine_id | int | no | MUL |  |  |
| schedule_id | int | yes |  |  |  |
| task_name | varchar(120) | no |  |  |  |
| task_type | varchar(40) | no |  |  |  |
| performed_at | datetime | no |  |  |  |
| performed_by | int | yes |  |  |  |
| performed_by_name | varchar(200) | no |  |  |  |
| outcome | enum('Completed','Completed with issues','Not completed') | no |  | Completed |  |
| notes | varchar(1000) | yes |  |  |  |
| parts_used | varchar(500) | yes |  |  |  |
| vendor | varchar(200) | yes |  |  |  |
| was_overdue | tinyint(1) | no |  | 0 |  |
| due_was | date | yes |  |  |  |
| next_due_after | date | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### equipment_pm_schedules

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| machine_id | int | no | MUL |  |  |
| task_name | varchar(120) | no |  |  |  |
| task_type | enum('Preventive maintenance','Calibration','Quality control','Cleaning','Other') | no |  | Preventive maintenance |  |
| frequency_unit | enum('Day','Week','Month','Year') | no |  |  |  |
| frequency_every | int | no |  | 1 |  |
| warn_days_before | int | no |  | 7 |  |
| last_done_at | date | yes |  |  |  |
| next_due_at | date | no |  |  |  |
| instructions | varchar(500) | yes |  |  |  |
| active | tinyint(1) | no | MUL | 1 |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### equipment_reagent_changes

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| machine_id | int | no | MUL |  |  |
| reagent_name | varchar(150) | no |  |  |  |
| lot_no | varchar(80) | no |  |  |  |
| manufacturer | varchar(120) | yes |  |  |  |
| slot | varchar(60) | yes |  |  |  |
| expiry_date | date | no |  |  |  |
| opened_on | date | no |  |  |  |
| stability_days | int | yes |  |  |  |
| replaced_lot_no | varchar(80) | yes |  |  |  |
| changed_at | datetime | no |  |  |  |
| changed_by | int | yes |  |  |  |
| changed_by_name | varchar(200) | no |  |  |  |
| reason | enum('Empty','Expired','New lot','On-board stability','QC failure','Other') | no |  | Empty |  |
| notes | varchar(500) | yes |  |  |  |
| loaded_expired | tinyint(1) | no |  | 0 |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| inventory_item_id | int | yes |  |  |  |
| inventory_batch_id | int | yes |  |  |  |
| quantity_issued | int | yes |  |  |  |

### equipment_ticket_samples

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| ticket_id | int | no | MUL |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| action | enum('Referred','Moved to another analyzer','Held') | no |  |  |  |
| referral_id | int | yes |  |  |  |
| alt_machine_id | int | yes |  |  |  |
| note | varchar(300) | yes |  |  |  |
| linked_by | int | yes |  |  |  |
| linked_by_name | varchar(200) | yes |  |  |  |
| linked_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### equipment_tickets

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| ticket_no | varchar(30) | no | UNI |  |  |
| machine_id | int | no | MUL |  |  |
| branch_id | int | yes | MUL |  |  |
| category | varchar(60) | no |  |  |  |
| priority | enum('Low','Medium','High','Critical') | no |  | Medium |  |
| description | varchar(1000) | no |  |  |  |
| status | enum('Open','In Progress','Resolved','Closed') | no |  | Open |  |
| assigned_to | varchar(200) | yes |  |  |  |
| resolution | varchar(1000) | yes |  |  |  |
| reported_by | int | yes |  |  |  |
| reported_by_name | varchar(200) | yes |  |  |  |
| reported_at | datetime | no |  |  |  |
| resolved_at | datetime | yes |  |  |  |
| closed_at | datetime | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### infrastructure

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no |  |  |  |
| type | enum('Room','Ward','Lab','Pharmacy') | no |  |  |  |
| block | varchar(100) | yes |  |  |  |
| floor | int | yes |  |  |  |
| capacity | int | yes |  |  |  |
| machines_count | int | no |  | 1 |  |
| status | enum('Available','Occupied','Maintenance') | yes |  | Available |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL | 1 | branches.id |

## Inventory

### inventory_batches

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_id | int | no | MUL |  | inventory_item_master.id |
| batch_number | varchar(100) | no | MUL |  |  |
| lot_number | varchar(100) | yes |  |  |  |
| manufacturing_date | date | yes |  |  |  |
| expiry_date | date | yes | MUL |  |  |
| vendor_id | int | yes | MUL |  | vendors.id |
| quantity_received | decimal(10,2) | no |  | 0.00 |  |
| quantity_available | decimal(10,2) | no |  | 0.00 |  |
| quantity_reserved | decimal(10,2) | no |  | 0.00 |  |
| quantity_damaged | decimal(10,2) | no |  | 0.00 |  |
| unit_cost | decimal(10,2) | no |  | 0.00 |  |
| grn_id | int | yes |  |  |  |
| status | enum('Active','Quarantine','Expired','Empty') | yes | MUL | Active |  |
| open_vial_date | date | yes |  |  |  |
| stability_days | int | yes |  |  |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### inventory_item_master

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_code | varchar(50) | no | UNI |  |  |
| item_name | varchar(200) | no |  |  |  |
| category | enum('Consumable','Reagent','Equipment') | no |  |  |  |
| unit | varchar(50) | no |  |  |  |
| min_stock_level | int | yes |  | 0 |  |
| reorder_level | int | yes |  | 0 |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| lead_time_days | int | yes |  | 3 |  |
| safety_stock_buffer | int | yes |  | 20 |  |
| preferred_vendor_id | int | yes | MUL |  | vendors.id |
| estimated_cost | decimal(10,2) | yes |  | 0.00 |  |
| default_vendor_id | int | yes |  |  |  |
| delivery_lead_time_days | int | yes |  | 3 |  |
| unit_price | decimal(12,2) | yes |  | 0.00 |  |

### inventory_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_code | varchar(50) | no | UNI |  |  |
| item_name | varchar(200) | no |  |  |  |
| category | enum('Reagents','Consumables','Test Kits','Calibrators','Controls','Glassware','General Lab Supplies') | no | MUL |  |  |
| brand | varchar(100) | yes |  |  |  |
| manufacturer | varchar(200) | yes |  |  |  |
| unit | enum('ml','liter','test','box','pack','piece','mg','g','kg') | no |  |  |  |
| min_stock_level | decimal(10,2) | no |  | 0.00 |  |
| reorder_level | decimal(10,2) | no |  | 0.00 |  |
| storage_condition | varchar(200) | yes |  |  |  |
| cost_price | decimal(10,2) | no |  | 0.00 |  |
| selling_cost | decimal(10,2) | no |  | 0.00 |  |
| expiry_required | tinyint(1) | yes |  | 0 |  |
| lot_tracking | tinyint(1) | yes |  | 0 |  |
| status | enum('Active','Inactive') | yes | MUL | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### inventory_payments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| payment_number | varchar(100) | no | UNI |  |  |
| vendor_id | int | no | MUL |  | vendors.id |
| invoice_id | int | no | MUL |  | inventory_supplier_invoices.id |
| amount | decimal(12,2) | no |  |  |  |
| payment_method | enum('CASH','BANK','UPI','CHEQUE') | no |  |  |  |
| reference_no | varchar(100) | yes |  |  |  |
| paid_by | int | yes |  |  |  |
| paid_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_po_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| po_id | int | no | MUL |  | inventory_purchase_orders.id |
| pr_item_id | int | yes | MUL |  | inventory_pr_items.id |
| item_id | int | no | MUL |  | inventory_item_master.id |
| quantity | int | no |  |  |  |
| unit_price | decimal(10,2) | no |  |  |  |
| subtotal | decimal(12,2) | no |  |  |  |

### inventory_pr_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| pr_id | int | no | MUL |  | inventory_purchase_requisitions.id |
| item_id | int | no | MUL |  | inventory_item_master.id |
| quantity | int | no |  |  |  |
| remarks | text | yes |  |  |  |

### inventory_purchase_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| po_number | varchar(50) | no | UNI |  |  |
| vendor_id | int | no | MUL |  | vendors.id |
| status | enum('DRAFT','ISSUED','COMPLETED','CANCELLED') | yes |  | DRAFT |  |
| expected_delivery_date | date | yes |  |  |  |
| total_amount | decimal(12,2) | yes |  | 0.00 |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| remarks | text | yes |  |  |  |

### inventory_purchase_requisitions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| pr_number | varchar(50) | no | UNI |  |  |
| branch_id | int | no | MUL |  | branches.id |
| status | enum('PENDING','APPROVED','REJECTED','PO_CREATED') | yes |  | PENDING |  |
| requested_by | int | yes |  |  |  |
| approved_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_purchase_suggestions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_id | int | no | MUL |  | inventory_item_master.id |
| vendor_id | int | yes | MUL |  | vendors.id |
| suggested_qty | int | no |  |  |  |
| estimated_cost | decimal(10,2) | yes |  | 0.00 |  |
| status | enum('Pending','Approved','Rejected') | yes |  | Pending |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_stock

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_id | int | no | MUL |  | inventory_items.id |
| current_stock | decimal(10,2) | no |  | 0.00 |  |
| available_stock | decimal(10,2) | no |  | 0.00 |  |
| reserved_stock | decimal(10,2) | no |  | 0.00 |  |
| consumed_stock | decimal(10,2) | no |  | 0.00 |  |
| expired_stock | decimal(10,2) | no |  | 0.00 |  |
| damaged_stock | decimal(10,2) | no |  | 0.00 |  |
| department_id | int | yes | MUL |  | branches.id |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### inventory_stock_transfer_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| transfer_id | int | no | MUL |  | inventory_stock_transfers.id |
| item_id | int | no | MUL |  | inventory_item_master.id |
| batch_id | int | no | MUL |  | inventory_batches.id |
| quantity | int | no |  |  |  |

### inventory_stock_transfers

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| transfer_number | varchar(50) | no | UNI |  |  |
| from_branch_id | int | no | MUL |  | branches.id |
| to_branch_id | int | no | MUL |  | branches.id |
| status | enum('PENDING','APPROVED','IN_TRANSIT','COMPLETED','CANCELLED') | yes |  | PENDING |  |
| notes | text | yes |  |  |  |
| created_by | int | yes |  |  |  |
| approved_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_supplier_invoices

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| invoice_number | varchar(100) | no | UNI |  |  |
| vendor_id | int | no | MUL |  | vendors.id |
| po_id | int | yes |  |  |  |
| grn_id | int | yes |  |  |  |
| invoice_date | date | no |  |  |  |
| due_date | date | no |  |  |  |
| total_amount | decimal(12,2) | no |  |  |  |
| paid_amount | decimal(12,2) | yes |  | 0.00 |  |
| status | enum('PENDING','PARTIAL','PAID') | yes |  | PENDING |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_supplier_ledger

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| vendor_id | int | no | MUL |  | vendors.id |
| type | enum('INVOICE','PAYMENT') | no |  |  |  |
| reference_id | int | no |  |  |  |
| debit | decimal(12,2) | yes |  | 0.00 |  |
| credit | decimal(12,2) | yes |  | 0.00 |  |
| balance | decimal(12,2) | no |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### inventory_test_mapping

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| test_id | int | no | MUL |  | lab_tests.id |
| item_id | int | no | MUL |  | inventory_item_master.id |
| quantity_required | decimal(10,2) | no |  | 1.00 |  |

### inventory_transactions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| item_id | int | no | MUL |  | inventory_item_master.id |
| batch_id | int | no | MUL |  | inventory_batches.id |
| type | enum('IN','OUT','ADJUSTMENT') | no |  |  |  |
| quantity | int | no |  |  |  |
| reference_type | varchar(50) | yes |  | Manual |  |
| reference_id | varchar(100) | yes |  |  |  |
| remarks | text | yes |  |  |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL |  | branches.id |
| test_id | int | yes | MUL |  | lab_tests.id |

### purchase_order_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| po_id | int | no | MUL |  | purchase_orders.id |
| item_id | int | no | MUL |  | inventory_items.id |
| quantity_ordered | decimal(10,2) | no |  |  |  |
| quantity_received | decimal(10,2) | yes |  | 0.00 |  |
| quantity_damaged | decimal(10,2) | yes |  | 0.00 |  |
| unit_price | decimal(10,2) | no |  |  |  |
| total_price | decimal(10,2) | no |  |  |  |
| notes | text | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### purchase_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| po_number | varchar(50) | no | UNI |  |  |
| pr_id | int | yes | MUL |  | purchase_requisitions.id |
| vendor_id | int | no | MUL |  | vendors.id |
| order_date | date | no |  |  |  |
| expected_delivery | date | yes |  |  |  |
| delivery_location | int | yes | MUL |  | branches.id |
| subtotal | decimal(10,2) | no |  | 0.00 |  |
| tax_amount | decimal(10,2) | yes |  | 0.00 |  |
| total_amount | decimal(10,2) | no |  | 0.00 |  |
| terms_conditions | text | yes |  |  |  |
| status | enum('Draft','Sent','Partially Received','Fully Received','Cancelled') | yes | MUL | Draft |  |
| created_by | int | no | MUL |  | users.id |
| branch_id | int | yes | MUL | 1 | branches.id |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### purchase_requisition_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| pr_id | int | no | MUL |  | purchase_requisitions.id |
| item_id | int | no | MUL |  | inventory_items.id |
| quantity_requested | decimal(10,2) | no |  |  |  |
| quantity_approved | decimal(10,2) | yes |  |  |  |
| unit_price | decimal(10,2) | yes |  |  |  |
| total_price | decimal(10,2) | yes |  |  |  |
| notes | text | yes |  |  |  |
| status | enum('Pending','Approved','Rejected') | yes |  | Pending |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### purchase_requisitions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| pr_number | varchar(50) | no | UNI |  |  |
| department_id | int | yes | MUL |  | branches.id |
| requested_by | int | no | MUL |  | users.id |
| request_date | date | no |  |  |  |
| required_date | date | yes |  |  |  |
| priority | enum('Low','Normal','High','Urgent') | yes |  | Normal |  |
| total_amount | decimal(10,2) | yes |  | 0.00 |  |
| status | enum('Draft','Submitted','Approved','Rejected','Converted to PO') | yes | MUL | Draft |  |
| notes | text | yes |  |  |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### stock_transfer_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| transfer_id | int | no | MUL |  | stock_transfers.id |
| item_id | int | no | MUL |  | inventory_items.id |
| batch_id | int | yes | MUL |  | inventory_batches.id |
| quantity | decimal(10,2) | no |  |  |  |
| received_quantity | decimal(10,2) | yes |  | 0.00 |  |
| damaged_quantity | decimal(10,2) | yes |  | 0.00 |  |
| notes | text | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### stock_transfers

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| transfer_number | varchar(50) | no | UNI |  |  |
| from_department | int | no | MUL |  | branches.id |
| to_department | int | no | MUL |  | branches.id |
| transfer_date | date | no |  |  |  |
| status | enum('Pending','In Transit','Received','Cancelled') | yes |  | Pending |  |
| requested_by | int | no | MUL |  | users.id |
| approved_by | int | yes | MUL |  | users.id |
| received_by | int | yes | MUL |  | users.id |
| notes | text | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### vendors

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| vendor_code | varchar(50) | no | UNI |  |  |
| vendor_name | varchar(200) | no |  |  |  |
| contact_person | varchar(100) | yes |  |  |  |
| phone | varchar(20) | yes |  |  |  |
| email | varchar(100) | yes |  |  |  |
| address | text | yes |  |  |  |
| tax_id | varchar(50) | yes |  |  |  |
| payment_terms | varchar(100) | yes |  |  |  |
| lead_time_days | int | yes |  | 7 |  |
| bank_name | varchar(100) | yes |  |  |  |
| account_number | varchar(100) | yes |  |  |  |
| ifsc_code | varchar(50) | yes |  |  |  |
| status | enum('Active','Inactive','Blacklisted') | yes |  | Active |  |
| rating | decimal(3,2) | yes |  | 0.00 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

## Laboratory

### analyzer_connection_logs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| machine_id | varchar(100) | no | MUL |  |  |
| machine_name | varchar(200) | yes |  |  |  |
| model | varchar(200) | yes |  |  |  |
| lab_id | int | yes | MUL |  |  |
| port | varchar(100) | yes |  |  |  |
| event | enum('ONLINE','OFFLINE') | no |  |  |  |
| ip_address | varchar(45) | yes |  |  |  |
| created_at | timestamp | yes | MUL | CURRENT_TIMESTAMP |  |

### critical_alerts

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| result_id | int | no | MUL |  |  |
| sample_id | varchar(60) | no |  |  |  |
| branch_id | int | yes | MUL |  |  |
| patient_id | int | yes |  |  |  |
| report_version | int | no |  | 1 |  |
| parameters | json | no |  |  |  |
| status | enum('Open','Acknowledged','Cleared') | no |  | Open |  |
| notify_within_minutes | int | no |  | 30 |  |
| block_approval | tinyint(1) | no |  | 1 |  |
| raised_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| acknowledged_at | timestamp | yes |  |  |  |
| acknowledged_by_name | varchar(200) | yes |  |  |  |
| cleared_at | timestamp | yes |  |  |  |
| cleared_reason | varchar(200) | yes |  |  |  |

### critical_notifications

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| alert_id | bigint | no | MUL |  |  |
| method | enum('Phone','In person','SMS','WhatsApp','Email','Other') | no |  |  |  |
| outcome | enum('Acknowledged','No answer','Left message') | no |  |  |  |
| notified_to_name | varchar(200) | yes |  |  |  |
| notified_to_role | varchar(100) | yes |  |  |  |
| read_back | tinyint(1) | no |  | 0 |  |
| recorded_by | int | yes |  |  |  |
| recorded_by_name | varchar(200) | yes |  |  |  |
| recorded_role | varchar(50) | yes |  |  |  |
| note | varchar(500) | yes |  |  |  |
| notified_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| ip_address | varchar(64) | yes |  |  |  |

### eqas_results

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | yes | MUL |  |  |
| provider | varchar(150) | no |  |  |  |
| program_name | varchar(150) | no |  |  |  |
| cycle | varchar(60) | no |  |  |  |
| sample_code | varchar(60) | yes |  |  |  |
| test_id | int | yes |  |  |  |
| parameter_name | varchar(200) | no |  |  |  |
| our_result | decimal(14,4) | yes |  |  |  |
| assigned_value | decimal(14,4) | yes |  |  |  |
| assigned_sd | decimal(14,4) | yes |  |  |  |
| sdi | decimal(8,3) | yes |  |  |  |
| performance | enum('Pending','Acceptable','Warning','Unacceptable') | no |  | Pending |  |
| received_on | date | yes |  |  |  |
| submitted_on | date | yes |  |  |  |
| result_on | date | yes |  |  |  |
| corrective_action | varchar(500) | yes |  |  |  |
| recorded_by | int | yes |  |  |  |
| recorded_by_name | varchar(200) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### lab_categories

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no | UNI |  |  |
| description | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| tat_minutes | int | yes |  |  |  |

### lab_machines

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| lab_id | int | no | MUL |  | infrastructure.id |
| machine_id | varchar(50) | no |  |  |  |
| name | varchar(100) | no |  |  |  |
| model | varchar(100) | yes |  |  |  |
| manufacturer | varchar(100) | yes |  |  |  |
| status | enum('Active','Inactive','Maintenance','Online','Offline') | yes |  | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| serial_number | varchar(100) | yes | UNI |  |  |
| interface_type | varchar(20) | yes |  |  |  |
| port_ip | varchar(255) | yes |  |  |  |
| baud_rate | int | yes |  |  |  |
| install_lat | decimal(10,7) | yes |  |  |  |
| install_lng | decimal(10,7) | yes |  |  |  |
| geofence_radius_m | int | no |  | 200 |  |
| installed_on | date | yes |  |  |  |
| last_seen_lat | decimal(10,7) | yes |  |  |  |
| last_seen_lng | decimal(10,7) | yes |  |  |  |
| last_seen_at | datetime | yes |  |  |  |
| geofence_status | enum('Unknown','Inside','Outside') | no |  | Unknown |  |
| protocol | varchar(40) | yes |  |  |  |
| mapping_version | varchar(20) | yes |  |  |  |
| validation_status | enum('Not validated','In validation','Validated','Suspended') | no |  | Not validated |  |
| validated_on | date | yes |  |  |  |
| validated_by | varchar(150) | yes |  |  |  |

### lab_parameter_loinc_map

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| parameter_name | varchar(200) | no | MUL |  |  |
| loinc_code | varchar(20) | yes |  |  |  |
| loinc_long_common_name | varchar(255) | yes |  |  |  |
| specimen_context | varchar(100) | yes |  |  |  |
| mapping_status | enum('Mapped','Unmapped','Needs Review') | no |  | Unmapped |  |
| confidence | enum('High','Medium','Low') | yes |  |  |  |
| notes | varchar(500) | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### lab_result_audit

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| result_id | int | no | MUL |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| action | varchar(80) | no |  |  |  |
| from_status | varchar(20) | yes |  |  |  |
| to_status | varchar(20) | yes |  |  |  |
| actor_id | int | yes |  |  |  |
| actor_name | varchar(200) | yes |  |  |  |
| actor_role | varchar(50) | yes |  |  |  |
| note | varchar(500) | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| reason | varchar(500) | yes |  |  |  |
| details | json | yes |  |  |  |
| version | int | yes |  |  |  |

### lab_result_versions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| result_id | int | no | MUL |  |  |
| version | int | no |  |  |  |
| results_json | json | no |  |  |  |
| status_at_change | varchar(20) | yes |  |  |  |
| verified_by | int | yes |  |  |  |
| approved_by | int | yes |  |  |  |
| approved_at | timestamp | yes |  |  |  |
| signature_id | bigint | yes |  |  |  |
| superseded_reason | varchar(500) | no |  |  |  |
| superseded_by | int | yes |  |  |  |
| superseded_by_name | varchar(200) | yes |  |  |  |
| superseded_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### lab_sample_ids

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| sample_id | varchar(60) | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| seq_date | date | no |  |  |  |
| dept_key | varchar(10) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### lab_sample_sequences

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| seq_date | date | no |  |  |  |
| dept_key | varchar(10) | no |  |  |  |
| last_seq | int | no |  | 0 |  |

### lab_samples

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| sample_id | varchar(60) | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| holder_branch_id | int | yes | MUL |  |  |
| holder_lab_id | int | yes |  |  |  |
| parent_sample_id | varchar(60) | yes | MUL |  |  |
| aliquot_no | int | yes |  |  |  |
| purpose | varchar(80) | yes |  |  |  |
| volume_ml | decimal(6,2) | yes |  |  |  |
| stage | enum('Accessioned','Collected','Received','Processing','Stored','Disposed','Rejected','In Transit') | no |  | Accessioned |  |
| location | varchar(120) | yes |  |  |  |
| disposal_method | varchar(80) | yes |  |  |  |
| accessioned_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| collected_at | timestamp | yes |  |  |  |
| received_at | timestamp | yes |  |  |  |
| processing_at | timestamp | yes |  |  |  |
| stored_at | timestamp | yes |  |  |  |
| disposed_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### lab_test_branch_prices

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| branch_id | int | no | PRI |  |  |
| test_id | int | no | PRI |  |  |
| price | decimal(10,2) | no |  |  |  |
| is_active | tinyint(1) | no |  | 1 |  |
| updated_by | int | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### lab_test_parameters

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| test_id | int | no | MUL |  |  |
| parameter_code | varchar(10) | yes |  |  |  |
| parameter_name | varchar(200) | no |  |  |  |
| parameter_unit | varchar(50) | yes |  |  |  |
| result_type | enum('numeric','text','select') | yes |  | numeric |  |
| min_value | decimal(10,2) | yes |  |  |  |
| max_value | decimal(10,2) | yes |  |  |  |
| men_min_value | decimal(10,2) | yes |  |  |  |
| men_max_value | decimal(10,2) | yes |  |  |  |
| women_min_value | decimal(10,2) | yes |  |  |  |
| women_max_value | decimal(10,2) | yes |  |  |  |
| kids_min_value | decimal(10,2) | yes |  |  |  |
| kids_max_value | decimal(10,2) | yes |  |  |  |
| use_demographic_ranges | tinyint(1) | yes |  | 0 |  |
| display_order | int | yes |  | 0 |  |
| is_calculated | tinyint(1) | yes |  | 0 |  |
| formula | text | yes |  |  |  |
| options | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| machine_parameter_code | varchar(100) | yes |  |  |  |
| loinc_code | varchar(20) | yes |  |  |  |
| critical_low | decimal(12,3) | yes |  |  |  |
| critical_high | decimal(12,3) | yes |  |  |  |
| measurable_min | decimal(12,3) | yes |  |  |  |
| measurable_max | decimal(12,3) | yes |  |  |  |
| delta_percent | decimal(6,2) | yes |  |  |  |
| delta_absolute | decimal(12,3) | yes |  |  |  |
| delta_days | int | yes |  |  |  |

### lab_test_result

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bill_item_id | int | yes | MUL |  |  |
| patient_id | int | yes | MUL |  |  |
| sample_id | varchar(50) | no | MUL |  |  |
| machine_no | varchar(50) | yes | MUL |  |  |
| test_id | int | yes |  |  |  |
| test_name | varchar(200) | yes |  |  |  |
| results_json | json | no |  |  |  |
| tested_by | int | yes |  |  |  |
| verified_by | int | yes |  |  |  |
| tested_at | timestamp | yes |  |  |  |
| verified_at | timestamp | yes |  |  |  |
| notes | text | yes |  |  |  |
| rerun_reason | varchar(500) | yes |  |  |  |
| rerun_requested_by | int | yes |  |  |  |
| rerun_requested_at | timestamp | yes |  |  |  |
| status | enum('Pending','Test Done','Verified','Approved','Rerun Requested','Cancelled') | no |  | Pending |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| approved_by | int | yes |  |  |  |
| approved_at | timestamp | yes |  |  |  |
| has_abnormal | tinyint(1) | no |  | 0 |  |
| has_critical | tinyint(1) | no |  | 0 |  |
| has_invalid | tinyint(1) | no |  | 0 |  |
| has_delta | tinyint(1) | no |  | 0 |  |
| report_version | int | no |  | 1 |  |
| reagent_lots | json | yes |  |  |  |
| entry_mode | varchar(10) | yes |  |  |  |
| manual_reason_code | varchar(30) | yes |  |  |  |
| manual_reason | varchar(500) | yes |  |  |  |
| capture_sha256 | char(64) | yes |  |  |  |

### lab_tests

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| test_code | varchar(50) | no | UNI |  |  |
| test_name | varchar(200) | no |  |  |  |
| category_id | int | no | MUL |  |  |
| lab_id | int | yes | MUL |  |  |
| sample_type | varchar(100) | no |  |  |  |
| tube_color | varchar(50) | yes |  |  |  |
| storage_conditions | text | yes |  |  |  |
| methodology | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| price | decimal(10,2) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| analyzer_name | varchar(100) | yes |  |  |  |
| loinc_code | varchar(20) | yes |  |  |  |
| loinc_display | varchar(255) | yes |  |  |  |
| tat_minutes | int | yes |  |  |  |

### lab_verification_workflows

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| category_id | int | no | PRI |  |  |
| levels | enum('Two-level','Single') | no |  | Two-level |  |
| technical_roles | varchar(200) | no |  | Lab Technician,Lab Head,Admin,Super Admin |  |
| clinical_roles | varchar(200) | no |  | Lab Head,Admin,Super Admin |  |
| enforce_segregation | tinyint(1) | no |  | 1 |  |
| auto_verify_normal | tinyint(1) | no |  | 0 |  |
| updated_by | int | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| critical_notify | tinyint(1) | no |  | 1 |  |
| critical_notify_minutes | int | no |  | 30 |  |
| critical_block_approval | tinyint(1) | no |  | 1 |  |

### machine_models

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| manufacturer | varchar(100) | no | MUL |  |  |
| model | varchar(100) | no |  |  |  |
| diff_type | varchar(100) | no |  | N/A |  |
| department | varchar(100) | yes |  |  |  |
| notes | varchar(255) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### qc_materials

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | yes | MUL |  |  |
| machine_id | int | yes | MUL |  |  |
| test_id | int | yes |  |  |  |
| parameter_name | varchar(200) | no |  |  |  |
| unit | varchar(50) | yes |  |  |  |
| material_name | varchar(150) | no |  |  |  |
| lot_no | varchar(80) | no |  |  |  |
| level | varchar(20) | no |  | Level 1 |  |
| target_mean | decimal(14,4) | no |  |  |  |
| target_sd | decimal(14,4) | no |  |  |  |
| expiry_date | date | yes |  |  |  |
| rules | varchar(100) | no |  | 1-2s,1-3s,2-2s,R-4s,4-1s,10x |  |
| active | tinyint(1) | no |  | 1 |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### qc_runs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| material_id | int | no | MUL |  |  |
| branch_id | int | yes | MUL |  |  |
| value | decimal(14,4) | no |  |  |  |
| z_score | decimal(8,3) | yes |  |  |  |
| run_at | datetime | no |  |  |  |
| status | enum('Accepted','Warning','Rejected') | no |  |  |  |
| violations | varchar(200) | yes |  |  |  |
| corrective_action | varchar(500) | yes |  |  |  |
| performed_by | int | yes |  |  |  |
| performed_by_name | varchar(200) | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### report_deliveries

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| patient_id | int | yes |  |  |  |
| branch_id | int | yes | MUL |  |  |
| channel | enum('WhatsApp','Email','SMS','Kiosk view','Kiosk print','Portal download','HMIS push','Staff download') | no |  |  |  |
| recipient | varchar(200) | yes |  |  |  |
| status | enum('Queued','Sent','Delivered','Read','Failed','Blocked') | no | MUL | Queued |  |
| error | varchar(500) | yes |  |  |  |
| provider | varchar(40) | yes |  |  |  |
| provider_message_id | varchar(120) | yes | MUL |  |  |
| triggered_by | enum('Auto','Staff','Patient kiosk','Patient portal','Lobby board') | no |  |  |  |
| actor_id | int | yes |  |  |  |
| actor_name | varchar(200) | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |
| resend_of | bigint | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| updated_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### report_signatures

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| result_id | int | no | MUL |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| signer_id | int | no |  |  |  |
| signer_name | varchar(200) | no |  |  |  |
| signer_role | varchar(50) | yes |  |  |  |
| registration_no | varchar(60) | no |  |  |  |
| designation | varchar(100) | yes |  |  |  |
| signature_image | mediumtext | yes |  |  |  |
| method | varchar(60) | no |  | Login password re-authentication |  |
| content_hash | char(64) | no |  |  |  |
| seal | char(64) | no |  |  |  |
| signed_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| ip_address | varchar(64) | yes |  |  |  |
| status | enum('Valid','Revoked','Pending','Cancelled') | no |  | Valid |  |
| revoked_at | timestamp | yes |  |  |  |

### sample_containers

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| container_name | varchar(100) | no |  |  |  |
| tube_color | varchar(50) | yes |  |  |  |
| volume_ml | decimal(5,2) | yes |  |  |  |
| additives | text | yes |  |  |  |
| storage_temperature | varchar(50) | yes |  |  |  |
| special_instructions | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### sample_events

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | no | MUL |  |  |
| event_type | enum('Accessioned','Collected','Received','Processing','Stored','Disposed','Registered','Aliquoted','Reprinted','Merged','Rejected','Recollection','Referred','Referral Received','Referral Cancelled') | no |  |  |  |
| from_stage | varchar(20) | yes |  |  |  |
| to_stage | varchar(20) | no |  |  |  |
| location | varchar(120) | yes |  |  |  |
| station | varchar(160) | yes |  |  |  |
| note | varchar(255) | yes |  |  |  |
| auto | tinyint(1) | no |  | 0 |  |
| actor_id | int | yes | MUL |  |  |
| actor_name | varchar(200) | yes |  |  |  |
| actor_role | varchar(50) | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### sample_referrals

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| bill_id | int | no |  |  |  |
| transfer_type | enum('Between labs','Between hospitals') | no |  | Between hospitals |  |
| from_branch_id | int | no | MUL |  |  |
| from_lab_id | int | yes |  |  |  |
| to_branch_id | int | no | MUL |  |  |
| to_lab_id | int | yes |  |  |  |
| reason | varchar(160) | no |  |  |  |
| consignment_ref | varchar(80) | yes |  |  |  |
| dispatch_remarks | varchar(255) | yes |  |  |  |
| prior_stage | varchar(20) | no |  |  |  |
| tests | varchar(500) | yes |  |  |  |
| status | enum('In Transit','Received','Cancelled') | no |  | In Transit |  |
| dispatched_by | int | yes |  |  |  |
| dispatched_by_name | varchar(200) | yes |  |  |  |
| dispatched_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| received_by | int | yes |  |  |  |
| received_by_name | varchar(200) | yes |  |  |  |
| received_at | timestamp | yes |  |  |  |
| receipt_condition | varchar(160) | yes |  |  |  |
| cancelled_at | timestamp | yes |  |  |  |
| prior_holder_branch_id | int | yes |  |  |  |
| prior_holder_lab_id | int | yes |  |  |  |
| ticket_id | int | yes |  |  |  |

### sample_rejection_reasons

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| code | varchar(30) | no | PRI |  |  |
| label | varchar(120) | no |  |  |  |
| category | enum('Specimen quality','Quantity','Identification','Handling') | no |  |  |  |
| note_required | tinyint(1) | no |  | 0 |  |
| active | tinyint(1) | no |  | 1 |  |
| sort_order | int | no |  | 0 |  |

### sample_rejections

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | no | MUL |  |  |
| bill_id | int | no | MUL |  |  |
| reason_code | varchar(30) | no |  |  |  |
| reason_label | varchar(120) | no |  |  |  |
| note | varchar(255) | yes |  |  |  |
| tests | varchar(500) | yes |  |  |  |
| status | enum('Recollection Pending','Recollected') | no |  | Recollection Pending |  |
| recollect_sample_id | varchar(60) | no | MUL |  |  |
| rejected_by | int | yes |  |  |  |
| rejected_by_name | varchar(200) | yes |  |  |  |
| rejected_device | varchar(120) | yes |  |  |  |
| rejected_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| recollected_at | timestamp | yes |  |  |  |

### sample_types

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| type_name | varchar(100) | no | UNI |  |  |
| description | text | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

## Organisation

### branches

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| district_id | int | no | MUL |  | districts.id |
| block_id | int | yes |  |  |  |
| branch_name | varchar(255) | no |  |  |  |
| category | varchar(100) | yes |  | General Lab |  |
| facility_type | enum('PHC','CHC','UPHC','SDH','DHH','Medical College','Cancer Hub','Hospital','Clinic','Lab','Other') | yes |  | Other |  |
| branch_level | varchar(50) | yes |  | Center |  |
| parent_branch_id | int | yes |  |  |  |
| hospital_code | varchar(50) | no | UNI |  |  |
| address | text | yes |  |  |  |
| contact_number | varchar(50) | yes |  |  |  |
| status | enum('Active','Inactive') | yes |  | Active |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| latitude | decimal(10,7) | yes |  |  |  |
| longitude | decimal(10,7) | yes |  |  |  |

### departments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no | UNI |  |  |
| code | varchar(20) | yes |  |  |  |
| description | text | yes |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### districts

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| state_id | int | yes |  | 1 |  |
| name | varchar(100) | no | UNI |  |  |
| state | varchar(100) | yes |  | Jharkhand |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### states

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no | UNI |  |  |
| code | varchar(10) | no | UNI |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

## Other

### abdm_care_context

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| request_id | varchar(255) | no | MUL |  |  |
| patient_id | bigint | yes | MUL |  |  |
| abha_number | varchar(50) | yes | MUL |  |  |
| care_context_ref | varchar(100) | no | MUL |  |  |
| display | varchar(255) | yes |  |  |  |
| link_status | varchar(50) | no |  | PENDING |  |
| error | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### abdm_consents

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| consent_id | varchar(255) | no | MUL |  |  |
| status | varchar(50) | yes |  |  |  |
| consent_detail | json | yes |  |  |  |
| signature | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| consent_request_id | varchar(255) | yes |  |  |  |
| consent_artifact_id | varchar(255) | yes |  |  |  |
| abha_address | varchar(255) | yes |  |  |  |
| raw_payload | json | yes |  |  |  |
| patient_id | varchar(50) | yes | MUL |  |  |
| requester_id | bigint | yes |  |  |  |
| purpose | varchar(20) | yes |  | CAREMGT |  |
| hi_types | json | yes |  |  |  |
| access_mode | varchar(20) | yes |  | VIEW |  |
| from_time | datetime | yes |  |  |  |
| to_time | datetime | yes |  |  |  |
| expiry | datetime | yes |  |  |  |
| frequency_unit | varchar(10) | yes |  | HOUR |  |
| frequency_value | int | yes |  | 1 |  |
| frequency_repeats | int | yes |  | 0 |  |
| care_contexts | json | yes |  |  |  |
| hip_id | varchar(100) | yes |  |  |  |
| direction | varchar(10) | yes |  | HIU |  |

### abdm_data_requests

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| transaction_id | varchar(255) | no | MUL |  |  |
| consent_id | varchar(255) | yes | MUL |  |  |
| hiu_id | varchar(100) | yes |  |  |  |
| data_push_url | varchar(500) | yes |  |  |  |
| key_material | json | yes |  |  |  |
| status | varchar(50) | yes |  | RECEIVED |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### abdm_health_information

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| consent_id | varchar(255) | no | MUL |  |  |
| transaction_id | varchar(255) | yes | MUL |  |  |
| patient_id | varchar(50) | yes | MUL |  |  |
| care_context_ref | varchar(255) | yes |  |  |  |
| hip_id | varchar(100) | yes |  |  |  |
| content | json | yes |  |  |  |
| is_archived | tinyint(1) | yes |  | 0 |  |
| archived_reason | varchar(50) | yes |  |  |  |
| archived_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### abdm_link_requests

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| request_id | varchar(255) | no | MUL |  |  |
| abha_number | varchar(50) | yes | MUL |  |  |
| patient_id | bigint | yes | MUL |  |  |
| link_token | text | yes |  |  |  |
| care_contexts_payload | json | yes |  |  |  |
| status | varchar(50) | no |  | PENDING |  |
| error | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### abdm_user_linking

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| transaction_id | varchar(255) | no | MUL |  |  |
| abha_number | varchar(50) | yes |  |  |  |
| abha_address | varchar(100) | yes |  |  |  |
| patient_ref | varchar(100) | yes |  |  |  |
| care_contexts | json | yes |  |  |  |
| otp | varchar(10) | yes |  |  |  |
| status | varchar(50) | yes |  | INITIATED |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| link_ref_number | varchar(255) | yes | MUL |  |  |

### abdm_user_links

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| abha_address | varchar(255) | no | MUL |  |  |
| abha_number | varchar(50) | yes |  |  |  |
| patient_id | int | yes | MUL |  |  |
| reg_no | varchar(50) | yes |  |  |  |
| care_context_ref | varchar(255) | yes |  |  |  |
| care_context_display | varchar(255) | yes |  |  |  |
| transaction_id | varchar(255) | yes |  |  |  |
| linked_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### admission_bed_history

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no |  |  |  |
| bed_id | int | no |  |  |  |
| ward | varchar(100) | yes |  |  |  |
| room_number | varchar(20) | yes |  |  |  |
| bed_number | varchar(20) | yes |  |  |  |
| assigned_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| vacated_at | timestamp | yes |  |  |  |
| transfer_reason | varchar(255) | yes |  |  |  |
| transferred_by | int | yes |  |  |  |

### admissions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_number | varchar(40) | no | UNI |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| branch_id | int | no |  |  |  |
| bed_id | int | yes |  |  |  |
| ward | varchar(100) | yes |  |  |  |
| room_number | varchar(20) | yes |  |  |  |
| bed_number | varchar(20) | yes |  |  |  |
| admission_type | enum('Elective','Emergency','Transfer','DayCare','OT','Observation') | yes |  | Elective |  |
| admission_source | enum('OP','Emergency','Telemedicine','Referral','DirectWalkIn','CancerDayCare','ICUTransfer','Observation') | yes |  | OP |  |
| op_visit_id | int | yes |  |  |  |
| op_encounter_id | int | yes |  |  |  |
| primary_doctor_id | int | no |  |  |  |
| admitting_doctor_id | int | yes |  |  |  |
| admission_reason | text | yes |  |  |  |
| admission_diagnosis | text | yes |  |  |  |
| icd10_codes | varchar(255) | yes |  |  |  |
| cancer_stage | varchar(20) | yes |  |  |  |
| comorbidities | text | yes |  |  |  |
| urgency | enum('Routine','Urgent','Emergency') | yes |  | Routine |  |
| expected_los_days | int | yes |  |  |  |
| requested_ward | varchar(100) | yes |  |  |  |
| required_specialty | varchar(100) | yes |  |  |  |
| isolation_required | tinyint(1) | yes |  | 0 |  |
| isolation_type | varchar(50) | yes |  |  |  |
| insurance_provider | varchar(100) | yes |  |  |  |
| pre_auth_number | varchar(100) | yes |  |  |  |
| deposit_amount | decimal(10,2) | yes |  | 0.00 |  |
| status | enum('Requested','PendingApproval','Approved','Rejected','Active','Discharged','Transferred','LAMA','Death') | yes |  | Requested |  |
| approved_by | int | yes |  |  |  |
| approved_at | timestamp | yes |  |  |  |
| admitted_at | timestamp | yes |  |  |  |
| expected_discharge_date | date | yes |  |  |  |
| actual_discharge_date | date | yes |  |  |  |
| discharge_type | enum('Recovered','Improved','Unchanged','LAMA','Transferred','Death','Referral') | yes |  |  |  |
| total_los_days | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### bb_donors

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| donor_no | varchar(30) | no | UNI |  |  |
| first_name | varchar(80) | no |  |  |  |
| last_name | varchar(80) | yes |  |  |  |
| gender | varchar(10) | no |  |  |  |
| dob | date | no |  |  |  |
| phone | varchar(20) | yes | MUL |  |  |
| address | varchar(255) | yes |  |  |  |
| abo | enum('A','B','AB','O','Unknown') | no |  | Unknown |  |
| rh | enum('Pos','Neg','Unknown') | no |  | Unknown |  |
| last_donation_date | date | yes |  |  |  |
| deferred_until | date | yes |  |  |  |
| deferral_reason | varchar(255) | yes |  |  |  |
| branch_id | int | yes | MUL |  |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### bb_issues

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| request_id | int | no | MUL |  |  |
| unit_id | int | no | MUL |  |  |
| crossmatch | enum('Compatible','Incompatible','Not done (emergency)') | no |  |  |  |
| override_reason | varchar(255) | yes |  |  |  |
| issued_to | varchar(120) | yes |  |  |  |
| issued_by | int | yes |  |  |  |
| issued_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| outcome | enum('Issued','Transfused','Returned','Wasted') | no |  | Issued |  |
| outcome_at | datetime | yes |  |  |  |
| notes | varchar(255) | yes |  |  |  |
| branch_id | int | no |  |  |  |

### bb_reactions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| issue_id | int | no |  |  |  |
| unit_id | int | no |  |  |  |
| patient_name | varchar(160) | yes |  |  |  |
| reaction_type | varchar(80) | no |  |  |  |
| severity | enum('Mild','Moderate','Severe','Fatal') | no |  |  |  |
| details | varchar(500) | yes |  |  |  |
| reported_by | int | yes |  |  |  |
| reported_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | no |  |  |  |

### bb_requests

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| request_no | varchar(40) | no | UNI |  |  |
| patient_id | int | yes |  |  |  |
| patient_name | varchar(160) | no |  |  |  |
| patient_abo | enum('A','B','AB','O','Unknown') | no |  | Unknown |  |
| patient_rh | enum('Pos','Neg','Unknown') | no |  | Unknown |  |
| ward | varchar(80) | yes |  |  |  |
| clinician | varchar(120) | yes |  |  |  |
| component | enum('Whole Blood','PRBC','FFP','Platelets','Cryoprecipitate','Plasma') | no |  |  |  |
| units_requested | tinyint | no |  | 1 |  |
| urgency | enum('Routine','Urgent','Emergency') | no |  | Routine |  |
| indication | varchar(255) | yes |  |  |  |
| status | enum('Requested','Ready','Partly issued','Issued','Cancelled') | no |  | Requested |  |
| branch_id | int | no | MUL |  |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### bb_units

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| unit_no | varchar(40) | no | UNI |  |  |
| donor_id | int | yes |  |  |  |
| parent_unit_id | int | yes |  |  |  |
| component | enum('Whole Blood','PRBC','FFP','Platelets','Cryoprecipitate','Plasma') | no |  |  |  |
| abo | enum('A','B','AB','O','Unknown') | no |  | Unknown |  |
| rh | enum('Pos','Neg','Unknown') | no |  | Unknown |  |
| volume_ml | smallint | yes |  |  |  |
| collected_at | datetime | no |  |  |  |
| expires_at | datetime | no | MUL |  |  |
| status | enum('Quarantine','Available','Reserved','Issued','Used','Discarded','Expired') | no |  | Quarantine |  |
| tti_status | enum('Pending','Cleared','Reactive') | no |  | Pending |  |
| tti_json | json | yes |  |  |  |
| screening_json | json | yes |  |  |  |
| storage_location | varchar(80) | yes |  |  |  |
| discard_reason | varchar(255) | yes |  |  |  |
| branch_id | int | no | MUL |  |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### beds

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bed_number | varchar(20) | no |  |  |  |
| branch_id | int | no |  |  |  |
| bed_type | enum('General','Semi-Private','Private','ICU','HDU','NICU','PICU','Day Care') | yes |  | General |  |
| status | enum('Available','Occupied','Cleaning','Reserved','Blocked','Maintenance') | yes |  | Available |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| ward | varchar(100) | yes |  |  |  |
| room_number | varchar(20) | yes |  |  |  |
| bed_code | varchar(50) | yes | UNI |  |  |
| floor | varchar(20) | yes |  |  |  |
| gender_restriction | varchar(20) | yes |  | Any |  |
| has_ventilator | tinyint(1) | yes |  | 0 |  |
| has_oxygen | tinyint(1) | yes |  | 0 |  |
| has_monitor | tinyint(1) | yes |  | 0 |  |
| has_negative_pressure | tinyint(1) | yes |  | 0 |  |
| daily_rate | decimal(10,2) | yes |  | 0.00 |  |
| notes | text | yes |  |  |  |
| current_admission_id | int | yes |  |  |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### blocks

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(150) | no | MUL |  |  |
| district_id | int | no |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### branch_hmis_config

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | UNI |  |  |
| integration_type | enum('CDAC','CARE','NONE') | no |  | NONE |  |
| hmis_hosp_mapping_code | varchar(50) | yes |  |  |  |
| api_access_key_override | varchar(255) | yes |  |  |  |
| is_active | tinyint(1) | no |  | 1 |  |
| notes | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| care_gateway_external_id | varchar(100) | yes |  |  |  |
| care_sender_ip | varchar(100) | yes |  |  |  |
| care_oru_port | int | yes |  |  |  |
| care_orm_mode | varchar(20) | yes |  |  |  |

### branch_payment_settings

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| branch_id | int | no | PRI |  |  |
| reg_fee_enabled | tinyint(1) | no |  | 1 |  |
| reg_fee_amount | decimal(10,2) | no |  | 0.00 |  |
| reg_fee_rule | enum('First registration','Every visit','Renew after days') | no |  | First registration |  |
| reg_fee_validity_days | int | no |  | 365 |  |
| methods | varchar(120) | no |  | Cash,Card,UPI,Online,Insurance,Other |  |
| default_method | varchar(20) | no |  | Cash |  |
| allow_discount | tinyint(1) | no |  | 1 |  |
| max_discount_percent | decimal(5,2) | no |  | 100.00 |  |
| allow_part_payment | tinyint(1) | no |  | 1 |  |
| online_counter | tinyint(1) | no |  | 1 |  |
| online_link | tinyint(1) | no |  | 1 |  |
| online_kiosk | tinyint(1) | no |  | 1 |  |
| link_expiry_hours | int | no |  | 48 |  |
| updated_by | int | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### branch_signing_settings

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| branch_id | int | no | PRI |  |  |
| require_dsc | tinyint(1) | no |  | 0 |  |
| updated_by | int | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| use_agent | tinyint(1) | no |  | 0 |  |

### call_agent_logs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| call_sid | varchar(100) | no | UNI |  |  |
| call_status | enum('in_progress','completed','hospital_mismatch','machine_mismatch') | no |  | in_progress |  |
| hospital_name | varchar(255) | yes |  |  |  |
| location | varchar(255) | yes |  |  |  |
| instrument_name | varchar(255) | yes |  |  |  |
| machine_status | enum('Active','Inactive','Condemned') | yes | MUL |  |  |
| samples_per_day | varchar(50) | yes |  |  |  |
| complaint_raised | enum('Yes','No') | yes |  |  |  |
| phone_number | varchar(20) | yes | MUL |  |  |
| agent_id | varchar(100) | yes |  |  |  |
| execution_id | varchar(100) | yes |  |  |  |
| raw_payload | json | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### care_hl7_logs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| direction | enum('inbound_order','outbound_result') | no |  |  |  |
| bill_item_id | int | yes | MUL |  |  |
| accession_id | bigint | yes | MUL |  |  |
| status | enum('success','error') | no |  |  |  |
| raw_message | mediumtext | yes |  |  |  |
| error_message | text | yes |  |  |  |
| created_at | timestamp | yes | MUL | CURRENT_TIMESTAMP |  |

### care_integration_logs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| operation | varchar(50) | no | MUL |  |  |
| direction | enum('INBOUND','OUTBOUND') | no |  |  |  |
| care_lab_order_id | int | yes |  |  |  |
| bill_item_id | int | yes | MUL |  |  |
| filler_order_number | varchar(50) | yes |  |  |  |
| branch_id | int | yes |  |  |  |
| request_payload | json | yes |  |  |  |
| response_payload | json | yes |  |  |  |
| http_status | int | yes |  |  |  |
| success | tinyint(1) | no |  | 0 |  |
| error_message | text | yes |  |  |  |
| duration_ms | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### care_lab_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bill_item_id | int | no | UNI |  |  |
| branch_id | int | no | MUL |  |  |
| placer_order_number | varchar(50) | no |  |  |  |
| filler_order_number | varchar(50) | no | UNI |  |  |
| loinc_code | varchar(20) | no |  |  |  |
| loinc_name | varchar(200) | yes |  |  |  |
| coding_system | varchar(255) | yes |  |  |  |
| message_control_id | varchar(50) | yes |  |  |  |
| device_ip | varchar(50) | yes |  |  |  |
| device_port | int | yes |  |  |  |
| orm_mode | varchar(20) | yes |  |  |  |
| last_pushed_status | varchar(30) | yes |  |  |  |
| last_pushed_at | timestamp | yes |  |  |  |
| last_push_error | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### care_loinc_parameter_map

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| loinc_code | varchar(20) | no | MUL |  |  |
| parameter_loinc_code | varchar(20) | no |  |  |  |
| parameter_name | varchar(200) | no |  |  |  |
| uom | varchar(50) | yes |  |  |  |
| lab_test_parameter_id | int | yes |  |  |  |
| mapping_status | enum('Mapped','Unmapped') | no |  | Unmapped |  |
| notes | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### care_loinc_test_map

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| loinc_code | varchar(20) | no | UNI |  |  |
| loinc_name | varchar(200) | yes |  |  |  |
| lab_test_id | int | yes |  |  |  |
| mapping_status | enum('Mapped','Placeholder','Unmapped') | no |  | Unmapped |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### cdac_integration_logs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| operation | varchar(50) | no | MUL |  |  |
| hmis_request_type | varchar(10) | yes |  |  |  |
| bill_item_id | int | yes | MUL |  |  |
| hmis_req_no | varchar(50) | yes |  |  |  |
| hmis_req_dno | varchar(50) | yes |  |  |  |
| hmis_patCrNo | varchar(50) | yes |  |  |  |
| branch_id | int | yes |  |  |  |
| request_payload | json | yes |  |  |  |
| response_payload | json | yes |  |  |  |
| http_status | int | yes |  |  |  |
| success | tinyint(1) | no | MUL | 0 |  |
| error_message | text | yes |  |  |  |
| duration_ms | int | yes |  |  |  |
| attempt | int | no |  | 1 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### cdac_lab_requisitions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| bill_item_id | int | no | UNI |  |  |
| branch_id | int | no | MUL |  |  |
| hmis_hosp_mapping_code | varchar(50) | no |  |  |  |
| hmis_patCrNo | varchar(50) | no | MUL |  |  |
| hmis_episode_code | varchar(50) | yes |  |  |  |
| hmis_episode_visitno | varchar(50) | yes |  |  |  |
| hmis_req_no | varchar(50) | no |  |  |  |
| hmis_req_dno | varchar(50) | no | UNI |  |  |
| hmis_lab_code | varchar(50) | yes |  |  |  |
| hmis_test_code | varchar(50) | yes |  |  |  |
| hmis_test_name | varchar(200) | yes |  |  |  |
| hmis_sample_code | varchar(50) | yes |  |  |  |
| hmis_sample_name | varchar(200) | yes |  |  |  |
| req_type | varchar(10) | yes |  |  |  |
| cdac_inv_status | varchar(10) | yes |  |  |  |
| last_pushed_status | varchar(30) | yes |  |  |  |
| last_pushed_at | timestamp | yes |  |  |  |
| last_push_error | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### cdac_master_data_cache

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| hmis_hosp_mapping_code | varchar(50) | no | MUL |  |  |
| category | enum('LAB','SAMPLE','TEST','UOM','SAMPLE_MAPPING','PARAMETER','OTHER') | no |  |  |  |
| code | varchar(50) | no |  |  |  |
| name | varchar(255) | yes |  |  |  |
| raw_json | json | yes |  |  |  |
| synced_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### cdac_parameter_map

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| hmis_hosp_mapping_code | varchar(50) | yes |  |  |  |
| hmis_lab_code | varchar(50) | yes |  |  |  |
| hmis_test_code | varchar(50) | yes | MUL |  |  |
| hmis_sample_code | varchar(50) | yes |  |  |  |
| parameter_name | varchar(200) | no |  |  |  |
| hmis_parameter_code | varchar(50) | yes |  |  |  |
| hmis_parent_parameter_code | varchar(50) | yes |  |  |  |
| hmis_str_uom | varchar(50) | yes |  |  |  |
| lab_test_parameter_id | int | yes |  |  |  |
| mapping_status | enum('Mapped','Unmapped') | no |  | Unmapped |  |
| notes | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### cdac_test_code_map

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| hmis_hosp_mapping_code | varchar(50) | no |  |  |  |
| hmis_lab_code | varchar(50) | yes |  |  |  |
| hmis_test_code | varchar(50) | no | UNI |  |  |
| hmis_test_name | varchar(200) | yes |  |  |  |
| hmis_sample_code | varchar(50) | yes |  |  |  |
| lab_test_id | int | yes |  |  |  |
| mapping_status | enum('Mapped','Placeholder','Unmapped') | no |  | Unmapped |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### clinical_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| order_number | varchar(30) | no | UNI |  |  |
| encounter_id | int | yes | MUL |  |  |
| visit_id | int | yes |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | no |  |  |  |
| branch_id | int | yes |  |  |  |
| order_type | enum('Laboratory','Radiology','Pharmacy','Procedure','OT','Physiotherapy','Dietician','BloodBank','Other') | no | MUL |  |  |
| department | varchar(100) | yes |  |  |  |
| order_details | json | no |  |  |  |
| status | enum('Draft','Ordered','Acknowledged','InProgress','Completed','Cancelled','OnHold') | yes | MUL | Ordered |  |
| priority | enum('Routine','STAT','Urgent') | yes |  | Routine |  |
| clinical_indication | text | yes |  |  |  |
| special_instructions | text | yes |  |  |  |
| fulfilled_by | int | yes |  |  |  |
| fulfilled_at | timestamp | yes |  |  |  |
| bill_id | int | yes |  |  |  |
| billed | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| admission_id | int | yes |  |  |  |

### consultations

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| appointment_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | yes | MUL |  |  |
| vitals_json | text | yes |  |  |  |
| symptoms | text | yes |  |  |  |
| diagnosis | text | yes |  |  |  |
| prescription_json | text | yes |  |  |  |
| lab_requests_json | text | yes |  |  |  |
| doctor_notes | text | yes |  |  |  |
| consultation_date | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| chief_complaints | text | yes |  |  |  |
| status | enum('Pending','Completed') | yes |  | Pending |  |
| updated_at | timestamp | yes |  |  |  |
| soap_history | text | yes |  |  |  |
| soap_exam | text | yes |  |  |  |
| icd10_codes | text | yes |  |  |  |
| follow_up_date | date | yes |  |  |  |
| patient_instructions | text | yes |  |  |  |
| examination_general | json | yes |  |  |  |
| examination_systems | json | yes |  |  |  |

### device_api_keys

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| key_hash | char(64) | no | UNI |  |  |
| label | varchar(150) | no |  |  |  |
| branch_id | int | yes |  |  |  |
| role | varchar(50) | no |  | Lab Technician |  |
| status | enum('Active','Revoked') | no | MUL | Active |  |
| created_by | int | yes |  |  |  |
| last_used_at | datetime | yes |  |  |  |
| last_used_ip | varchar(64) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| revoked_at | datetime | yes |  |  |  |

### digital_prescriptions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| consultation_id | int | no | MUL |  | consultations.id |
| medicine_name | varchar(255) | no |  |  |  |
| dosage | varchar(100) | yes |  |  |  |
| frequency | varchar(100) | yes |  |  |  |
| duration | varchar(100) | yes |  |  |  |
| instructions | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| route | varchar(50) | yes |  | Oral |  |
| sig_morning | tinyint(1) | yes |  | 0 |  |
| sig_afternoon | tinyint(1) | yes |  | 0 |  |
| sig_evening | tinyint(1) | yes |  | 0 |  |
| sig_night | tinyint(1) | yes |  | 0 |  |
| stop_date | date | yes |  |  |  |

### discharge_planning

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | UNI |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| planned_discharge_date | date | yes |  |  |  |
| pending_labs | tinyint(1) | yes |  | 0 |  |
| pending_bills | tinyint(1) | yes |  | 0 |  |
| pending_medicines | tinyint(1) | yes |  | 0 |  |
| counselling_done | tinyint(1) | yes |  | 0 |  |
| followup_booked | tinyint(1) | yes |  | 0 |  |
| home_care_arranged | tinyint(1) | yes |  | 0 |  |
| equipment_arranged | tinyint(1) | yes |  | 0 |  |
| ambulance_required | tinyint(1) | yes |  | 0 |  |
| insurance_approved | tinyint(1) | yes |  | 0 |  |
| discharge_instructions | text | yes |  |  |  |
| home_care_plan | text | yes |  |  |  |
| status | enum('InProgress','ReadyForDischarge','Discharged') | yes |  | InProgress |  |
| updated_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| medication_reconciled | tinyint(1) | yes |  | 0 |  |
| patient_educated | tinyint(1) | yes |  | 0 |  |
| discharge_summary_done | tinyint(1) | yes |  | 0 |  |
| follow_up_scheduled | tinyint(1) | yes |  | 0 |  |
| prescriptions_given | tinyint(1) | yes |  | 0 |  |
| lab_reports_given | tinyint(1) | yes |  | 0 |  |
| imaging_given | tinyint(1) | yes |  | 0 |  |
| transport_arranged | tinyint(1) | yes |  | 0 |  |
| insurance_cleared | tinyint(1) | yes |  | 0 |  |
| belongings_returned | tinyint(1) | yes |  | 0 |  |
| consent_for_discharge | tinyint(1) | yes |  | 0 |  |
| notes | text | yes |  |  |  |

### discharge_summaries

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | UNI |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| doctor_id | int | yes |  |  |  |
| admission_date | date | yes |  |  |  |
| discharge_date | date | yes |  |  |  |
| total_los_days | int | yes |  |  |  |
| admission_diagnosis | text | yes |  |  |  |
| final_diagnosis | text | yes |  |  |  |
| icd10_codes | text | yes |  |  |  |
| icd11_codes | text | yes |  |  |  |
| cancer_stage | varchar(20) | yes |  |  |  |
| comorbidities | text | yes |  |  |  |
| hospital_course | text | yes |  |  |  |
| procedures_done | text | yes |  |  |  |
| surgeries_done | text | yes |  |  |  |
| investigations_summary | text | yes |  |  |  |
| blood_products_used | text | yes |  |  |  |
| complications | text | yes |  |  |  |
| discharge_condition | enum('Recovered','Improved','Unchanged','LAMA','Death','Transferred') | yes |  |  |  |
| discharge_medications | text | yes |  |  |  |
| discharge_advice | text | yes |  |  |  |
| diet_instructions | text | yes |  |  |  |
| activity_restrictions | text | yes |  |  |  |
| wound_care | text | yes |  |  |  |
| follow_up_date | date | yes |  |  |  |
| follow_up_dept | varchar(100) | yes |  |  |  |
| follow_up_doctor_id | int | yes |  |  |  |
| follow_up_instructions | text | yes |  |  |  |
| emergency_contact | text | yes |  |  |  |
| status | enum('Draft','Finalized','Signed') | yes |  | Draft |  |
| signed_at | timestamp | yes |  |  |  |
| abha_uploaded | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| authored_by | int | yes |  |  |  |
| history_summary | text | yes |  |  |  |
| physical_exam_summary | text | yes |  |  |  |
| treatment_given | text | yes |  |  |  |
| procedures_performed | text | yes |  |  |  |
| response_to_treatment | text | yes |  |  |  |
| condition_at_discharge | text | yes |  |  |  |
| discharge_instructions | text | yes |  |  |  |
| follow_up_plan | text | yes |  |  |  |
| medications_at_discharge | text | yes |  |  |  |
| return_precautions | text | yes |  |  |  |
| finalized_by | int | yes |  |  |  |
| finalized_at | timestamp | yes |  |  |  |

### dispositions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| encounter_id | int | no | MUL |  |  |
| visit_id | int | yes |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | no |  |  |  |
| disposition_type | enum('Discharge','FollowUp','Admission','Observation','Telemedicine','Referral','HomeCare') | no |  |  |  |
| discharge_condition | enum('Stable','Improved','Unchanged','LAMA','Death') | yes |  |  |  |
| discharge_notes | text | yes |  |  |  |
| follow_up_date | date | yes |  |  |  |
| follow_up_dept | varchar(100) | yes |  |  |  |
| follow_up_doctor_id | int | yes |  |  |  |
| admit_ward | varchar(100) | yes |  |  |  |
| admit_reason | text | yes |  |  |  |
| obs_duration_hrs | int | yes |  |  |  |
| home_care_plan | text | yes |  |  |  |
| followup_appt_id | int | yes |  |  |  |
| sms_sent | tinyint(1) | yes |  | 0 |  |
| whatsapp_sent | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### doctor_lab_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| consultation_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | no |  |  |  |
| test_id | int | no | MUL |  |  |
| status | enum('Pending','Billed','Collected','Completed') | yes | MUL | Pending |  |
| order_date | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| urgency | enum('STAT','ASAP','Routine') | yes |  | Routine |  |
| clinical_indication | text | yes |  |  |  |

### doctor_schedules

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| doctor_id | int | no |  |  |  |
| day_of_week | enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') | yes |  |  |  |
| start_time | time | yes |  |  |  |
| end_time | time | yes |  |  |  |
| slot_duration_mins | int | yes |  | 15 |  |
| is_active | tinyint(1) | yes |  | 1 |  |

### doctors

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| user_id | int | no |  |  |  |
| specialization | varchar(100) | yes |  |  |  |
| experience_years | int | yes |  |  |  |
| consultation_fee | decimal(10,2) | yes |  | 0.00 |  |
| availability_status | enum('Available','On Leave','In Surgery') | yes |  | Available |  |
| bio | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| qualification | varchar(255) | yes |  |  |  |
| practice_since | year | yes |  |  |  |

### encounters

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| encounter_number | varchar(30) | no | UNI |  |  |
| visit_id | int | yes | MUL |  |  |
| appointment_id | int | yes |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| department | varchar(100) | yes |  |  |  |
| encounter_type | enum('Initial','FollowUp','Review','Emergency','Teleconsult','SecondOpinion') | yes |  | Initial |  |
| status | enum('Open','InProgress','Completed','Cancelled') | yes |  | Open |  |
| chief_complaint | text | yes |  |  |  |
| history_present | text | yes |  |  |  |
| past_history | text | yes |  |  |  |
| family_history | text | yes |  |  |  |
| surgical_history | text | yes |  |  |  |
| allergy_history | text | yes |  |  |  |
| current_medications | text | yes |  |  |  |
| soap_history | text | yes |  |  |  |
| soap_exam | text | yes |  |  |  |
| soap_assessment | text | yes |  |  |  |
| soap_plan | text | yes |  |  |  |
| general_examination | text | yes |  |  |  |
| systemic_examination | text | yes |  |  |  |
| provisional_diagnosis | text | yes |  |  |  |
| final_diagnosis | text | yes |  |  |  |
| icd10_codes | text | yes |  |  |  |
| icd11_codes | text | yes |  |  |  |
| cancer_stage | varchar(20) | yes |  |  |  |
| clinical_notes | text | yes |  |  |  |
| disposition | enum('Discharge','FollowUp','Admission','Observation','Telemedicine','Referral','HomeCare') | yes |  |  |  |
| follow_up_date | date | yes |  |  |  |
| follow_up_notes | text | yes |  |  |  |
| patient_instructions | text | yes |  |  |  |
| started_at | timestamp | yes |  |  |  |
| completed_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### facility_categories

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(100) | no | UNI |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### goods_receipt_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| grn_id | int | no | MUL |  | goods_receipts.id |
| po_item_id | int | yes |  |  |  |
| item_id | int | no | MUL |  | inventory_items.id |
| quantity_received | decimal(10,2) | no |  |  |  |
| quantity_damaged | decimal(10,2) | yes |  | 0.00 |  |
| unit_cost | decimal(10,2) | no |  |  |  |
| total_cost | decimal(10,2) | no |  |  |  |
| batch_number | varchar(100) | yes |  |  |  |
| lot_number | varchar(100) | yes |  |  |  |
| manufacturing_date | date | yes |  |  |  |
| expiry_date | date | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### goods_receipts

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| grn_number | varchar(50) | no | UNI |  |  |
| po_id | int | yes | MUL |  | purchase_orders.id |
| vendor_id | int | no | MUL |  | vendors.id |
| receipt_date | date | no |  |  |  |
| invoice_number | varchar(100) | yes |  |  |  |
| invoice_date | date | yes |  |  |  |
| subtotal | decimal(10,2) | yes |  | 0.00 |  |
| tax_amount | decimal(10,2) | yes |  | 0.00 |  |
| total_amount | decimal(10,2) | yes |  | 0.00 |  |
| received_by | int | no | MUL |  | users.id |
| approved_by | int | yes | MUL |  | users.id |
| status | enum('Pending','Approved','Rejected') | yes | MUL | Pending |  |
| notes | text | yes |  |  |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### holidays

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | yes |  |  |  |
| holiday_name | varchar(200) | no |  |  |  |
| holiday_date | date | no |  |  |  |
| holiday_type | enum('National','State','Local','Hospital') | yes |  | Hospital |  |
| is_recurring | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### hospital_settings

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| hospital_name | varchar(255) | yes |  | MERIL HIMS |  |
| logo_url | longtext | yes |  |  |  |
| address | text | yes |  |  |  |
| phone | varchar(50) | yes |  |  |  |
| website | varchar(255) | yes |  |  |  |
| email | varchar(255) | yes |  |  |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| smtp_host | varchar(255) | yes |  |  |  |
| smtp_port | int | yes |  | 587 |  |
| smtp_user | varchar(255) | yes |  |  |  |
| smtp_pass | varchar(255) | yes |  |  |  |
| smtp_from_name | varchar(255) | yes |  | HIMS Procurement |  |
| registration_fee | decimal(10,2) | yes |  | 15.00 |  |
| abdm_hip_id | varchar(100) | yes |  |  |  |
| abdm_facility_id | varchar(100) | yes |  |  |  |
| abdm_bridge_url | varchar(500) | yes |  |  |  |
| abdm_hip_status | varchar(50) | yes |  | NOT_REGISTERED |  |

### ip_activity_log

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | MUL |  |  |
| entity_type | varchar(50) | no |  |  |  |
| action | varchar(150) | no |  |  |  |
| performed_by | int | no |  |  |  |
| details | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_consultations

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| requested_by | int | no |  |  |  |
| consultant_id | int | yes |  |  |  |
| department | varchar(100) | no |  |  |  |
| urgency | enum('Routine','Urgent','Emergency') | yes |  | Routine |  |
| reason | text | yes |  |  |  |
| findings | text | yes |  |  |  |
| recommendations | text | yes |  |  |  |
| status | enum('Requested','Acknowledged','Completed','Declined') | yes |  | Requested |  |
| consultation_date | date | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_diet_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| diet_plan_id | varchar(50) | no |  |  |  |
| diet_plan_name | varchar(150) | no |  |  |  |
| custom_instructions | text | yes |  |  |  |
| status | enum('Active','Discontinued') | no |  | Active |  |
| ordered_by | int | no |  |  |  |
| discontinued_by | int | yes |  |  |  |
| discontinued_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_documents

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| document_type | enum('Consent Form','Scanned Report','Clinical Image','ID Proof','Insurance Document','Other') | no |  |  |  |
| file_name | varchar(255) | no |  |  |  |
| file_path | varchar(500) | no |  |  |  |
| notes | varchar(500) | yes |  |  |  |
| uploaded_by | int | no |  |  |  |
| signed_by | int | yes |  |  |  |
| signed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_hai_records

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| branch_id | int | no |  |  |  |
| infection_type | enum('CLABSI','CAUTI','SSI','VAP','CDI','Other') | no |  |  |  |
| site_detail | varchar(255) | yes |  |  |  |
| onset_date | date | no |  |  |  |
| organism_identified | varchar(150) | yes |  |  |  |
| device_associated | tinyint(1) | yes |  | 0 |  |
| device_type | varchar(100) | yes |  |  |  |
| antibiotic_started | varchar(255) | yes |  |  |  |
| outcome | enum('Ongoing','Resolved','Contributed to Death') | no |  | Ongoing |  |
| notes | text | yes |  |  |  |
| reported_by | int | no |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_insurance_claims

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no | UNI |  | admissions.id |
| patient_insurance_id | int | yes |  |  |  |
| policy_number | varchar(100) | yes |  |  |  |
| tpa_name | varchar(150) | yes |  |  |  |
| insurer_name | varchar(150) | yes |  |  |  |
| pre_auth_number | varchar(100) | yes |  |  |  |
| pre_auth_requested_amount | decimal(12,2) | yes |  |  |  |
| pre_auth_approved_amount | decimal(12,2) | yes |  |  |  |
| pre_auth_status | enum('Not Requested','Requested','Approved','Rejected','Partially Approved') | no |  | Not Requested |  |
| claim_status | enum('Not Filed','Filed','Under Review','Settled','Rejected') | no |  | Not Filed |  |
| claim_amount | decimal(12,2) | yes |  |  |  |
| settled_amount | decimal(12,2) | yes |  |  |  |
| remarks | text | yes |  |  |  |
| requested_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_nursing_assessments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| assessed_by | int | no |  |  |  |
| height_cm | decimal(5,1) | yes |  |  |  |
| weight_kg | decimal(5,1) | yes |  |  |  |
| bmi | decimal(4,1) | yes |  |  |  |
| bp_systolic | int | yes |  |  |  |
| bp_diastolic | int | yes |  |  |  |
| pulse_bpm | int | yes |  |  |  |
| respiration_rpm | int | yes |  |  |  |
| temperature_c | decimal(4,1) | yes |  |  |  |
| spo2_pct | decimal(4,1) | yes |  |  |  |
| pain_score | tinyint | yes |  |  |  |
| fall_risk | enum('Low','Moderate','High') | yes |  |  |  |
| fall_risk_score | int | yes |  |  |  |
| braden_score | int | yes |  |  |  |
| pressure_ulcer_risk | enum('No Risk','At Risk','High Risk') | yes |  |  |  |
| ecog_score | tinyint | yes |  |  |  |
| nutrition_score | int | yes |  |  |  |
| iv_cannula | tinyint(1) | yes |  | 0 |  |
| iv_cannula_site | varchar(50) | yes |  |  |  |
| iv_cannula_date | date | yes |  |  |  |
| catheter | tinyint(1) | yes |  | 0 |  |
| catheter_date | date | yes |  |  |  |
| ngt | tinyint(1) | yes |  | 0 |  |
| drain | tinyint(1) | yes |  | 0 |  |
| drain_type | varchar(100) | yes |  |  |  |
| ventilator | tinyint(1) | yes |  | 0 |  |
| implants | text | yes |  |  |  |
| known_allergies | text | yes |  |  |  |
| admission_notes | text | yes |  |  |  |
| care_plan | text | yes |  |  |  |
| belongings_inventory | text | yes |  |  |  |
| consent_obtained | tinyint(1) | yes |  | 0 |  |
| assessed_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ip_progress_notes

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| note_number | varchar(30) | yes | UNI |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| doctor_id | int | no |  |  |  |
| note_type | enum('AdmissionNote','DailyRound','NurseNote','ConsultationNote','ProcedureNote','DischargeNote','HandoverNote','ICUNote') | yes |  | DailyRound |  |
| note_date | date | no |  |  |  |
| note_time | time | yes |  |  |  |
| bp_systolic | int | yes |  |  |  |
| bp_diastolic | int | yes |  |  |  |
| pulse_bpm | int | yes |  |  |  |
| temperature_c | decimal(4,1) | yes |  |  |  |
| spo2_pct | decimal(4,1) | yes |  |  |  |
| pain_score | tinyint | yes |  |  |  |
| soap_subjective | text | yes |  |  |  |
| soap_objective | text | yes |  |  |  |
| soap_assessment | text | yes |  |  |  |
| soap_plan | text | yes |  |  |  |
| clinical_condition | text | yes |  |  |  |
| complications | text | yes |  |  |  |
| procedures_done | text | yes |  |  |  |
| diet_notes | text | yes |  |  |  |
| fluid_in_ml | int | yes |  |  |  |
| fluid_out_ml | int | yes |  |  |  |
| is_critical | tinyint(1) | yes |  | 0 |  |
| transfer_decision | varchar(100) | yes |  |  |  |
| expected_discharge | date | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### mar_records

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| medication_order_id | int | no |  |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| nurse_id | int | no |  |  |  |
| scheduled_time | timestamp | no |  |  |  |
| administered_at | timestamp | yes |  |  |  |
| status | enum('Scheduled','Given','Delayed','Missed','Refused','Held') | yes |  | Scheduled |  |
| dose_given | varchar(100) | yes |  |  |  |
| route_used | varchar(50) | yes |  |  |  |
| site | varchar(100) | yes |  |  |  |
| notes | text | yes |  |  |  |
| refused_reason | text | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### medication_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| order_number | varchar(30) | yes | UNI |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| doctor_id | int | no |  |  |  |
| drug_name | varchar(255) | no |  |  |  |
| generic_name | varchar(255) | yes |  |  |  |
| dosage | varchar(100) | yes |  |  |  |
| route | enum('Oral','IV','IM','SC','Topical','Sublingual','Inhaled','Rectal','Transdermal','Nasal','Other') | yes |  | Oral |  |
| frequency | varchar(50) | yes |  |  |  |
| frequency_times | json | yes |  |  |  |
| start_date | date | yes |  |  |  |
| end_date | date | yes |  |  |  |
| duration_days | int | yes |  |  |  |
| quantity_ordered | int | yes |  |  |  |
| instructions | text | yes |  |  |  |
| indication | text | yes |  |  |  |
| allergy_alert_shown | tinyint(1) | yes |  | 0 |  |
| allergy_override_reason | text | yes |  |  |  |
| status | enum('Active','Completed','Discontinued','OnHold','Paused') | yes |  | Active |  |
| discontinued_reason | text | yes |  |  |  |
| discontinued_by | int | yes |  |  |  |
| discontinued_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### nursing_assessments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| visit_id | int | yes | MUL |  |  |
| appointment_id | int | yes |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| assessed_by | int | yes |  |  |  |
| height_cm | decimal(5,1) | yes |  |  |  |
| weight_kg | decimal(5,1) | yes |  |  |  |
| bmi | decimal(4,1) | yes |  |  |  |
| bp_systolic | int | yes |  |  |  |
| bp_diastolic | int | yes |  |  |  |
| pulse_bpm | int | yes |  |  |  |
| respiration_rpm | int | yes |  |  |  |
| spo2_pct | decimal(4,1) | yes |  |  |  |
| temperature_c | decimal(4,1) | yes |  |  |  |
| pain_score | tinyint | yes |  |  |  |
| ecog_score | tinyint | yes |  |  |  |
| fall_risk | enum('Low','Moderate','High') | yes |  |  |  |
| nutrition_score | tinyint | yes |  |  |  |
| known_allergies | text | yes |  |  |  |
| nursing_notes | text | yes |  |  |  |
| assessed_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### order_basket

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| visit_id | int | yes | MUL |  |  |
| encounter_id | int | yes |  |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| branch_id | int | no |  |  |  |
| status | enum('Open','Reviewed','Billed','Cancelled') | yes |  | Open |  |
| created_by | int | yes |  |  |  |
| reviewed_by | int | yes |  |  |  |
| reviewed_at | timestamp | yes |  |  |  |
| converted_bill_id | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### order_basket_items

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| basket_id | int | no | MUL |  |  |
| service_type | enum('Consultation','Laboratory','Radiology','Pharmacy','Procedure','OT','Physiotherapy','Dietician','BloodBank','Package','Other') | no |  |  |  |
| service_id | int | yes |  |  |  |
| service_name | varchar(255) | no |  |  |  |
| quantity | int | yes |  | 1 |  |
| unit_price | decimal(10,2) | yes |  | 0.00 |  |
| total_price | decimal(10,2) | yes |  | 0.00 |  |
| discount_pct | decimal(5,2) | yes |  | 0.00 |  |
| net_price | decimal(10,2) | yes |  | 0.00 |  |
| doctor_id | int | yes |  |  |  |
| department | varchar(100) | yes |  |  |  |
| notes | text | yes |  |  |  |
| status | enum('Pending','Approved','Removed') | yes |  | Pending |  |
| added_by | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ot_bookings

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| booking_number | varchar(30) | no | UNI |  |  |
| admission_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| branch_id | int | no |  |  |  |
| clinical_order_id | int | yes |  |  |  |
| procedure_name | varchar(255) | no |  |  |  |
| surgeon_id | int | yes |  |  |  |
| assistant_surgeon_name | varchar(150) | yes |  |  |  |
| anesthesia_type | varchar(50) | yes |  |  |  |
| ot_room | varchar(50) | yes |  |  |  |
| scheduled_at | datetime | yes |  |  |  |
| estimated_duration_mins | int | yes |  |  |  |
| status | enum('Requested','Scheduled','InProgress','Completed','Cancelled') | no | MUL | Requested |  |
| consent_signed | tinyint(1) | yes |  | 0 |  |
| site_marked | tinyint(1) | yes |  | 0 |  |
| npo_confirmed | tinyint(1) | yes |  | 0 |  |
| allergies_reviewed | tinyint(1) | yes |  | 0 |  |
| blood_arranged | tinyint(1) | yes |  | 0 |  |
| antibiotics_given | tinyint(1) | yes |  | 0 |  |
| labs_reviewed | tinyint(1) | yes |  | 0 |  |
| imaging_reviewed | tinyint(1) | yes |  | 0 |  |
| implants_available | tinyint(1) | yes |  | 0 |  |
| checklist_completed_by | int | yes |  |  |  |
| checklist_completed_at | datetime | yes |  |  |  |
| requested_by | int | no |  |  |  |
| started_at | datetime | yes |  |  |  |
| completed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ot_operative_notes

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| booking_id | int | no | UNI |  | ot_bookings.id |
| surgeon_id | int | yes |  |  |  |
| anesthesiologist_name | varchar(150) | yes |  |  |  |
| anesthesia_type | varchar(50) | yes |  |  |  |
| start_time | datetime | yes |  |  |  |
| end_time | datetime | yes |  |  |  |
| procedure_performed | text | yes |  |  |  |
| findings | text | yes |  |  |  |
| complications | text | yes |  |  |  |
| blood_loss_ml | int | yes |  |  |  |
| specimens_removed | text | yes |  |  |  |
| implants_used | text | yes |  |  |  |
| post_op_diagnosis | text | yes |  |  |  |
| notes | text | yes |  |  |  |
| authored_by | int | no |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### parameter_code_names

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int unsigned | no | PRI |  |  |
| code | varchar(50) | no | UNI |  |  |
| name | varchar(255) | no |  |  |  |
| created_at | datetime | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | datetime | yes |  | CURRENT_TIMESTAMP |  |

### poct_devices

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| name | varchar(120) | no |  |  |  |
| model | varchar(120) | yes |  |  |  |
| serial_no | varchar(80) | yes |  |  |  |
| location | varchar(120) | yes |  |  |  |
| tests | varchar(500) | yes |  |  |  |
| status | enum('Active','Inactive') | no |  | Active |  |
| qc_interval_hours | smallint | no |  | 24 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### poct_operators

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| device_id | int | no | MUL |  |  |
| user_id | int | no |  |  |  |
| certified_until | date | no |  |  |  |

### poct_qc

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| device_id | int | no | MUL |  |  |
| level | varchar(30) | no |  |  |  |
| lot_no | varchar(60) | yes |  |  |  |
| expected | varchar(60) | yes |  |  |  |
| observed | varchar(60) | yes |  |  |  |
| passed | tinyint(1) | no |  |  |  |
| note | varchar(255) | yes |  |  |  |
| performed_by | int | yes |  |  |  |
| performed_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### poct_results

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| device_id | int | no |  |  |  |
| patient_id | int | yes | MUL |  |  |
| patient_name | varchar(160) | no |  |  |  |
| test_name | varchar(120) | no |  |  |  |
| lot_no | varchar(60) | yes |  |  |  |
| value | varchar(60) | no |  |  |  |
| unit | varchar(30) | yes |  |  |  |
| ref_low | decimal(12,3) | yes |  |  |  |
| ref_high | decimal(12,3) | yes |  |  |  |
| crit_low | decimal(12,3) | yes |  |  |  |
| crit_high | decimal(12,3) | yes |  |  |  |
| flag | enum('Normal','Low','High','Critical low','Critical high','Qualitative') | no |  | Normal |  |
| qc_override_reason | varchar(255) | yes |  |  |  |
| comment | varchar(255) | yes |  |  |  |
| performed_by | int | yes |  |  |  |
| performed_by_name | varchar(160) | yes |  |  |  |
| performed_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### portal_otps

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| audience | enum('patient','clinician','kiosk') | no | MUL |  |  |
| phone | varchar(20) | no |  |  |  |
| code_hash | char(64) | no |  |  |  |
| channel | varchar(20) | yes |  |  |  |
| expires_at | datetime | no |  |  |  |
| attempts | tinyint | no |  | 0 |  |
| consumed_at | datetime | yes |  |  |  |
| ip | varchar(64) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### prescription_barcodes

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| barcode_id | varchar(50) | no | UNI |  |  |
| status | enum('unused','assigned','verified','cancelled') | yes |  | unused |  |
| generated_by | int | yes | MUL |  | users.id |
| generated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| used_at | timestamp | yes |  |  |  |

### prescription_medicines

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| prescription_id | int | yes | MUL |  | prescriptions.id |
| medicine_name | varchar(255) | yes |  |  |  |
| dosage | varchar(100) | yes |  |  |  |
| confidence | float | yes |  |  |  |

### prescription_templates

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| doctor_id | int | no | MUL |  |  |
| template_name | varchar(255) | no |  |  |  |
| medicines | json | no |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### prescription_tests

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| prescription_id | int | yes | MUL |  | prescriptions.id |
| test_code | varchar(50) | yes |  |  |  |
| test_name | varchar(255) | yes |  |  |  |
| confidence | float | yes |  |  |  |

### prescriptions

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| barcode_id | varchar(50) | no | UNI |  |  |
| patient_name | varchar(255) | yes |  |  |  |
| abha_id | varchar(50) | yes |  |  |  |
| age | int | yes |  |  |  |
| gender | varchar(20) | yes |  |  |  |
| doctor_name | varchar(255) | yes |  |  |  |
| image_path | varchar(500) | yes |  |  |  |
| raw_ocr_text | text | yes |  |  |  |
| ai_json | json | yes |  |  |  |
| status | enum('pending','verified','processed','failed') | yes |  | pending |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### radiology_orders

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| consultation_id | int | yes | MUL |  |  |
| appointment_id | int | yes |  |  |  |
| admission_id | int | yes | MUL |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| doctor_id | int | yes |  |  |  |
| modality | enum('X-Ray','CT','MRI','Ultrasound','ECG','Echo','PET-CT','Nuclear Medicine','Mammography','DEXA Scan','Fluoroscopy','Angiography') | no |  |  |  |
| body_part | varchar(100) | yes |  |  |  |
| clinical_indication | text | yes |  |  |  |
| urgency | enum('Routine','Urgent','STAT') | yes |  | Routine |  |
| status | enum('Ordered','Scheduled','InProgress','Completed','Cancelled') | yes |  | Ordered |  |
| scheduled_at | datetime | yes |  |  |  |
| performed_at | datetime | yes |  |  |  |
| performed_by | int | yes |  |  |  |
| report_text | text | yes |  |  |  |
| report_url | varchar(500) | yes |  |  |  |
| reported_by | int | yes |  |  |  |
| reported_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### referrals

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| from_doctor_id | int | no | MUL |  |  |
| to_doctor_id | int | no | MUL |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| consultation_id | int | yes |  |  |  |
| note | text | yes |  |  |  |
| priority | enum('Routine','Urgent','Emergency') | yes |  | Routine |  |
| status | enum('Pending','Accepted','Completed','Cancelled') | yes |  | Pending |  |
| appointment_id | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### referring_clinicians

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(150) | no |  |  |  |
| registration_no | varchar(60) | yes |  |  |  |
| phone | varchar(20) | no | UNI |  |  |
| email | varchar(150) | yes |  |  |  |
| facility | varchar(200) | yes |  |  |  |
| name_aliases | varchar(500) | yes |  |  |  |
| status | enum('Active','Inactive') | no |  | Active |  |
| last_login_at | datetime | yes |  |  |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### result_flag_settings

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| setting_key | varchar(60) | no | PRI |  |  |
| setting_value | varchar(500) | yes |  |  |  |
| description | varchar(255) | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### signed_reports

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| signature_id | bigint | no | MUL |  |  |
| result_id | int | no |  |  |  |
| sample_id | varchar(60) | no | MUL |  |  |
| branch_id | int | yes |  |  |  |
| dsc_id | int | no |  |  |  |
| signer_id | int | no |  |  |  |
| pdf | longblob | no |  |  |  |
| pdf_sha256 | char(64) | no |  |  |  |
| signed_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### specialties

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| name | varchar(150) | no |  |  |  |
| code | varchar(20) | yes | UNI |  |  |
| description | text | yes |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| branch_id | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### vitals

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| consultation_id | int | no | MUL |  | consultations.id |
| height | decimal(5,2) | yes |  |  |  |
| weight | decimal(5,2) | yes |  |  |  |
| bp_systolic | int | yes |  |  |  |
| bp_diastolic | int | yes |  |  |  |
| pulse | int | yes |  |  |  |
| temperature | decimal(5,2) | yes |  |  |  |
| spo2 | int | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### ward_transfers

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| admission_id | int | no |  |  |  |
| patient_reg_no | varchar(50) | no |  |  |  |
| from_bed_id | int | yes |  |  |  |
| from_ward | varchar(100) | yes |  |  |  |
| from_room | varchar(20) | yes |  |  |  |
| from_bed_number | varchar(20) | yes |  |  |  |
| to_bed_id | int | yes |  |  |  |
| to_ward | varchar(100) | yes |  |  |  |
| to_room | varchar(20) | yes |  |  |  |
| to_bed_number | varchar(20) | yes |  |  |  |
| transfer_reason | text | yes |  |  |  |
| transfer_type | enum('WardTransfer','ICUAdmission','ICUDischarge','RoomUpgrade','RoomDowngrade','IsolationTransfer') | yes |  | WardTransfer |  |
| transferred_by | int | no |  |  |  |
| transfer_time | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| clinical_notes | text | yes |  |  |  |

### working_hours

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| department_id | int | yes |  |  |  |
| day_of_week | tinyint | no |  |  |  |
| open_time | time | no |  | 09:00:00 |  |
| close_time | time | no |  | 17:00:00 |  |
| is_closed | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

## Patients & registration

### appointments

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| reg_no | varchar(50) | no | MUL |  | patients.reg_no |
| visit_id | varchar(30) | yes |  |  |  |
| department | varchar(100) | no |  |  |  |
| doctor | varchar(100) | yes |  |  |  |
| doctor_id | int | yes |  |  |  |
| priority | varchar(50) | yes |  | Routine |  |
| appt_date | date | no |  |  |  |
| appt_time | time | yes |  |  |  |
| reason | text | yes |  |  |  |
| status | varchar(50) | yes |  | Scheduled |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes |  |  |  |
| queue_status | varchar(30) | yes |  | Registered |  |
| token_number | varchar(20) | yes |  |  |  |
| checkin_time | datetime | yes |  |  |  |
| start_time | datetime | yes |  |  |  |
| end_time | datetime | yes |  |  |  |
| wait_minutes | int | yes |  |  |  |

### patient_addresses

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  |  |
| address_type | enum('Current','Permanent','Office','Other') | yes |  | Current |  |
| address_line | varchar(255) | yes |  |  |  |
| city | varchar(100) | yes |  |  |  |
| district | varchar(100) | yes |  |  |  |
| state | varchar(100) | yes |  |  |  |
| pincode | varchar(10) | yes |  |  |  |
| country | varchar(50) | yes |  | India |  |
| is_primary | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### patient_alerts

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| alert_type | enum('Allergy','Condition','Warning','High Risk') | no |  |  |  |
| alert_text | varchar(255) | no |  |  |  |
| severity | enum('Low','Medium','High','Critical') | yes |  | High |  |
| added_by | int | yes |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### patient_consents

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  |  |
| consent_type | enum('Treatment','DataSharing','Research','Photography','ABHA','Telemedicine','Other') | no |  |  |  |
| consent_text | text | yes |  |  |  |
| consented | tinyint(1) | yes |  | 1 |  |
| consented_by | varchar(150) | yes |  |  |  |
| relation | varchar(50) | yes |  |  |  |
| ip_address | varchar(45) | yes |  |  |  |
| captured_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| visit_id | int | yes |  |  |  |

### patient_contacts

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  |  |
| name | varchar(150) | no |  |  |  |
| relation | varchar(50) | yes |  |  |  |
| phone | varchar(20) | yes |  |  |  |
| alt_phone | varchar(20) | yes |  |  |  |
| email | varchar(150) | yes |  |  |  |
| is_emergency | tinyint(1) | yes |  | 1 |  |
| is_primary | tinyint(1) | yes |  | 0 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### patient_custom_field_values

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  | patients.id |
| field_key | varchar(100) | no |  |  |  |
| value | text | yes |  |  |  |

### patient_field_config

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| field_key | varchar(100) | no | UNI |  |  |
| label | varchar(150) | no |  |  |  |
| field_source | enum('system','custom') | no |  | custom |  |
| field_type | enum('text','textarea','number','date','select','checkbox') | no |  | text |  |
| options_json | json | yes |  |  |  |
| is_required | tinyint(1) | no |  | 0 |  |
| is_enabled | tinyint(1) | no |  | 1 |  |
| display_order | int | no |  | 0 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### patient_identifiers

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  |  |
| id_type | enum('ABHA','Aadhaar','PAN','Passport','DrivingLicense','VoterID','AyushmanID','InsuranceID','UHID','Other') | no |  |  |  |
| id_value | varchar(100) | no | MUL |  |  |
| issuing_body | varchar(150) | yes |  |  |  |
| expiry_date | date | yes |  |  |  |
| verified | tinyint(1) | yes |  | 0 |  |
| verified_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### patient_insurance

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| patient_id | int | no | MUL |  |  |
| scheme_name | varchar(150) | no |  |  |  |
| scheme_type | enum('Ayushman','CGHS','ECHS','ESI','Private','TPA','Corporate','Other') | yes |  | Private |  |
| policy_number | varchar(100) | yes |  |  |  |
| member_id | varchar(100) | yes |  |  |  |
| tpa_name | varchar(150) | yes |  |  |  |
| insurer_name | varchar(150) | yes |  |  |  |
| sum_insured | decimal(12,2) | yes |  |  |  |
| valid_from | date | yes |  |  |  |
| valid_to | date | yes |  |  |  |
| card_photo | text | yes |  |  |  |
| is_active | tinyint(1) | yes |  | 1 |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### patient_queue_tokens

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| token_date | date | no |  |  |  |
| service_point | enum('Sample Collection','Registration') | no |  |  |  |
| token_number | varchar(20) | no |  |  |  |
| seq | int | no |  |  |  |
| patient_reg_no | varchar(50) | yes |  |  |  |
| patient_name | varchar(200) | yes |  |  |  |
| bill_id | int | yes | MUL |  |  |
| priority | enum('Routine','Urgent','STAT') | no |  | Routine |  |
| status | enum('Waiting','Called','In Service','Completed','Skipped','Cancelled') | no |  | Waiting |  |
| counter | varchar(50) | yes |  |  |  |
| issued_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| issued_by | int | yes |  |  |  |
| issued_via | enum('Counter','Kiosk') | no |  | Counter |  |
| called_at | timestamp | yes |  |  |  |
| called_by | int | yes |  |  |  |
| started_at | timestamp | yes |  |  |  |
| completed_at | timestamp | yes |  |  |  |

### patient_reg_sequences

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| branch_id | int | no | PRI |  |  |
| year | int | no | PRI |  |  |
| last_seq | int | no |  | 0 |  |

### patient_uploads

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| image_hash | varchar(64) | no | MUL |  |  |
| extracted_json | json | yes |  |  |  |
| matched_test_ids | json | yes |  |  |  |
| unmatched_lines | json | yes |  |  |  |
| status | enum('Analyzed','AutoBilled','ManualRequired','Expired') | no |  | Analyzed |  |
| patient_id | int | yes | MUL |  |  |
| bill_id | int | yes |  |  |  |
| branch_id | int | no |  | 1 |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

### patients

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| reg_no | varchar(50) | no | UNI |  |  |
| reg_date | date | no |  |  |  |
| is_new_born | tinyint(1) | yes |  | 0 |  |
| patient_type | enum('OP','IP','Emergency') | no |  | OP |  |
| consultant_name | varchar(150) | yes |  |  |  |
| photo_base64 | longtext | yes |  |  |  |
| title | varchar(20) | yes |  |  |  |
| first_name | varchar(100) | no |  |  |  |
| middle_name | varchar(100) | yes |  |  |  |
| last_name | varchar(100) | no |  |  |  |
| dob | date | yes |  |  |  |
| gender | varchar(20) | yes |  |  |  |
| aadhar_number | varchar(50) | yes |  |  |  |
| abha_id | varchar(50) | yes |  |  |  |
| abha_address | varchar(255) | yes |  |  |  |
| marital_status | varchar(50) | yes |  |  |  |
| occupation | varchar(100) | yes |  |  |  |
| language | varchar(50) | yes |  |  |  |
| education_level | varchar(100) | yes |  |  |  |
| religion | varchar(50) | yes |  |  |  |
| citizen | varchar(50) | yes |  |  |  |
| email_id | varchar(100) | yes |  |  |  |
| telephone | varchar(20) | yes |  |  |  |
| file_required | tinyint(1) | yes |  | 0 |  |
| address | varchar(255) | yes |  |  |  |
| suburb | varchar(100) | yes |  |  |  |
| city | varchar(100) | yes |  |  |  |
| country | varchar(50) | yes |  |  |  |
| postal_code | varchar(50) | yes |  |  |  |
| postal_address_check | tinyint(1) | yes |  | 0 |  |
| kin_same_address | tinyint(1) | yes |  | 0 |  |
| kin_name | varchar(100) | yes |  |  |  |
| kin_relation | varchar(50) | yes |  |  |  |
| kin_telephone | varchar(20) | yes |  |  |  |
| kin_address | varchar(255) | yes |  |  |  |
| kin_suburb | varchar(100) | yes |  |  |  |
| kin_city | varchar(100) | yes |  |  |  |
| kin_country | varchar(50) | yes |  |  |  |
| kin_code | varchar(50) | yes |  |  |  |
| payer_type | varchar(100) | yes |  |  |  |
| insurance_provider | varchar(100) | yes |  |  |  |
| policy_number | varchar(100) | yes |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| phr_address | varchar(100) | yes |  |  |  |
| abdm_txn_id | varchar(100) | yes |  |  |  |
| aadhaar_verified | tinyint(1) | yes |  | 0 |  |
| mobile_verified | tinyint(1) | yes |  | 0 |  |
| abha_token | text | yes |  |  |  |
| abha_x_token | text | yes |  |  |  |
| vip_category | varchar(50) | yes |  |  |  |
| blood_group | varchar(5) | yes |  |  |  |
| report_consent | tinyint(1) | yes |  |  |  |
| report_consent_at | datetime | yes |  |  |  |
| client_ref | varchar(48) | yes | UNI |  |  |
| provisional_id | varchar(40) | yes |  |  |  |
| offline_registered_at | datetime | yes |  |  |  |

### visits

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| visit_number | varchar(30) | no | UNI |  |  |
| patient_reg_no | varchar(50) | no | MUL |  |  |
| branch_id | int | no | MUL |  |  |
| visit_type | enum('OP','IP','Emergency','Telemedicine','DayCare','Procedure') | yes |  | OP |  |
| visit_status | enum('Registered','CheckedIn','Triage','NursingPending','NursingDone','WaitingDoctor','InConsultation','OrdersPending','BillingPending','Completed','Cancelled') | yes |  | Registered |  |
| visit_reason | varchar(500) | yes |  |  |  |
| priority | enum('Normal','Urgent','Emergency','VIP','CancerFastTrack') | yes |  | Normal |  |
| created_by | int | yes |  |  |  |
| created_at | timestamp | yes | MUL | CURRENT_TIMESTAMP |  |
| updated_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |
| closed_at | timestamp | yes |  |  |  |

## Queue & kiosk

### queue_token_events

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | bigint | no | PRI |  |  |
| token_id | int | no | MUL |  |  |
| branch_id | int | no | MUL |  |  |
| service_point | enum('Sample Collection','Registration') | no |  |  |  |
| token_number | varchar(20) | no |  |  |  |
| event_type | enum('Issued','Called','Recalled','Started','Completed','Skipped','Cancelled') | no |  |  |  |
| from_status | varchar(20) | yes |  |  |  |
| to_status | varchar(20) | no |  |  |  |
| counter | varchar(50) | yes |  |  |  |
| actor_id | int | yes | MUL |  |  |
| actor_name | varchar(200) | yes |  |  |  |
| actor_role | varchar(50) | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |

### queue_token_sequences

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| branch_id | int | no | PRI |  |  |
| token_date | date | no | PRI |  |  |
| service_point | enum('Sample Collection','Registration') | no | PRI |  |  |
| last_seq | int | no |  | 0 |  |

### queue_tokens

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| branch_id | int | no | MUL |  |  |
| token_date | date | no |  |  |  |
| department | varchar(100) | yes |  | General |  |
| doctor_id | int | yes |  |  |  |
| token_number | varchar(20) | no |  |  |  |
| seq | int | no |  |  |  |
| appointment_id | int | yes | MUL |  |  |
| patient_reg_no | varchar(50) | yes |  |  |  |
| issued_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

## Surveillance

### disease_surveillance

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| district | varchar(100) | no |  |  |  |
| disease | varchar(100) | no |  |  |  |
| cases | int | yes |  | 0 |  |
| trend | varchar(20) | yes |  |  |  |
| risk_level | enum('LOW','MEDIUM','HIGH') | yes |  | LOW |  |
| recorded_date | date | no |  |  |  |
| created_at | timestamp | yes |  | CURRENT_TIMESTAMP |  |

### surveillance_diseases

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| disease | varchar(100) | no | UNI |  |  |
| test_pattern | varchar(200) | no |  |  |  |
| medium_threshold | int | no |  | 5 |  |
| high_threshold | int | no |  | 15 |  |
| rise_alert_percent | int | no |  | 50 |  |
| cluster_min_cases | int | no |  | 3 |  |
| active | tinyint(1) | no |  | 1 |  |
| updated_by | int | yes |  |  |  |
| updated_at | timestamp | no |  | CURRENT_TIMESTAMP |  |

## Users, access & signing

### dsc_signing_jobs

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | char(36) | no | PRI |  |  |
| result_id | int | no | MUL |  |  |
| sample_id | varchar(60) | no |  |  |  |
| branch_id | int | yes |  |  |  |
| doctor_id | int | no | MUL |  |  |
| signature_id | bigint | no |  |  |  |
| token_hash | char(64) | no |  |  |  |
| status | enum('Created','Prepared','Completing','Completed','Failed','Cancelled','Expired') | no |  | Created |  |
| notes | varchar(1000) | yes |  |  |  |
| approved_at | datetime(3) | no |  |  |  |
| summary | json | yes |  |  |  |
| pdf_unsigned | longblob | yes |  |  |  |
| pdf_sha256 | char(64) | yes |  |  |  |
| prepared_pdf | longblob | yes |  |  |  |
| attrs_der | blob | yes |  |  |  |
| hex_start | int | yes |  |  |  |
| hex_end | int | yes |  |  |  |
| signing_time | datetime(3) | yes |  |  |  |
| cert_der | mediumblob | yes |  |  |  |
| chain_json | mediumtext | yes |  |  |  |
| dsc_id | int | yes |  |  |  |
| message | varchar(500) | yes |  |  |  |
| agent_info | varchar(300) | yes |  |  |  |
| ip_address | varchar(64) | yes |  |  |  |
| created_at | timestamp(3) | no |  | CURRENT_TIMESTAMP(3) |  |
| expires_at | datetime | no |  |  |  |
| completed_at | datetime(3) | yes |  |  |  |

### duty_schedules

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| doctor_id | int | no | MUL |  |  |
| room_id | int | no | MUL |  |  |
| duty_date | date | no |  |  |  |
| start_time | time | no |  |  |  |
| end_time | time | no |  |  |  |
| price | decimal(10,2) | yes |  | 0.00 |  |
| notes | text | yes |  |  |  |
| status | varchar(50) | yes |  | Scheduled |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes |  |  |  |

### user_dsc_certificates

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| user_id | int | yes | MUL |  |  |
| kind | enum('Doctor','Hospital','Token') | no |  | Doctor |  |
| branch_id | int | yes | MUL |  |  |
| p12_blob | mediumblob | yes |  |  |  |
| common_name | varchar(200) | yes |  |  |  |
| subject | varchar(500) | yes |  |  |  |
| issuer | varchar(500) | yes |  |  |  |
| serial | varchar(100) | yes |  |  |  |
| valid_from | datetime | yes |  |  |  |
| valid_to | datetime | yes |  |  |  |
| status | enum('Active','Revoked') | no |  | Active |  |
| uploaded_by | int | yes |  |  |  |
| uploaded_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| revoked_by | int | yes |  |  |  |
| revoked_at | timestamp | yes |  |  |  |
| password_enc | text | yes |  |  |  |
| cert_der | mediumblob | yes |  |  |  |
| fingerprint | char(64) | yes | MUL |  |  |
| token_info | varchar(200) | yes |  |  |  |

### users

| Column | Type | Null | Key | Default | Refers to |
|---|---|---|---|---|---|
| id | int | no | PRI |  |  |
| first_name | varchar(50) | no |  |  |  |
| last_name | varchar(50) | no |  |  |  |
| email | varchar(100) | no | UNI |  |  |
| phone | varchar(20) | yes |  |  |  |
| role | varchar(20) | no |  |  |  |
| department | varchar(50) | yes |  |  |  |
| staff_id | varchar(50) | yes |  |  |  |
| password | varchar(255) | no |  |  |  |
| created_at | timestamp | no |  | CURRENT_TIMESTAMP |  |
| branch_id | int | yes | MUL | 1 | branches.id |
| role_level | enum('Central','Sub-Central','Branch') | yes |  | Branch |  |
| qualification | varchar(255) | yes |  |  |  |
| experience_years | int | yes |  |  |  |
| practice_since | year | yes |  |  |  |
| failed_login_attempts | int | no |  | 0 |  |
| locked_until | datetime | yes |  |  |  |
| password_change_required | tinyint(1) | no |  | 0 |  |
| registration_no | varchar(60) | yes |  |  |  |
| designation | varchar(100) | yes |  |  |  |
| signature_image | mediumtext | yes |  |  |  |
| signature_updated_at | timestamp | yes |  |  |  |
| password_changed_at | datetime | yes |  |  |  |
| is_active | tinyint(1) | no |  | 1 |  |
| last_login_at | datetime | yes |  |  |  |

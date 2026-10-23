-- HMIS: Employee Management, Duty Roster, Leave, Attendance, Payroll,
-- Room Management and the OP appointment lifecycle.
--
-- Employees are a separate HR master from `users`: housekeeping, ward
-- attendants and other staff need an HR record (roster, attendance, payroll)
-- without ever logging in. `employees.user_id` links the two when the person
-- also has a login. Doctors are booked by users.id (appointments.doctor_id and
-- consultations already key on it), so a doctor taking OP appointments must
-- have a login.
--
-- Re-runnable only on a database that has not had it applied (MySQL has no
-- ADD COLUMN IF NOT EXISTS); apply once per database.

-- Role names such as 'Nursing Superintendent' are longer than the old 20 characters.
ALTER TABLE users MODIFY COLUMN role VARCHAR(40) NOT NULL;

-- ── HR settings (branch_id 0 = defaults for every facility) ─────────────────
CREATE TABLE IF NOT EXISTS hr_settings (
  branch_id            INT          NOT NULL PRIMARY KEY,
  weekly_off           VARCHAR(20)  NOT NULL DEFAULT 'Sun',      -- comma list of Mon..Sun
  late_grace_minutes   INT          NOT NULL DEFAULT 15,
  half_day_ratio       DECIMAL(4,2) NOT NULL DEFAULT 0.50,       -- worked/scheduled below this = half day
  geofence_radius_m    INT          NULL,                         -- NULL = clock-in allowed anywhere
  pf_employee_pct      DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  pf_employer_pct      DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  pf_wage_ceiling      DECIMAL(10,2) NOT NULL DEFAULT 15000.00,
  esi_employee_pct     DECIMAL(5,2) NOT NULL DEFAULT 0.75,
  esi_employer_pct     DECIMAL(5,2) NOT NULL DEFAULT 3.25,
  esi_gross_ceiling    DECIMAL(10,2) NOT NULL DEFAULT 21000.00,
  pt_threshold         DECIMAL(10,2) NOT NULL DEFAULT 25000.00,  -- Professional Tax: nil below this monthly gross (set per state)
  pt_amount            DECIMAL(10,2) NOT NULL DEFAULT 200.00,
  pt_february_amount   DECIMAL(10,2) NOT NULL DEFAULT 300.00,
  lop_basis            ENUM('Calendar','Fixed30') NOT NULL DEFAULT 'Calendar',
  ot_multiplier        DECIMAL(4,2) NOT NULL DEFAULT 2.00,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO hr_settings (branch_id) VALUES (0);

-- ── Shifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  branch_id      INT          NULL,                 -- NULL = available to every facility
  name           VARCHAR(60)  NOT NULL,
  code           VARCHAR(10)  NOT NULL,
  start_time     TIME         NOT NULL,
  end_time       TIME         NOT NULL,             -- end < start means the shift runs past midnight
  break_minutes  INT          NOT NULL DEFAULT 0,
  color          VARCHAR(9)   NOT NULL DEFAULT '#1a6fd4',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_shifts_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO shifts (branch_id, name, code, start_time, end_time, break_minutes, color) VALUES
  (NULL, 'General',   'G', '09:00:00', '17:00:00', 30, '#1a6fd4'),
  (NULL, 'Morning',   'M', '07:00:00', '14:00:00', 0,  '#0ea5e9'),
  (NULL, 'Evening',   'E', '14:00:00', '21:00:00', 0,  '#f59e0b'),
  (NULL, 'Night',     'N', '21:00:00', '07:00:00', 0,  '#6366f1'),
  (NULL, 'OPD Morning','OM','09:00:00', '13:00:00', 0, '#10b981'),
  (NULL, 'OPD Evening','OE','16:00:00', '20:00:00', 0, '#14b8a6');

-- ── Employees ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  branch_id                INT          NOT NULL,
  employee_code            VARCHAR(30)  NOT NULL,
  user_id                  INT          NULL,
  first_name               VARCHAR(50)  NOT NULL,
  last_name                VARCHAR(50)  NOT NULL DEFAULT '',
  gender                   ENUM('Male','Female','Other') NULL,
  dob                      DATE         NULL,
  blood_group              VARCHAR(5)   NULL,
  phone                    VARCHAR(20)  NULL,
  email                    VARCHAR(100) NULL,
  address                  TEXT         NULL,
  designation              VARCHAR(100) NULL,
  department_id            INT          NULL,
  staff_category           ENUM('Doctor','Nurse','Paramedical','Technician','Pharmacist','Administrative','Support','Other') NOT NULL DEFAULT 'Other',
  employment_type          ENUM('Permanent','Contract','Probation','Consultant','Intern','Trainee') NOT NULL DEFAULT 'Contract',
  date_of_joining          DATE         NULL,
  date_of_leaving          DATE         NULL,
  status                   ENUM('Active','Suspended','Resigned','Terminated','Retired') NOT NULL DEFAULT 'Active',
  reporting_to             INT          NULL,
  default_shift_id         INT          NULL,
  weekly_off               VARCHAR(20)  NULL,       -- NULL = facility default (hr_settings)
  qualification            VARCHAR(255) NULL,
  registration_council     VARCHAR(100) NULL,       -- e.g. Karnataka Medical Council / Nursing Council
  registration_no          VARCHAR(50)  NULL,
  registration_valid_till  DATE         NULL,
  experience_years         INT          NULL,
  emergency_contact_name   VARCHAR(100) NULL,
  emergency_contact_phone  VARCHAR(20)  NULL,
  pan                      VARCHAR(10)  NULL,
  aadhaar_last4            CHAR(4)      NULL,       -- only the last four digits are ever stored
  uan                      VARCHAR(12)  NULL,
  esi_number               VARCHAR(17)  NULL,
  bank_name                VARCHAR(100) NULL,
  bank_account_no          VARCHAR(30)  NULL,
  bank_ifsc                VARCHAR(11)  NULL,
  created_by               INT          NULL,
  created_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_code (employee_code),
  UNIQUE KEY uq_employee_user (user_id),
  KEY idx_employees_branch_status (branch_id, status),
  KEY idx_employees_department (department_id),
  CONSTRAINT fk_employees_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_shift FOREIGN KEY (default_shift_id) REFERENCES shifts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_documents (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  employee_id    INT          NOT NULL,
  doc_type       VARCHAR(50)  NOT NULL,             -- Appointment Letter, Degree, Registration, ID Proof…
  file_name      VARCHAR(255) NOT NULL,             -- stored name under uploads/employee-docs
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INT          NOT NULL,
  expires_on     DATE         NULL,
  uploaded_by    INT          NULL,
  uploaded_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_empdoc_employee (employee_id),
  CONSTRAINT fk_empdoc_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: every existing login becomes an employee of its facility.
-- Central users with no facility are left out (they are not on any roster).
INSERT INTO employees (branch_id, employee_code, user_id, first_name, last_name, phone, email,
                       designation, department_id, staff_category, employment_type, date_of_joining,
                       qualification, experience_years)
SELECT u.branch_id,
       COALESCE(NULLIF(u.staff_id, ''), CONCAT('EMP-', LPAD(u.id, 5, '0'))),
       u.id, u.first_name, u.last_name, u.phone, u.email,
       u.role,
       (SELECT d.id FROM departments d WHERE LOWER(d.name) = LOWER(u.department) LIMIT 1),
       CASE
         WHEN u.role IN ('Doctor','Lab Doctor','lab_doctor','Lab Head') THEN 'Doctor'
         WHEN u.role = 'Nurse' THEN 'Nurse'
         WHEN u.role IN ('Lab Technician','lab_tech','Sample Collector','Phlebotomist') THEN 'Technician'
         WHEN u.role = 'Pharmacist' THEN 'Pharmacist'
         WHEN u.role IN ('Admin','admin','Super Admin','Receptionist','HR','HR Manager','Auditor','Programme Officer') THEN 'Administrative'
         ELSE 'Other'
       END,
       'Permanent', DATE(u.created_at), u.qualification, u.experience_years
  FROM users u
 WHERE u.branch_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id);

-- ── Rooms (infrastructure) and beds ──────────────────────────────────────────
ALTER TABLE infrastructure
  MODIFY COLUMN type ENUM('Room','OPD Cabin','Ward','ICU','OT','Emergency','Procedure Room','Lab','Pharmacy','Radiology','Store','Office','Other') NOT NULL,
  ADD COLUMN room_number   VARCHAR(30) NULL AFTER name,
  ADD COLUMN department_id INT         NULL AFTER type,
  ADD COLUMN is_active     TINYINT(1)  NOT NULL DEFAULT 1,
  ADD COLUMN notes         TEXT        NULL,
  ADD KEY idx_infra_department (department_id);

ALTER TABLE beds
  ADD COLUMN room_id INT NULL AFTER branch_id,
  ADD KEY idx_beds_room (room_id),
  ADD KEY idx_beds_branch_status (branch_id, status);

-- ── Duty roster ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roster_entries (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  branch_id         INT          NOT NULL,
  employee_id       INT          NOT NULL,
  duty_date         DATE         NOT NULL,
  shift_id          INT          NULL,
  start_time        TIME         NOT NULL,
  end_time          TIME         NOT NULL,          -- end <= start means it ends next day
  duty_type         ENUM('OPD','IPD','Emergency','OT','On-Call','General','Weekly Off') NOT NULL DEFAULT 'General',
  room_id           INT          NULL,
  department_id     INT          NULL,
  -- OP booking settings (duty_type = OPD)
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  slot_minutes      INT          NOT NULL DEFAULT 15,
  patients_per_slot INT          NOT NULL DEFAULT 1,
  online_booking    TINYINT(1)   NOT NULL DEFAULT 1,
  notes             VARCHAR(255) NULL,
  status            ENUM('Scheduled','Cancelled') NOT NULL DEFAULT 'Scheduled',
  created_by        INT          NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_roster_branch_date (branch_id, duty_date),
  KEY idx_roster_employee_date (employee_id, duty_date),
  KEY idx_roster_room_date (room_id, duty_date),
  CONSTRAINT fk_roster_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_roster_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  CONSTRAINT fk_roster_room FOREIGN KEY (room_id) REFERENCES infrastructure(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Leave ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_types (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  branch_id          INT          NULL,             -- NULL = every facility
  name               VARCHAR(60)  NOT NULL,
  code               VARCHAR(10)  NOT NULL,
  annual_quota       DECIMAL(5,1) NOT NULL DEFAULT 0, -- 0 with is_paid = 0 means unlimited unpaid leave
  is_paid            TINYINT(1)   NOT NULL DEFAULT 1,
  carry_forward      TINYINT(1)   NOT NULL DEFAULT 0,
  max_carry_forward  DECIMAL(5,1) NOT NULL DEFAULT 0,
  requires_document  TINYINT(1)   NOT NULL DEFAULT 0,
  applicable_gender  ENUM('Any','Male','Female') NOT NULL DEFAULT 'Any',
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leave_type_code (branch_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO leave_types (branch_id, name, code, annual_quota, is_paid, carry_forward, max_carry_forward, requires_document, applicable_gender) VALUES
  (NULL, 'Casual Leave',    'CL',  12,  1, 0, 0,  0, 'Any'),
  (NULL, 'Sick Leave',      'SL',  12,  1, 0, 0,  1, 'Any'),
  (NULL, 'Earned Leave',    'EL',  15,  1, 1, 30, 0, 'Any'),
  (NULL, 'Maternity Leave', 'ML',  182, 1, 0, 0,  1, 'Female'),
  (NULL, 'Paternity Leave', 'PL',  5,   1, 0, 0,  0, 'Male'),
  (NULL, 'Compensatory Off','CO',  0,   1, 0, 0,  0, 'Any'),
  (NULL, 'Loss of Pay',     'LOP', 0,   0, 0, 0,  0, 'Any');

CREATE TABLE IF NOT EXISTS leave_balances (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  employee_id    INT          NOT NULL,
  leave_type_id  INT          NOT NULL,
  year           SMALLINT     NOT NULL,
  allotted       DECIMAL(5,1) NOT NULL DEFAULT 0,
  carried        DECIMAL(5,1) NOT NULL DEFAULT 0,
  adjusted       DECIMAL(5,1) NOT NULL DEFAULT 0,  -- manual +/- by HR (e.g. comp-off credit)
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leave_balance (employee_id, leave_type_id, year),
  CONSTRAINT fk_lb_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_lb_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leave_requests (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  branch_id      INT          NOT NULL,
  employee_id    INT          NOT NULL,
  leave_type_id  INT          NOT NULL,
  from_date      DATE         NOT NULL,
  to_date        DATE         NOT NULL,
  half_day       ENUM('None','First Half','Second Half') NOT NULL DEFAULT 'None', -- only when from_date = to_date
  days           DECIMAL(5,1) NOT NULL,
  reason         VARCHAR(500) NOT NULL,
  status         ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  applied_by     INT          NULL,
  applied_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by     INT          NULL,
  decided_at     DATETIME     NULL,
  decision_note  VARCHAR(500) NULL,
  KEY idx_lr_employee_dates (employee_id, from_date, to_date),
  KEY idx_lr_branch_status (branch_id, status),
  CONSTRAINT fk_lr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_lr_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Attendance ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_punches (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  branch_id        INT          NOT NULL,
  employee_id      INT          NOT NULL,
  attendance_date  DATE         NOT NULL,           -- the duty day this punch counts towards (night shifts)
  punch_type       ENUM('IN','OUT') NOT NULL,
  punched_at       DATETIME     NOT NULL,           -- IST wall-clock time
  source           ENUM('Web','Mobile','Manual') NOT NULL DEFAULT 'Web',
  latitude         DECIMAL(10,7) NULL,
  longitude        DECIMAL(10,7) NULL,
  accuracy_m       INT          NULL,
  distance_m       INT          NULL,               -- from the facility, when it has coordinates
  ip_address       VARCHAR(45)  NULL,
  note             VARCHAR(255) NULL,               -- required for Manual punches
  created_by       INT          NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_punch_employee_date (employee_id, attendance_date),
  KEY idx_punch_branch_date (branch_id, attendance_date),
  CONSTRAINT fk_punch_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Payroll ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_structures (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT           NOT NULL,
  effective_from     DATE          NOT NULL,
  basic              DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra                DECIMAL(12,2) NOT NULL DEFAULT 0,
  conveyance         DECIMAL(12,2) NOT NULL DEFAULT 0,
  medical            DECIMAL(12,2) NOT NULL DEFAULT 0,
  special_allowance  DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_allowance    DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_applicable      TINYINT(1)    NOT NULL DEFAULT 1,
  pf_on_full_basic   TINYINT(1)    NOT NULL DEFAULT 0, -- 0 = PF wages capped at hr_settings.pf_wage_ceiling
  esi_applicable     TINYINT(1)    NOT NULL DEFAULT 1, -- still only deducted while gross <= ESI ceiling
  pt_applicable      TINYINT(1)    NOT NULL DEFAULT 1,
  monthly_tds        DECIMAL(12,2) NOT NULL DEFAULT 0,
  ot_rate_per_hour   DECIMAL(10,2) NULL,              -- NULL = derived from basic with hr_settings.ot_multiplier
  attendance_based   TINYINT(1)    NOT NULL DEFAULT 1, -- 0 = fixed monthly pay; only unpaid leave reduces it
  notes              VARCHAR(255)  NULL,
  created_by         INT           NULL,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_salary_effective (employee_id, effective_from),
  CONSTRAINT fk_salary_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  branch_id       INT           NOT NULL,
  period          CHAR(7)       NOT NULL,           -- YYYY-MM
  status          ENUM('Draft','Finalized','Paid') NOT NULL DEFAULT 'Draft',
  employee_count  INT           NOT NULL DEFAULT 0,
  total_gross     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_employer_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by      INT           NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_by    INT           NULL,
  finalized_at    DATETIME      NULL,
  paid_at         DATETIME      NULL,
  payment_reference VARCHAR(100) NULL,
  UNIQUE KEY uq_payroll_period (branch_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payslips (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  payroll_run_id     INT           NOT NULL,
  employee_id        INT           NOT NULL,
  salary_structure_id INT          NULL,
  days_in_month      DECIMAL(5,1)  NOT NULL,
  paid_days          DECIMAL(5,1)  NOT NULL,
  lop_days           DECIMAL(5,1)  NOT NULL DEFAULT 0,
  present_days       DECIMAL(5,1)  NOT NULL DEFAULT 0,
  leave_days         DECIMAL(5,1)  NOT NULL DEFAULT 0,
  ot_hours           DECIMAL(6,2)  NOT NULL DEFAULT 0,
  basic              DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra                DECIMAL(12,2) NOT NULL DEFAULT 0,
  conveyance         DECIMAL(12,2) NOT NULL DEFAULT 0,
  medical            DECIMAL(12,2) NOT NULL DEFAULT 0,
  special_allowance  DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_allowance    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ot_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  arrears            DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross              DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_employee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  esi_employee       DECIMAL(12,2) NOT NULL DEFAULT 0,
  professional_tax   DECIMAL(12,2) NOT NULL DEFAULT 0,
  tds                DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deductions   DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deductions   DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay            DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_employer        DECIMAL(12,2) NOT NULL DEFAULT 0,
  esi_employer       DECIMAL(12,2) NOT NULL DEFAULT 0,
  remarks            VARCHAR(255)  NULL,
  tds_manual         TINYINT(1)    NOT NULL DEFAULT 0, -- HR set TDS / OT hours by hand; a rebuild keeps them
  ot_manual          TINYINT(1)    NOT NULL DEFAULT 0,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payslip (payroll_run_id, employee_id),
  KEY idx_payslip_employee (employee_id),
  CONSTRAINT fk_payslip_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_payslip_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── OP appointments ──────────────────────────────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN department_id    INT          NULL AFTER department,
  ADD COLUMN roster_entry_id  INT          NULL AFTER doctor_id,
  ADD COLUMN booking_source   ENUM('Front Desk','Patient Portal','Walk-in','Billing') NOT NULL DEFAULT 'Front Desk',
  ADD COLUMN booked_by        INT          NULL,
  ADD COLUMN consultation_fee DECIMAL(10,2) NULL,
  ADD COLUMN cancelled_at     DATETIME     NULL,
  ADD COLUMN cancelled_by     VARCHAR(60)  NULL,    -- 'user:<id>' or 'patient:<phone>'
  ADD COLUMN cancel_reason    VARCHAR(255) NULL,
  ADD COLUMN rescheduled_from INT          NULL,
  ADD COLUMN updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD KEY idx_appt_doctor_date (doctor_id, appt_date, appt_time),
  ADD KEY idx_appt_branch_date (branch_id, appt_date),
  ADD KEY idx_appt_roster (roster_entry_id);

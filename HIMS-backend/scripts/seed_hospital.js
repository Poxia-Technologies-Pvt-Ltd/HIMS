// Starter data for a new hospital: one login per role (each with an employee
// record), consultation rooms, wards and beds, a four-week duty roster with
// doctors' OPD sessions, national holidays, this year's leave quotas and
// salary structures.
//
//   node scripts/seed_hospital.js [--password 'Hmis@2026']
//
// Safe to re-run: accounts are matched by email, rooms by name, and nothing
// already rostered is duplicated. Change every password before real use.
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { passwordProblem } from '../utils/passwordPolicy.js';
import { nowIST, addDays, dateRange, weekdayOf } from '../utils/hr.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const PASSWORD = arg('password') || 'Hmis@2026';

// login role, name, email, mobile, staff category, designation, department, monthly CTC split
const STAFF = [
  { role: 'Admin', first: 'Hospital', last: 'Administrator', email: 'admin@hospital.local', phone: '9000000001', cat: 'Administrative', desig: 'Hospital Administrator', dept: 'Administration', pay: [45000, 18000, 1600, 9400] },
  { role: 'HR Manager', first: 'Kavya', last: 'Menon', email: 'hr@hospital.local', phone: '9000000002', cat: 'Administrative', desig: 'HR Manager', dept: 'Human Resources', pay: [30000, 12000, 1600, 6400] },
  { role: 'Receptionist', first: 'Divya', last: 'Shetty', email: 'reception@hospital.local', phone: '9000000003', cat: 'Administrative', desig: 'Front Office Executive', dept: 'Administration', pay: [12000, 4800, 1600, 1600] },
  { role: 'Doctor', first: 'Arjun', last: 'Rao', email: 'dr.arjun@hospital.local', phone: '9000000004', cat: 'Doctor', desig: 'Consultant Physician', dept: 'General Medicine', qual: 'MBBS, MD (General Medicine)', pay: [90000, 36000, 0, 24000], fixed: true, opd: { room: 'Medicine OPD', fee: 400, from: '09:00', to: '13:00', slot: 15, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Doctor', first: 'Meera', last: 'Iyer', email: 'dr.meera@hospital.local', phone: '9000000005', cat: 'Doctor', desig: 'Consultant Paediatrician', dept: 'Pediatrics', qual: 'MBBS, MD (Paediatrics)', pay: [85000, 34000, 0, 21000], fixed: true, opd: { room: 'Paediatrics OPD', fee: 350, from: '10:00', to: '14:00', slot: 10, perSlot: 2, days: ['Mon', 'Wed', 'Fri', 'Sat'] } },
  { role: 'Doctor', first: 'Sana', last: 'Khan', email: 'dr.sana@hospital.local', phone: '9000000006', cat: 'Doctor', desig: 'Consultant Gynaecologist', dept: 'Gynecology', qual: 'MBBS, MS (OBG)', pay: [85000, 34000, 0, 21000], fixed: true, opd: { room: 'Gynaecology OPD', fee: 400, from: '16:00', to: '19:00', slot: 15, days: ['Mon', 'Tue', 'Thu', 'Fri'] } },
  { role: 'Nursing Superintendent', first: 'Grace', last: 'Thomas', email: 'nursing.head@hospital.local', phone: '9000000007', cat: 'Nurse', desig: 'Nursing Superintendent', dept: 'General Medicine', pay: [35000, 14000, 1600, 5400], duty: { shift: 'G', room: 'General Ward', type: 'IPD', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Nurse', first: 'Lakshmi', last: 'Nair', email: 'nurse.lakshmi@hospital.local', phone: '9000000008', cat: 'Nurse', desig: 'Staff Nurse', dept: 'General Medicine', gender: 'Female', pay: [16000, 6400, 1600, 2000], duty: { shift: 'M', room: 'General Ward', type: 'IPD', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Nurse', first: 'Priya', last: 'Das', email: 'nurse.priya@hospital.local', phone: '9000000009', cat: 'Nurse', desig: 'ICU Staff Nurse', dept: 'ICU', gender: 'Female', pay: [18000, 7200, 1600, 2200], duty: { shift: 'N', room: 'ICU', type: 'IPD', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] } },
  { role: 'Lab Head', first: 'Vikram', last: 'Patil', email: 'lab.head@hospital.local', phone: '9000000010', cat: 'Doctor', desig: 'Pathologist', dept: 'Laboratory', qual: 'MBBS, MD (Pathology)', pay: [70000, 28000, 0, 17000], duty: { shift: 'G', room: 'Laboratory', type: 'General', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Lab Technician', first: 'Ravi', last: 'Kumar', email: 'lab.tech@hospital.local', phone: '9000000011', cat: 'Technician', desig: 'Lab Technician', dept: 'Laboratory', pay: [15000, 6000, 1600, 1900], duty: { shift: 'M', room: 'Laboratory', type: 'General', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Accounts Manager', first: 'Suresh', last: 'Hegde', email: 'accounts@hospital.local', phone: '9000000013', cat: 'Administrative', desig: 'Accounts Manager', dept: 'Administration', pay: [32000, 12800, 1600, 5600], duty: { shift: 'G', room: 'Accounts Office', type: 'General', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Radiographer', first: 'Naveen', last: 'Gowda', email: 'xray@hospital.local', phone: '9000000014', cat: 'Technician', desig: 'Radiographer', dept: 'Radiology', pay: [17000, 6800, 1600, 2100], duty: { shift: 'M', room: 'X-Ray & Imaging', type: 'General', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
  { role: 'Pharmacist', first: 'Anand', last: 'Joshi', email: 'pharmacy@hospital.local', phone: '9000000012', cat: 'Pharmacist', desig: 'Pharmacist', dept: 'General Medicine', pay: [18000, 7200, 1600, 2200], duty: { shift: 'G', room: 'Pharmacy', type: 'General', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } },
];

const ROOMS = [
  { name: 'Medicine OPD', room_number: '101', type: 'OPD Cabin', dept: 'General Medicine', floor: 0, block: 'A', capacity: 2 },
  { name: 'Paediatrics OPD', room_number: '102', type: 'OPD Cabin', dept: 'Pediatrics', floor: 0, block: 'A', capacity: 2 },
  { name: 'Gynaecology OPD', room_number: '103', type: 'OPD Cabin', dept: 'Gynecology', floor: 0, block: 'A', capacity: 2 },
  { name: 'Emergency', room_number: 'ER', type: 'Emergency', dept: 'Emergency', floor: 0, block: 'A', capacity: 4, beds: { prefix: 'ER-', count: 4, type: 'General', rate: 1500, oxygen: true, monitor: true } },
  { name: 'General Ward', room_number: '201', type: 'Ward', dept: 'General Medicine', floor: 1, block: 'B', capacity: 12, beds: { prefix: 'GW-', count: 12, type: 'General', rate: 800, oxygen: true } },
  { name: 'ICU', room_number: '301', type: 'ICU', dept: 'ICU', floor: 2, block: 'B', capacity: 6, beds: { prefix: 'ICU-', count: 6, type: 'ICU', rate: 5000, oxygen: true, monitor: true, ventilator: true } },
  { name: 'Laboratory', room_number: '110', type: 'Lab', dept: 'Laboratory', floor: 0, block: 'A' },
  { name: 'Pharmacy', room_number: '105', type: 'Pharmacy', floor: 0, block: 'A' },
  { name: 'X-Ray & Imaging', room_number: '108', type: 'Radiology', dept: 'Radiology', floor: 0, block: 'A' },
  { name: 'Accounts Office', room_number: '106', type: 'Office', dept: 'Administration', floor: 0, block: 'A' },
];

// item code, name (as the doctor's medicine list writes it), unit, quantity, unit cost
const MEDICINES = [
  ['MED-001', 'Paracetamol 500mg Tablet', 'tablet', 2000, 1], ['MED-002', 'Paracetamol 650mg Tablet', 'tablet', 1500, 1.5],
  ['MED-003', 'Ibuprofen 400mg Tablet', 'tablet', 600, 1.2], ['MED-004', 'Diclofenac 50mg Tablet', 'tablet', 400, 1],
  ['MED-005', 'Amoxicillin 500mg Capsule', 'capsule', 500, 4], ['MED-006', 'Amoxicillin-Clavulanate 625mg Tablet', 'tablet', 300, 12],
  ['MED-007', 'Azithromycin 500mg Tablet', 'tablet', 200, 18], ['MED-008', 'Cetirizine 10mg Tablet', 'tablet', 800, 0.8],
  ['MED-009', 'Pantoprazole 40mg Tablet', 'tablet', 900, 2], ['MED-010', 'Ondansetron 4mg Tablet', 'tablet', 0, 3],
  ['MED-011', 'Metformin 500mg Tablet', 'tablet', 1200, 1], ['MED-012', 'Amlodipine 5mg Tablet', 'tablet', 700, 1.5],
  ['MED-013', 'Atorvastatin 10mg Tablet', 'tablet', 40, 4], ['MED-014', 'ORS Sachet', 'sachet', 300, 15],
];

const HOLIDAYS = [
  ['Republic Day', '2026-01-26'],
  ['Independence Day', '2026-08-15'],
  ['Gandhi Jayanti', '2026-10-02'],
];

async function main() {
  const problem = passwordProblem(PASSWORD);
  if (problem) throw new Error(problem);
  const [[hospital]] = await db.query("SELECT id, hospital_code FROM branches WHERE status = 'Active' ORDER BY id LIMIT 1");
  if (!hospital) throw new Error('No active hospital record in branches');
  const H = hospital.id;
  const prefix = (hospital.hospital_code || 'H').toUpperCase();
  const [depts] = await db.query('SELECT id, name FROM departments');
  const deptId = (name) => depts.find((d) => d.name.toLowerCase() === String(name || '').toLowerCase())?.id || null;
  const [shiftRows] = await db.query('SELECT id, code, TIME_FORMAT(start_time, "%H:%i") s, TIME_FORMAT(end_time, "%H:%i") e FROM shifts WHERE is_active = 1');
  const shift = (code) => shiftRows.find((s) => s.code === code);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const today = nowIST().date;
  const year = Number(today.slice(0, 4));

  // Rooms and beds
  const roomId = {};
  for (const r of ROOMS) {
    const [[found]] = await db.query('SELECT id FROM infrastructure WHERE branch_id = ? AND name = ?', [H, r.name]);
    if (found) { roomId[r.name] = found.id; continue; }
    const [ins] = await db.query(
      `INSERT INTO infrastructure (branch_id, name, room_number, type, department_id, block, floor, capacity, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Available', 1)`,
      [H, r.name, r.room_number, r.type, deptId(r.dept), r.block, r.floor, r.capacity || null]
    );
    roomId[r.name] = ins.insertId;
    if (r.beds) {
      const rows = [];
      for (let n = 1; n <= r.beds.count; n++) {
        const label = `${r.beds.prefix}${String(n).padStart(2, '0')}`;
        rows.push([label, H, ins.insertId, r.beds.type, 'Available', r.name, r.room_number, `${H}-${ins.insertId}-${label}`, String(r.floor),
          r.beds.ventilator ? 1 : 0, r.beds.oxygen ? 1 : 0, r.beds.monitor ? 1 : 0, r.beds.rate]);
      }
      await db.query(
        `INSERT INTO beds (bed_number, branch_id, room_id, bed_type, status, ward, room_number, bed_code, floor,
                           has_ventilator, has_oxygen, has_monitor, daily_rate) VALUES ?`,
        [rows]
      );
    }
  }
  console.log(`Rooms ready: ${Object.keys(roomId).length}`);

  // Accounts + employees + salary
  const [[{ n: existingEmps }]] = await db.query('SELECT COUNT(*) AS n FROM employees WHERE branch_id = ?', [H]);
  let seq = Number(existingEmps);
  const people = [];
  for (const p of STAFF) {
    let [[user]] = await db.query('SELECT id FROM users WHERE email = ?', [p.email]);
    let created = false;
    if (!user) {
      const [u] = await db.query(
        `INSERT INTO users (first_name, last_name, email, phone, role, department, password, branch_id, role_level,
                            password_change_required, is_active, designation, qualification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Branch', 0, 1, ?, ?)`,
        [p.first, p.last, p.email, p.phone, p.role, p.dept, hash, H, p.desig, p.qual || null]
      );
      user = { id: u.insertId };
      created = true;
    }
    let [[emp]] = await db.query('SELECT id FROM employees WHERE user_id = ?', [user.id]);
    if (!emp) {
      seq += 1;
      const [e] = await db.query(
        `INSERT INTO employees (branch_id, employee_code, user_id, first_name, last_name, gender, phone, email, designation, department_id,
                                staff_category, employment_type, date_of_joining, qualification, default_shift_id,
                                bank_name, bank_account_no, bank_ifsc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'State Bank of India', ?, 'SBIN0001234')`,
        [H, `${prefix}-${String(seq).padStart(4, '0')}`, user.id, p.first, p.last,
          p.gender || (['Kavya', 'Divya', 'Meera', 'Sana', 'Grace'].includes(p.first) ? 'Female' : 'Male'),
          p.phone, p.email, p.desig, deptId(p.dept), p.cat, p.cat === 'Doctor' && p.fixed ? 'Consultant' : 'Permanent',
          `${year}-01-01`, p.qual || null, shift('G')?.id || null, `30${p.phone}`]
      );
      emp = { id: e.insertId };
      const [basic, hra, conveyance, special] = p.pay;
      await db.query(
        `INSERT INTO salary_structures (employee_id, effective_from, basic, hra, conveyance, special_allowance, pf_applicable,
                                        esi_applicable, pt_applicable, monthly_tds, attendance_based, notes)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, 'Starter salary')`,
        [emp.id, `${year}-01-01`, basic, hra, conveyance, special, basic >= 60000 ? 5000 : 0, p.fixed ? 0 : 1]
      );
    }
    people.push({ ...p, user_id: user.id, employee_id: emp.id, created });
  }
  console.log(`Accounts ready: ${people.length} (${people.filter((p) => p.created).length} new)`);

  // Duty roster: from this week's Monday for four weeks.
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = addDays(today, -((dow + 6) % 7));
  const to = addDays(from, 27);
  const rows = [];
  for (const p of people) {
    const [[already]] = await db.query('SELECT COUNT(*) AS n FROM roster_entries WHERE employee_id = ? AND duty_date BETWEEN ? AND ?', [p.employee_id, from, to]);
    if (already.n) continue;
    for (const d of dateRange(from, to)) {
      if (p.opd && p.opd.days.includes(weekdayOf(d))) {
        rows.push([H, p.employee_id, d, null, p.opd.from, p.opd.to, 'OPD', roomId[p.opd.room], deptId(p.dept),
          p.opd.fee, p.opd.slot, p.opd.perSlot || 1, 1, null]);
      } else if (p.duty && p.duty.days.includes(weekdayOf(d))) {
        const s = shift(p.duty.shift);
        rows.push([H, p.employee_id, d, s.id, s.s, s.e, p.duty.type, roomId[p.duty.room] || null, deptId(p.dept), 0, 15, 1, 0, null]);
      }
    }
  }
  if (rows.length) {
    await db.query(
      `INSERT INTO roster_entries (branch_id, employee_id, duty_date, shift_id, start_time, end_time, duty_type, room_id, department_id,
                                   consultation_fee, slot_minutes, patients_per_slot, online_booking, notes) VALUES ?`,
      [rows]
    );
  }
  console.log(`Roster ${from} to ${to}: ${rows.length} duties added`);

  // National holidays (repeat every year)
  for (const [name, date] of HOLIDAYS) {
    const [[h]] = await db.query('SELECT id FROM holidays WHERE holiday_name = ?', [name]);
    if (!h) await db.query("INSERT INTO holidays (branch_id, holiday_name, holiday_date, holiday_type, is_recurring) VALUES (NULL, ?, ?, 'National', 1)", [name, date]);
  }

  // Leave quotas for this year
  const [types] = await db.query('SELECT id, annual_quota, applicable_gender FROM leave_types WHERE is_active = 1 AND is_paid = 1 AND annual_quota > 0');
  const [emps] = await db.query("SELECT id, gender FROM employees WHERE branch_id = ? AND status = 'Active'", [H]);
  for (const e of emps) {
    for (const t of types) {
      if (t.applicable_gender !== 'Any' && t.applicable_gender !== e.gender) continue;
      await db.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, allotted) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE allotted = allotted`,
        [e.id, t.id, year, t.annual_quota]
      );
    }
  }
  console.log(`Leave quotas set for ${emps.length} employees (${year})`);

  // A starting pharmacy stock, so the doctor sees what is available while prescribing.
  let added = 0;
  for (const [code, name, unit, qty, cost] of MEDICINES) {
    const [[have]] = await db.query('SELECT id FROM inventory_item_master WHERE item_code = ?', [code]);
    if (have) continue;
    const [ins] = await db.query(
      `INSERT INTO inventory_item_master (item_code, item_name, category, unit, min_stock_level, reorder_level, unit_price, status)
       VALUES (?, ?, 'Medicine', ?, 50, 100, ?, 'Active')`,
      [code, name, unit, cost]
    );
    await db.query(
      `INSERT INTO inventory_batches (item_id, batch_number, expiry_date, quantity_received, quantity_available, unit_cost, status, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)`,
      [ins.insertId, `${code}-B1`, addDays(nowIST().date, 540), qty, qty, cost, H]
    );
    added += 1;
  }
  console.log(`Pharmacy medicines added: ${added}`);

  console.log('\nSign in from the start page — choose the role, then:');
  for (const p of people) console.log(`  ${p.role.padEnd(24)} ${p.email.padEnd(32)} ${p.created ? PASSWORD : '(existing password)'}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });

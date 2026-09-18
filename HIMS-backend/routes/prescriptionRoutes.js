import express from 'express';
import multer from 'multer';
import fs from 'fs';
import axios from 'axios';
import db from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

const upload = multer({
  dest: 'uploads/prescriptions/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — a photographed prescription shouldn't exceed this
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image uploads (JPEG, PNG, WebP, HEIC) are allowed'));
  },
});

// Helper to generate unique bill number
const generateBillNumber = (hospital_code = 'BILL') => {
  const timestamp = Date.now().toString(36).toUpperCase();
  // 8 base36 chars (~2.8e12 combinations) — bill numbers double as a public,
  // unauthenticated lookup key (trackTestStatus), so this needs to resist
  // guessing, not just avoid collisions.
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${hospital_code}-${timestamp}-${random}`;
};

// Helper to generate patient reg number
const generateRegNo = () => {
  return `REG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

router.post(
  '/process-ai',
  authenticateToken,
  authorizeRole(['Admin', 'Doctor', 'Lab Head', 'Lab Technician']),
  upload.single('image'),
  async (req, res) => {
    try {
      const { barcodeId } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Image required',
        });
      }

      // Convert Image To Base64
      const imageBuffer = fs.readFileSync(req.file.path);
      const imageBase64 = imageBuffer.toString('base64');

      // AI Prompt
      const prompt = `
You are an advanced medical prescription extraction AI.
Analyze the uploaded prescription image carefully.
Extract: patient_name, age, gender, doctor_name, tests, medicines, diagnosis.

Rules:
- Return STRICT JSON only
- No markdown
- If uncertain, still predict best value
- Extract tests as an array of objects: [{"test_name": "...", "confidence": 0.9}]

Example format:
{
  "patient_name": { "value": "Ravi Kumar", "confidence": 0.96 },
  "tests": [ { "test_name": "CBC", "confidence": 0.92 } ]
}
`;

      const ollamaUrl = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
      const ollamaResponse = await axios.post(
        ollamaUrl,
        {
          model: 'gemma4:31b-cloud',
          prompt,
          images: [imageBase64],
          stream: false,
        }
      );

      const aiText = ollamaResponse.data.response;
      let aiJson = {};
      try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        aiJson = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
      } catch (e) {
        return res.status(500).json({ success: false, message: 'AI Parsing Failed', raw: aiText });
      }

      // --- MATCHING LOGIC (Proposed) ---
      const extractedTests = aiJson.tests || [];
      const matchedTests = [];
      let totalAmount = 0;

      for (const t of extractedTests) {
        const cleanSearchName = t.test_name.split('(')[0].trim();
        const [rows] = await db.query(
          "SELECT id, test_name, price, test_code, lab_id FROM lab_tests WHERE (test_name LIKE ? OR test_name LIKE ?) AND status = 'Active' LIMIT 1",
          [`%${cleanSearchName}%`, `%${t.test_name}%`]
        );

        if (rows.length > 0) {
          const test = rows[0];
          matchedTests.push({
            service_id: test.id,
            service_name: test.test_name,
            service_code: test.test_code,
            price: test.price,
            lab_id: test.lab_id
          });
          totalAmount += test.price;
        }
      }

      // Return proposed data for user verification
      res.json({
        success: true,
        message: 'AI Extraction Completed. Please verify before billing.',
        aiResponse: aiJson,
        proposedData: {
          patientName: aiJson.patient_name?.value,
          gender: aiJson.gender?.value,
          tests: matchedTests,
          totalAmount,
          barcodeId
        }
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'AI Processing Failed' });
    }
  }
);

router.post('/finalize-billing', authenticateToken, authorizeRole(['Admin', 'Doctor', 'Lab Head', 'Lab Technician']), async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { patientName, gender, tests, totalAmount, barcodeId } = req.body;

    await connection.beginTransaction();

    // 1. Create Patient
    const regNo = generateRegNo();
    const nameParts = patientName.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Patient';

    const [result] = await connection.query(
      'INSERT INTO patients (reg_no, reg_date, first_name, last_name, gender) VALUES (?, NOW(), ?, ?, ?)',
      [regNo, firstName, lastName, gender || 'Other']
    );
    const patientId = result.insertId;

    // 2. Create Bill
    const billNumber = generateBillNumber();
    const [billResult] = await connection.query(
      `INSERT INTO bills (bill_number, patient_id, patient_name, total_amount, net_amount, payment_status, status, branch_id, lab_barcode) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [billNumber, patientId, patientName, totalAmount, totalAmount, 'Pending', 'Active', 1, barcodeId]
    );
    const billId = billResult.insertId;

    // 3. Insert Bill Items
    for (const test of tests) {
      await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, service_code, lab_id, quantity, unit_price, total_price, lab_barcode) 
         VALUES (?, 'Laboratory', ?, ?, ?, ?, 1, ?, ?, ?)`,
        [billId, test.service_id, test.service_name, test.service_code, test.lab_id, test.price, test.price, barcodeId]
      );
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Bill Generated Successfully',
      data: {
        billId,
        billNumber,
        patientId,
        totalAmount
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Finalizing Billing Failed' });
  } finally {
    connection.release();
  }
});

export default router;

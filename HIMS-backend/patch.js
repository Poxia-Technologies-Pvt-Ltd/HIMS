const fs = require('fs');
let content = fs.readFileSync('controllers/billingController.js', 'utf8');

if (!content.includes('generateInvoicePDFStream')) {
  // Add import below import http
  content = content.replace("import http from 'http';", "import http from 'http';\nimport { generateInvoicePDFStream } from '../utils/invoiceGenerator.js';");
  
  // Add export to end
  const exportStr = `
export const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const [bills] = await db.query('SELECT * FROM bills WHERE bill_number = ? OR id = ?', [id, id]);
    if (bills.length === 0) return res.status(404).json({ success: false, message: 'Bill not found' });
    const bill = bills[0];

    const [items] = await db.query('SELECT service_name as name, quantity, unit_price as amount, total_price FROM bill_items WHERE bill_id = ? AND status != "Inactive"', [bill.id]);

    let patientRegNo = 'N/A', age = '', gender = '';
    if (bill.patient_id) {
      const [patients] = await db.query('SELECT reg_no, age, gender FROM patients WHERE id = ?', [bill.patient_id]);
      if (patients.length > 0) {
        patientRegNo = patients[0].reg_no;
        age = patients[0].age;
        gender = patients[0].gender;
      }
    }

    const invoiceData = {
      bill_number: bill.bill_number,
      date: new Date(bill.created_at).toLocaleString(),
      patient_name: bill.patient_name,
      patient_reg_no: patientRegNo,
      age, gender, doctor_name: '', payment_method: bill.payment_method,
      discount_amount: bill.discount_amount, items
    };

    const doc = await generateInvoicePDFStream(invoiceData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', \`attachment; filename="Invoice-\${invoiceData.bill_number}.pdf"\`);
    doc.pipe(res);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ success: false, message: 'Server error generating PDF' });
  }
};
`;
  content += exportStr;
  fs.writeFileSync('controllers/billingController.js', content);
  console.log('Patched billingController.js');
} else {
  console.log('Already patched.');
}

let routes = fs.readFileSync('routes/billingRoutes.js', 'utf8');
if (!routes.includes('downloadInvoicePdf')) {
  routes = routes.replace('sendWhatsApp', 'sendWhatsApp,\n  downloadInvoicePdf');
  routes = routes.replace("router.delete('/:id', deleteBill);", "router.delete('/:id', deleteBill);\nrouter.get('/:id/pdf', downloadInvoicePdf);");
  fs.writeFileSync('routes/billingRoutes.js', routes);
  console.log('Patched billingRoutes.js');
}

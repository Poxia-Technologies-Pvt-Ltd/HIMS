import db from '../config/db.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { generateInvoicePDFStream } from './invoiceGenerator.js';
import { buildInvoiceData } from '../controllers/billingController.js';

// Sent to the patient's WhatsApp once an online order is paid and confirmed:
// the invoice (PDF), the Sample Collection token and the sample IDs. Best
// effort — a failed message is logged and never undoes a paid order.

const pdfBase64 = async (invoice) => {
  const doc = await generateInvoicePDFStream(invoice);
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);
  });
};

export async function sendOrderConfirmation(billId) {
  try {
    const [[bill]] = await db.query('SELECT * FROM bills WHERE id = ?', [billId]);
    if (!bill) return;
    const [[patient]] = await db.query('SELECT first_name, telephone FROM patients WHERE id = ?', [bill.patient_id]);
    const phone = bill.patient_phone || patient?.telephone;
    if (!phone) return;

    const invoice = await buildInvoiceData(bill);
    const [[token]] = await db.query(
      `SELECT token_number FROM patient_queue_tokens WHERE bill_id = ? AND service_point = 'Sample Collection' ORDER BY id DESC LIMIT 1`, [bill.id]);
    const tests = invoice.items.filter((i) => i.service_type === 'Laboratory');
    const text = [
      `Hello ${patient?.first_name || bill.patient_name || ''},`,
      `Your payment of Rs. ${Number(bill.paid_amount).toFixed(2)} is received at ${invoice.facility?.name || 'the hospital'}.`,
      '',
      `*Invoice:* ${bill.bill_number}`,
      tests.length ? `*Tests:* ${tests.map((t) => t.name).join(', ')}` : null,
      token ? `*Sample Collection token:* ${token.token_number}` : null,
      tests.some((t) => t.sample_id) ? `*Sample ID:* ${tests.map((t) => t.sample_id).filter(Boolean).join(', ')}` : null,
      '',
      'Please wait for your token to be called at the sample collection counter. Your invoice is attached.',
    ].filter((l) => l !== null).join('\n');

    await sendWhatsAppMessage(phone, text, await pdfBase64(invoice), `Invoice-${bill.bill_number}.pdf`);
  } catch (e) {
    console.error(`order confirmation message for bill ${billId} failed:`, e.message);
  }
}

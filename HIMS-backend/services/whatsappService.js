/**
 * WhatsApp Notification Service
 * Calls the whatsapp-web.js bot (localhost:3000) to send messages.
 * The bot must be running separately: cd WhatsApp-chat-bot && node server.js
 */

const WHATSAPP_BOT_URL = process.env.WHATSAPP_BOT_URL || 'http://bot:3005';

/**
 * Send a WhatsApp message via the local whatsapp-web.js bot.
 * @param {string} phone - Phone number with country code, e.g. "919876543210"
 * @param {string} text  - Message body
 */
/**
 * Send a WhatsApp message via the local whatsapp-web.js bot.
 * @param {string} phone - Phone number
 * @param {string} text  - Message body
 * @param {string} media - Base64 encoded media (optional)
 * @param {string} filename - Filename for media (optional)
 */
export async function sendWhatsAppMessage(phone, text, media = null, filename = null) {
  if (!phone) return;

  // Normalize phone: strip +, spaces, dashes
  let normalized = phone.replace(/[\s\-\+]/g, '');

  // Automatically add country code (India - 91) if it's a 10-digit number
  if (normalized.length === 10) {
    normalized = '91' + normalized;
  }

  const payload = {
    phone: normalized,
    text
  };

  if (media) {
    // Ensure we send raw base64 to whatsapp-web.js without the data URI scheme
    payload.media = media.replace(/^data:([A-Za-z-+/]+);base64,/, '');
    payload.filename = filename || 'document.pdf';
  }

  const res = await fetch(`${WHATSAPP_BOT_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp bot error: ${body}`);
  }

  return res.text();
}

/**
 * Build and send a Purchase Order WhatsApp notification to the vendor.
 */
export async function sendPOWhatsApp(po, vendorPhone, hospitalName = 'HIMS', pdfBase64 = null) {
  const deliveryDate = po.expected_delivery_date
    ? new Date(po.expected_delivery_date).toLocaleDateString('en-IN')
    : 'ASAP';

  const message = [
    `🏥 *${hospitalName}*`,
    `📋 *Purchase Order: ${po.po_number}*`,
    ``,
    `Hello *${po.vendor_name}*,`,
    ``,
    `Please find the attached Purchase Order.`,
    ``,
    `*Expected Delivery:* ${deliveryDate}`,
    `*Total Amount:* ₹${parseFloat(po.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    ``,
    `Please confirm receipt. Thank you! 🙏`,
  ].join('\n');

  await sendWhatsAppMessage(vendorPhone, message, pdfBase64, `${po.po_number}.pdf`);
  console.log(`✅ WhatsApp PO notification sent to ${vendorPhone}`);
}

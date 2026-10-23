/**
 * WhatsApp Notification Service
 *
 * Two providers, chosen by WHATSAPP_PROVIDER:
 *
 *  - 'cloud'  — the official WhatsApp Business Platform (Cloud API) from Meta:
 *               an approved enterprise messaging API, with per-message
 *               delivery status coming back to POST /api/whatsapp/webhook
 *               (see whatsappWebhookController.js). This is the provider the
 *               tender (#133-134) asks for. Needs WHATSAPP_CLOUD_TOKEN and
 *               WHATSAPP_PHONE_NUMBER_ID; set WHATSAPP_REPORT_TEMPLATE to an
 *               approved template whose header is a DOCUMENT so reports can be
 *               sent outside the 24-hour customer-service window.
 *  - 'bot'    — (default, legacy) the whatsapp-web.js bot. Kept only so
 *               existing deployments keep working until the Cloud API number
 *               is approved; it is not a Government-approved channel.
 *
 * sendWhatsAppMessage resolves to { provider, messageId } — messageId is what
 * the webhook later reports statuses against (null for the bot).
 */

const WHATSAPP_BOT_URL = process.env.WHATSAPP_BOT_URL || 'http://bot:3005';
const GRAPH_URL = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v20.0'}`;

export const whatsappProvider = () => (process.env.WHATSAPP_PROVIDER || 'bot').toLowerCase();

// Strip +, spaces, dashes; add India's 91 to a bare 10-digit number.
const normalizePhone = (phone) => {
  const normalized = String(phone).replace(/[\s\-\+]/g, '');
  return normalized.length === 10 ? '91' + normalized : normalized;
};

async function graphCall(path, init) {
  const res = await fetch(`${GRAPH_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp Cloud API error: ${body?.error?.message || res.status}`);
  return body;
}

async function sendViaCloud(to, text, media, filename) {
  if (!process.env.WHATSAPP_CLOUD_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WhatsApp Cloud API is not configured (WHATSAPP_CLOUD_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  }
  let message;
  if (media) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([Buffer.from(media, 'base64')], { type: 'application/pdf' }), filename);
    const { id: mediaId } = await graphCall('/media', { method: 'POST', body: form });
    const document = { id: mediaId, filename };
    message = process.env.WHATSAPP_REPORT_TEMPLATE
      ? {
          type: 'template',
          template: {
            name: process.env.WHATSAPP_REPORT_TEMPLATE,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
            components: [{ type: 'header', parameters: [{ type: 'document', document }] }],
          },
        }
      : { type: 'document', document: { ...document, caption: text } };
  } else {
    message = { type: 'text', text: { body: text } };
  }
  const body = await graphCall('/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
  });
  return { provider: 'cloud', messageId: body?.messages?.[0]?.id || null };
}

/**
 * Send a WhatsApp message through the configured provider.
 * @param {string} phone - Phone number
 * @param {string} text  - Message body
 * @param {string} media - Base64 encoded media (optional)
 * @param {string} filename - Filename for media (optional)
 */
export async function sendWhatsAppMessage(phone, text, media = null, filename = null) {
  if (!phone) return { provider: null, messageId: null };

  const normalized = normalizePhone(phone);
  // Raw base64, without any data URI scheme
  const rawMedia = media ? media.replace(/^data:([A-Za-z-+/]+);base64,/, '') : null;

  if (whatsappProvider() === 'cloud') {
    return sendViaCloud(normalized, text, rawMedia, filename || 'document.pdf');
  }

  const payload = { phone: normalized, text };
  if (rawMedia) {
    payload.media = rawMedia;
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

  await res.text();
  return { provider: 'bot', messageId: null };
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

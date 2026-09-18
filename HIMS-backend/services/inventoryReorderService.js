import db from '../config/db.js';
import { sendPOEmail } from './emailService.js';
import { sendPOWhatsApp } from './whatsappService.js';
import { generatePOPdf } from '../utils/inventoryPdfGenerator.js';

/**
 * Checks if an item's aggregate stock has fallen below its minimum level
 * and triggers an automatic Purchase Order if a default vendor is assigned.
 */
export const checkAndTriggerAutoReorder = async (connection, itemId) => {
  try {
    // 1. Fetch item details and current aggregate stock
    const [itemRows] = await connection.execute(`
      SELECT 
        im.id, im.item_name, im.item_code, im.min_stock_level, im.reorder_level, 
        im.default_vendor_id, im.delivery_lead_time_days, im.unit_price,
        COALESCE(SUM(b.quantity), 0) as total_stock
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id
      WHERE im.id = ?
      GROUP BY im.id
    `, [itemId]);

    if (!itemRows.length) return;
    const item = itemRows[0];

    // 2. Check if reorder is needed
    // Condition: total stock < min stock level AND a default vendor is assigned
    if (item.total_stock < item.min_stock_level && item.default_vendor_id) {
      
      // 3. Check if an active 'DRAFT' or 'ISSUED' PO already exists for this item to avoid duplicates
      const [existingPORows] = await connection.execute(`
        SELECT po.id 
        FROM inventory_purchase_orders po
        JOIN inventory_po_items poi ON po.id = poi.po_id
        WHERE poi.item_id = ? AND po.status IN ('DRAFT', 'ISSUED')
        LIMIT 1
      `, [itemId]);

      if (existingPORows.length > 0) {
        console.log(`Auto-Reorder: Active PO (DRAFT/ISSUED) already exists for item ${item.item_code}. Skipping.`);
        return;
      }

      console.log(`Auto-Reorder: Item ${item.item_code} is below min stock (${item.total_stock} < ${item.min_stock_level}). Triggering PO.`);

      // 4. Generate PO Number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const [countRes] = await connection.query(`
        SELECT COUNT(*) as cnt FROM inventory_purchase_orders WHERE DATE(created_at) = CURDATE()
      `);
      const count = (countRes[0].cnt + 1).toString().padStart(3, '0');
      const poNumber = `AUTO-PO-${dateStr}-${count}`;

      // 5. Calculate Expected Delivery Date
      const leadTime = item.delivery_lead_time_days || 3;
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + leadTime);
      const expectedDateStr = expectedDate.toISOString().slice(0, 10);

      // 6. Calculate Pricing
      const qty = parseFloat(item.reorder_level) || 0;
      const price = parseFloat(item.unit_price) || 0;
      const totalAmount = qty * price;

      // 7. Create the Purchase Order
      const [poRes] = await connection.execute(
        `INSERT INTO inventory_purchase_orders (
          po_number, vendor_id, expected_delivery_date, total_amount, status, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          poNumber, 
          item.default_vendor_id, 
          expectedDateStr, 
          totalAmount, 
          'DRAFT', 
          `Auto-generated PO: Stock fell below ${item.min_stock_level} units.`,
          1 // System User ID
        ]
      );
      
      const poId = poRes.insertId;

      // 8. Add the Item to the PO
      await connection.execute(
        `INSERT INTO inventory_po_items (
          po_id, item_id, quantity, unit_price, subtotal
        ) VALUES (?, ?, ?, ?, ?)`,
        [poId, item.id, qty, price, totalAmount]
      );

      console.log(`Auto-Reorder: Created PO ${poNumber} for ${item.reorder_level} units.`);

      // 8. Fetch Full PO Details for Notification (including vendor info and items)
      const [fullPORows] = await connection.execute(`
        SELECT po.*, v.vendor_name, v.email as vendor_email, v.phone as vendor_phone,
               'System' as created_by_name
        FROM inventory_purchase_orders po
        JOIN vendors v ON po.vendor_id = v.id
        WHERE po.id = ?
      `, [poId]);

      const [poItems] = await connection.execute(`
        SELECT poi.*, i.item_name, i.item_code, i.unit
        FROM inventory_po_items poi
        JOIN inventory_item_master i ON poi.item_id = i.id
        WHERE poi.po_id = ?
      `, [poId]);

      if (fullPORows.length > 0) {
        const fullPO = { ...fullPORows[0], items: poItems };
        
        // 9. Get Hospital Settings for PDF branding
        const [settingsRows] = await connection.execute(`SELECT * FROM hospital_settings LIMIT 1`);
        const settings = settingsRows[0] || {};

        // 10. Generate PDF Buffer
        const pdfBuffer = await generatePOPdf(fullPO, settings);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 11. Send Email Notification
        if (fullPO.vendor_email) {
          sendPOEmail(fullPO, fullPO.vendor_email, null, pdfBuffer)
            .catch(e => console.error('Auto-Reorder Email Error:', e.message));
        }

        // 12. Send WhatsApp Notification
        if (fullPO.vendor_phone) {
          sendPOWhatsApp(fullPO, fullPO.vendor_phone, settings.hospital_name || 'HIMS', pdfBase64)
            .catch(e => console.error('Auto-Reorder WhatsApp Error:', e.message));
        }
        }
      }
  } catch (error) {
    console.error('Error in checkAndTriggerAutoReorder:', error);
    // We don't throw here to avoid breaking the main transaction, 
    // but in a production system we might want more robust logging/retry.
  }
};

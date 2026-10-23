import cron from 'node-cron';
import db from '../config/db.js';
import { reconcileOpen } from '../controllers/paymentController.js';
import { razorpayEnabled } from '../services/razorpayService.js';

export const initCronJobs = () => {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('Running cron job: Deleting UNMAPPED tests older than 24 hours');
      const [result] = await db.query(
        `DELETE FROM lab_test_result 
         WHERE sample_id LIKE 'UNMAPPED-%' 
           AND tested_at < NOW() - INTERVAL 24 HOUR`
      );
      if (result.affectedRows > 0) {
        console.log(`Deleted ${result.affectedRows} old UNMAPPED test(s).`);
      }
    } catch (error) {
      console.error('Error deleting old UNMAPPED tests:', error);
    }
  });

  // Every night: one-time codes are only useful for five minutes; keep a day of them for investigation.
  cron.schedule('30 2 * * *', async () => {
    try {
      const [r] = await db.query('DELETE FROM portal_otps WHERE created_at < NOW() - INTERVAL 1 DAY');
      if (r.affectedRows) console.log(`Removed ${r.affectedRows} old one-time code(s).`);
    } catch (error) {
      console.error('Error removing old one-time codes:', error.message);
    }
  });

  // Every 15 minutes: settle Razorpay payments whose browser callback never
  // arrived (tab closed, network drop) and close expired payment links.
  cron.schedule('*/15 * * * *', async () => {
    if (!razorpayEnabled()) return;
    try {
      const r = await reconcileOpen();
      if (r.checked) console.log(`Razorpay reconciliation: ${r.checked} checked, ${r.paid} paid, ${r.expired} expired`);
    } catch (error) {
      console.error('Razorpay reconciliation failed:', error.message);
    }
  });
};

import cron from 'node-cron';
import db from '../config/db.js';

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
};

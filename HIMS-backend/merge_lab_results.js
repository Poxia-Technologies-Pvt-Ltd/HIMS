import db from './config/db.js';

async function mergeDuplicates() {
    console.log('Merging duplicate laboratory results...');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Find bill_item_ids with multiple results
        const [duplicates] = await connection.query(`
            SELECT bill_item_id, COUNT(*) as count 
            FROM lab_test_result 
            GROUP BY bill_item_id 
            HAVING count > 1
        `);

        console.log(`Found ${duplicates.length} items with duplicate results.`);

        for (const item of duplicates) {
            const bill_item_id = item.bill_item_id;
            
            // 2. Get all results for this item
            const [rows] = await connection.query(
                `SELECT * FROM lab_test_result WHERE bill_item_id = ? ORDER BY id ASC`,
                [bill_item_id]
            );

            let mergedResults = [];
            const firstRow = rows[0];

            for (const row of rows) {
                let json = [];
                try {
                    json = JSON.parse(row.results_json || '[]');
                } catch(e) {}

                json.forEach(newRes => {
                    const idx = mergedResults.findIndex(r => r.parameter_name === newRes.parameter_name);
                    if (idx !== -1) {
                        mergedResults[idx] = newRes;
                    } else {
                        mergedResults.push(newRes);
                    }
                });
            }

            // 3. Update the first row and delete others
            await connection.query(
                `UPDATE lab_test_result SET results_json = ? WHERE id = ?`,
                [JSON.stringify(mergedResults), firstRow.id]
            );

            const otherIds = rows.slice(1).map(r => r.id);
            if (otherIds.length > 0) {
                await connection.query(
                    `DELETE FROM lab_test_result WHERE id IN (?)`,
                    [otherIds]
                );
            }
            console.log(`Consolidated item ${bill_item_id}: ${rows.length} rows merged into 1.`);
        }

        await connection.commit();
        console.log('Merge complete.');
        process.exit(0);
    } catch (err) {
        await connection.rollback();
        console.error('Merge failed:', err);
        process.exit(1);
    } finally {
        connection.release();
    }
}

mergeDuplicates();

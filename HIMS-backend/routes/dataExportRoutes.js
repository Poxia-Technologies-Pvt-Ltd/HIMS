import express from 'express';
import { listTables, exportTable, dataDictionary, apiCatalogue } from '../controllers/dataExportController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

// Mounted at /api/export. `app` is passed in so the API catalogue can read the
// app's own route table.
export default function dataExportRoutes(app) {
  const router = express.Router();
  router.use(authenticateToken);
  router.use(authorizeRole(['Admin', 'Super Admin', 'Auditor']));

  router.get('/tables', listTables);
  router.get('/table/:name', exportTable);
  router.get('/data-dictionary', dataDictionary);
  router.get('/api-catalogue', (req, res) => res.json({ success: true, endpoints: apiCatalogue(app) }));

  return router;
}

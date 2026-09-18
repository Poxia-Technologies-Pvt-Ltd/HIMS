import express from 'express';
import {
  getInventoryItems,
  getInventoryItemById,
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getItemCategories,
  getBatches,
  addBatch,
  updateBatch,
  getLowStockAlerts,
  getExpiryAlerts,
  getExpiredStock,
  getInventoryDashboard,
  getReagentTestMappings,
  addReagentTestMapping,
  updateReagentTestMapping,
  deleteReagentTestMapping,
  getTestReagents
} from '../controllers/inventoryController.js';

import {
  getVendors,
  getVendorById,
  addVendor,
  updateVendor,
  deleteVendor,
  getVendorPurchaseSummary
} from '../controllers/vendorController.js';

import {
  getPurchaseRequisitions,
  getPurchaseRequisitionById,
  createPurchaseRequisition,
  updatePurchaseRequisition,
  approvePurchaseRequisition,
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  getGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  approveGoodsReceipt,
  getPendingForGRN
} from '../controllers/purchaseController.js';

import {
  getStockLevels,
  getBatchStock,
  getStockTransactions,
  adjustStock,
  getStockTransfers,
  getStockTransferById,
  createStockTransfer,
  approveStockTransfer,
  receiveStockTransfer,
  consumeReagentsForTest,
  getConsumptionLogs,
  getQCInventory,
  openVial
} from '../controllers/stockController.js';

import {
  getStockLedger,
  getConsumptionReport,
  getExpiryReport,
  getPurchaseReport,
  getReagentUsageByTest,
  getLowStockReport
} from '../controllers/inventoryReportsController.js';

import { authenticateToken, authorizeRole } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticateToken);

// Master data, vendors, purchasing and approvals — kept to Lab Head (who runs
// day-to-day lab operations) plus Admin/Super Admin, per the maker/checker
// separation the approve endpoints imply.
const LAB_MANAGE_ROLES = authorizeRole(['Admin', 'Super Admin', 'Lab Head']);

// ============================================
// DASHBOARD
// ============================================
router.get('/dashboard', getInventoryDashboard);

// ============================================
// INVENTORY ITEMS
// ============================================
router.get('/items', getInventoryItems);
router.get('/items/categories', getItemCategories);
router.get('/items/:id', getInventoryItemById);
router.post('/items', LAB_MANAGE_ROLES, addInventoryItem);
router.put('/items/:id', LAB_MANAGE_ROLES, updateInventoryItem);
router.delete('/items/:id', LAB_MANAGE_ROLES, deleteInventoryItem);

// ============================================
// BATCHES
// ============================================
router.get('/batches', getBatches);
router.post('/batches', LAB_MANAGE_ROLES, addBatch);
router.put('/batches/:id', LAB_MANAGE_ROLES, updateBatch);

// ============================================
// ALERTS
// ============================================
router.get('/alerts/low-stock', getLowStockAlerts);
router.get('/alerts/expiry', getExpiryAlerts);
router.get('/alerts/expired', getExpiredStock);

// ============================================
// VENDORS
// ============================================
router.get('/vendors', getVendors);
router.get('/vendors/purchase-summary', getVendorPurchaseSummary);
router.get('/vendors/:id', getVendorById);
router.post('/vendors', LAB_MANAGE_ROLES, addVendor);
router.put('/vendors/:id', LAB_MANAGE_ROLES, updateVendor);
router.delete('/vendors/:id', LAB_MANAGE_ROLES, deleteVendor);

// ============================================
// PURCHASE REQUISITIONS
// ============================================
router.get('/purchase-requisitions', getPurchaseRequisitions);
router.get('/purchase-requisitions/:id', getPurchaseRequisitionById);
router.post('/purchase-requisitions', LAB_MANAGE_ROLES, createPurchaseRequisition);
router.put('/purchase-requisitions/:id', LAB_MANAGE_ROLES, updatePurchaseRequisition);
router.put('/purchase-requisitions/:id/approve', LAB_MANAGE_ROLES, approvePurchaseRequisition);

// ============================================
// PURCHASE ORDERS
// ============================================
router.get('/purchase-orders', getPurchaseOrders);
router.get('/purchase-orders/:id', getPurchaseOrderById);
router.post('/purchase-orders', LAB_MANAGE_ROLES, createPurchaseOrder);
router.put('/purchase-orders/:id', LAB_MANAGE_ROLES, updatePurchaseOrder);

// ============================================
// GOODS RECEIPTS
// ============================================
router.get('/goods-receipts', getGoodsReceipts);
router.get('/goods-receipts/:id', getGoodsReceiptById);
router.post('/goods-receipts', LAB_MANAGE_ROLES, createGoodsReceipt);
router.put('/goods-receipts/:id/approve', LAB_MANAGE_ROLES, approveGoodsReceipt);
router.get('/pending-grn', getPendingForGRN);

// ============================================
// STOCK MANAGEMENT
// ============================================
router.get('/stock', getStockLevels);
router.get('/stock/batches', getBatchStock);
router.get('/stock/transactions', getStockTransactions);
router.post('/stock/adjust', LAB_MANAGE_ROLES, adjustStock);

// ============================================
// STOCK TRANSFERS
// ============================================
router.get('/transfers', getStockTransfers);
router.get('/transfers/:id', getStockTransferById);
router.post('/transfers', LAB_MANAGE_ROLES, createStockTransfer);
router.put('/transfers/:id/approve', LAB_MANAGE_ROLES, approveStockTransfer);
router.put('/transfers/:id/receive', LAB_MANAGE_ROLES, receiveStockTransfer);

// ============================================
// REAGENT CONSUMPTION
// ============================================
router.get('/reagent-mappings', getReagentTestMappings);
router.post('/reagent-mappings', LAB_MANAGE_ROLES, addReagentTestMapping);
router.put('/reagent-mappings/:id', LAB_MANAGE_ROLES, updateReagentTestMapping);
router.delete('/reagent-mappings/:id', LAB_MANAGE_ROLES, deleteReagentTestMapping);
router.get('/tests/:test_id/reagents', getTestReagents);

// Auto-consumption endpoint — fires as a routine side effect of any staff
// member (typically a Lab Technician) processing a test, not a purchasing
// action, so this deliberately stays open to all authenticated staff.
router.post('/consume-reagents', consumeReagentsForTest);
router.get('/consumption-logs', getConsumptionLogs);

// ============================================
// QC / CONTROL INVENTORY
// ============================================
router.get('/qc-inventory', getQCInventory);
// Opening a vial happens routinely while running tests — same reasoning as
// consume-reagents above, left open to all authenticated staff.
router.put('/batches/:id/open-vial', openVial);

// ============================================
// REPORTS
// ============================================
router.get('/reports/stock-ledger', getStockLedger);
router.get('/reports/consumption', getConsumptionReport);
router.get('/reports/expiry', getExpiryReport);
router.get('/reports/purchase', getPurchaseReport);
router.get('/reports/reagent-usage', getReagentUsageByTest);
router.get('/reports/low-stock', getLowStockReport);

export default router;

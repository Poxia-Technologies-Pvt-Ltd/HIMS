// A cheap "something changed" counter per facility. Screens poll
// GET /api/lab/worklist/version every few seconds and reload the worklist only
// when the number moves — near-real-time updates without a push channel that
// would have to survive nginx, the Electron IPC bridge and multiple tabs.
const versions = new Map();

export const bumpWorklist = (branch_id) => {
  const key = String(branch_id ?? 'all');
  versions.set(key, (versions.get(key) || 0) + 1);
  versions.set('all', (versions.get('all') || 0) + 1);
};

export const worklistVersion = (branch_id) => `${process.pid}-${versions.get(String(branch_id ?? 'all')) || 0}`;

// Router-level middleware: any successful write under /api/lab or /api/billing
// (new order, receipt, result, rerun, transfer…) moves the facility's version.
export const signalWorklistOnWrite = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) bumpWorklist(req.user?.branch_id ?? req.body?.branch_id);
    });
  }
  next();
};

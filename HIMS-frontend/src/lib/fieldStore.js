// IndexedDB storage for the Field app (see fieldEngine.js for the interface it implements).
const DB_NAME = 'ka-lims-field';
const KEYS = { registrations: 'id', collections: 'billId', orders: 'id', meta: 'key' };

let opening;
function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { for (const [name, keyPath] of Object.entries(KEYS)) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { opening = null; reject(req.error); };
    });
  }
  return opening;
}

const run = async (name, mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode); const out = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
};

export const fieldStore = {
  put: (name, rec) => run(name, 'readwrite', (s) => s.put(rec)),
  get: (name, key) => run(name, 'readonly', (s) => s.get(key)),
  all: (name) => run(name, 'readonly', (s) => s.getAll()),
  remove: (name, key) => run(name, 'readwrite', (s) => s.delete(key)),
  clear: (name) => run(name, 'readwrite', (s) => s.clear()),
};

// The analyzers set up on THIS computer (Machine Setup). Reagent Changes,
// Equipment Maintenance and their sidebar counts show only these — not every
// analyzer the facility owns.
const norm = (s) => String(s ?? '').trim().toLowerCase();

export async function loadLocalMachines() {
  const configs = await window.electronAPI.getConfig().catch(() => []);
  const names = new Set();
  (Array.isArray(configs) ? configs : []).forEach((c) => {
    if (c.unique_id) names.add(norm(c.unique_id));
    if (c.analyzer_name) names.add(norm(c.analyzer_name));
  });
  return { names, count: (Array.isArray(configs) ? configs : []).length };
}

export const isLocalMachine = (local, name) => local.names.has(norm(name));

// Relève — stockage local (IndexedDB de l'extension). Rien ne quitte le poste.
'use strict';
const ACDB = (() => {
  const NAME = 'avis-collector', VERSION = 1;
  const STORES = { avis: 'id', pdfs: 'id', dossiers: 'siren', dettes: 'siren', tasks: 'id', meta: 'key', runs: 'at' };
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => { const db = r.result; for (const [n, k] of Object.entries(STORES)) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: k }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = async (name, mode = 'readonly') => (await open()).transaction(name, mode).objectStore(name);
  const api = {
    get: async (s, k) => req((await store(s)).get(k)),
    put: async (s, v) => req((await store(s, 'readwrite')).put(v)),
    del: async (s, k) => req((await store(s, 'readwrite')).delete(k)),
    all: async (s) => req((await store(s)).getAll()),
    keys: async (s) => req((await store(s)).getAllKeys()),
    clear: async (s) => req((await store(s, 'readwrite')).clear()),
    count: async (s) => req((await store(s)).count()),
    async settings() {
      const s = (await api.get('meta', 'settings')) || {};
      return { key: 'settings', seuilPct: 10, seuilEur: 100, seuilDette: 5, amr: true, signature: '', moi: '', correspondance: {}, portefeuille: [], delai: 60, ...s };
    },
    async saveSettings(patch) { const s = await api.settings(); const n = { ...s, ...patch, key: 'settings' }; await api.put('meta', n); return n; },
    async loadAll() {
      const [avis, dossiers, dettes, tasks, settings, runs, ca, cnotes] = await Promise.all([api.all('avis'), api.all('dossiers'), api.all('dettes'), api.all('tasks'), api.settings(), api.all('runs'), api.get('meta', 'ca'), api.get('meta', 'cnotes')]);
      return { avis, dossiers, dettes, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), settings, runs: runs.sort((a, b) => b.at - a.at), ca: (ca && ca.data) || {}, cnotes: (cnotes && cnotes.data) || {} };
    },
    async pdfBlob(id, suite) { const p = await api.get('pdfs', id); if (!p) return null; return suite ? p.suite || null : p.blob || null; },
  };
  return api;
})();
if (typeof self !== 'undefined') self.ACDB = ACDB;

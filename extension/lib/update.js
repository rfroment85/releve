// Relève — vérifie s'il existe une version plus récente sur le site (une fois toutes les 6 h). Aucune donnée envoyée.
'use strict';
const ACUP = (() => {
  const URL_V = 'https://releveavis.netlify.app/version.json';
  const GUIDE = 'https://releveavis.netlify.app/mode-emploi.html#mise-a-jour';
  const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  async function check(force) {
    const cur = chrome.runtime.getManifest().version;
    let c = null;
    try { c = (await chrome.storage.local.get('upd')).upd || null; } catch {}
    if (force || !c || Date.now() - c.at > 6 * 3600e3) {
      try {
        const r = await fetch(URL_V + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
        if (r.ok) { c = { at: Date.now(), data: await r.json() }; chrome.storage.local.set({ upd: c }).catch(() => {}); }
      } catch {}
    }
    const d = c && c.data;
    if (!d || !d.version || cmp(d.version, cur) <= 0) return { available: false, current: cur };
    return { available: true, current: cur, version: d.version, notes: d.notes || '', zip: d.zip || 'https://releveavis.netlify.app/Releve.zip', guide: GUIDE };
  }
  return { check, cmp };
})();
if (typeof self !== 'undefined') self.ACUP = ACUP;

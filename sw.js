// Offline play (service worker). Same-origin GETs are served cache-first and cached as they load; the page shell
// (navigations) and version.json are network-first so updates arrive whenever the player is online. On install, a
// production build precaches every file listed in version.json, so the first visit is enough to play offline. When
// version.json reports a new build, the old cache is dropped and the new file list precached.
const RUNTIME = 'ode-runtime', META = 'ode-meta';

async function manifest() { const r = await fetch('version.json', { cache: 'no-store' }); if (!r.ok) throw new Error('no version.json'); return r.json(); }
async function precache(v) {
  const files = Object.keys(v.files || {}); if (!files.length) return 0;
  const c = await caches.open(RUNTIME); await c.addAll(['./', ...files]); return files.length;
}
async function refresh() { // compare the deployed build with the one we cached for
  try {
    const v = await manifest(), meta = await caches.open(META), seen = await (await meta.match('build'))?.json(), id = `${v.version}+${v.commit}`;
    if (seen?.id === id) return; await caches.delete(RUNTIME); await precache(v); await meta.put('build', new Response(JSON.stringify({ id })));
  } catch { /* offline or no manifest: keep what we have */ }
}
self.addEventListener('install', e => { e.waitUntil(refresh().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('/version.json');
  e.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    if (networkFirst) {
      try { const r = await fetch(req, { cache: 'no-store' }); if (r.ok) { cache.put(req, r.clone()); if (req.mode === 'navigate') e.waitUntil(refresh()); } return r; }
      catch { return (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (await cache.match('./')) || Response.error(); }
    }
    const hit = await cache.match(req); if (hit) return hit;
    const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r;
  })());
});

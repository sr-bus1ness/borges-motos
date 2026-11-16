// Permite abrir o sistema sem internet. Arquivos do próprio site: tenta a rede
// primeiro (pega atualizações) e usa a cópia guardada se estiver offline.
const CACHE = 'borges-v2';
const BASE = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/config.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const guardar = (req, res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    e.respondWith(
      // no-cache: sempre confere com o servidor, para nunca usar arquivo velho
      fetch(req, { cache: 'no-cache' }).then((r) => (r.ok ? guardar(req, r) : r))
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
  } else if (u.hostname === 'www.gstatic.com' || u.hostname === 'cdnjs.cloudflare.com') {
    // bibliotecas com versão fixa: cache primeiro
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => guardar(req, res))));
  }
});

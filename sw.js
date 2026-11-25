// Service Worker: アプリ本体をキャッシュしてオフラインでも起動できるようにする
// index.html などを更新したら VERSION を上げると、古いキャッシュが消えて確実に入れ替わる
const VERSION = 'v2';
const CACHE = 'reader-' + VERSION;
const CORE = ['./', 'index.html', 'manifest.json', 'icon.png', 'pdf.min.js', 'pdf.worker.min.js'];
// CDN（pdf.jsのcMap・予備のpdf.js）は専用キャッシュに保存。VERSIONを上げても消えない
const CDN_CACHE = 'cdn-assets-v1';
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const INDEX_URL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ欠けても全体が失敗しないよう個別に追加する
    await Promise.allSettled(CORE.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('reader-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey, timeoutMs) {
  const cache = await caches.open(CACHE);
  try {
    const net = fetch(request, { cache: 'no-cache' });
    const res = await Promise.race([
      net,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    if (res && res.ok) cache.put(cacheKey || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey || request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName = CACHE) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN（pdf.jsの予備読み込み・cMap・標準フォント）は一度取れたら使い回す
  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // ページ本体: ネット優先（更新が早く反映）、オフラインならキャッシュ
  if (req.mode === 'navigate') {
    e.respondWith(
      networkFirst(INDEX_URL, INDEX_URL, 3500).catch(() => caches.match(INDEX_URL).then((r) => r || caches.match('./')))
    );
    return;
  }

  // 重いpdf.js本体はキャッシュ優先
  if (/\/pdf(\.worker)?\.min\.js$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  e.respondWith(networkFirst(req, null, 3500));
});

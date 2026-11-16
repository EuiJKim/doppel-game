// 가계부 서비스 워커 — 인터넷이 없어도 앱이 열리게 파일을 보관한다.
// 온라인이면 항상 새 파일을 받아 오고(받는 김에 보관본도 갱신), 느리거나 끊기면 보관본으로 연다.
// 받아 올 때는 브라우저의 임시 보관(HTTP 캐시, GitHub Pages 는 10분)을 건너뛰고 서버에 새 버전을 확인한다
// — 그러지 않으면 배포 후 최대 10분 동안 예전 화면이 보인다.
const CACHE = 'ledger-v3';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'store.js',
  'logic.js',
  'sync.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];
const TIMEOUT_MS = 2500;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req.url, { cache: 'no-cache' }).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (!cached) return fresh;
      fresh.catch(() => {}); // 실패해도 보관본이 있으니 조용히 넘어간다
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), TIMEOUT_MS));
      return Promise.race([fresh.catch(() => cached), timeout]);
    })(),
  );
});

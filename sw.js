// © 2026 Siska, Fasilkom. Seluruh hak dilindungi. Dilarang menyalin atau memakai ulang tanpa izin tertulis.
// ============================================================
// SERVICE WORKER RUANG AJAR — membuat aplikasi terbuka hampir seketika
// ------------------------------------------------------------
// • Kerangka aplikasi (HTML/CSS/JS/ikon) disimpan di perangkat → pembukaan berikutnya tanpa mengunduh ulang.
// • Pustaka CDN (Bootstrap, ikon, font) juga disimpan.
// • Data (Apps Script) TIDAK PERNAH disimpan di sini — selalu langsung ke server.
// ⚠️ SETIAP KALI Anda mengubah index.html / css / js:
//     1) naikkan VERSION di bawah (mis. 2.1.0 → 2.1.1), dan
//     2) naikkan angka ?v= pada index.html (harus sama dengan VERSION).
//    Pengguna akan melihat tombol "Muat ulang" saat versi baru siap.
// ============================================================
const VERSION = '2.1.2';
const SHELL = 'ra-shell-' + VERSION;
const RUNTIME = 'ra-cdn-v1';
const SHELL_FILES = ['./', 'index.html', 'css/style.css?v=' + VERSION, 'js/config.js?v=' + VERSION, 'js/api.js?v=' + VERSION, 'js/app.js?v=' + VERSION, 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('ra-shell-') === 0 && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return;      // API: selalu langsung ke jaringan
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req)); return; }
    e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  if (/(^|\.)(jsdelivr\.net|cdnjs\.cloudflare\.com|googleapis\.com|gstatic\.com)$/.test(url.hostname)) e.respondWith(staleWhileRevalidate(req, RUNTIME));
});

/** Halaman utama: ambil dari jaringan (agar versi baru langsung terpakai); bila lambat (>2,5 dtk) atau offline, pakai simpanan. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('lambat')), 2500))]);
    if (res && res.ok) cache.put('index.html', res.clone());
    return res;
  } catch (err) {
    return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
  }
}

/** Aset: tampilkan simpanan SEKETIKA, sambil memperbarui simpanan di latar belakang. */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName), hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

// © 2026 Siska, Fasilkom. Seluruh hak dilindungi. Dilarang menyalin atau memakai ulang tanpa izin tertulis.
// ============================================
// KOMUNIKASI KE SERVER (Google Apps Script) — dioptimalkan untuk kecepatan
// ============================================
// Bolak-balik jaringan ke Apps Script adalah bagian paling lambat (0,5–3 detik). Karena itu:
//  1. PENYATUAN OTOMATIS — beberapa pembacaan yang diminta hampir bersamaan dikirim sebagai SATU permintaan "batch".
//  2. DEDUPLIKASI — pembacaan identik yang sedang berjalan memakai hasil yang sama (tidak dikirim dua kali).
//  3. PRIORITAS — pengambilan data latar belakang (prefetch) tidak pernah menghambat permintaan yang ditunggu pengguna.
//  4. PEMANASAN — server dibangunkan sejak halaman dibuka, agar "cold start" tidak terasa saat login.
// ⚠️ Content-Type WAJIB text/plain — "application/json" memicu CORS preflight (OPTIONS) yang tidak didukung Apps Script.

const API_TIMEOUT_MS = 90000;      // GAS kadang lambat saat "cold start"; beri waktu lega
const BATCH_WINDOW_MS = 12;        // panggilan yang datang dalam jendela ini digabung
const LOW_DELAY_MS = 180;          // prefetch menunggu sebentar agar permintaan utama lebih dulu
const MAX_BATCH_SIZE = 12;         // harus ≤ MAX_BATCH di server (16)
const MAX_BATCH_BYTES = 200000;    // permintaan besar (unggahan berkas) tidak digabung

/** Hanya aksi BACA yang digabung/dideduplikasi. Aksi tulis & waktu-nyata (ujian, sesi live) selalu dikirim sendiri-sendiri. */
const BATCHABLE = /^(app\.config|auth\.me|notif\.list|dash\.(dosen|mahasiswa)|class\.(list|detail|members)|meeting\.list|assignment\.(listClass|get|mine)|grading\.list|group\.list|att\.(overview|mine|recap)|grade\.(summary|mine|rincian)|ann\.list|lecturer\.list|live\.(list|active)|award\.(mine|list|defaults))$/;

let _batchOK = true;               // false bila server lama belum mengenal 'batch' → kirim satu-satu
let _qHigh = [], _qLow = [], _tHigh = null, _tLow = null, _active = 0;
const _inflight = new Map(), _inflightItem = new Map();

function _ctype() { return { 'Content-Type': 'text/plain;charset=utf-8' }; }

/** Satu permintaan HTTP ke Apps Script → JSON. */
async function _post(body, timeoutMs) {
  if (typeof GAS_URL !== 'string' || GAS_URL.indexOf('script.google.com') === -1) {
    throw new Error('Alamat server belum diisi. Buka js/config.js lalu isi GAS_URL dengan URL /exec dari Apps Script.');
  }
  const ctrl = new AbortController(), ms = timeoutMs || API_TIMEOUT_MS, timer = setTimeout(() => ctrl.abort(), ms);
  _active++;
  try {
    const res = await fetch(GAS_URL, { method: 'POST', headers: _ctype(), body: body, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('Server menjawab HTTP ' + res.status + '.');
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('Balasan server bukan JSON. Pastikan deployment Apps Script: Execute as "Me", akses "Anyone", dan sudah memakai VERSI TERBARU.'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Server tidak menjawab dalam ' + Math.round(ms / 1000) + ' detik. Coba lagi.');
    if (e instanceof TypeError) throw new Error('Tidak dapat menghubungi server. Periksa koneksi internet, dan pastikan GAS_URL di js/config.js benar.');
    throw e;
  } finally { clearTimeout(timer); _active--; }
}

/** Kirim satu kelompok panggilan (token sama). */
async function _sendGroup(items) {
  const single = it => _post(JSON.stringify({ action: it.action, token: it.token || '', payload: it.payload }), it.timeoutMs).then(it.resolve, it.reject);
  if (items.length === 1 || !_batchOK) return Promise.all(items.map(single));
  try {
    const res = await _post(JSON.stringify({ action: 'batch', token: items[0].token || '', calls: items.map(it => ({ action: it.action, payload: it.payload })) }),
      Math.max.apply(null, items.map(it => it.timeoutMs || 0)) || undefined);
    if (res && res.success && Array.isArray(res.data) && res.data.length === items.length) { items.forEach((it, i) => it.resolve(res.data[i])); return; }
    // server lama (belum ada 'batch'): matikan penyatuan, kirim satu-satu agar tidak ada yang gagal
    if (res && !res.success && /tidak dikenal/i.test(res.message || '')) { _batchOK = false; return Promise.all(items.map(single)); }
    items.forEach(it => it.reject(new Error((res && res.message) || 'Balasan batch tidak valid.')));
  } catch (e) { items.forEach(it => it.reject(e)); }
}

function _flush(queue) {
  const items = queue.splice(0, queue.length);
  if (!items.length) return;
  const groups = {};
  items.forEach(it => { (groups[it.token || ''] = groups[it.token || ''] || []).push(it); });
  Object.keys(groups).forEach(t => {
    const g = groups[t];
    for (let i = 0; i < g.length; i += MAX_BATCH_SIZE) _sendGroup(g.slice(i, i + MAX_BATCH_SIZE));
  });
}
function _flushHigh() { _tHigh = null; _flush(_qHigh); }
function _flushLow() {
  _tLow = null;
  if (_active > 0 || _qHigh.length) { _tLow = setTimeout(_flushLow, 120); return; }    // tunggu sampai permintaan utama selesai
  _flush(_qLow);
}

/**
 * Panggil satu aksi di server. Pembacaan dikumpulkan ±12 ms lalu dikirim sekaligus.
 * payload._pf = true menandai pengambilan latar belakang (prioritas rendah).
 * @returns {Promise<{success:boolean,data:any,message:string,code?:string}>}
 */
/** Kunci deduplikasi: penanda _pf diabaikan (prefetch & permintaan biasa untuk data yang sama = satu permintaan), kecuali class.detail (punya efek "dosen membuka kelas"). */
function _dedupeKey(action, token, payload) {
  if (!BATCHABLE.test(action)) return null;
  let p = payload;
  if (action !== 'class.detail' && payload._pf) { p = Object.assign({}, payload); delete p._pf; }
  return action + '|' + (token || '') + '|' + JSON.stringify(p);
}
/** Pengguna kini menunggu data yang sedang diambil diam-diam → naikkan prioritasnya agar tidak ikut menunggu antrean latar belakang. */
function _promote(key) {
  const it = _inflightItem.get(key); if (!it) return;
  const i = _qLow.indexOf(it);
  if (i > -1) { _qLow.splice(i, 1); _qHigh.push(it); if (!_tHigh) _tHigh = setTimeout(_flushHigh, BATCH_WINDOW_MS); }
}

/**
 * Panggil satu aksi di server. Pembacaan dikumpulkan ±12 ms lalu dikirim sekaligus.
 * payload._pf = true menandai pengambilan latar belakang (prioritas rendah).
 * @returns {Promise<{success:boolean,data:any,message:string,code?:string}>}
 */
function callServer(action, token, payload, timeoutMs) {
  payload = payload || {};
  const batchable = _batchOK && BATCHABLE.test(action), low = !!payload._pf, key = _dedupeKey(action, token, payload);
  if (key && _inflight.has(key)) { if (!low) _promote(key); return _inflight.get(key); }
  let item = null;
  const p = new Promise((resolve, reject) => {
    const it = { action: action, token: token || '', payload: payload, resolve: resolve, reject: reject, timeoutMs: timeoutMs };
    if (!batchable || JSON.stringify(payload).length > MAX_BATCH_BYTES) {       // aksi tulis/besar → langsung, sendiri
      _post(JSON.stringify({ action: action, token: token || '', payload: payload }), timeoutMs).then(resolve, reject); return;
    }
    item = it;
    if (low) { _qLow.push(it); if (!_tLow) _tLow = setTimeout(_flushLow, LOW_DELAY_MS); }
    else { _qHigh.push(it); if (!_tHigh) _tHigh = setTimeout(_flushHigh, BATCH_WINDOW_MS); }
  });
  if (key) {
    _inflight.set(key, p); if (item) _inflightItem.set(key, item);
    const done = () => { if (_inflight.get(key) === p) { _inflight.delete(key); _inflightItem.delete(key); } };
    p.then(done, done);
  }
  return p;
}
/** Bangunkan server (hindari cold start). Tanpa menunggu hasil. */
function warmServer() {
  try { if (typeof GAS_URL === 'string' && GAS_URL.indexOf('script.google.com') > -1) fetch(GAS_URL + '?action=ping', { mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(() => { }); } catch (e) { /* abaikan */ }
}
warmServer();                                              // sejak halaman dibuka — saat pengguna mengetik, server sudah bangun
let _hiddenAt = 0;
document.addEventListener('visibilitychange', () => {      // kembali ke tab setelah lama → bangunkan lagi
  if (document.hidden) _hiddenAt = Date.now(); else if (_hiddenAt && Date.now() - _hiddenAt > 180000) { warmServer(); _hiddenAt = 0; }
});

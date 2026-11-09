// © 2026 Siska, Fasilkom. Seluruh hak dilindungi. Dilarang menyalin atau memakai ulang tanpa izin tertulis.
/**
 * ============================================================
 * RUANG AJAR — Frontend (app.js)
 * - Frontend statis (GitHub Pages) + backend Google Apps Script (REST API)
 * - Satu halaman (SPA): semua navigasi via navigateTo()
 * - Token sesi di memori + localStorage, TIDAK PERNAH di URL
 * - Transport ke server: callServer() di js/api.js (fetch → GAS_URL)
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// BAGIAN 1: STATE & UTILITAS
// ════════════════════════════════════════════════════════

const AppState = {
  token: null,
  user: null,
  config: { appName: 'Ruang Ajar', prodi: [] },
  page: null,
  params: {},
  history: [],
  cleanups: [],     // fungsi pembersih (kamera, timer) saat pindah halaman
  charts: {},
  navSeq: 0,        // nomor urut navigasi (abaikan respons lama setelah pindah halaman)
  tabSeq: 0,        // nomor urut tab kelas
  formDirty: false, // pengguna sedang mengisi form → jangan timpa tampilan
  syncing: 0,       // jumlah pembaruan data di latar belakang
  classCache: {},   // detail kelas terakhir per class_id
  sessionTitles: {} // judul layar proyektor per session_id
};

const KOMP_FALLBACK = { absensi: 'Aktivitas Partisipatif', proyek: 'Hasil Proyek', tugas: 'Tugas', uts: 'Ujian Tengah Semester', uas: 'Ujian Akhir Semester' };
function kompLabel(key) {
  const d = AppState.classCache && AppState.classCache[AppState.params.class_id];
  const w = d && d.weights && d.weights.find(x => x.komponen === key);
  if (w) return w.label;
  const c = (AppState.config.components || []).find(x => x.key === key);
  return c ? c.label : (KOMP_FALLBACK[key] || key || '-');
}
const LECT_LABEL = { hadir: 'Hadir (luring)', daring: 'Hadir (daring)', digantikan: 'Digantikan', tidak_hadir: 'Tidak hadir' };
const ROLE_LABEL = { superadmin: 'Super Admin', dosen: 'Dosen', mahasiswa: 'Mahasiswa' };
const PERM_LABEL = { materi: 'Unggah materi', tugas: 'Buat tugas & rubrik', nilai: 'Isi nilai', absensi: 'Kelola absensi' };
const TIPE_JAWABAN = { teks: 'Teks / esai', pilihan_ganda: 'Pilihan ganda', file: 'Unggah file', campuran: 'Campuran' };
const ATT_LABEL = { hadir: 'Hadir', terlambat: 'Terlambat', izin: 'Izin', sakit: 'Sakit', alpa: 'Alpa' };
const LS = {
  get(k) { try { return localStorage.getItem('ruangajar_' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('ruangajar_' + k, v); } catch (e) { /* mode privat */ } },
  del(k) { try { localStorage.removeItem('ruangajar_' + k); } catch (e) { /* abaikan */ } }
};

/** Escape HTML — semua teks dari pengguna WAJIB lewat fungsi ini. */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const container = () => document.getElementById('app-container');

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function parseDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v); return isNaN(d) ? null : d;
}
function fmtDate(v) { const d = parseDate(v); return d ? `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}` : '-'; }
function fmtTime(v) { const d = parseDate(v); return d ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtDateTime(v) { const d = parseDate(v); return d ? `${fmtDate(v)}, ${fmtTime(v)}` : '-'; }
function isToday(v) { const d = parseDate(v); const n = new Date(); return d && d.toDateString() === n.toDateString(); }
function relDeadline(v) {
  const d = parseDate(v); if (!d) return { text: 'Tanpa tenggat', cls: 'b-muted' };
  const diff = d - Date.now(), h = diff / 36e5;
  if (diff < 0) return { text: 'Lewat ' + fmtDate(v), cls: 'b-bad' };
  if (h < 24) return { text: 'Hari ini ' + fmtTime(v), cls: 'b-warn' };
  if (h < 48) return { text: 'Besok ' + fmtTime(v), cls: 'b-warn' };
  return { text: fmtDateTime(v), cls: 'b-muted' };
}
/** Nilai <input type="datetime-local"> dari ISO */
function toLocalInput(iso) {
  const d = parseDate(iso); if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function initials(name) { const w = String(name || '').split(/\s+/).filter(x => /^[A-Za-zÀ-ÿ]/.test(x)); return (w.slice(0, 2).map(s => s[0]).join('') || '?').toUpperCase(); }
function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtBytes(n) { if (!n && n !== 0) return '-'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
function isStaffRole() { return AppState.user && (AppState.user.role === 'dosen' || AppState.user.role === 'superadmin'); }
function prefersReducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

// ════════════════════════════════════════════════════════
// BAGIAN 2: PEMANGGIL SERVER (fetch ke Google Apps Script → Promise)
// ════════════════════════════════════════════════════════

/**
 * Panggil satu aksi di server (lihat callServer() di js/api.js).
 * opts.retries: ulangi otomatis bila gagal jaringan/kuota (dengan jeda acak).
 */
async function api(action, payload = {}, opts = {}) {
  const retries = opts.retries || 0;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await callServer(action, AppState.token, payload, opts.timeout);
    } catch (err) {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 500 + Math.random() * 1500 * (attempt + 1))); continue; }
      throw new Error(err && err.message ? err.message : 'Koneksi ke server gagal.');
    }
    if (!res) throw new Error('Respons server kosong.');
    if (res.code === 'AUTH') { handleSessionExpired(res.message); throw new Error(res.message); }
    if (res.success) {
      if (!READ_ONLY_ACTIONS.test(action)) SWR.clear(); // data berubah → cache lama tidak dipakai
      return res.data;
    }
    throw new Error(res.message || 'Terjadi kesalahan.');
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 2b: CACHE "TAMPIL DULU, PERBARUI DI LATAR" (stale-while-revalidate)
// Halaman langsung tampil dari data terakhir; data terbaru diambil diam-diam.
// ════════════════════════════════════════════════════════

const READ_ONLY_ACTIONS = /^(app\.config|auth\.me|notif\.(list|read)|file\.get|att\.(qr|scan|recap)|report\.|dash\.|exam\.(state|answer|event|next)|live\.(state|active|list|report)|award\.(defaults|candidates|get|list|mine))|\.(list|listClass|detail|members|get|mine|overview|meeting|active|summary|rincian|codes|dosen|dosenKelas|storage|suggest|open|progress|ping)$/;

const SWR = {
  mem: {}, owner: null,
  init(uid) {
    this.owner = uid; this.mem = {};
    try { const raw = LS.get('swr_' + uid); if (raw) this.mem = JSON.parse(raw) || {}; } catch (e) { this.mem = {}; }
  },
  key(a, p) { return a + '|' + JSON.stringify(p || {}); },
  get(k) { return this.mem[k] || null; },
  set(k, v) { this.mem[k] = { v: v, t: Date.now() }; this.persist(); },
  clear() { this.mem = {}; this.persist(); },
  persist: debounce(() => {
    if (!SWR.owner) return;
    try {
      const out = {}; let size = 0;
      Object.entries(SWR.mem).sort((a, b) => b[1].t - a[1].t).slice(0, 40).forEach(([k, v]) => {
        const str = JSON.stringify(v); if (size + str.length > 1500000) return; size += str.length; out[k] = v;
      });
      LS.set('swr_' + SWR.owner, JSON.stringify(out));
    } catch (e) { /* penyimpanan penuh → abaikan */ }
  }, 800)
};

function setSync(delta) {
  AppState.syncing = Math.max(0, AppState.syncing + delta);
  const b = document.getElementById('refreshBtn');
  if (b) { b.classList.toggle('syncing', AppState.syncing > 0); b.setAttribute('aria-busy', AppState.syncing > 0); }
}

/**
 * Ambil data dengan cache: render(data, dariCache) dipanggil segera bila ada cache,
 * lalu sekali lagi bila data server berbeda. opts.empty() dipanggil bila belum ada cache.
 * opts.scope 'tab' → dibatalkan saat pindah tab; default 'page' → dibatalkan saat pindah halaman.
 */
async function swr(action, payload, render, opts = {}) {
  const k = SWR.key(action, payload), hit = SWR.get(k);
  const seqName = opts.scope === 'tab' ? 'tabSeq' : 'navSeq', seq = AppState[seqName];
  if (hit) render(hit.v, true); else if (opts.empty) opts.empty();
  if (hit && Date.now() - hit.t < 5000) return hit.v; // baru saja diambil → tidak perlu ke server lagi
  setSync(1);
  try {
    const fresh = await api(action, payload);
    const same = hit && JSON.stringify(hit.v) === JSON.stringify(fresh);
    SWR.set(k, fresh);
    if (!same && seq === AppState[seqName] && (!hit || !AppState.formDirty)) render(fresh, false);
    return fresh;
  } catch (e) {
    if (!hit) throw e;
    if (seq === AppState[seqName]) toast('Belum bisa memperbarui', 'Menampilkan data terakhir. ' + e.message, 'warning');
    return hit.v;
  } finally { setSync(-1); }
}

/** Boleh mengambil data di latar belakang? (tab aktif, online, bukan mode hemat data) */
function canPrefetch() {
  return !!AppState.token && !document.hidden && navigator.onLine !== false && !(navigator.connection && navigator.connection.saveData);
}
/**
 * Isi cache di latar belakang agar halaman berikutnya langsung tampil (0 ms).
 * Bertanda _pf → prioritas rendah di server & klien, dan tidak dihitung sebagai aktivitas dosen.
 * Kunci cache memakai payload BERSIH (tanpa _pf) agar sama dengan yang dipakai halaman.
 */
function prefetch(action, payload) {
  const k = SWR.key(action, payload);
  if (SWR.get(k) || !canPrefetch()) return;
  api(action, Object.assign({}, payload || {}, { _pf: true })).then(v => SWR.set(k, v)).catch(() => { });
}
/** Data yang hampir pasti dibuka berikutnya, per halaman. Payload HARUS sama dengan yang dipakai halamannya (= kunci cache). */
function prefetchPlan(page, params) {
  const mhs = AppState.user && AppState.user.role === 'mahasiswa';
  if (page === 'dashboard') return mhs ? [['class.list', {}], ['assignment.mine', {}], ['grade.mine', {}]] : [['class.list', {}]];
  if (page === 'kelas') return [['class.list', {}]];
  if (page === 'tugas-saya') return [['assignment.mine', {}]];
  if (page === 'nilai-saya') return [['grade.mine', {}]];
  if (page === 'kelas-detail' && params && params.class_id) return [['class.detail', { class_id: params.class_id, with_timeline: true }]];
  return [];
}
/** Setelah halaman kelas tampil: siapkan data tab-tab di latar belakang agar pindah tab tidak menunggu server. */
function prefetchClassTabs(d) {
  if (!d || !d.cls) return;
  const id = d.cls.class_id, a = d.access || {}, p = { class_id: id };
  const list = [['assignment.listClass', p], ['ann.list', p], ['group.list', p]];
  if (a.isOwner || a.isAssistant) { list.push(['class.members', p]); if (a.isOwner || (a.perms || []).indexOf('absensi') > -1) list.push(['att.overview', p]); }
  else { list.push(['att.mine', p], ['grade.mine', p]); }
  list.forEach(x => prefetch(x[0], x[1]));
}
/** Saat senggang setelah beranda tampil: daftar kelas, tugas, dan detail beberapa kelas teratas. */
function idlePrefetch() {
  const run = () => {
    prefetchPlan('dashboard').forEach(x => prefetch(x[0], x[1]));
    const cl = SWR.get(SWR.key('class.list', {}));
    if (cl && Array.isArray(cl.v)) cl.v.filter(c => c.status === 'aktif').slice(0, 4).forEach(c => prefetchClass(c.class_id));
  };
  (window.requestIdleCallback || (f => setTimeout(f, 500)))(run, { timeout: 2500 });
}
/** Niat membuka (sentuh/hover/fokus pada tautan navigasi) → ambil datanya sebelum diklik. */
function installIntentPrefetch() {
  const seen = {};
  const handler = e => {
    const el = e.target && e.target.closest ? e.target.closest('[onclick*="navigateTo("]') : null;
    if (!el) return;
    const m = /navigateTo\('([\w-]+)'\s*(?:,\s*(\{[^}]*\}))?/.exec(el.getAttribute('onclick') || '');
    if (!m) return;
    let params = {};
    if (m[2]) { try { params = JSON.parse(m[2].replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')); } catch (err) { return; } }
    const key = m[1] + JSON.stringify(params); if (seen[key] && Date.now() - seen[key] < 4000) return; seen[key] = Date.now();
    prefetchPlan(m[1], params).forEach(x => prefetch(x[0], x[1]));
  };
  ['pointerdown', 'touchstart', 'mouseover', 'focusin'].forEach(ev => document.addEventListener(ev, handler, { passive: true, capture: true }));
}
/** Simpan paket data awal dari respons login ke cache → beranda langsung terisi tanpa menunggu server lagi. */
function seedBoot(boot) {
  if (!boot) return;
  Object.keys(boot).forEach(a => {
    if (a === 'notif.list') { AppState.notif = boot[a]; updateNotifBadge(); }
    else SWR.set(SWR.key(a, {}), boot[a]);
  });
}

const _scripts = {};
const LIBS = {
  chart: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', 'Chart'],
  sortable: ['https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js', 'Sortable'],
  qrcode: ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode'],
  scanner: ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js', 'Html5Qrcode'],
  xlsx: ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX']
};
/** Muat library hanya saat dibutuhkan (lazy load) agar aplikasi terbuka lebih cepat. */
function loadLib(name) { const l = LIBS[name]; return window[l[1]] ? Promise.resolve() : loadScript(l[0]); }
/** Muat library di waktu senggang browser, supaya siap sebelum dibutuhkan. */
function preloadLibs(names) {
  const go = () => names.forEach(n => loadLib(n).catch(() => { }));
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}
/** Ambil data kelas lebih awal (saat kursor/jari menyentuh kartu kelas). */
function prefetchClass(id) { prefetch('class.detail', { class_id: id, with_timeline: true }); }
function loadScript(src) {
  if (!_scripts[src]) {
    _scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = src; el.onload = resolve;
      el.onerror = () => { delete _scripts[src]; reject(new Error('Library gagal dimuat. Periksa koneksi internet.')); };
      document.head.appendChild(el);
    });
  }
  return _scripts[src];
}
const XLSX_SRC = LIBS.xlsx[0];

function downloadBase64(base64, mime, name) {
  const url = b64ToBlobUrl(base64, mime);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Modal hasil laporan PDF: unduh langsung. Tidak disimpan di Drive dan tidak ada email dikirim; cetak ulang kapan saja. */
function showReportModal(r) {
  openModal({
    title: 'Laporan siap',
    body: `<div class="text-center py-2"><div class="result-badge" style="background:var(--accent-soft);color:var(--accent-strong)"><i class="bi bi-file-earmark-pdf"></i></div>
      <b>${esc(r.name)}</b><p class="small-ss text-secondary-ss mt-2 mb-0">Dibuat langsung dari data terbaru. Anda boleh mencetak ulang kapan saja.</p></div>`,
    footer: `<button class="btn btn-ink" id="dlReport"><i class="bi bi-download"></i> Unduh PDF</button>`
  });
  $('#dlReport').onclick = () => downloadBase64(r.base64, 'application/pdf', r.name);
}

function handleSessionExpired(msg) {
  if (!AppState.token) return;
  AppState.token = null; AppState.user = null; LS.del('token');
  document.body.classList.add('logged-out');
  toast('Sesi berakhir', msg || 'Silakan masuk kembali.', 'warning');
  navigateTo('login', {}, { noHistory: true, reset: true });
}

// ════════════════════════════════════════════════════════
// BAGIAN 3: KOMPONEN UI (toast, modal, konfirmasi, loading)
// ════════════════════════════════════════════════════════

function toast(title, message, type = 'info') {
  const icons = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-octagon-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const el = document.createElement('div');
  el.className = `toast-ss t-${type}`;
  el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  el.innerHTML = `<i class="bi ${icons[type] || icons.info}" aria-hidden="true"></i><div><div class="t-title">${esc(title)}</div>${message ? `<div>${esc(message)}</div>` : ''}</div>`;
  document.getElementById('toastStack').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, type === 'danger' ? 6000 : 3800);
}
const toastErr = e => toast('Gagal', e && e.message ? e.message : String(e), 'danger');

let _modal = null;
/** Buka modal umum. size: '', 'modal-lg', 'modal-xl'. Mengembalikan elemen body. */
function openModal({ title, body, footer = '', size = '', onShown = null, static: isStatic = false }) {
  const el = document.getElementById('appModal');
  const alreadyOpen = _modal && el.classList.contains('show');
  el.querySelector('.modal-dialog').className = `modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}`;
  document.getElementById('appModalTitle').textContent = title;
  document.getElementById('appModalBody').innerHTML = body;
  const f = document.getElementById('appModalFooter');
  f.innerHTML = footer; f.classList.toggle('d-none', !footer);
  if (alreadyOpen) { // modal sudah tampil → cukup ganti isi (hindari backdrop ganda)
    if (onShown) setTimeout(onShown, 0);
    return document.getElementById('appModalBody');
  }
  const start = () => {
    if (_modal) _modal.dispose();
    _modal = new bootstrap.Modal(el, isStatic ? { backdrop: 'static', keyboard: false } : {});
    if (onShown) el.addEventListener('shown.bs.modal', function h() { el.removeEventListener('shown.bs.modal', h); onShown(); });
    _modal.show();
  };
  // Dialog sebelumnya masih dalam animasi menutup → tunggu selesai dulu (isi sudah terpasang), agar tidak terjadi balapan
  if (_modal && !el.classList.contains('show') && el.style.display === 'block') {
    let started = false;
    const go = () => { if (started) return; started = true; el.removeEventListener('hidden.bs.modal', go); start(); };
    el.addEventListener('hidden.bs.modal', go);
    setTimeout(go, 700);
  } else start();
  return document.getElementById('appModalBody');
}
function closeModal() { if (_modal) _modal.hide(); }

function confirmDialog(message, { title = 'Konfirmasi', okText = 'Lanjutkan', danger = false } = {}) {
  return new Promise(resolve => {
    let decided = false;
    openModal({
      title,
      body: `<p class="mb-0">${esc(message)}</p>`,
      footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button>
               <button class="btn ${danger ? 'btn-danger-soft' : 'btn-ink'}" id="confirmOk">${esc(okText)}</button>`
    });
    $('#confirmOk').onclick = () => { decided = true; closeModal(); resolve(true); };
    document.getElementById('appModal').addEventListener('hidden.bs.modal', function h() {
      document.getElementById('appModal').removeEventListener('hidden.bs.modal', h);
      if (!decided) resolve(false);
    });
  });
}

/** Tampilkan spinner di tombol selama promise berjalan. */
async function withBtn(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="spinner-inline" aria-hidden="true"></span> ${esc(btn.dataset.loading || 'Memproses…')}`;
  try { return await fn(); } finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = html; } }
}

function skeleton(kind = 'page') {
  if (kind === 'list') return `<div class="d-grid gap-2">${'<div class="skeleton" style="height:68px"></div>'.repeat(4)}</div>`;
  return `<div class="page-head"><div class="skeleton" style="height:34px;width:240px"></div></div>
    <div class="row g-3 mb-3">${'<div class="col-6 col-lg-3"><div class="skeleton" style="height:132px;border-radius:22px"></div></div>'.repeat(4)}</div>
    <div class="row g-3"><div class="col-lg-8"><div class="skeleton" style="height:300px;border-radius:22px"></div></div>
    <div class="col-lg-4"><div class="skeleton" style="height:300px;border-radius:22px"></div></div></div>`;
}
function loadingBlock(text = 'Memuat data…') {
  return `<div class="d-grid gap-2 py-2" role="status" aria-live="polite"><span class="visually-hidden">${esc(text)}</span>${'<div class="skeleton" style="height:64px"></div>'.repeat(3)}</div>`;
}
function errorBlock(e, retryFn) {
  return `<div class="empty-state">${emptyArt('warn')}<h3>Data gagal dimuat</h3><p>${esc(e && e.message ? e.message : e)}</p>
    ${retryFn ? `<button class="btn btn-soft" onclick="${retryFn}"><i class="bi bi-arrow-clockwise"></i> Coba lagi</button>` : ''}</div>`;
}
function emptyState(title, text, actionHtml = '') {
  return `<div class="empty-state">${emptyArt()}<h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHtml}</div>`;
}
function emptyArt(kind) {
  const c = kind === 'warn' ? 'var(--warn)' : 'var(--accent)';
  return `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="18" y="26" width="84" height="58" rx="14" fill="var(--accent-soft)"/>
    <rect x="30" y="14" width="60" height="40" rx="10" fill="var(--surface)" stroke="var(--border-strong)"/>
    <circle cx="60" cy="34" r="9" fill="${c}" opacity=".85"/>
    <rect x="38" y="62" width="44" height="6" rx="3" fill="var(--border-strong)"/>
  </svg>`;
}
function badge(text, cls = 'b-muted', icon = '') { return `<span class="badge-ss ${cls}">${icon ? `<i class="bi ${icon}"></i>` : ''}${esc(text)}</span>`; }
function subStatusBadge(st) {
  const map = { 'Dinilai': 'b-ok', 'Dikirim': 'b-info', 'Dikirim Ulang': 'b-info', 'Perlu Revisi': 'b-warn', 'Draft': 'b-muted', 'Belum dikumpulkan': 'b-muted', 'Belum ada kelompok': 'b-warn' };
  return badge(st, map[st] || 'b-muted');
}
function attBadge(st) {
  const map = { hadir: 'b-ok', terlambat: 'b-warn', izin: 'b-info', sakit: 'b-info', alpa: 'b-bad' };
  return st ? badge(ATT_LABEL[st] || st, map[st] || 'b-muted') : badge('Belum', 'b-muted');
}

// ════════════════════════════════════════════════════════
// BAGIAN 4: SAMPUL ABSTRAK KELAS (SVG generatif, tanpa gambar eksternal)
// ════════════════════════════════════════════════════════

const COVER_PALETTES = [
  ['#C9C1FA', '#7C6FE0', '#5B8DEF'], ['#F8CBE6', '#B69CF2', '#7C6FE0'], ['#B8DAFF', '#6C8CF5', '#7C6FE0'],
  ['#BFEDE0', '#7CC4E6', '#7C6FE0'], ['#FFD9BF', '#F3A6C8', '#9D8CF0'], ['#DDD6FF', '#9384F0', '#4E46B8']
];
let _svgSeq = 0;
function seeded(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) { h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
/** Bentuk abstrak bergradien gaya "3D lembut" seperti referensi. Deterministik per kelas. */
function coverSVG(seed, colorIdx = 0) {
  const r = seeded(seed), pal = COVER_PALETTES[Math.abs(colorIdx) % COVER_PALETTES.length], id = 'cv' + (++_svgSeq);
  const cx = 160 + (r() - .5) * 40, cy = 100 + (r() - .5) * 20;
  const kind = Math.floor(r() * 3);
  const defs = `<defs>
    <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset=".55" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[2]}"/></linearGradient>
    <linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${pal[0]}" stop-opacity=".2"/></linearGradient>
    <radialGradient id="${id}c" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${pal[0]}"/><stop offset="1" stop-color="${pal[2]}"/></radialGradient>
  </defs>`;
  let art = '';
  if (kind === 0) { // bintang/kelopak terekstrusi
    const pts = 4 + Math.floor(r() * 3), R = 70 + r() * 10, rin = 30 + r() * 10, rot = r() * Math.PI;
    const poly = (dx, dy) => Array.from({ length: pts * 2 }, (_, i) => {
      const rad = i % 2 ? rin : R, a = rot + i * Math.PI / pts;
      return `${(cx + dx + Math.cos(a) * rad).toFixed(1)},${(cy + dy + Math.sin(a) * rad).toFixed(1)}`;
    }).join(' ');
    art = `<polygon points="${poly(10, 12)}" fill="${pal[2]}" opacity=".55" stroke-linejoin="round" stroke="${pal[2]}" stroke-width="10"/>
           <polygon points="${poly(0, 0)}" fill="url(#${id}a)" stroke-linejoin="round" stroke="url(#${id}a)" stroke-width="10"/>
           <polygon points="${poly(-6, -8)}" fill="url(#${id}b)" opacity=".45" transform="scale(.6) translate(${cx * .66} ${cy * .66})"/>`;
  } else if (kind === 1) { // cincin + bola
    art = `<ellipse cx="${cx + 8}" cy="${cy + 10}" rx="74" ry="52" fill="none" stroke="${pal[2]}" stroke-width="30" opacity=".45"/>
           <ellipse cx="${cx}" cy="${cy}" rx="74" ry="52" fill="none" stroke="url(#${id}a)" stroke-width="30"/>
           <circle cx="${cx + 52}" cy="${cy - 34}" r="${22 + r() * 8}" fill="url(#${id}c)"/>`;
  } else { // panah/kotak tumpuk
    const s = 54 + r() * 10, rot = -20 + r() * 40;
    art = `<g transform="rotate(${rot.toFixed(1)} ${cx} ${cy})">
             <rect x="${cx - s + 14}" y="${cy - s + 16}" width="${s * 2}" height="${s * 1.4}" rx="22" fill="${pal[2]}" opacity=".5"/>
             <rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 1.4}" rx="22" fill="url(#${id}a)"/>
             <rect x="${cx - s + 18}" y="${cy - s + 14}" width="${s * 1.1}" height="${s * .5}" rx="14" fill="url(#${id}b)" opacity=".7"/>
           </g><circle cx="${cx - 70}" cy="${cy + 52}" r="16" fill="url(#${id}c)"/>`;
  }
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${defs}
    <rect width="320" height="200" style="fill:var(--accent-softer)"/>${art}</svg>`;
}

// ════════════════════════════════════════════════════════
// BAGIAN 5: TEMA (mode gelap)
// ════════════════════════════════════════════════════════

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
  $$('.theme-icon').forEach(i => { i.className = `bi ${theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'} theme-icon`; });
}
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next); LS.set('theme', next);
  updateChartsTheme();
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ════════════════════════════════════════════════════════
// BAGIAN 6: NAVIGASI & ROUTER SPA
// ════════════════════════════════════════════════════════

const PAGE_TITLES = {
  login: 'Masuk', register: 'Daftar', forgot: 'Lupa kata sandi', 'ganti-sandi': 'Ganti kata sandi',
  dashboard: 'Beranda', kelas: 'Kelas', 'kelas-detail': 'Detail kelas', 'tugas-detail': 'Tugas', 'sesi-live': 'Sesi kelas', 'penghargaan-edit': 'Penghargaan', 'sertifikat-saya': 'Sertifikat saya',
  'tugas-saya': 'Tugas saya', 'nilai-saya': 'Nilai saya', aktivitas: 'Aktivitas', absen: 'Absen', profil: 'Profil', admin: 'Super Admin'
};
const PUBLIC_PAGES = ['login', 'register', 'forgot'];
const DETAIL_PAGES = ['kelas-detail', 'tugas-detail', 'aktivitas'];

function menuFor(user) {
  if (!user) return [];
  if (user.role === 'mahasiswa') {
    return [
      { id: 'dashboard', icon: 'bi-grid', label: 'Beranda' },
      { id: 'kelas', icon: 'bi-journal-bookmark', label: 'Kelas' },
      { id: 'absen', icon: 'bi-qr-code-scan', label: 'Absen', center: true },
      { id: 'tugas-saya', icon: 'bi-clipboard-check', label: 'Tugas' },
      { id: 'profil', icon: 'bi-person', label: 'Profil' }
    ];
  }
  const m = [
    { id: 'dashboard', icon: 'bi-grid', label: 'Dashboard' },
    { id: 'kelas', icon: 'bi-journal-bookmark', label: 'Kelas' }
  ];
  if (user.role === 'superadmin') m.push({ id: 'admin', icon: 'bi-shield-lock', label: 'Super Admin' });
  m.push({ id: 'profil', icon: 'bi-person', label: 'Profil' });
  return m;
}

function renderNavigation() {
  const menu = menuFor(AppState.user);
  $('#sidebar-nav').innerHTML = menu.map(m => `
    <li><button class="rail-btn" data-page="${m.id}" data-label="${esc(m.label)}" aria-label="${esc(m.label)}" onclick="navigateTo('${m.id}', {}, {reset:true})">
      <i class="bi ${m.icon}"></i></button></li>`).join('');
  $('#bottomNav').innerHTML = menu.map(m => m.center ? `
    <button class="bn-item bn-center" data-page="${m.id}" onclick="navigateTo('${m.id}', {}, {reset:true})" aria-label="${esc(m.label)}">
      <span class="bn-fab"><i class="bi ${m.icon}"></i></span></button>` : `
    <button class="bn-item" data-page="${m.id}" onclick="navigateTo('${m.id}', {}, {reset:true})">
      <i class="bi ${m.icon}"></i><span>${esc(m.label)}</span></button>`).join('');
  const u = AppState.user;
  $('#userName').textContent = u.nama_lengkap;
  $('#userSub').textContent = u.role === 'mahasiswa' ? (u.npm || 'Mahasiswa') : ROLE_LABEL[u.role];
  $('#userAvatar').textContent = initials(u.nama_lengkap);
}

function updateActiveNav(page) {
  const root = { 'kelas-detail': 'kelas', 'sesi-live': 'kelas', 'penghargaan-edit': 'kelas', 'sertifikat-saya': 'profil', aktivitas: 'kelas', 'nilai-saya': 'tugas-saya', 'tugas-detail': AppState.user && AppState.user.role === 'mahasiswa' ? 'tugas-saya' : 'kelas' }[page] || page;
  $$('[data-page]').forEach(el => {
    const on = el.dataset.page === root;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

function runCleanups() {
  AppState.cleanups.splice(0).forEach(fn => { try { fn(); } catch (e) { /* abaikan */ } });
  Object.values(AppState.charts).forEach(c => { try { c.destroy(); } catch (e) { /* abaikan */ } });
  AppState.charts = {};
}

/**
 * Satu-satunya cara berpindah halaman. URL tidak pernah berubah.
 * opts.noHistory: jangan simpan ke riwayat; opts.reset: kosongkan riwayat (menu utama).
 */
function navigateTo(page, params = {}, opts = {}) {
  if (!PAGES[page]) page = 'dashboard';
  if (!AppState.token && !PUBLIC_PAGES.includes(page)) page = 'login';
  if (AppState.user && AppState.user.wajib_ganti_password && page !== 'ganti-sandi') page = 'ganti-sandi';
  runCleanups();
  AppState.navSeq++; AppState.tabSeq++; AppState.formDirty = false;
  if (opts.reset) AppState.history = [];
  else if (AppState.page && !opts.noHistory && !PUBLIC_PAGES.includes(AppState.page)) AppState.history.push({ page: AppState.page, params: AppState.params });
  AppState.page = page; AppState.params = params;
  updateActiveNav(page);
  $('#pageTitle').textContent = PAGE_TITLES[page] || 'Ruang Ajar';
  document.title = (PAGE_TITLES[page] ? PAGE_TITLES[page] + ' — ' : '') + (AppState.config.appName || 'Ruang Ajar');
  $('#backBtn').classList.toggle('d-none', !(DETAIL_PAGES.includes(page) && AppState.history.length));
  closeNotif();
  const c = container();
  window.scrollTo({ top: 0 });
  Promise.resolve(PAGES[page](params, c)).catch(e => { c.innerHTML = errorBlock(e, `navigateTo('${page}', AppState.params, {noHistory:true})`); });
}
function goBack() {
  const prev = AppState.history.pop();
  if (prev) navigateTo(prev.page, prev.params, { noHistory: true });
  else navigateTo('dashboard', {}, { reset: true });
}
/** Muat ulang halaman aktif tanpa menambah riwayat. */
function refreshPage() { navigateTo(AppState.page, AppState.params, { noHistory: true }); }
/** Tombol ⟳: paksa ambil data terbaru dari server (abaikan cache). */
function forceRefresh() { Object.values(SWR.mem).forEach(e => { e.t = 0; }); refreshPage(); }

/** Jalankan tujuan klik dari dashboard: {list:'kunci'} membuka daftar rinci; {page,params} berpindah halaman. */
function runAction(a) {
  if (!a) return;
  if (a.list) openDashList(a.list); else if (a.page) navigateTo(a.page, a.params || {});
}
function actAttr(a) { return a ? `role="button" tabindex="0" onclick="runAction(${esc(JSON.stringify(a))})" onkeydown="if(event.key==='Enter')this.click()"` : ''; }

/** Daftar rinci di balik angka/insight dashboard; setiap baris menuju halaman asalnya. */
function openDashList(key) {
  const l = (AppState.dashLists || {})[key];
  if (!l) return;
  openModal({
    title: l.judul, size: 'modal-lg',
    body: l.items.length ? l.items.map(it => `<button class="list-row" onclick="closeModal();runAction(${esc(JSON.stringify(it.aksi))})">
        <div class="flex-grow-1 min-w-0"><div class="fw-600 text-truncate">${esc(it.judul)}</div><div class="small-ss text-secondary-ss text-truncate">${esc(it.sub)}</div></div>
        <span class="badge-ss b-muted">${esc(it.nilai)}</span><i class="bi bi-chevron-right text-muted-ss"></i></button>`).join('')
      : emptyState('Tidak ada data', 'Belum ada yang perlu ditampilkan.')
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 7: FILE (baca, kompres, pratinjau modal)
// ════════════════════════════════════════════════════════

const FILE_LIMITS = { pdf: 10, doc: 10, docx: 10, ppt: 10, pptx: 10, jpg: 10, jpeg: 10, png: 10, mp4: 30 };
const FILE_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.mp4';

/** Validasi & baca file sebagai base64. Melempar Error berbahasa Indonesia. */
function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Pilih file terlebih dahulu.'));
    const ext = file.name.split('.').pop().toLowerCase();
    if (!FILE_LIMITS[ext]) return reject(new Error('Format .' + ext + ' tidak didukung.'));
    if (file.size > FILE_LIMITS[ext] * 1024 * 1024) {
      return reject(new Error(`Ukuran maksimal ${FILE_LIMITS[ext]} MB.${ext === 'mp4' ? ' Untuk video besar, tempel link Drive/YouTube.' : ''}`));
    }
    const fr = new FileReader();
    fr.onload = () => resolve({ name: file.name, base64: String(fr.result).split(',')[1], size: file.size });
    fr.onerror = () => reject(new Error('File gagal dibaca.'));
    fr.readAsDataURL(file);
  });
}

/** Kompres gambar (dari video/img/canvas) ke JPEG ±200 KB. Mengembalikan base64 tanpa prefix. */
function compressToJpeg(source, maxW = 480, targetKB = 50, mirror = false) {
  const w0 = source.videoWidth || source.naturalWidth || source.width;
  const h0 = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxW / w0);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w0 * scale); cv.height = Math.round(h0 * scale);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);      // latar putih (PNG transparan tidak jadi hitam)
  if (mirror) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, 0, 0, cv.width, cv.height);
  let q = 0.8, data = cv.toDataURL('image/jpeg', q);
  // Turunkan kualitas dulu, lalu perkecil dimensi bila masih di atas target (±50 KB)
  for (let shrink = 0; shrink < 4 && data.length * 0.75 > targetKB * 1024; shrink++) {
    while (data.length * 0.75 > targetKB * 1024 && q > 0.4) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
    if (data.length * 0.75 <= targetKB * 1024) break;
    const w = Math.round(cv.width * 0.85), h = Math.round(cv.height * 0.85);
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    c2.getContext('2d').drawImage(cv, 0, 0, w, h);
    cv.width = w; cv.height = h; cv.getContext('2d').drawImage(c2, 0, 0); q = 0.7; data = cv.toDataURL('image/jpeg', q);
  }
  return data.split(',')[1];
}

/** Kecilkan gambar sebelum diunggah (hemat penyimpanan Drive): maks 1000 px, ±220 KB. File yang sudah kecil dikirim apa adanya. */
async function prepareImageForUpload(file) {
  if (file.size <= 150 * 1024) return readFileBase64(file);
  const img = await loadImageFile(file);
  try { return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', base64: compressToJpeg(img, 1000, 220, false) }; } finally { URL.revokeObjectURL(img.src); }
}

function b64ToBlobUrl(base64, mime) {
  const bin = atob(base64), len = bin.length, bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Pratinjau file di modal (gambar, video, PDF) + tombol Unduh. kind: materi|submission|selfie */
async function previewFile(kind, id, name) {
  const el = document.getElementById('previewModal');
  const body = document.getElementById('previewContent');
  const dl = document.getElementById('downloadBtn');
  document.getElementById('previewTitle').textContent = name || 'Pratinjau';
  body.innerHTML = loadingBlock('Mengambil file…');
  dl.classList.add('disabled');
  const modal = bootstrap.Modal.getOrCreateInstance(el);
  modal.show();
  try {
    const f = await api('file.get', { kind, id });
    document.getElementById('previewTitle').textContent = f.name || name || 'Pratinjau';
    const url = b64ToBlobUrl(f.base64, f.mime);
    dl.href = url; dl.setAttribute('download', f.name || name || 'file'); dl.classList.remove('disabled');
    if (f.mime.startsWith('image/')) body.innerHTML = `<img src="${url}" alt="${esc(f.name)}">`;
    else if (f.mime.startsWith('video/')) body.innerHTML = `<video src="${url}" controls playsinline></video>`;
    else if (f.mime === 'application/pdf') body.innerHTML = `<iframe src="${url}" title="${esc(f.name)}"></iframe>`;
    else body.innerHTML = `<div class="empty-state"><i class="bi bi-file-earmark-text" style="font-size:3rem;color:var(--accent)"></i>
      <h3 class="mt-2">${esc(f.name)}</h3><p>Pratinjau tidak tersedia untuk format ini. Gunakan tombol Unduh.</p></div>`;
    el.addEventListener('hidden.bs.modal', function h() { el.removeEventListener('hidden.bs.modal', h); URL.revokeObjectURL(url); body.innerHTML = ''; });
  } catch (e) {
    body.innerHTML = errorBlock(e);
  }
}

// ════════════════════════════════════════════════════════
// BAGIAN 8: GRAFIK (Chart.js)
// ════════════════════════════════════════════════════════

async function lineChart(canvasId, labels, values, opts = {}) {
  try { await loadLib('chart'); } catch (e) { return; }
  drawLineChart(canvasId, labels, values, opts);
}
function drawLineChart(canvasId, labels, values, { suffix = '%', max = 100 } = {}) {
  const el = document.getElementById(canvasId); if (!el) return;
  if (AppState.charts[canvasId]) AppState.charts[canvasId].destroy();
  const accent = cssVar('--accent'), text2 = cssVar('--text-2'), border = cssVar('--border');
  const g = el.getContext('2d').createLinearGradient(0, 0, 0, el.clientHeight || 260);
  g.addColorStop(0, accent + '55'); g.addColorStop(1, accent + '00');
  AppState.charts[canvasId] = new Chart(el, {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: accent, backgroundColor: g, fill: true, tension: .42, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: accent, pointBorderColor: '#fff', pointBorderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: prefersReducedMotion() ? false : { duration: 500 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#25252B', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 10, displayColors: false, callbacks: { label: c => c.parsed.y + suffix } }
      },
      scales: {
        y: { min: 0, max, ticks: { color: text2, callback: v => v + suffix, maxTicksLimit: 5 }, grid: { color: border }, border: { display: false } },
        x: { ticks: { color: text2 }, grid: { display: false }, border: { display: false } }
      }
    }
  });
}
function updateChartsTheme() {
  Object.values(AppState.charts).forEach(ch => {
    const t2 = cssVar('--text-2'), b = cssVar('--border');
    if (ch.options.scales) {
      Object.values(ch.options.scales).forEach(s => { if (s.ticks) s.ticks.color = t2; if (s.grid && s.grid.color) s.grid.color = b; });
    }
    ch.update('none');
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 9: AUTENTIKASI (masuk, daftar, lupa sandi, ganti sandi)
// ════════════════════════════════════════════════════════

function authLayout(inner) {
  return `<div class="auth-wrap">
    <aside class="auth-art">
      <div class="d-flex align-items-center gap-2"><div class="brand-mark"><i class="bi bi-mortarboard"></i></div>
        <b>${esc(AppState.config.appName || 'Ruang Ajar')}</b></div>
      <div class="mt-auto mb-5 position-relative" style="z-index:1">
        <h2>Materi, tugas, absensi, dan nilai kelas dalam satu ruang.</h2>
        <p class="mt-3">Absen cukup memindai QR yang tampil di layar kelas. Progres nilai terlihat sepanjang semester.</p>
      </div>
      <div class="art-svg">${coverSVG('auth-hero', 0)}</div>
    </aside>
    <section class="auth-panel"><div class="auth-box">${inner}</div></section>
  </div>`;
}

function renderLogin(params, c) {
  document.body.classList.add('logged-out');
  c.innerHTML = authLayout(`
    <div class="brand-mark d-lg-none"><i class="bi bi-mortarboard"></i></div>
    <h1>Masuk</h1>
    <p class="text-secondary-ss mb-4">Gunakan email atau NPM yang terdaftar.</p>
    <form id="loginForm" novalidate>
      <div class="mb-3">
        <label class="form-label" for="lgId">Email atau NPM</label>
        <input class="form-control" id="lgId" autocomplete="username" required>
      </div>
      <div class="mb-2">
        <label class="form-label" for="lgPw">Kata sandi</label>
        <div class="input-group">
          <input class="form-control" id="lgPw" type="password" autocomplete="current-password" required style="border-radius:12px 0 0 12px">
          <button class="btn btn-soft" type="button" onclick="togglePw('lgPw', this)" aria-label="Tampilkan kata sandi" style="border-radius:0 12px 12px 0;min-height:44px"><i class="bi bi-eye"></i></button>
        </div>
      </div>
      <div class="text-end mb-4"><a href="javascript:void(0)" onclick="navigateTo('forgot')" class="small-ss fw-600">Lupa kata sandi?</a></div>
      <button class="btn btn-ink w-100" type="submit" data-loading="Masuk…">Masuk</button>
    </form>
    <p class="text-center mt-4 mb-0 small-ss text-secondary-ss">Belum punya akun?
      <a href="javascript:void(0)" onclick="navigateTo('register')" class="fw-600">Daftar</a></p>`);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const identitas = $('#lgId').value.trim(), password = $('#lgPw').value;
    if (!identitas || !password) return toast('Lengkapi data', 'Isi email/NPM dan kata sandi.', 'warning');
    await withBtn(e.submitter || $('#loginForm button[type=submit]'), async () => {
      try { const res = await api('auth.login', { identitas, password }); onLoggedIn(res); }
      catch (err) { toastErr(err); }
    });
  };
}

function togglePw(id, btn) {
  const i = document.getElementById(id); const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  btn.innerHTML = `<i class="bi ${show ? 'bi-eye-slash' : 'bi-eye'}"></i>`;
}

async function renderRegister(params, c) {
  document.body.classList.add('logged-out');
  if (!(AppState.config.prodi || []).length && window.__cfgReady) {        // daftar prodi belum sampai (pembukaan pertama)
    const seq = AppState.navSeq; c.innerHTML = skeleton('list'); await window.__cfgReady; if (seq !== AppState.navSeq) return;
  }
  const peran = params.peran === 'dosen' ? 'dosen' : 'mahasiswa';
  const prodiOpts = (AppState.config.prodi || []).map(p => `<option>${esc(p.nama_prodi)}</option>`).join('');
  c.innerHTML = authLayout(`
    <div class="brand-mark d-lg-none"><i class="bi bi-mortarboard"></i></div>
    <h1>Buat akun</h1>
    <p class="text-secondary-ss mb-3">Pilih peran Anda.</p>
    <div class="seg" role="tablist">
      <button type="button" class="${peran === 'mahasiswa' ? 'active' : ''}" onclick="navigateTo('register',{peran:'mahasiswa'},{noHistory:true})">Mahasiswa</button>
      <button type="button" class="${peran === 'dosen' ? 'active' : ''}" onclick="navigateTo('register',{peran:'dosen'},{noHistory:true})">Dosen</button>
    </div>
    <form id="regForm" novalidate>
      ${peran === 'mahasiswa' ? `
        <div class="mb-3"><label class="form-label" for="rgKelas">Kode kelas</label>
          <input class="form-control text-uppercase text-center fw-600 tabular" id="rgKelas" required maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" style="letter-spacing:.25em;font-size:1.15rem" placeholder="ABC1234">
          <div class="form-text">Kode 7 karakter dari dosen pengampu. Setelah mendaftar, kamu otomatis masuk ke kelas itu. Sudah punya akun? <a href="javascript:void(0)" onclick="navigateTo('login')" class="fw-600">Masuk</a> lalu pilih "Gabung kelas".</div></div>` : ''}
      <div class="mb-3"><label class="form-label" for="rgNama">Nama lengkap</label><input class="form-control" id="rgNama" required maxlength="120" autocomplete="name"></div>
      ${peran === 'mahasiswa' ? `
        <div class="row g-2 mb-3">
          <div class="col-6"><label class="form-label" for="rgNpm">NPM</label><input class="form-control" id="rgNpm" required inputmode="numeric" maxlength="30"></div>
          <div class="col-6"><label class="form-label" for="rgProdi">Program studi</label>
            <select class="form-select" id="rgProdi" required><option value="">Pilih…</option>${prodiOpts}</select></div>
        </div>` : `
        <div class="mb-3"><label class="form-label" for="rgKode">Kode redeem dosen</label>
          <input class="form-control text-uppercase" id="rgKode" required placeholder="DSN-XXXX-XXXX" autocomplete="off">
          <div class="form-text">Minta kode ke Super Admin. Satu kode untuk satu akun.</div></div>`}
      <div class="mb-3"><label class="form-label" for="rgEmail">Email</label><input class="form-control" id="rgEmail" type="email" required autocomplete="email">
        <div class="form-text">Email kampus atau pribadi.</div></div>
      <div class="mb-4"><label class="form-label" for="rgPw">Kata sandi</label><input class="form-control" id="rgPw" type="password" minlength="8" required autocomplete="new-password">
        <div class="form-text">Minimal 8 karakter.</div></div>
      <button class="btn btn-ink w-100" type="submit" data-loading="Mendaftarkan…">Daftar sebagai ${peran === 'dosen' ? 'dosen' : 'mahasiswa'}</button>
    </form>
    <p class="text-center mt-4 mb-0 small-ss text-secondary-ss">Sudah punya akun? <a href="javascript:void(0)" onclick="navigateTo('login')" class="fw-600">Masuk</a></p>`);
  $('#regForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.checkValidity()) { f.classList.add('was-validated'); return toast('Lengkapi data', 'Periksa kembali isian yang ditandai.', 'warning'); }
    const p = { peran, nama_lengkap: $('#rgNama').value.trim(), email: $('#rgEmail').value.trim(), password: $('#rgPw').value };
    if (peran === 'mahasiswa') { p.kode_kelas = $('#rgKelas').value.trim(); p.npm = $('#rgNpm').value.trim(); p.program_studi = $('#rgProdi').value; }
    else p.kode_redeem = $('#rgKode').value.trim();
    await withBtn(f.querySelector('button[type=submit]'), async () => {
      try {
        const res = await api('auth.register', p);
        toast('Akun dibuat', res.kelas ? 'Kamu sudah masuk ke kelas ' + res.kelas.nama_kelas + '.' : 'Selamat datang di Ruang Ajar!', 'success');
        onLoggedIn(res);
        if (res.kelas) navigateTo('kelas-detail', { class_id: res.kelas.class_id });
      }
      catch (err) { toastErr(err); }
    });
  };
}

function renderForgot(params, c) {
  document.body.classList.add('logged-out');
  const step = params.step || 1;
  c.innerHTML = authLayout(`
    <h1>Lupa kata sandi</h1>
    <p class="text-secondary-ss mb-4">${step === 1 ? 'Masukkan email atau NPM. Kami kirim kode 6 digit ke email yang terdaftar.' : 'Masukkan kode dari email dan kata sandi baru.'}</p>
    <form id="fgForm" novalidate>
      <div class="mb-3"><label class="form-label" for="fgEmail">Email atau NPM</label>
        <input class="form-control" id="fgEmail" type="text" autocapitalize="none" autocomplete="username" required value="${esc(params.email || '')}" ${step === 2 ? 'readonly' : ''}></div>
      ${step === 1 ? '<div class="form-text mb-3" style="margin-top:-8px">Tidak menerima email (cek juga folder spam)? Minta dosen pengampu mereset kata sandimu.</div>' : ''}
      ${step === 2 ? `
        <div class="mb-3"><label class="form-label" for="fgKode">Kode reset</label><input class="form-control tabular" id="fgKode" inputmode="numeric" maxlength="6" required></div>
        <div class="mb-4"><label class="form-label" for="fgPw">Kata sandi baru</label><input class="form-control" id="fgPw" type="password" minlength="8" required autocomplete="new-password"></div>` : ''}
      <button class="btn btn-ink w-100" type="submit">${step === 1 ? 'Kirim kode' : 'Simpan kata sandi baru'}</button>
    </form>
    <p class="text-center mt-4 mb-0 small-ss"><a href="javascript:void(0)" onclick="navigateTo('login')" class="fw-600">Kembali ke halaman masuk</a></p>`);
  $('#fgForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#fgEmail').value.trim();
    if (!email) return toast('Lengkapi data', 'Isi email atau NPM.', 'warning');
    await withBtn(e.target.querySelector('button[type=submit]'), async () => {
      try {
        if (step === 1) {
          const r = await api('auth.forgot', { email });
          toast('Kode dikirim', r.message, 'info');
          navigateTo('forgot', { step: 2, email }, { noHistory: true });
        } else {
          const r = await api('auth.reset', { email, kode: $('#fgKode').value.trim(), password_baru: $('#fgPw').value });
          toast('Berhasil', r.message, 'success');
          navigateTo('login', {}, { noHistory: true });
        }
      } catch (err) { toastErr(err); }
    });
  };
}

function renderForceChange(params, c) {
  c.innerHTML = `<div class="ss-card mx-auto mt-4" style="max-width:460px">
    <h1 class="h4">Ganti kata sandi sementara</h1>
    <p class="text-secondary-ss">Demi keamanan, buat kata sandi baru sebelum memakai aplikasi.</p>
    <form id="fcForm">
      <div class="mb-3"><label class="form-label" for="fcOld">Kata sandi sementara</label><input class="form-control" id="fcOld" type="password" required autocomplete="current-password"></div>
      <div class="mb-4"><label class="form-label" for="fcNew">Kata sandi baru</label><input class="form-control" id="fcNew" type="password" minlength="8" required autocomplete="new-password">
        <div class="form-text">Minimal 8 karakter.</div></div>
      <button class="btn btn-ink w-100" type="submit">Simpan kata sandi</button>
    </form>
    <button class="btn btn-ghost w-100 mt-2" onclick="handleLogout()">Keluar</button></div>`;
  $('#fcForm').onsubmit = async e => {
    e.preventDefault();
    await withBtn(e.target.querySelector('button[type=submit]'), async () => {
      try {
        AppState.user = await api('profile.password', { lama: $('#fcOld').value, baru: $('#fcNew').value });
        LS.set('user', JSON.stringify(AppState.user));
        toast('Kata sandi diperbarui', '', 'success');
        navigateTo('dashboard', {}, { reset: true });
      } catch (err) { toastErr(err); }
    });
  };
}

function onLoggedIn(res) {
  AppState.token = res.token; AppState.user = res.user;
  LS.set('token', res.token); LS.set('user', JSON.stringify(res.user));
  SWR.init(res.user.user_id);
  seedBoot(res.boot);                                   // beranda terisi dari paket data login: tanpa bolak-balik tambahan
  document.body.classList.remove('logged-out');
  renderNavigation();
  navigateTo('dashboard', {}, { reset: true });
  if (!res.boot) refreshNotif();
}

async function handleLogout() {
  const ok = await confirmDialog('Keluar dari Ruang Ajar?', { okText: 'Keluar' });
  if (!ok) return;
  try { await api('auth.logout'); } catch (e) { /* tetap keluar di klien */ }
  if (AppState.user) LS.del('swr_' + AppState.user.user_id);
  SWR.owner = null; SWR.mem = {};
  AppState.token = null; AppState.user = null; AppState.history = []; LS.del('token'); LS.del('user');
  document.body.classList.add('logged-out');
  navigateTo('login', {}, { reset: true });
}

// ════════════════════════════════════════════════════════
// BAGIAN 10: DASHBOARD
// ════════════════════════════════════════════════════════

function renderDashboard(params, c) {
  return AppState.user.role === 'mahasiswa' ? renderDashMahasiswa(c) : renderDashDosen(c);
}

function kpiCard(label, value, icon, note = '', noteCls = '', aksi = null) {
  return `<div class="ss-card kpi h-100 ${aksi ? 'clickable' : ''}" ${actAttr(aksi)} ${aksi ? `aria-label="${esc(label)}: lihat rincian"` : ''}><div class="kpi-label">${esc(label)}</div>
    <span class="kpi-icon" aria-hidden="true"><i class="bi ${icon}"></i></span>
    <div class="kpi-value">${value === null || value === undefined ? '–' : esc(value)}</div>
    ${note ? `<div class="kpi-note ${noteCls}">${esc(note)}</div>` : ''}${aksi ? '<i class="bi bi-arrow-right-short kpi-go" aria-hidden="true"></i>' : ''}</div>`;
}

function classCardHtml(k, opts = {}) {
  const pct = k.jumlah_pertemuan ? Math.round(k.pertemuan_lewat / k.jumlah_pertemuan * 100) : 0;
  return `<article class="ss-card class-card" tabindex="0" role="button" aria-label="Buka kelas ${esc(k.nama_kelas)}" onpointerenter="prefetchClass('${k.class_id}')"
      onclick="navigateTo('kelas-detail',{class_id:'${k.class_id}'})" onkeydown="if(event.key==='Enter')this.click()">
    <div class="class-cover">${coverSVG(k.class_id, k.warna)}</div>
    <div class="title">${esc(k.nama_kelas)}</div>
    <div class="meta">${esc(k.mata_kuliah)}${opts.showDosen ? ' — ' + esc(k.dosen_nama) : ''}</div>
    <div class="d-flex justify-content-between align-items-center mt-2 small-ss text-secondary-ss">
      <span>${k.pertemuan_lewat} dari ${k.jumlah_pertemuan} pertemuan</span>
      ${k.status === 'arsip' ? badge('Arsip', 'b-muted') : k.is_assistant ? badge('Asisten', 'b-accent') : `<span>${k.jumlah_mhs} mhs</span>`}
    </div>
    <div class="progress-thin" aria-hidden="true"><span style="width:${pct}%"></span></div>
  </article>`;
}

function scheduleHtml(items) {
  if (!items.length) return `<p class="text-secondary-ss small-ss mb-0">Tidak ada jadwal atau tenggat terdekat.</p>`;
  return items.map(j => {
    const action = j.jenis === 'tenggat' ? `navigateTo('tugas-detail',{assignment_id:'${j.assignment_id}'})` : `navigateTo('kelas-detail',{class_id:'${j.class_id}'})`;
    const when = j.jenis === 'tenggat' ? (isToday(j.waktu) ? 'Hari ini' : fmtDate(j.waktu)) : (isToday(j.waktu) ? 'Hari ini' : fmtDate(j.waktu));
    return `<div class="sched-item" role="button" tabindex="0" onclick="${action}" onkeydown="if(event.key==='Enter')this.click()">
      <div class="sched-thumb">${coverSVG(j.class_id + j.judul, j.warna)}</div>
      <div class="min-w-0"><div class="s-title text-truncate">${esc(j.judul)}</div><div class="s-sub text-truncate">${j.jenis === 'tenggat' ? 'Tenggat tugas' : 'Pertemuan'} — ${esc(j.kelas)}</div></div>
      <div class="s-when"><b>${esc(when)}</b>${j.jenis === 'tenggat' ? esc(fmtTime(j.waktu)) : ''}</div></div>`;
  }).join('');
}

function activeSessionCard(list, role) {
  if (role === 'staf') {
    const s = list.find(x => x.peran === 'staf');
    if (s) {
      AppState.sessionTitles[s.session_id] = s.nama_kelas + ' — ' + s.pertemuan;
      return `<div class="ss-card highlight-card h-100 d-flex flex-column">
        <div class="d-flex justify-content-between align-items-start"><h3 class="mb-1"><span class="live-dot"></span>Absensi berlangsung</h3></div>
        <p class="small-ss mb-3">${esc(s.nama_kelas)} — ${esc(s.pertemuan)}</p>
        <div class="d-flex align-items-baseline gap-2 mb-3"><span class="kpi-value" style="margin:0">${s.hadir}</span><span class="text-secondary-ss">dari ${s.total} mahasiswa sudah absen</span></div>
        <div class="d-flex gap-2 mt-auto flex-wrap">
          <button class="btn btn-ink flex-fill" onclick="openProjector('${s.session_id}')"><i class="bi bi-qr-code"></i> Tampilkan QR</button>
          <button class="btn btn-soft" onclick="navigateTo('kelas-detail',{class_id:'${s.class_id}',tab:'absensi'})">Rekap</button>
        </div></div>`;
    }
    return `<div class="ss-card highlight-card h-100 d-flex flex-column">
      <h3 class="mb-1">Absensi QR</h3>
      <p class="small-ss text-secondary-ss">Buka sesi dari tab Absensi di kelas Anda. QR berganti otomatis; mahasiswa cukup memindainya, tanpa lokasi dan foto.</p>
      <button class="btn btn-ink mt-auto" onclick="navigateTo('kelas')"><i class="bi bi-qr-code"></i> Pilih kelas</button></div>`;
  }
  const s = list.find(x => x.peran === 'mahasiswa' && !x.sudah_absen);
  if (s) {
    return `<div class="ss-card highlight-card d-flex flex-column">
      <h3 class="mb-1"><span class="live-dot"></span>Absensi dibuka</h3>
      <p class="small-ss mb-3">${esc(s.nama_kelas)} — ${esc(s.pertemuan)}</p>
      <button class="btn btn-ink" onclick="navigateTo('absen')"><i class="bi bi-qr-code-scan"></i> Absen sekarang</button></div>`;
  }
  return '';
}

function insightCard(items) {
  return `<div class="ss-card h-100"><div class="card-head"><h2><i class="bi bi-stars me-1" style="color:var(--accent)"></i> Insight otomatis</h2></div>
    <ul class="insight-list">${items.map(i => i.aksi
      ? `<li><button class="insight-btn" ${`onclick="runAction(${esc(JSON.stringify(i.aksi))})"`}><i class="bi bi-dot" style="color:var(--accent)"></i><span>${esc(i.teks)}</span><i class="bi bi-chevron-right"></i></button></li>`
      : `<li><i class="bi bi-dot"></i><span>${esc(i.teks)}</span></li>`).join('')}</ul></div>`;
}

/** Pengumuman terbaru di dashboard (yang penting disorot). */
function announcementsHtml(list) {
  if (!list || !list.length) return '';
  return `<div class="mb-2">${list.slice(0, 2).map(x => `<div class="ann-banner ${x.penting ? 'penting' : ''}" role="button" tabindex="0" style="cursor:pointer" ${actAttr({ page: 'kelas-detail', params: { class_id: x.class_ids[0], tab: 'pengumuman' } })}>
      <i class="bi ${x.penting ? 'bi-megaphone-fill' : 'bi-megaphone'}"></i>
      <div class="min-w-0"><div class="fw-bold">${esc(x.judul)} ${x.penting ? badge('Penting', 'b-warn') : ''}</div>
        <div class="small-ss text-secondary-ss">${esc(x.kelas.join(', '))} — ${esc(fmtDate(x.waktu))}</div>
        <div class="ann-isi ann-clamp">${esc(x.isi)}</div></div></div>`).join('')}</div>`;
}

async function renderDashDosen(c) {
  await swr('dash.dosen', {}, d => drawDashDosen(c, d), { empty: () => { c.innerHTML = skeleton(); } });
  idlePrefetch();
}

function drawDashDosen(c, d) {
  AppState.dashLists = d.lists;
  const first = Object.keys(d.tren)[0];
  const u = AppState.user;
  c.innerHTML = `
    <div class="page-head"><div><h1>Halo, ${esc(u.nama_lengkap.split(' ')[0])}</h1><p>${esc(fmtDate(new Date().toISOString()))}</p></div>
      <button class="btn btn-ink" onclick="openClassForm()"><i class="bi bi-plus-lg"></i> Kelas baru</button></div>
    ${announcementsHtml(d.pengumuman)}
    <div class="row g-3">
      <div class="col-xl-8">
        <div class="row g-3">
          <div class="col-6 col-md-3">${kpiCard('Kelas aktif', d.kpi.kelas_aktif, 'bi-journal-bookmark', d.kpi.total_mhs + ' mahasiswa', '', { page: 'kelas', params: {} })}</div>
          <div class="col-6 col-md-3">${kpiCard('Menunggu dinilai', d.kpi.menunggu_dinilai, 'bi-hourglass-split', d.kpi.menunggu_dinilai ? 'Perlu ditindaklanjuti' : 'Semua beres', d.kpi.menunggu_dinilai ? 'warn' : 'ok', d.kpi.menunggu_dinilai ? { list: 'menunggu' } : null)}</div>
          <div class="col-6 col-md-3">${kpiCard('Rata-rata hadir', d.kpi.rata_kehadiran === null ? null : d.kpi.rata_kehadiran + '%', 'bi-graph-up', d.kpi.rata_kehadiran === null ? 'Belum ada data' : d.kpi.rata_kehadiran >= 80 ? 'Kehadiran baik' : 'Perlu perhatian', d.kpi.rata_kehadiran === null ? '' : d.kpi.rata_kehadiran >= 80 ? 'ok' : 'warn', d.kpi.rata_kehadiran === null ? null : { list: 'kehadiran' })}</div>
          <div class="col-6 col-md-3">${kpiCard('Sesi absensi hari ini', d.kpi.sesi_hari_ini, 'bi-lightning', d.aktif.some(a => a.peran === 'staf') ? 'Ada sesi berjalan' : '', '', d.kpi.sesi_hari_ini ? { list: 'sesi' } : null)}</div>
          <div class="col-12">
            <div class="ss-card">
              <div class="card-head"><h2>Tren kehadiran</h2>
                ${first ? `<select class="pill-select" id="trendSel" aria-label="Pilih kelas">${Object.entries(d.tren).map(([id, t]) => `<option value="${id}">${esc(t.nama_kelas)}</option>`).join('')}</select>` : ''}</div>
              <div style="height:240px">${first ? '<canvas id="trendChart"></canvas>' : emptyState('Belum ada data', 'Grafik muncul setelah sesi absensi pertama ditutup.')}</div>
            </div>
          </div>
          <div class="col-12">
            <div class="card-head"><h2 class="section-title">Kelas saya</h2>
              ${d.kelas.length > 3 ? `<button class="btn btn-ghost btn-sm" onclick="navigateTo('kelas')">Lihat semua</button>` : ''}</div>
            ${d.kelas.length ? `<div class="class-grid">${d.kelas.slice(0, 3).map(k => classCardHtml(k)).join('')}</div>
              <button class="btn btn-ink w-100 mt-3" onclick="navigateTo('kelas')">Lihat semua kelas</button>`
              : `<div class="ss-card">${emptyState('Belum ada kelas', 'Buat kelas pertama, lalu bagikan kode gabung ke mahasiswa.', '<button class="btn btn-ink" onclick="openClassForm()"><i class="bi bi-plus-lg"></i> Buat kelas</button>')}</div>`}
          </div>
        </div>
      </div>
      <div class="col-xl-4">
        <div class="d-grid gap-3">
          ${activeSessionCard(d.aktif, 'staf')}
          ${insightCard(d.insights)}
          <div class="ss-card"><div class="card-head"><h2>Jadwal terdekat</h2></div>${scheduleHtml(d.jadwal)}</div>
        </div>
      </div>
    </div>`;
  if (first) {
    const draw = id => lineChart('trendChart', d.tren[id].labels, d.tren[id].values);
    draw(first);
    $('#trendSel').onchange = e => draw(e.target.value);
  }
}

async function renderDashMahasiswa(c) {
  await swr('dash.mahasiswa', {}, d => drawDashMahasiswa(c, d), { empty: () => { c.innerHTML = skeleton(); } });
  idlePrefetch();
}

function drawDashMahasiswa(c, d) {
  AppState.dashLists = d.lists;
  const k = d.kpi, u = AppState.user;
  const hadirCls = k.kehadiran === null ? '' : k.kehadiran >= 85 ? 'ok' : k.kehadiran >= 75 ? 'warn' : 'bad';
  const hadirNote = k.kehadiran === null ? 'Belum ada data' : k.kehadiran >= 85 ? 'Aman' : k.kehadiran >= 75 ? 'Perlu perhatian' : 'Berisiko';
  c.innerHTML = `
    <div class="page-head"><div><h1>Halo, ${esc(u.nama_lengkap.split(' ')[0])}</h1><p>${esc(u.npm || '')}${u.program_studi ? ' — ' + esc(u.program_studi) : ''}</p></div>
      <button class="btn btn-soft" onclick="openJoinClass()"><i class="bi bi-plus-lg"></i> Gabung kelas</button></div>
    ${announcementsHtml(d.pengumuman)}
    ${activeSessionCard(d.aktif, 'mahasiswa') ? `<div class="mb-3">${activeSessionCard(d.aktif, 'mahasiswa')}</div>` : ''}
    <div class="row g-3 mb-3">
      <div class="col-6 col-lg-3">${kpiCard('Kehadiran', k.kehadiran === null ? null : k.kehadiran + '%', 'bi-person-check', hadirNote, hadirCls, k.kehadiran === null ? null : { list: 'kehadiran' })}</div>
      <div class="col-6 col-lg-3">${kpiCard('Tugas tertunda', k.tertunda, 'bi-clipboard', k.tertunda ? 'Segera kerjakan' : 'Tidak ada', k.tertunda ? 'warn' : 'ok', k.tertunda ? { page: 'tugas-saya', params: { f: 'aktif' } } : null)}</div>
      <div class="col-6 col-lg-3">${kpiCard('Perlu revisi', k.revisi, 'bi-arrow-repeat', k.revisi ? 'Cek catatan dosen' : 'Tidak ada', k.revisi ? 'bad' : 'ok', k.revisi ? { page: 'tugas-saya', params: { f: 'revisi' } } : null)}</div>
      <div class="col-6 col-lg-3">${kpiCard('Rata-rata nilai', k.rata_nilai, 'bi-star', k.rata_nilai === null ? 'Belum ada nilai' : 'Lihat rincian nilai', k.rata_nilai === null ? '' : k.rata_nilai >= 70 ? 'ok' : k.rata_nilai >= 55 ? 'warn' : 'bad', { page: 'nilai-saya', params: {} })}</div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="ss-card h-100"><div class="card-head"><h2>Tugas yang perlu dikerjakan</h2>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('tugas-saya',{},{reset:true})">Semua tugas</button></div>
          ${d.tugas_tertunda.length ? d.tugas_tertunda.map(t => taskRowHtml(t, true)).join('') : emptyState('Semua beres', 'Tidak ada tugas yang menunggu.')}
        </div>
      </div>
      <div class="col-lg-5">${insightCard(d.insights)}</div>
      <div class="col-12">
        <div class="card-head mt-2"><h2 class="section-title">Kelas saya</h2></div>
        ${d.kelas.length ? `<div class="class-grid">${d.kelas.map(x => classCardHtml(x, { showDosen: true })).join('')}</div>`
          : `<div class="ss-card">${emptyState('Belum bergabung ke kelas', 'Masukkan kode kelas dari dosen untuk mulai.', '<button class="btn btn-ink" onclick="openJoinClass()">Gabung kelas</button>')}</div>`}
      </div>
    </div>`;
}

/** Baris tugas untuk mahasiswa. */
function taskRowHtml(t, showClass) {
  const dl = relDeadline(t.tenggat);
  const st = t.state || {};
  return `<div class="item-row clickable" role="button" tabindex="0" onclick="navigateTo('tugas-detail',{assignment_id:'${t.assignment_id}'})" onkeydown="if(event.key==='Enter')this.click()">
    <div class="item-icon ii-task"><i class="bi ${t.mode === 'kelompok' ? 'bi-people' : 'bi-clipboard-check'}"></i></div>
    <div class="flex-grow-1 min-w-0"><div class="i-title text-truncate">${esc(t.judul)}</div>
      <div class="i-sub text-truncate">${showClass ? esc(t.nama_kelas) + ' — ' : ''}${esc(TIPE_JAWABAN[t.tipe_jawaban] || '')}</div></div>
    <div class="text-end d-flex flex-column align-items-end gap-1">
      ${st.skor !== null && st.skor !== undefined ? badge(st.skor + ' / ' + t.nilai_maks, 'b-ok') : subStatusBadge(st.status || 'Belum dikumpulkan')}
      ${['Dinilai', 'Dikirim', 'Dikirim Ulang'].includes(st.status) ? '' : `<span class="badge-ss ${dl.cls}">${esc(dl.text)}</span>`}
    </div></div>`;
}

// ════════════════════════════════════════════════════════
// BAGIAN 11: DAFTAR KELAS, BUAT KELAS, GABUNG KELAS
// ════════════════════════════════════════════════════════

async function renderKelas(params, c) {
  const staff = isStaffRole();
  const tab = params.tab || 'aktif';
  c.innerHTML = `<div class="page-head"><div><h1>Kelas</h1><p>${staff ? 'Kelola kelas yang Anda ampu.' : 'Kelas yang kamu ikuti.'}</p></div>
      ${staff ? `<button class="btn btn-ink" onclick="openClassForm()"><i class="bi bi-plus-lg"></i> Kelas baru</button>` : `<button class="btn btn-ink" onclick="openJoinClass()"><i class="bi bi-plus-lg"></i> Gabung kelas</button>`}</div>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <div class="tabs-pill mb-0" role="tablist">
        <button class="${tab === 'aktif' ? 'active' : ''}" onclick="navigateTo('kelas',{tab:'aktif',q:AppState.params.q||''},{noHistory:true})">Aktif</button>
        <button class="${tab === 'arsip' ? 'active' : ''}" onclick="navigateTo('kelas',{tab:'arsip',q:AppState.params.q||''},{noHistory:true})">Arsip</button>
      </div>
      <input type="search" class="form-control ms-auto" style="max-width:260px;border-radius:999px" id="classSearch" placeholder="Cari kelas atau mata kuliah" value="${esc(params.q || '')}" aria-label="Cari kelas">
    </div>
    <div id="classList"></div>`;
  let list = [];
  const draw = () => {
    const q = ($('#classSearch').value || '').toLowerCase();
    const items = list.filter(k => k.status === tab && (!q || (k.nama_kelas + ' ' + k.mata_kuliah).toLowerCase().includes(q)));
    $('#classList').innerHTML = items.length ? `<div class="class-grid">${items.map(k => classCardHtml(k, { showDosen: !staff })).join('')}</div>`
      : emptyState(tab === 'arsip' ? 'Belum ada kelas diarsipkan' : 'Belum ada kelas', tab === 'arsip' ? 'Kelas yang diarsipkan di akhir semester muncul di sini.' : (staff ? 'Buat kelas lalu bagikan kode gabung ke mahasiswa.' : 'Minta kode kelas dari dosen, lalu tekan Gabung kelas.'));
  };
  $('#classSearch').oninput = debounce(draw, 150);
  await swr('class.list', {}, data => { list = data; draw(); }, { empty: () => { $('#classList').innerHTML = skeleton('list'); } });
}

function openClassForm(cls) {
  const v = cls || {};
  const year = new Date().getFullYear();
  openModal({
    title: cls ? 'Ubah kelas' : 'Kelas baru',
    body: `<form id="clsForm" novalidate>
      <div class="mb-3"><label class="form-label" for="cfNama">Nama kelas</label><input class="form-control" id="cfNama" required maxlength="100" placeholder="mis. SI 3A" value="${esc(v.nama_kelas || '')}"></div>
      <div class="mb-3"><label class="form-label" for="cfMk">Mata kuliah</label><input class="form-control" id="cfMk" required maxlength="120" value="${esc(v.mata_kuliah || '')}"></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label" for="cfSem">Semester</label>
          <select class="form-select" id="cfSem">${['Ganjil', 'Genap', 'Pendek'].map(s => `<option ${v.semester === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="col-6"><label class="form-label" for="cfTa">Tahun ajaran</label><input class="form-control" id="cfTa" required maxlength="20" value="${esc(v.tahun_ajaran || (year + '/' + (year + 1)))}"></div>
      </div>
      <div class="mt-3"><label class="form-label" for="cfKuota">Kuota peserta (opsional)</label>
        <input class="form-control" id="cfKuota" type="number" min="1" max="1000" inputmode="numeric" placeholder="Kosong = tanpa batas" value="${esc(v.kuota || '')}">
        <div class="form-text">Bila jumlah peserta sudah mencapai kuota, pendaftaran dan gabung kelas otomatis ditolak.</div></div>
      <div class="mt-3"><label class="form-label" for="cfMeet">Link Google Meet bawaan kelas (opsional)</label>
        <input class="form-control" id="cfMeet" type="url" inputmode="url" maxlength="300" placeholder="https://meet.google.com/abc-defg-hij" value="${esc(v.link_meet || '')}">
        <div class="form-text">Dipakai untuk semua pertemuan daring yang tidak punya link sendiri. Cocok bila Anda memakai satu ruang Meet tetap untuk kelas ini.</div></div>
      ${cls ? `<hr><div class="fw-600 mb-1">Data untuk Daftar Hadir (PDF kampus)</div><div class="form-text mb-2">Tercetak di kop Daftar Hadir Mahasiswa dan Daftar Hadir Dosen. Kosong = tanda "-".</div>
      <div class="row g-2">
        <div class="col-md-6"><label class="form-label small-ss" for="cfProdi">Program studi</label><input class="form-control form-control-sm" id="cfProdi" maxlength="100" value="${esc(v.program_studi || '')}" placeholder="mis. Sistem Informasi"></div>
        <div class="col-md-6"><label class="form-label small-ss" for="cfDosen">Nama dosen di dokumen (dengan gelar)</label><input class="form-control form-control-sm" id="cfDosen" maxlength="120" value="${esc(v.nama_dosen_cetak || '')}" placeholder="mis. Siska, M.Kom."></div>
        <div class="col-md-6"><label class="form-label small-ss" for="cfJab">Jabatan akademik</label><input class="form-control form-control-sm" id="cfJab" maxlength="60" value="${esc(v.jabatan_akademik || '')}" placeholder="mis. Asisten Ahli"></div>
        <div class="col-md-6"><label class="form-label small-ss" for="cfSks">Bobot SKS</label><input class="form-control form-control-sm" id="cfSks" maxlength="10" value="${esc(v.bobot_sks || '')}" placeholder="mis. 3"></div>
        <div class="col-md-7"><label class="form-label small-ss" for="cfKoor">Koordinator program studi</label><input class="form-control form-control-sm" id="cfKoor" maxlength="120" value="${esc(v.koordinator_nama || '')}" placeholder="Nama lengkap dengan gelar"></div>
        <div class="col-md-5"><label class="form-label small-ss" for="cfNip">NIP koordinator</label><input class="form-control form-control-sm" id="cfNip" maxlength="40" value="${esc(v.koordinator_nip || '')}"></div>
        <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfAll"><label class="form-check-label small-ss" for="cfAll">Terapkan data ini ke semua kelas saya</label></div></div></div>` : ''}</form>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="cfSave">${cls ? 'Simpan perubahan' : 'Buat kelas'}</button>`
  });
  $('#cfSave').onclick = e => withBtn(e.currentTarget, async () => {
    const f = $('#clsForm'); if (!f.checkValidity()) { f.classList.add('was-validated'); return; }
    const p = { nama_kelas: $('#cfNama').value.trim(), mata_kuliah: $('#cfMk').value.trim(), semester: $('#cfSem').value, tahun_ajaran: $('#cfTa').value.trim(), kuota: $('#cfKuota').value.trim(), link_meet: $('#cfMeet').value.trim() };
    if (cls) Object.assign(p, { program_studi: $('#cfProdi').value.trim(), nama_dosen_cetak: $('#cfDosen').value.trim(), jabatan_akademik: $('#cfJab').value.trim(), bobot_sks: $('#cfSks').value.trim(), koordinator_nama: $('#cfKoor').value.trim(), koordinator_nip: $('#cfNip').value.trim(), terapkan_semua: $('#cfAll').checked });
    try {
      if (cls) {
        await api('class.update', Object.assign({}, cls, p));
        closeModal(); toast('Kelas diperbarui', '', 'success'); refreshPage();
      } else {
        const k = await api('class.create', p);
        closeModal(); toast('Kelas dibuat', 'Kode gabung: ' + k.kode_gabung, 'success');
        navigateTo('kelas-detail', { class_id: k.class_id });
      }
    } catch (err) { toastErr(err); }
  });
}

function openJoinClass() {
  openModal({
    title: 'Gabung kelas',
    body: `<form id="joinForm"><label class="form-label" for="joinCode">Kode kelas</label>
      <input class="form-control text-uppercase text-center fw-600 tabular" id="joinCode" maxlength="10" required autocomplete="off" style="letter-spacing:.3em;font-size:1.3rem" placeholder="ABC1234">
      <div class="form-text">Kode 7 karakter dari dosen.</div></form>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="joinBtn">Gabung</button>`,
    onShown: () => $('#joinCode').focus()
  });
  const go = e => withBtn($('#joinBtn'), async () => {
    if (e) e.preventDefault();
    const kode = $('#joinCode').value.trim();
    if (!kode) return toast('Isi kode kelas', '', 'warning');
    try { const k = await api('class.join', { kode }); closeModal(); toast('Berhasil bergabung', k.nama_kelas, 'success'); navigateTo('kelas-detail', { class_id: k.class_id }); }
    catch (err) { toastErr(err); }
  });
  $('#joinBtn').onclick = () => go();
  $('#joinForm').onsubmit = go;
}

// ════════════════════════════════════════════════════════
// BAGIAN 12: DETAIL KELAS (tab sesuai peran & izin)
// ════════════════════════════════════════════════════════

function classTabs(acc) {
  const p = acc.perms || [];
  const staffTask = p.includes('tugas') || p.includes('nilai');
  const tabs = [{ id: 'timeline', label: 'Timeline' }, { id: 'pengumuman', label: 'Pengumuman' }, { id: 'tugas', label: 'Tugas' }];
  if (p.includes('absensi')) tabs.push({ id: 'absensi', label: 'Absensi' });
  if (p.includes('absensi') || acc.isStudent) tabs.push({ id: 'sesi', label: 'Sesi kelas' });
  if (p.includes('nilai')) tabs.push({ id: 'nilai', label: 'Nilai' });
  if (acc.isStudent) tabs.push({ id: 'nilai-saya', label: 'Nilai saya' });
  if (acc.isOwner || acc.isStudent) tabs.push({ id: 'penghargaan', label: acc.isOwner ? 'Penghargaan' : 'Sertifikat' });
  if (acc.isOwner || acc.isPj || p.length) tabs.push({ id: 'kehadiran-dosen', label: 'Kehadiran dosen' });
  if (acc.isStudent) tabs.push({ id: 'absensi-saya', label: 'Absensi saya' });
  if (acc.isOwner || p.length) tabs.push({ id: 'anggota', label: 'Anggota & kelompok' });
  else tabs.push({ id: 'kelompok', label: 'Kelompok' });
  if (acc.isOwner) tabs.push({ id: 'pengaturan', label: 'Pengaturan' });
  return { tabs, staffTask };
}

async function renderClassDetail(params, c) {
  const id = params.class_id;
  c.innerHTML = `<div id="classHead"></div><div id="tabsBar"></div><div id="tabBody"></div>`;
  let started = false;
  await swr('class.detail', { class_id: id, with_timeline: true }, d => {
    AppState.classCache[id] = d;
    // Timeline ikut terkirim dalam satu panggilan → tab pertama langsung tampil
    if (d.timeline) SWR.set(SWR.key('meeting.list', { class_id: id }), d.timeline);
    drawClassHead(d, params);
    if (!started) { started = true; loadClassTab(AppState.params.tab); setTimeout(() => { if (AppState.page === 'kelas-detail' && AppState.params.class_id === id) prefetchClassTabs(d); }, 350); }
  }, { empty: () => { $('#classHead').innerHTML = skeleton('list'); } });
}

function drawClassHead(d) {
  const { cls, access: acc } = d;
  const { tabs } = classTabs(acc);
  const tab = tabs.find(t => t.id === AppState.params.tab) ? AppState.params.tab : 'timeline';
  AppState.params = Object.assign({}, AppState.params, { tab });
  $('#pageTitle').textContent = cls.nama_kelas;
  $('#classHead').innerHTML = `
    <div class="class-hero">
      <div class="d-flex align-items-center gap-3">
        <div class="cover-mini">${coverSVG(cls.class_id, Number(cls.warna) || 0)}</div>
        <div class="min-w-0">
          <div class="d-flex flex-wrap gap-2 mb-1">${acc.archived ? badge('Diarsipkan — hanya-baca', 'b-muted', 'bi-archive') : ''}${acc.isAssistant ? badge('Anda asisten di kelas ini', 'b-accent', 'bi-person-badge') : ''}${acc.isPj ? badge('Anda PJ mata kuliah', 'b-info', 'bi-flag') : ''}${cls.kunci_gabung && cls.kode_gabung ? badge('Pendaftaran dikunci', 'b-warn', 'bi-lock') : ''}</div>
          <h1 class="text-truncate">${esc(cls.nama_kelas)}</h1>
          <div class="text-secondary-ss small-ss">${esc(cls.mata_kuliah)} — ${esc(cls.semester)} ${esc(cls.tahun_ajaran)} — ${esc(d.dosen_nama)} — ${d.jumlah_mhs}${cls.kuota ? ' dari ' + esc(cls.kuota) : ''} mahasiswa</div>
        </div>
        ${cls.kode_gabung ? `<div class="ms-auto d-none d-md-flex align-items-center gap-2">
          <span class="small-ss text-secondary-ss">Kode gabung</span><span class="code-chip">${esc(cls.kode_gabung)}</span>
          <button class="icon-action" onclick="copyText('${esc(cls.kode_gabung)}')" aria-label="Salin kode"><i class="bi bi-copy"></i></button>
          <button class="btn btn-soft btn-sm" onclick="copyInvite()"><i class="bi bi-send"></i> Salin undangan</button></div>` : ''}
      </div>
      ${cls.kode_gabung ? `<div class="d-flex d-md-none align-items-center gap-2"><span class="small-ss text-secondary-ss">Kode gabung</span><span class="code-chip">${esc(cls.kode_gabung)}</span>
        <button class="icon-action" onclick="copyText('${esc(cls.kode_gabung)}')" aria-label="Salin kode"><i class="bi bi-copy"></i></button>
          <button class="btn btn-soft btn-sm" onclick="copyInvite()"><i class="bi bi-send"></i> Salin undangan</button></div>` : ''}
    </div>
    ${(d.pengumuman || []).slice(0, 1).map(x => `<div class="ann-banner ${x.penting ? 'penting' : ''}" role="button" tabindex="0" style="cursor:pointer" onclick="switchClassTab('pengumuman')" onkeydown="if(event.key==='Enter')this.click()">
      <i class="bi ${x.penting ? 'bi-megaphone-fill' : 'bi-megaphone'}"></i>
      <div class="min-w-0 flex-grow-1"><div class="fw-bold">${esc(x.judul)} ${x.penting ? badge('Penting', 'b-warn') : ''}</div><div class="ann-isi ann-clamp">${esc(x.isi)}</div>
        ${d.pengumuman.length > 1 ? `<div class="small-ss fw-600 mt-1" style="color:var(--accent-strong)">+${d.pengumuman.length - 1} pengumuman lainnya</div>` : ''}</div></div>`).join('')}`;
  $('#tabsBar').innerHTML = `<div class="tabs-pill" role="tablist">${tabs.map(t => `<button role="tab" aria-selected="${t.id === tab}" class="${t.id === tab ? 'active' : ''}" onclick="switchClassTab('${t.id}')">${esc(t.label)}</button>`).join('')}</div>`;
  const act = $('#tabsBar .tabs-pill button.active'); if (act && act.scrollIntoView) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function switchClassTab(tab) {
  AppState.params = Object.assign({}, AppState.params, { tab });
  $$('#tabsBar .tabs-pill button').forEach(b => { const on = b.getAttribute('onclick') === `switchClassTab('${tab}')`; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); if (on && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  runCleanups();
  loadClassTab(tab);
}

async function loadClassTab(tab) {
  const body = $('#tabBody'); if (!body) return;
  tab = tab || 'timeline';
  AppState.tabSeq++; AppState.formDirty = false;
  const id = AppState.params.class_id, d = AppState.classCache[id];
  const fns = {
    timeline: renderTimelineTab, tugas: renderTugasTab, absensi: renderAbsensiTab, 'absensi-saya': renderAbsensiSayaTab,
    anggota: renderAnggotaTab, kelompok: renderKelompokTab, pengaturan: renderPengaturanTab,
    nilai: renderNilaiTab, 'kehadiran-dosen': renderKehadiranDosenTab, pengumuman: renderPengumumanTab, 'nilai-saya': renderNilaiSayaTab, sesi: renderSesiTab, penghargaan: renderPenghargaanTab
  };
  if (!fns[tab]) tab = 'timeline';
  try { await fns[tab](body, d); } catch (e) { body.innerHTML = errorBlock(e, `loadClassTab('${tab}')`); }
}

/** Pesan undangan siap tempel ke grup WhatsApp: berisi kode kelas dan langkah mendaftar. */
/** Alamat halaman aplikasi yang sedang dibuka (tanpa index.html) — dipakai bila admin belum mengisi alamat khusus. */
function pageUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

function inviteText(cls) {
  const url = AppState.config.urlAplikasi || pageUrl();
  const app = AppState.config.appName || 'Ruang Ajar';
  return `Halo, kamu diundang ke kelas ${cls.nama_kelas} (${cls.mata_kuliah}) di ${app}.\n\n` +
    `KODE KELAS: ${cls.kode_gabung}\n\n` +
    `Belum punya akun:\n1. Buka ${url || 'aplikasi ' + app + ' (tautan dari dosen)'}\n2. Pilih Daftar → Mahasiswa\n3. Isi kode kelas di atas, lalu nama, NPM, program studi, email, dan kata sandi\n\n` +
    `Sudah punya akun: masuk, pilih "Gabung kelas", lalu masukkan kode di atas.\n\n` +
    `Kode ini khusus anggota kelas. Mohon tidak dibagikan ke orang lain.`;
}
function copyInvite() {
  const d = AppState.classCache[AppState.params.class_id];
  if (!d || !d.cls.kode_gabung) return;
  copyText(inviteText(d.cls), 'Pesan undangan disalin. Tinggal tempel ke grup kelas.');
}

function copyText(t, label) {
  const done = () => toast('Disalin', label || t, 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
  else fallbackCopy(t, done);
}
function fallbackCopy(t, done) {
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Salin manual', t, 'info'); } ta.remove();
}

// ════════════════════════════════════════════════════════
// BAGIAN 13: TIMELINE PERTEMUAN + MATERI
// ════════════════════════════════════════════════════════

AppState.openMeetings = new Set();

async function renderTimelineTab(body, d) {
  await swr('meeting.list', { class_id: d.cls.class_id }, m => drawTimeline(body, d, m), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawTimeline(body, d, meetings) {
  const acc = d.access, canEdit = acc.isOwner && !acc.archived;
  const canMat = acc.perms.includes('materi') && !acc.archived;
  const canTask = acc.perms.includes('tugas') && !acc.archived;
  AppState.meetings = meetings;
  if (!AppState.openMeetings.size && meetings.length) {
    const today = new Date().toISOString().slice(0, 10);
    const cur = meetings.find(m => m.tanggal >= today) || meetings[meetings.length - 1];
    AppState.openMeetings.add(cur.meeting_id);
  }
  body.innerHTML = `
    <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
      <p class="text-secondary-ss mb-0 small-ss">${meetings.length} pertemuan${canEdit && meetings.length > 1 ? ' — seret ikon titik untuk mengubah urutan' : ''}</p>
      ${canEdit ? `<button class="btn btn-ink btn-sm" onclick="openMeetingForm()"><i class="bi bi-plus-lg"></i> Pertemuan</button>` : ''}
    </div>
    <div id="meetingList">${meetings.length ? meetings.map(m => meetingCardHtml(m, { canEdit, canMat, canTask, isStudent: acc.isStudent, linkMeet: d.cls.link_meet || '' })).join('')
      : emptyState('Timeline masih kosong', canEdit ? 'Tambahkan pertemuan pertama: Pertemuan 1, UTS, UAS, atau judul bebas.' : 'Dosen belum menyusun timeline.',
        canEdit ? '<button class="btn btn-ink" onclick="openMeetingForm()"><i class="bi bi-plus-lg"></i> Tambah pertemuan</button>' : '')}</div>`;
  if (canEdit && meetings.length > 1) {
    loadLib('sortable').then(() => {
      const list = $('#meetingList'); if (!list) return;
      const s = Sortable.create(list, {
        handle: '.drag-handle', animation: 150,
        onEnd: async () => {
          const order = $$('#meetingList .meeting-card').map(el => el.dataset.id);
          try { await api('meeting.reorder', { class_id: d.cls.class_id, order }); toast('Urutan disimpan', '', 'success'); loadClassTab('timeline'); }
          catch (e) { toastErr(e); loadClassTab('timeline'); }
        }
      });
      AppState.cleanups.push(() => s.destroy());
    }).catch(() => { });
  }
}

function meetingCardHtml(m, o) {
  const open = AppState.openMeetings.has(m.meeting_id);
  const num = m.tipe === 'uts' ? 'UTS' : m.tipe === 'uas' ? 'UAS' : m.urutan;
  const exam = m.tipe === 'uts' || m.tipe === 'uas';
  const counts = [m.materials.length ? m.materials.length + ' materi' : '', m.assignments.length ? m.assignments.length + ' tugas' : '', (m.activities || []).length ? m.activities.length + ' aktivitas' : ''].filter(Boolean).join(', ');
  return `<section class="ss-card meeting-card" data-id="${m.meeting_id}">
    <div class="meeting-head" role="button" tabindex="0" aria-expanded="${open}" onclick="toggleMeeting('${m.meeting_id}')" onkeydown="if(event.key==='Enter')this.click()">
      ${o.canEdit ? `<span class="drag-handle" onclick="event.stopPropagation()" aria-label="Seret untuk mengurutkan"><i class="bi bi-grip-vertical"></i></span>` : ''}
      <div class="meeting-num ${exam ? 'exam' : ''}">${esc(num)}</div>
      <div class="flex-grow-1 min-w-0">
        <div class="m-title">${esc(m.judul)}</div>
        <div class="m-sub">${m.tanggal ? esc(fmtDate(m.tanggal)) : 'Tanggal belum diatur'}${counts ? ' — ' + esc(counts) : ''}</div>
        ${m.topik ? `<div class="m-sub"><i class="bi bi-book"></i> ${esc(m.topik)}</div>` : ''}
      </div>
      ${(m.link_meet || o.linkMeet) ? `<a class="btn btn-soft btn-sm flex-shrink-0" href="${esc(m.link_meet || o.linkMeet)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" aria-label="Gabung pertemuan daring ${esc(m.judul)}"><i class="bi bi-camera-video"></i> <span class="d-none d-sm-inline">Gabung </span>Meet</a>` : ''}
      ${m.absensi.terbuka ? badge('Absensi dibuka', 'b-ok', 'bi-broadcast') : ''}
      ${o.canEdit ? `<div class="dropdown" onclick="event.stopPropagation()">
        <button class="icon-action" data-bs-toggle="dropdown" aria-label="Menu pertemuan"><i class="bi bi-three-dots-vertical"></i></button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item" href="javascript:void(0)" onclick="openMeetingForm('${m.meeting_id}')"><i class="bi bi-pencil me-2"></i>Ubah</a></li>
          <li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="deleteMeeting('${m.meeting_id}')"><i class="bi bi-trash me-2"></i>Hapus</a></li>
        </ul></div>` : ''}
      <i class="bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'} text-muted-ss"></i>
    </div>
    <div class="meeting-body ${open ? '' : 'd-none'}">
      ${m.deskripsi ? `<p class="small-ss text-secondary-ss">${esc(m.deskripsi)}</p>` : ''}
      ${m.materials.map(x => materialRowHtml(x, o.canMat)).join('')}
      ${m.assignments.map(a => assignmentRowHtml(a, o.isStudent)).join('')}
      ${(m.activities || []).map(x => activityRowHtml(x, o.isStudent)).join('')}
      ${!m.materials.length && !m.assignments.length && !(m.activities || []).length ? `<p class="small-ss text-muted-ss mb-2">Belum ada materi atau tugas.</p>` : ''}
      ${o.canMat || o.canTask ? `<div class="d-flex flex-wrap gap-2 mt-3">
        ${o.canMat ? `<button class="btn btn-soft btn-sm" onclick="openMaterialForm('${m.meeting_id}')"><i class="bi bi-paperclip"></i> Materi</button>` : ''}
        ${o.canTask ? `<button class="btn btn-soft btn-sm" onclick="openAssignmentForm({meeting_id:'${m.meeting_id}'})"><i class="bi bi-clipboard-plus"></i> Tugas</button>` : ''}
        ${o.canMat ? `<button class="btn btn-soft btn-sm" onclick="openActivityForm({meeting_id:'${m.meeting_id}'})"><i class="bi bi-play-circle"></i> Aktivitas</button>` : ''}
      </div>` : ''}
    </div></section>`;
}

function toggleMeeting(id) {
  if (AppState.openMeetings.has(id)) AppState.openMeetings.delete(id); else AppState.openMeetings.add(id);
  const card = $(`.meeting-card[data-id="${id}"]`); if (!card) return;
  const open = AppState.openMeetings.has(id);
  card.querySelector('.meeting-body').classList.toggle('d-none', !open);
  card.querySelector('.meeting-head').setAttribute('aria-expanded', open);
  const ch = card.querySelector('.meeting-head > .bi:last-child'); if (ch) ch.className = `bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'} text-muted-ss`;
}

function materialRowHtml(x, canEdit) {
  const icon = { file: ['ii-file', 'bi-file-earmark-text'], link: ['ii-link', 'bi-link-45deg'], teks: ['ii-text', 'bi-text-paragraph'] }[x.tipe] || ['ii-file', 'bi-file'];
  let click = '', sub = '';
  if (x.tipe === 'file') { click = `previewFile('materi','${x.material_id}')`; sub = x.nama_file; }
  else if (x.tipe === 'teks') { click = `toggleTextMaterial('${x.material_id}')`; sub = 'Catatan teks'; }
  const menu = canEdit ? `<div class="dropdown" onclick="event.stopPropagation()"><button class="icon-action" data-bs-toggle="dropdown" aria-label="Menu materi"><i class="bi bi-three-dots"></i></button>
      <ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="javascript:void(0)" onclick="openMaterialForm('${x.meeting_id}','${x.material_id}')"><i class="bi bi-pencil me-2"></i>Ubah</a></li>
      <li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="deleteMaterial('${x.material_id}')"><i class="bi bi-trash me-2"></i>Hapus</a></li></ul></div>` : '';
  if (x.tipe === 'link') {
    return `<div class="item-row"><div class="item-icon ${icon[0]}"><i class="bi ${icon[1]}"></i></div>
      <div class="flex-grow-1 min-w-0"><a class="i-title d-block text-truncate text-decoration-none" style="color:var(--text)" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.judul)} <i class="bi bi-box-arrow-up-right small-ss"></i></a>
      <div class="i-sub text-truncate">${esc(x.url)}</div></div>${menu}</div>`;
  }
  return `<div class="item-row clickable" role="button" tabindex="0" onclick="${click}" onkeydown="if(event.key==='Enter')this.click()">
    <div class="item-icon ${icon[0]}"><i class="bi ${icon[1]}"></i></div>
    <div class="flex-grow-1 min-w-0"><div class="i-title text-truncate">${esc(x.judul)}</div><div class="i-sub text-truncate">${esc(sub)}</div></div>${menu}</div>
    ${x.tipe === 'teks' ? `<div id="txt-${x.material_id}" class="text-material mb-2 d-none">${esc(x.konten_teks)}</div>` : ''}`;
}
function toggleTextMaterial(id) { const el = document.getElementById('txt-' + id); if (el) el.classList.toggle('d-none'); }

function assignmentRowHtml(a, isStudent) {
  const dl = relDeadline(a.tenggat);
  const st = a.state;
  return `<div class="item-row clickable" role="button" tabindex="0" onclick="navigateTo('tugas-detail',{assignment_id:'${a.assignment_id}'})" onkeydown="if(event.key==='Enter')this.click()">
    <div class="item-icon ii-task"><i class="bi ${a.mode === 'kelompok' ? 'bi-people' : 'bi-clipboard-check'}"></i></div>
    <div class="flex-grow-1 min-w-0"><div class="i-title text-truncate">${esc(a.judul)} ${a.draft ? badge('Draft', 'b-warn', 'bi-pencil-square') : ''}</div>
      <div class="i-sub text-truncate">${esc(TIPE_JAWABAN[a.tipe_jawaban])} — ${esc(a.komponen_nama || kompLabel(a.komponen_bobot))}${a.mode === 'kelompok' ? ' — kelompok' : ''}</div></div>
    <div class="d-flex flex-column align-items-end gap-1">
      ${isStudent && st ? (st.skor !== null ? badge(st.skor + ' / ' + a.nilai_maks, 'b-ok') : subStatusBadge(st.status)) : ''}
      <span class="badge-ss ${dl.cls}">${esc(dl.text)}</span></div></div>`;
}

function openMeetingForm(id) {
  const m = id ? (AppState.meetings || []).find(x => x.meeting_id === id) : null;
  const v = m || { tipe: 'pertemuan' };
  const next = (AppState.meetings || []).filter(x => x.tipe === 'pertemuan').length + 1;
  openModal({
    title: m ? 'Ubah pertemuan' : 'Pertemuan baru',
    body: `<form id="mtForm" novalidate>
      <div class="mb-3"><label class="form-label" for="mtTipe">Jenis</label>
        <select class="form-select" id="mtTipe">${[['pertemuan', 'Pertemuan'], ['uts', 'UTS'], ['uas', 'UAS'], ['lainnya', 'Lainnya']].map(([k, l]) => `<option value="${k}" ${v.tipe === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="mb-3"><label class="form-label" for="mtJudul">Judul</label><input class="form-control" id="mtJudul" required maxlength="120" value="${esc(v.judul || 'Pertemuan ' + next)}"></div>
      <div class="mb-3"><label class="form-label" for="mtTgl">Tanggal</label><input class="form-control" id="mtTgl" type="date" value="${esc(v.tanggal || '')}"></div>
      <div class="mb-3"><label class="form-label" for="mtTopik">Topik / materi kuliah</label><input class="form-control" id="mtTopik" maxlength="300" value="${esc(v.topik || '')}" placeholder="mis. Pengenalan HTML dan struktur halaman web">
        <div class="form-text">Dipakai di rekap kehadiran dosen. Kosong = memakai judul pertemuan.</div></div>
      <div class="mb-3"><label class="form-label" for="mtMeet">Link pertemuan daring (opsional)</label><input class="form-control" id="mtMeet" type="url" inputmode="url" maxlength="300" value="${esc(v.link_meet || '')}" placeholder="https://meet.google.com/abc-defg-hij">
        <div class="form-text">Google Meet/Zoom. Mahasiswa melihat tombol "Gabung Meet" di timeline. Kosong = memakai link bawaan kelas (bila ada).</div></div>
      <div class="mb-1"><label class="form-label" for="mtDesk">Deskripsi (opsional)</label><textarea class="form-control" id="mtDesk" rows="3" maxlength="2000">${esc(v.deskripsi || '')}</textarea></div>
    </form>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="mtSave">Simpan</button>`
  });
  $('#mtTipe').onchange = e => { const j = $('#mtJudul'); if (!m && ['UTS', 'UAS', 'Pertemuan ' + next, ''].includes(j.value)) j.value = e.target.value === 'uts' ? 'UTS' : e.target.value === 'uas' ? 'UAS' : e.target.value === 'pertemuan' ? 'Pertemuan ' + next : ''; };
  $('#mtSave').onclick = e => withBtn(e.currentTarget, async () => {
    const judul = $('#mtJudul').value.trim(); if (!judul) return toast('Judul wajib diisi', '', 'warning');
    try {
      const r = await api('meeting.save', { meeting_id: id || '', class_id: AppState.params.class_id, judul, tipe: $('#mtTipe').value, tanggal: $('#mtTgl').value, topik: $('#mtTopik').value.trim(), link_meet: $('#mtMeet').value.trim(), deskripsi: $('#mtDesk').value });
      AppState.openMeetings.add(r.meeting_id);
      closeModal(); toast('Pertemuan disimpan', '', 'success'); loadClassTab('timeline');
    } catch (err) { toastErr(err); }
  });
}

async function deleteMeeting(id) {
  if (!await confirmDialog('Hapus pertemuan ini? Pertemuan harus kosong (tanpa materi, tugas, atau absensi).', { okText: 'Hapus', danger: true })) return;
  try { await api('meeting.delete', { meeting_id: id }); toast('Pertemuan dihapus', '', 'success'); loadClassTab('timeline'); } catch (e) { toastErr(e); }
}

function openMaterialForm(meetingId, materialId) {
  const m = (AppState.meetings || []).find(x => x.meeting_id === meetingId);
  const v = materialId && m ? m.materials.find(x => x.material_id === materialId) : { tipe: 'file' };
  openModal({
    title: materialId ? 'Ubah materi' : 'Tambah materi',
    body: `<form id="maForm" novalidate>
      <p class="small-ss text-secondary-ss">${esc(m ? m.judul : '')}</p>
      <div class="seg mb-3" style="grid-template-columns:1fr 1fr 1fr">${[['file', 'File'], ['link', 'Link'], ['teks', 'Teks']].map(([k, l]) => `<button type="button" data-t="${k}" class="${v.tipe === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="mb-3"><label class="form-label" for="maJudul">Judul materi</label><input class="form-control" id="maJudul" required maxlength="150" value="${esc(v.judul || '')}"></div>
      <div data-pane="file"><label class="form-label" for="maFile">File</label>
        <input class="form-control" id="maFile" type="file" accept="${FILE_ACCEPT}">
        <div class="form-text">PDF, DOC/DOCX, PPT/PPTX, JPG/PNG maks 10 MB; MP4 maks 30 MB.${v.nama_file ? ' File saat ini: ' + esc(v.nama_file) + ' (kosongkan bila tidak diganti).' : ''}</div></div>
      <div data-pane="link"><label class="form-label" for="maUrl">Link</label><input class="form-control" id="maUrl" type="url" placeholder="https://" value="${esc(v.url || '')}">
        <div class="form-text">Untuk video besar, tempel link Google Drive atau YouTube.</div></div>
      <div data-pane="teks"><label class="form-label" for="maTeks">Isi teks</label><textarea class="form-control" id="maTeks" rows="6">${esc(v.konten_teks || '')}</textarea></div>
    </form>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="maSave" data-loading="Mengunggah…">Simpan materi</button>`
  });
  let tipe = v.tipe;
  const sync = () => { $$('#maForm [data-pane]').forEach(p => p.classList.toggle('d-none', p.dataset.pane !== tipe)); $$('#maForm .seg button').forEach(b => b.classList.toggle('active', b.dataset.t === tipe)); };
  $$('#maForm .seg button').forEach(b => b.onclick = () => { tipe = b.dataset.t; sync(); });
  sync();
  $('#maSave').onclick = e => withBtn(e.currentTarget, async () => {
    const p = { meeting_id: meetingId, material_id: materialId || '', judul: $('#maJudul').value.trim(), tipe };
    if (!p.judul) return toast('Judul materi wajib diisi', '', 'warning');
    try {
      if (tipe === 'file') { const f = $('#maFile').files[0]; if (f) p.file = await readFileBase64(f); else if (!materialId) return toast('Pilih file', '', 'warning'); }
      if (tipe === 'link') p.url = $('#maUrl').value.trim();
      if (tipe === 'teks') p.konten_teks = $('#maTeks').value;
      await api('material.save', p);
      closeModal(); toast('Materi disimpan', '', 'success'); AppState.openMeetings.add(meetingId); loadClassTab('timeline');
    } catch (err) { toastErr(err); }
  });
}

async function deleteMaterial(id) {
  if (!await confirmDialog('Hapus materi ini? File di Drive ikut dipindahkan ke sampah.', { okText: 'Hapus', danger: true })) return;
  try { await api('material.delete', { material_id: id }); toast('Materi dihapus', '', 'success'); loadClassTab('timeline'); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 14: TAB TUGAS + FORM TUGAS + RUBRIK
// ════════════════════════════════════════════════════════

async function renderTugasTab(body, d) {
  await swr('assignment.listClass', { class_id: d.cls.class_id }, list => drawTugasTab(body, d, list), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawTugasTab(body, d, list) {
  const acc = d.access;
  const staff = acc.perms.includes('tugas') || acc.perms.includes('nilai');
  const canCreate = acc.perms.includes('tugas') && !acc.archived;
  const head = `<div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
      <p class="text-secondary-ss small-ss mb-0">${list.length} tugas</p>
      <div class="d-flex gap-2">${canCreate ? `<button class="btn btn-soft btn-sm" onclick="openRubricManager()"><i class="bi bi-list-check"></i> Rubrik</button>
        <button class="btn btn-ink btn-sm" onclick="openAssignmentForm({})"><i class="bi bi-plus-lg"></i> Tugas baru</button>` : ''}</div></div>`;
  if (!list.length) {
    body.innerHTML = head + emptyState('Belum ada tugas', canCreate ? 'Buat tugas dan petakan ke komponen bobot nilai.' : 'Tugas dari dosen akan muncul di sini.',
      canCreate ? '<button class="btn btn-ink" onclick="openAssignmentForm({})"><i class="bi bi-plus-lg"></i> Tugas baru</button>' : '');
    return;
  }
  if (!staff) { body.innerHTML = head + list.map(t => taskRowHtml(t, false)).join(''); return; }
  body.innerHTML = head + `<div class="table-wrap"><table class="table-ss"><thead><tr>
      <th>Tugas</th><th>Pertemuan</th><th>Tenggat</th><th>Terkumpul</th><th>Menunggu dinilai</th></tr></thead><tbody>
      ${list.map(t => {
        const dl = relDeadline(t.tenggat);
        return `<tr style="cursor:pointer" onclick="navigateTo('tugas-detail',{assignment_id:'${t.assignment_id}'})">
          <td><div class="fw-600">${esc(t.judul)} ${t.draft ? badge('Draft', 'b-warn', 'bi-pencil-square') : ''}</div><div class="small-ss text-secondary-ss">${esc(TIPE_JAWABAN[t.tipe_jawaban])} — ${esc(t.komponen_nama || kompLabel(t.komponen_bobot))}${t.mode === 'kelompok' ? ' — kelompok' : ''}</div></td>
          <td class="small-ss">${esc(t.pertemuan)}</td>
          <td><span class="badge-ss ${dl.cls}">${esc(dl.text)}</span></td>
          <td class="tabular">${t.stat.terkumpul} / ${t.stat.total}</td>
          <td>${t.stat.menunggu ? badge(t.stat.menunggu + ' jawaban', 'b-warn') : badge('Tidak ada', 'b-ok')}</td></tr>`;
      }).join('')}</tbody></table></div>`;
}

async function ensureMeetings(classId) {
  if (!AppState.meetings || !AppState.meetings.length || AppState.meetings[0].class_id !== classId) {
    AppState.meetings = await api('meeting.list', { class_id: classId });
  }
  return AppState.meetings;
}

/**
 * Form buat/ubah tugas. ctx: {meeting_id?, assignment_id?, class_id?}
 * Tugas baru / draft: tombol "Simpan draft" (boleh belum lengkap, tidak terlihat mahasiswa) dan "Terbitkan".
 * Tugas yang sudah terbit: "Simpan perubahan".
 */
async function openAssignmentForm(ctx) {
  const classId = ctx.class_id || AppState.params.class_id;
  AppState.asClass = classId;
  AppState.asDirty = false; AppState.asSaved = false; AppState.asId = ctx.assignment_id || ''; AppState.qIdx = 0;
  const body = openModal({ title: ctx.assignment_id ? 'Ubah tugas' : 'Tugas baru', body: loadingBlock(), size: 'modal-xl', static: true });
  try {
    const [meetings, detail, rubrics, existing] = await Promise.all([
      ensureMeetings(classId),
      AppState.classCache[classId] ? Promise.resolve(AppState.classCache[classId]) : api('class.detail', { class_id: classId }),
      api('rubric.list', { class_id: classId }),
      ctx.assignment_id ? api('assignment.get', { assignment_id: ctx.assignment_id }) : Promise.resolve(null)
    ]);
    if (!meetings.length) { body.innerHTML = emptyState('Belum ada pertemuan', 'Tambahkan pertemuan di tab Timeline sebelum membuat tugas.'); return; }
    const a = existing ? existing.assignment : { meeting_id: ctx.meeting_id || meetings[meetings.length - 1].meeting_id, tipe_jawaban: 'teks', mode: 'individu', nilai_maks: 100, izinkan_revisi: true, terima_terlambat: true, komponen_bobot: (detail.weights.find(w => w.jenis === 'tugas') || detail.weights[0] || {}).komponen };
    const canDraft = !existing || a.draft;               // tugas yang sudah terbit tidak bisa kembali jadi draft
    AppState.qDraft = existing ? existing.questions.map(q => ({ question_id: q.question_id, pertanyaan: q.pertanyaan, opsi: q.opsi.slice(), kunci_jawaban: q.kunci_jawaban, poin: q.poin })) : [];
    body.innerHTML = `<form id="asForm" novalidate onsubmit="return false">
      ${canDraft ? '' : `<div class="answer-box small-ss mb-3" style="white-space:normal"><i class="bi bi-info-circle"></i> Tugas ini sudah terbit. Perubahan langsung terlihat oleh mahasiswa.</div>`}
      <div class="row g-3">
        <div class="col-md-8"><label class="form-label" for="asJudul">Judul tugas</label><input class="form-control" id="asJudul" required maxlength="150" value="${esc(a.judul || '')}"></div>
        <div class="col-md-4"><label class="form-label" for="asMeet">Pertemuan</label>
          <select class="form-select" id="asMeet">${meetings.map(m => `<option value="${m.meeting_id}" ${m.meeting_id === a.meeting_id ? 'selected' : ''}>${esc(m.judul)}</option>`).join('')}</select></div>
        <div class="col-12"><label class="form-label" for="asIns">Instruksi</label><textarea class="form-control" id="asIns" rows="3" maxlength="20000">${esc(a.instruksi || '')}</textarea></div>
        <div class="col-md-4"><label class="form-label" for="asTipe">Tipe jawaban</label>
          <select class="form-select" id="asTipe">${Object.entries(TIPE_JAWABAN).map(([k, l]) => `<option value="${k}" ${a.tipe_jawaban === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="col-md-4"><label class="form-label" for="asMode">Mode</label>
          <select class="form-select" id="asMode"><option value="individu" ${a.mode === 'individu' ? 'selected' : ''}>Individu</option><option value="kelompok" ${a.mode === 'kelompok' ? 'selected' : ''}>Kelompok</option></select></div>
        <div class="col-md-4"><label class="form-label" for="asKomp">Alokasi nilai ke bobot</label>
          <select class="form-select" id="asKomp">${detail.weights.map(w => `<option value="${esc(w.komponen)}" ${w.komponen === a.komponen_bobot ? 'selected' : ''}>${esc(w.label || kompLabel(w.komponen))} (${w.bobot_persen}%)</option>`).join('')}</select>
          <div class="form-text">Dihitung otomatis ke komponen ini di tab Nilai.</div></div>
        <div class="col-md-4"><label class="form-label" for="asMaks">Nilai maksimum</label><input class="form-control" id="asMaks" type="number" min="1" max="1000" value="${esc(a.nilai_maks)}"></div>
        <div class="col-md-4"><label class="form-label" for="asTenggat">Tenggat</label><input class="form-control" id="asTenggat" type="datetime-local" value="${esc(toLocalInput(a.tenggat))}"></div>
        <div class="col-md-4"><label class="form-label" for="asRubrik">Rubrik</label>
          <select class="form-select" id="asRubrik"><option value="">Tanpa rubrik</option>${rubrics.map(r => `<option value="${r.rubric_id}" ${r.rubric_id === a.rubric_id ? 'selected' : ''}>${esc(r.nama_rubrik)}</option>`).join('')}</select>
          <div class="form-text">Buat rubrik lewat tombol Rubrik di tab Tugas.</div></div>
        <div class="col-12" id="asExamBox"><div class="ss-card ss-card-tight" style="background:var(--surface-2)">
          <div class="d-flex align-items-center gap-2 mb-2"><i class="bi bi-stopwatch"></i><b>Ujian berwaktu</b><span class="text-muted-ss small-ss">(opsional — untuk Pilihan ganda atau Teks/esai, individu)</span></div>
          <div class="row g-2">
            <div class="col-md-4"><label class="form-label small-ss" for="asWaktu">Mode waktu</label><select class="form-select" id="asWaktu">
              <option value="" ${!a.waktu_mode ? 'selected' : ''}>Tanpa batas waktu (tugas biasa)</option><option value="total" ${a.waktu_mode === 'total' ? 'selected' : ''}>Waktu total untuk semua soal</option><option value="per_soal" ${a.waktu_mode === 'per_soal' ? 'selected' : ''}>Waktu per soal</option></select></div>
            <div class="col-md-3 exam-opt"><label class="form-label small-ss" for="asDur" id="asDurLabel">Durasi (menit)</label><input class="form-control" id="asDur" type="number" min="1" value="${a.waktu_mode === 'total' ? Math.round((a.waktu_detik || 1800) / 60) : (a.waktu_detik || 30)}"></div>
            <div class="col-md-5 exam-opt small-ss d-flex flex-column justify-content-end">
              <label class="form-check mb-0"><input class="form-check-input" type="checkbox" id="asAcakSoal" ${a.waktu_mode ? (a.acak_soal ? 'checked' : '') : 'checked'}> <span class="form-check-label">Acak urutan soal</span></label>
              <label class="form-check mb-0"><input class="form-check-input" type="checkbox" id="asAcakOpsi" ${a.waktu_mode ? (a.acak_opsi ? 'checked' : '') : 'checked'}> <span class="form-check-label">Acak urutan pilihan jawaban</span></label>
              <label class="form-check mb-0"><input class="form-check-input" type="checkbox" id="asPantau" ${a.waktu_mode ? (a.pantau_tab ? 'checked' : '') : 'checked'}> <span class="form-check-label">Peringatan &amp; catatan bila keluar halaman</span></label>
              <label class="form-check mb-0"><input class="form-check-input" type="checkbox" id="asLayar" ${a.waktu_mode ? (a.layar_penuh ? 'checked' : '') : 'checked'}> <span class="form-check-label">Coba mode layar penuh</span></label></div></div>
          <div class="form-text exam-opt">Waktu dijaga server (tidak bisa dicurangi lewat browser). Ujian terkumpul otomatis saat waktu habis. Peringatan keluar halaman hanya mengingatkan mahasiswa dan mencatat untuk Anda; tidak menghentikan ujian. Layar penuh bergantung perangkat. Kamera tidak tersedia di aplikasi ini.</div></div></div>
        <div class="col-md-6"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="asRev" ${a.izinkan_revisi ? 'checked' : ''}>
          <label class="form-check-label" for="asRev">Izinkan permintaan revisi</label></div></div>
        <div class="col-md-6"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="asLate" ${a.terima_terlambat ? 'checked' : ''}>
          <label class="form-check-label" for="asLate">Terima pengiriman setelah tenggat (ditandai terlambat)</label></div></div>
      </div>
      <div id="qSection" class="mt-4">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><h3 class="h6 mb-0">Soal pilihan ganda <span id="qCount" class="text-muted-ss fw-normal"></span></h3>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-soft btn-sm" onclick="qAdd()"><i class="bi bi-plus-lg"></i> Soal</button>
            <button type="button" class="btn btn-soft btn-sm" onclick="qToggleImport()"><i class="bi bi-clipboard-plus"></i> Impor banyak soal</button></div></div>
        <div id="qImport" class="d-none ss-card ss-card-tight mb-3">
          <div class="fw-600 small-ss mb-1">Tempel soal dari Word/teks (satu blok per soal)</div>
          <textarea id="qPaste" class="form-control" rows="7" placeholder="1. Ibu kota Indonesia adalah…&#10;A. Jakarta&#10;B. Bandung&#10;C. Surabaya&#10;D. Medan&#10;Jawaban: A"></textarea>
          <div class="d-flex flex-wrap gap-2 mt-2 align-items-center">
            <button type="button" class="btn btn-ink btn-sm" onclick="qImportText()">Tambahkan soal dari teks</button>
            <label class="btn btn-soft btn-sm mb-0"><i class="bi bi-file-earmark-excel"></i> Impor dari Excel<input type="file" accept=".xlsx,.xls,.csv" class="d-none" id="qExcel"></label>
            <button type="button" class="btn btn-ghost btn-sm" onclick="qTemplateExcel()"><i class="bi bi-download"></i> Template Excel</button>
            <span id="qImportMsg" class="small-ss" role="status"></span></div>
          <div class="form-text">Format teks: nomor + pertanyaan, opsi A–F, lalu baris "Jawaban: B" (boleh juga "Poin: 2"). Soal masuk di akhir daftar dan bisa diperiksa satu per satu.</div></div>
        <div id="qList"></div>
      </div></form>`;
    const foot = document.getElementById('appModalFooter');
    foot.classList.remove('d-none');
    delete foot.dataset.confirming;
    const btns = canDraft
      ? `<span id="asStatus" class="small-ss text-muted-ss me-auto" role="status"></span><button class="btn btn-soft" id="asCancel">Batal</button>
         <button class="btn btn-soft" id="asDraft" data-loading="Menyimpan…"><i class="bi bi-save"></i> Simpan draft</button>
         <button class="btn btn-ink" id="asPublish" data-loading="Menerbitkan…"><i class="bi bi-send"></i> Terbitkan</button>`
      : `<span id="asStatus" class="small-ss text-muted-ss me-auto" role="status"></span><button class="btn btn-soft" id="asCancel">Batal</button>
         <button class="btn btn-ink" id="asSave" data-loading="Menyimpan…">Simpan perubahan</button>`;
    foot.innerHTML = `<div id="asBtns" class="d-flex flex-wrap gap-2 align-items-center w-100">${btns}</div>
      <div id="asConfirm" class="flex-wrap gap-2 align-items-center w-100" style="display:none">
        <span class="me-auto small-ss" style="color:var(--warn)"><i class="bi bi-exclamation-triangle"></i> Ada perubahan yang belum disimpan.</span>
        <button class="btn btn-soft" id="asBack">Kembali mengedit</button><button class="btn btn-danger-soft" id="asDiscard">Tutup tanpa menyimpan</button></div>`;

    const syncQ = () => $('#qSection').classList.toggle('d-none', !['pilihan_ganda', 'campuran'].includes($('#asTipe').value));
    const syncExam = () => {
      const tipe = $('#asTipe').value, ok = ['pilihan_ganda', 'teks'].includes(tipe) && $('#asMode').value === 'individu';
      $('#asExamBox').classList.toggle('d-none', !ok);
      const w = $('#asWaktu'); w.querySelector('option[value="per_soal"]').disabled = tipe !== 'pilihan_ganda';
      if (!ok || (tipe !== 'pilihan_ganda' && w.value === 'per_soal')) w.value = '';
      $$('.exam-opt').forEach(el => el.classList.toggle('d-none', !w.value));
      $('#asDurLabel').textContent = w.value === 'per_soal' ? 'Waktu tiap soal (detik)' : 'Durasi total (menit)';
    };
    $('#asTipe').onchange = () => { syncQ(); syncExam(); }; $('#asMode').onchange = syncExam;
    $('#asWaktu').onchange = () => { const w = $('#asWaktu').value; if (w === 'per_soal' && Number($('#asDur').value) > 3600) $('#asDur').value = 30; if (w === 'total' && Number($('#asDur').value) < 5) $('#asDur').value = 30; syncExam(); };
    syncQ(); syncExam(); qRender();
    $('#asForm').addEventListener('input', () => { AppState.asDirty = true; });
    $('#asForm').addEventListener('change', () => { AppState.asDirty = true; });
    $('#qList').addEventListener('input', qLiveUpdate); $('#qList').addEventListener('change', qLiveUpdate);
    $('#qExcel').onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) qImportExcel(f); };

    // Penjaga: jangan sampai pekerjaan hilang karena tertutup tak sengaja
    const el = document.getElementById('appModal');
    const guard = e => { if (AppState.asDirty && document.getElementById('asForm')) { e.preventDefault(); asCloseConfirm(); } };
    el.addEventListener('hide.bs.modal', guard);
    el.addEventListener('hidden.bs.modal', function h() {
      el.removeEventListener('hide.bs.modal', guard); el.removeEventListener('hidden.bs.modal', h);
      if (AppState.asSaved && !AppState.asPublishedNav) refreshPage();
      AppState.asPublishedNav = false;
    });
    $('#asCancel').onclick = () => closeModal();

    const payload = draft => {
      qSync();
      const mcq = ['pilihan_ganda', 'campuran'].includes($('#asTipe').value);
      return {
        assignment_id: AppState.asId, meeting_id: $('#asMeet').value, judul: $('#asJudul').value.trim(), instruksi: $('#asIns').value,
        tipe_jawaban: $('#asTipe').value, mode: $('#asMode').value, komponen_bobot: $('#asKomp').value, nilai_maks: Number($('#asMaks').value),
        tenggat: $('#asTenggat').value ? new Date($('#asTenggat').value).toISOString() : '', rubric_id: $('#asRubrik').value,
        izinkan_revisi: $('#asRev').checked, terima_terlambat: $('#asLate').checked, draft: draft,
        waktu_mode: $('#asWaktu').value, waktu_detik: $('#asWaktu').value === 'total' ? Math.round(Number($('#asDur').value) * 60) : Number($('#asDur').value),
        acak_soal: $('#asAcakSoal').checked, acak_opsi: $('#asAcakOpsi').checked, pantau_tab: $('#asPantau').checked, layar_penuh: $('#asLayar').checked,
        questions: mcq ? AppState.qDraft : []
      };
    };
    const finish = (r, msg) => {
      AppState.asDirty = false; AppState.asPublishedNav = true; closeModal();
      toast(msg, '', 'success');
      if (AppState.page === 'tugas-detail') refreshPage(); else navigateTo('tugas-detail', { assignment_id: r.assignment_id });
    };
    if ($('#asDraft')) {
      $('#asDraft').onclick = e => withBtn(e.currentTarget, async () => {
        const p = payload(true);
        if (!p.judul) return toast('Judul tugas wajib diisi', 'Beri judul dulu agar draft mudah ditemukan.', 'warning');
        try {
          const r = await api('assignment.save', p);
          AppState.asId = r.assignment_id; AppState.asDirty = false; AppState.asSaved = true;
          $('#asStatus').innerHTML = `<i class="bi bi-check-circle" style="color:var(--ok)"></i> Draft tersimpan ${esc(fmtTime(new Date().toISOString()))}. Boleh dilanjutkan nanti.`;
          toast('Draft tersimpan', 'Belum terlihat oleh mahasiswa.', 'success');
        } catch (err) { toastErr(err); }
      });
      $('#asPublish').onclick = e => withBtn(e.currentTarget, async () => {
        const p = payload(false);
        if (!p.judul) return toast('Judul tugas wajib diisi', '', 'warning');
        if (['pilihan_ganda', 'campuran'].includes(p.tipe_jawaban)) {
          if (p.tipe_jawaban === 'pilihan_ganda' && !AppState.qDraft.length) return toast('Belum ada soal', 'Tambahkan minimal satu soal pilihan ganda.', 'warning');
          const bad = AppState.qDraft.findIndex(q => !qComplete(q));
          if (bad > -1) { qGo(bad); return toast(`Soal no. ${bad + 1} belum lengkap`, 'Isi pertanyaan, minimal 2 opsi, dan pilih kunci jawaban. Atau simpan sebagai draft dulu.', 'warning'); }
        }
        try { const r = await api('assignment.save', p); finish(r, 'Tugas diterbitkan. Mahasiswa mendapat notifikasi.'); } catch (err) { toastErr(err); }
      });
    }
    if ($('#asSave')) {
      $('#asSave').onclick = e => withBtn(e.currentTarget, async () => {
        const p = payload(false);
        if (!p.judul) return toast('Judul tugas wajib diisi', '', 'warning');
        try { const r = await api('assignment.save', p); finish(r, 'Perubahan disimpan'); } catch (err) { toastErr(err); }
      });
    }
  } catch (e) { body.innerHTML = errorBlock(e); }
}

/** Konfirmasi tutup: panel di footer yang tinggal ditampilkan (tombol simpan tidak ikut hilang). */
function asCloseConfirm() {
  const btns = $('#asBtns'), conf = $('#asConfirm'); if (!btns || !conf) return;
  btns.style.display = 'none'; conf.style.display = 'flex';
  $('#asBack').onclick = () => { conf.style.display = 'none'; btns.style.display = 'flex'; };
  $('#asDiscard').onclick = () => { AppState.asDirty = false; closeModal(); };
}

// ── Editor soal pilihan ganda: satu soal per layar + peta nomor (nyaman untuk 50+ soal) ──
function qHasImg(q) { return /!\[[^\]]*\]\(/.test(String(q.pertanyaan || '') + (q.opsi || []).join('')); }
/** Unggah gambar untuk teks soal (target 'q') atau opsi ke-j; markup ![gambar](drive:ID) disisipkan di akhir isian. */
async function qUploadImg(input, target) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  qSync();
  try {
    toast('Mengunggah gambar…', f.name, 'info');
    const file = await prepareImageForUpload(f);
    const r = await api('assignment.uploadImage', { class_id: AppState.asClass, file });
    _imgCache[r.file_id] = Promise.resolve(b64ToBlobUrl(file.base64, 'image/jpeg'));        // pratinjau langsung, sebelum soal disimpan
    const q = AppState.qDraft[AppState.qIdx], mk = `![gambar](drive:${r.file_id})`;
    if (target === 'q') q.pertanyaan = (q.pertanyaan ? q.pertanyaan.replace(/\s+$/, '') + '\n' : '') + mk;
    else q.opsi[target] = (q.opsi[target] ? q.opsi[target].replace(/\s+$/, '') + ' ' : '') + mk;
    AppState.asDirty = true; qRender(); toast('Gambar ditambahkan', '', 'success');
  } catch (e) { toastErr(e); }
}
function qComplete(q) {
  const opsi = q.opsi || [], k = q.kunci_jawaban;
  return !!String(q.pertanyaan || '').trim() && opsi.filter(o => String(o).trim()).length >= 2 && k !== '' && k !== undefined && k !== null && !!String(opsi[Number(k)] || '').trim();
}
function qNewBlank() { return { pertanyaan: '', opsi: ['', '', '', ''], kunci_jawaban: '', poin: 1 }; }

function qRender() {
  const box = $('#qList'); if (!box) return;
  const arr = AppState.qDraft, n = arr.length;
  const cnt = $('#qCount'); if (cnt) cnt.textContent = n ? `(${n} soal)` : '';
  if (!n) { box.innerHTML = `<div class="photo-cta" style="padding:20px"><p class="mb-2">Belum ada soal.</p><button type="button" class="btn btn-ink btn-sm" onclick="qAdd()"><i class="bi bi-plus-lg"></i> Tambah soal pertama</button></div>`; return; }
  AppState.qIdx = Math.min(Math.max(AppState.qIdx || 0, 0), n - 1);
  const i = AppState.qIdx, q = arr[i];
  while ((q.opsi || []).length < 2) (q.opsi = q.opsi || []).push('');
  const done = arr.filter(qComplete).length;
  box.innerHTML = `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <span id="qProgress" class="small-ss text-secondary-ss"></span>
      <span class="ms-auto d-flex align-items-center gap-1 small-ss"><label for="qPoinAll" class="mb-0">Poin tiap soal</label>
        <input id="qPoinAll" class="form-control form-control-sm" type="number" min="0" value="${esc(q.poin === undefined ? 1 : q.poin)}" style="width:70px;min-height:32px">
        <button type="button" class="btn btn-ghost btn-sm" onclick="qPoinAll()">Terapkan ke semua</button></span></div>
    <div class="q-nav" role="navigation" aria-label="Peta nomor soal">${arr.map((x, j) => `<button type="button" class="q-dot ${j === i ? 'cur' : ''} ${qComplete(x) ? 'ok' : 'warn'}" data-j="${j}" onclick="qGo(${j})" aria-label="Soal ${j + 1}${qComplete(x) ? '' : ' belum lengkap'}"${j === i ? ' aria-current="true"' : ''}>${j + 1}</button>`).join('')}</div>
    <div class="ss-card ss-card-tight" data-q="${i}">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><b>Soal ${i + 1} <span class="text-muted-ss fw-normal">dari ${n}</span></b>
        <div class="d-flex align-items-center gap-2"><label class="small-ss text-secondary-ss mb-0" for="qpoin">Poin</label>
          <input class="form-control form-control-sm q-poin" id="qpoin" type="number" min="0" style="width:80px;min-height:34px" value="${esc(q.poin === undefined ? 1 : q.poin)}">
          <button type="button" class="btn btn-ghost btn-sm" onclick="qDup()" title="Gandakan soal ini"><i class="bi bi-files"></i> Gandakan</button>
          <button type="button" class="btn btn-ghost btn-sm" id="qDelBtn" onclick="qDel()"><i class="bi bi-trash"></i> Hapus</button></div></div>
      <textarea class="form-control mb-1 q-text" rows="3" placeholder="Tulis pertanyaan" aria-label="Pertanyaan ${i + 1}">${esc(q.pertanyaan || '')}</textarea>
      <div class="d-flex flex-wrap align-items-center gap-2 mb-2"><label class="btn btn-soft btn-sm mb-0"><i class="bi bi-image"></i> Sisipkan gambar<input type="file" accept="image/jpeg,image/png" class="d-none" onchange="qUploadImg(this, 'q')"></label>
        <span class="form-text mt-0">Gambar JPG/PNG dikecilkan otomatis agar hemat penyimpanan.</span></div>
      ${qHasImg(q) ? `<div class="q-rich-prev mb-2"><div class="small-ss text-secondary-ss mb-1">Pratinjau soal:</div><div class="q-prev-body">${qRich(q.pertanyaan, AppState.asId)}</div>${q.opsi.map((o, j) => /!\[/.test(o) ? `<div class="small-ss mt-1"><b>${String.fromCharCode(65 + j)}.</b> ${qRich(o, AppState.asId)}</div>` : '').join('')}</div>` : ''}
      ${q.opsi.map((o, j) => `
        <div class="d-flex align-items-center gap-2 mb-1">
          <input class="form-check-input mt-0 q-key" type="radio" name="qk" value="${j}" ${String(q.kunci_jawaban) === String(j) ? 'checked' : ''} aria-label="Jadikan opsi ${String.fromCharCode(65 + j)} kunci jawaban">
          <span class="small-ss fw-600" style="width:16px">${String.fromCharCode(65 + j)}</span>
          <input class="form-control form-control-sm q-opt" style="min-height:36px" value="${esc(o)}" placeholder="Opsi ${String.fromCharCode(65 + j)}">
          <label class="icon-action mb-0" title="Sisipkan gambar pada opsi ${String.fromCharCode(65 + j)}" style="cursor:pointer"><i class="bi bi-image"></i><input type="file" accept="image/jpeg,image/png" class="d-none" onchange="qUploadImg(this, ${j})" aria-label="Gambar untuk opsi ${String.fromCharCode(65 + j)}"></label>
          ${q.opsi.length > 2 ? `<button type="button" class="icon-action" onclick="qDelOpt(${j})" aria-label="Hapus opsi ${String.fromCharCode(65 + j)}"><i class="bi bi-x-lg"></i></button>` : ''}
        </div>`).join('')}
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-2">
        <div>${q.opsi.length < 6 ? `<button type="button" class="btn btn-ghost btn-sm" onclick="qAddOpt()"><i class="bi bi-plus"></i> Opsi</button>` : ''}
          <span class="form-text">Pilih bulatan di kiri opsi sebagai kunci jawaban.</span></div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-soft btn-sm" onclick="qGo(${i - 1})" ${i === 0 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Sebelumnya</button>
          ${i < n - 1 ? `<button type="button" class="btn btn-soft btn-sm" onclick="qGo(${i + 1})">Berikutnya <i class="bi bi-chevron-right"></i></button>`
            : `<button type="button" class="btn btn-ink btn-sm" onclick="qAdd()"><i class="bi bi-plus-lg"></i> Soal berikutnya</button>`}</div></div>
    </div>`;
  qUpdateProgress();
}
function qUpdateProgress() {
  const arr = AppState.qDraft, done = arr.filter(qComplete).length, el = $('#qProgress');
  if (el) el.innerHTML = `${done} dari ${arr.length} soal lengkap${done < arr.length ? ` — <span style="color:var(--warn)">${arr.length - done} belum lengkap (bernomor kuning)</span>` : ''}`;
}
/** Perbarui warna nomor soal & progres saat mengetik, tanpa render ulang (agar kursor tidak lompat). */
function qLiveUpdate() {
  qCollect();
  const i = AppState.qIdx, dot = $(`#qList .q-dot[data-j="${i}"]`);
  if (dot) { const ok = qComplete(AppState.qDraft[i]); dot.classList.toggle('ok', ok); dot.classList.toggle('warn', !ok); }
  qUpdateProgress();
}
/** Lepas fokus dari isian editor lebih dulu (memicu "change" saat tampilan lama masih utuh), baru baca nilainya. */
function qSync() { const a = document.activeElement; if (a && a.closest && a.closest('#qList')) a.blur(); qCollect(); }
function qCollect() {
  const el = $('#qList [data-q]'); if (!el) return;
  const q = AppState.qDraft[Number(el.dataset.q)]; if (!q) return;
  q.pertanyaan = el.querySelector('.q-text').value;
  q.poin = Number(el.querySelector('.q-poin').value || 0);
  q.opsi = $$('.q-opt', el).map(x => x.value);
  const k = el.querySelector('.q-key:checked'); q.kunci_jawaban = k ? Number(k.value) : '';
}
function qGo(i) { if (i < 0 || i >= AppState.qDraft.length) return; qSync(); AppState.qIdx = i; qRender(); const t = $('#qList .q-text'); if (t) t.focus(); }
function qAdd() { qSync(); AppState.qDraft.push(qNewBlank()); AppState.qIdx = AppState.qDraft.length - 1; AppState.asDirty = true; qRender(); const t = $('#qList .q-text'); if (t) t.focus(); }
function qDup() { qSync(); const q = AppState.qDraft[AppState.qIdx]; const c = Object.assign({}, q, { opsi: q.opsi.slice() }); delete c.question_id; AppState.qDraft.splice(AppState.qIdx + 1, 0, c); AppState.qIdx++; AppState.asDirty = true; qRender(); }
function qDel() {
  const b = $('#qDelBtn');
  if (!AppState.qDelArmed) { // klik kedua dalam 3 detik = konfirmasi (tanpa dialog agar isian tidak tertimpa)
    AppState.qDelArmed = true; if (b) b.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Klik lagi untuk hapus';
    setTimeout(() => { AppState.qDelArmed = false; const bb = $('#qDelBtn'); if (bb) bb.innerHTML = '<i class="bi bi-trash"></i> Hapus'; }, 3000); return;
  }
  AppState.qDelArmed = false; qSync(); AppState.qDraft.splice(AppState.qIdx, 1); AppState.asDirty = true; qRender(); toast('Soal dihapus', '', 'info');
}
function qAddOpt() { qSync(); const q = AppState.qDraft[AppState.qIdx]; if (q.opsi.length < 6) q.opsi.push(''); qRender(); }
function qDelOpt(j) {
  qSync(); const q = AppState.qDraft[AppState.qIdx]; if (q.opsi.length <= 2) return;
  q.opsi.splice(j, 1);
  if (q.kunci_jawaban === j) q.kunci_jawaban = ''; else if (q.kunci_jawaban !== '' && q.kunci_jawaban > j) q.kunci_jawaban -= 1;
  AppState.asDirty = true; qRender();
}
function qPoinAll() { qSync(); const v = Number($('#qPoinAll').value); if (isNaN(v) || v < 0) return toast('Poin tidak valid', '', 'warning'); AppState.qDraft.forEach(q => { q.poin = v; }); AppState.asDirty = true; qRender(); toast('Poin diterapkan', `${v} poin untuk ${AppState.qDraft.length} soal.`, 'success'); }

// ── Impor banyak soal ──
function qToggleImport() { $('#qImport').classList.toggle('d-none'); if (!$('#qImport').classList.contains('d-none')) $('#qPaste').focus(); }

/** Urai teks: "1. Pertanyaan / A. opsi / B. opsi / Jawaban: B / Poin: 2". */
function parseQuestionsText(text) {
  const out = []; let cur = null, inOpts = false;
  const flush = () => { if (cur && (cur.pertanyaan.trim() || cur.opsi.length)) out.push(cur); cur = null; inOpts = false; };
  const fresh = t => ({ pertanyaan: t, opsi: [], kunci_jawaban: '', poin: 1 });
  String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim(); let m;
    if (!line) { if (cur && cur.opsi.length) flush(); return; }
    if ((m = line.match(/^(?:jawaban|kunci(?:\s*jawaban)?|answer|ans)\s*[:=\-]\s*\(?([A-Fa-f])\b/i))) { if (cur) cur.kunci_jawaban = m[1].toUpperCase().charCodeAt(0) - 65; return; }
    if ((m = line.match(/^(?:poin|skor|bobot)\s*[:=]\s*(\d+(?:[.,]\d+)?)/i))) { if (cur) cur.poin = Number(m[1].replace(',', '.')); return; }
    if (cur && (m = line.match(/^\(?([A-Fa-f])[\.\)]\s+(.+)$/))) { cur.opsi.push(m[2].trim()); inOpts = true; return; }
    if ((m = line.match(/^(\d{1,3})[\.\)]\s+(.+)$/))) { flush(); cur = fresh(m[2].trim()); return; }
    if (cur) { if (inOpts && cur.opsi.length) cur.opsi[cur.opsi.length - 1] += ' ' + line; else cur.pertanyaan += ' ' + line; }
    else cur = fresh(line);
  });
  flush();
  return out.map(q => {
    while (q.opsi.length < 2) q.opsi.push('');
    if (q.opsi.length > 6) q.opsi = q.opsi.slice(0, 6);
    if (q.kunci_jawaban !== '' && q.kunci_jawaban >= q.opsi.length) q.kunci_jawaban = '';
    return q;
  });
}
function qAppendImported(list, msgEl) {
  if (!list.length) { msgEl.innerHTML = '<span style="color:var(--bad)">Tidak ada soal yang terbaca. Periksa formatnya.</span>'; return; }
  qSync();
  const first = AppState.qDraft.length;
  AppState.qDraft.push(...list); AppState.qIdx = first; AppState.asDirty = true; qRender();
  const incomplete = list.filter(q => !qComplete(q)).length;
  msgEl.innerHTML = '';
  $('#qImport').classList.add('d-none');                       // tutup panel agar editor langsung terlihat
  toast(`${list.length} soal ditambahkan`, incomplete ? `${incomplete} belum lengkap (bernomor kuning, biasanya belum ada kunci jawaban).` : 'Semua soal lengkap.', incomplete ? 'warning' : 'success');
  const l = $('#qList'); if (l && l.scrollIntoView) l.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function qImportText() {
  const msg = $('#qImportMsg'); const list = parseQuestionsText($('#qPaste').value);
  qAppendImported(list, msg); if (list.length) $('#qPaste').value = '';
}
async function qImportExcel(file) {
  const msg = $('#qImportMsg'); msg.innerHTML = '<span class="spinner-inline"></span> Membaca Excel…';
  try {
    await loadLib('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const hi = rows.findIndex(r => r.some(c => /^(pertanyaan|soal)$/i.test(String(c).trim())));
    if (hi < 0) throw new Error('Kolom "Pertanyaan" tidak ditemukan. Unduh Template Excel untuk contoh formatnya.');
    const head = rows[hi].map(c => String(c).trim().toLowerCase());
    const cq = head.findIndex(h => /^(pertanyaan|soal)$/.test(h));
    const cOpt = {}; head.forEach((h, i) => { const m = h.match(/^(?:opsi\s*)?([a-f])$/); if (m) cOpt[m[1].charCodeAt(0) - 97] = i; });
    const cKey = head.findIndex(h => /kunci|jawaban/.test(h)), cPoin = head.findIndex(h => /poin|skor/.test(h));
    if (Object.keys(cOpt).length < 2) throw new Error('Kolom opsi (A, B, C, D) tidak ditemukan.');
    const list = [];
    rows.slice(hi + 1).forEach(r => {
      const pert = String(r[cq] || '').trim(); if (!pert) return;
      const opsi = []; Object.keys(cOpt).map(Number).sort((a, b) => a - b).forEach(j => { opsi[j] = String(r[cOpt[j]] === undefined ? '' : r[cOpt[j]]).trim(); });
      for (let j = 0; j < opsi.length; j++) if (opsi[j] === undefined) opsi[j] = '';
      while (opsi.length > 2 && !opsi[opsi.length - 1]) opsi.pop();
      let kunci = ''; if (cKey > -1) { const kv = String(r[cKey]).trim(); if (/^[a-fA-F]$/.test(kv)) kunci = kv.toUpperCase().charCodeAt(0) - 65; else if (/^[1-6]$/.test(kv)) kunci = Number(kv) - 1; }
      const poin = cPoin > -1 && String(r[cPoin]).trim() !== '' ? Number(String(r[cPoin]).replace(',', '.')) : 1;
      while (opsi.length < 2) opsi.push('');
      list.push({ pertanyaan: pert, opsi, kunci_jawaban: kunci !== '' && kunci < opsi.length ? kunci : '', poin: isNaN(poin) ? 1 : poin });
    });
    qAppendImported(list, msg);
  } catch (e) { msg.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}
async function qTemplateExcel() {
  try {
    await loadLib('xlsx');
    const aoa = [['Pertanyaan', 'A', 'B', 'C', 'D', 'Kunci', 'Poin'], ['Ibu kota Indonesia adalah…', 'Jakarta', 'Bandung', 'Surabaya', 'Medan', 'A', 1], ['2 + 2 = …', '3', '4', '5', '6', 'B', 1]];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 50 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Soal'); XLSX.writeFile(wb, 'Template Soal Pilihan Ganda.xlsx');
  } catch (e) { toastErr(e); }
}

// ── Rubrik ──
async function openRubricManager() {
  const classId = AppState.params.class_id;
  const body = openModal({ title: 'Rubrik penilaian', body: loadingBlock(), size: 'modal-lg' });
  try {
    const list = await api('rubric.list', { class_id: classId });
    body.innerHTML = `<div class="d-flex justify-content-end mb-3"><button class="btn btn-ink btn-sm" onclick="openRubricForm()"><i class="bi bi-plus-lg"></i> Rubrik baru</button></div>
      ${list.length ? list.map(r => `<div class="item-row"><div class="item-icon ii-task"><i class="bi bi-list-check"></i></div>
        <div class="flex-grow-1"><div class="i-title">${esc(r.nama_rubrik)}</div><div class="i-sub">${r.kriteria.length} kriteria — total skor ${r.kriteria.reduce((s, k) => s + Number(k.skor_maks), 0)}${r.kriteria.some(k => k.aturan) ? ' — <i class="bi bi-lightbulb"></i> ada saran nilai otomatis' : ''}</div></div>
        <button class="icon-action" onclick='openRubricForm(${JSON.stringify(r.rubric_id)})' aria-label="Ubah rubrik"><i class="bi bi-pencil"></i></button>
        <button class="icon-action" onclick='deleteRubric(${JSON.stringify(r.rubric_id)})' aria-label="Hapus rubrik"><i class="bi bi-trash"></i></button></div>`).join('')
        : emptyState('Belum ada rubrik', 'Rubrik membantu menilai esai/proyek per kriteria; nilai tugas dihitung otomatis.')}`;
    AppState.rubrics = list;
  } catch (e) { body.innerHTML = errorBlock(e); }
}

function openRubricForm(id) {
  const r = id ? (AppState.rubrics || []).find(x => x.rubric_id === id) : null;
  const rows = r ? r.kriteria : [{ nama: 'Isi', deskripsi: '', skor_maks: 40 }, { nama: 'Struktur', deskripsi: '', skor_maks: 30 }, { nama: 'Presentasi', deskripsi: '', skor_maks: 30 }];
  const rowHtml = k => { const a = k.aturan || {}; return `<div class="rb-item mb-3"><div class="row g-2 rb-row">
      <div class="col-md-4"><input class="form-control rb-nama" placeholder="Kriteria" value="${esc(k.nama)}" aria-label="Nama kriteria"></div>
      <div class="col-md-5"><input class="form-control rb-desk" placeholder="Deskripsi (opsional)" value="${esc(k.deskripsi || '')}" aria-label="Deskripsi kriteria"></div>
      <div class="col-8 col-md-2"><input class="form-control rb-maks" type="number" min="1" value="${esc(k.skor_maks)}" aria-label="Skor maksimum"></div>
      <div class="col-4 col-md-1"><button type="button" class="icon-action" onclick="this.closest('.rb-item').remove()" aria-label="Hapus kriteria"><i class="bi bi-x-lg"></i></button></div></div>
    <details class="rb-rules mt-1" ${Object.keys(a).length ? 'open' : ''}><summary class="small-ss fw-600" style="cursor:pointer"><i class="bi bi-lightbulb"></i> Aturan saran nilai <span class="text-muted-ss fw-normal">(opsional, tanpa AI)</span></summary>
      <div class="row g-2 mt-1">
        <div class="col-md-6"><label class="form-label small-ss">Konsep / kata kunci <span class="text-muted-ss">(satu per baris; sinonim dipisah |)</span></label>
          <textarea class="form-control rb-kw" rows="3" placeholder="normalisasi|normalization&#10;primary key|kunci utama">${esc((a.kata_kunci || []).join('\n'))}</textarea></div>
        <div class="col-md-6"><label class="form-label small-ss">Bagian wajib <span class="text-muted-ss">(judul bagian, satu per baris)</span></label>
          <textarea class="form-control rb-sec" rows="3" placeholder="pendahuluan&#10;pembahasan|isi&#10;kesimpulan">${esc((a.bagian || []).join('\n'))}</textarea></div>
        <div class="col-4 col-md-3"><label class="form-label small-ss">Min. kata</label><input class="form-control rb-min" type="number" min="0" value="${esc(a.min_kata || '')}"></div>
        <div class="col-4 col-md-3"><label class="form-label small-ss">Maks. kata</label><input class="form-control rb-max" type="number" min="0" value="${esc(a.max_kata || '')}"></div>
        <div class="col-4 col-md-3"><label class="form-label small-ss">Min. referensi</label><input class="form-control rb-ref" type="number" min="0" value="${esc(a.min_referensi || '')}"></div>
        <div class="col-12 col-md-3 d-flex flex-column justify-content-end small-ss">
          <label class="form-check"><input class="form-check-input rb-late" type="checkbox" ${a.tepat_waktu ? 'checked' : ''}> <span class="form-check-label">Dikirim tepat waktu</span></label>
          <label class="form-check"><input class="form-check-input rb-att" type="checkbox" ${a.wajib_lampiran ? 'checked' : ''}> <span class="form-check-label">Ada file/tautan lampiran</span></label></div>
      </div>
      <div class="form-text">Sistem menghitung skor <b>saran</b> dari aturan ini (rata-rata ketercapaian tiap aturan). Dosen yang memutuskan nilai akhir. Aturan tidak terlihat oleh mahasiswa.</div></details></div>`; };
  openModal({
    title: r ? 'Ubah rubrik' : 'Rubrik baru', size: 'modal-lg',
    body: `<div class="mb-3"><label class="form-label" for="rbNama">Nama rubrik</label><input class="form-control" id="rbNama" value="${esc(r ? r.nama_rubrik : '')}" maxlength="120"></div>
      <label class="form-label">Kriteria dan skor maksimum</label><div id="rbRows">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="rbAdd"><i class="bi bi-plus"></i> Kriteria</button>`,
    footer: `<button class="btn btn-soft" onclick="openRubricManager()">Kembali</button><button class="btn btn-ink" id="rbSave">Simpan rubrik</button>`
  });
  $('#rbAdd').onclick = () => $('#rbRows').insertAdjacentHTML('beforeend', rowHtml({ nama: '', deskripsi: '', skor_maks: 10 }));
  $('#rbSave').onclick = e => withBtn(e.currentTarget, async () => {
    const kriteria = $$('#rbRows .rb-item').map(x => ({
      nama: $('.rb-nama', x).value.trim(), deskripsi: $('.rb-desk', x).value.trim(), skor_maks: Number($('.rb-maks', x).value),
      aturan: { kata_kunci: $('.rb-kw', x).value, bagian: $('.rb-sec', x).value, min_kata: Number($('.rb-min', x).value || 0), max_kata: Number($('.rb-max', x).value || 0), min_referensi: Number($('.rb-ref', x).value || 0), tepat_waktu: $('.rb-late', x).checked, wajib_lampiran: $('.rb-att', x).checked }
    }));
    try { await api('rubric.save', { class_id: AppState.params.class_id, rubric_id: id || '', nama_rubrik: $('#rbNama').value.trim(), kriteria }); toast('Rubrik disimpan', '', 'success'); openRubricManager(); }
    catch (err) { toastErr(err); }
  });
}

async function deleteRubric(id) {
  try { await api('rubric.delete', { rubric_id: id }); toast('Rubrik dihapus', '', 'success'); openRubricManager(); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 15: DETAIL TUGAS (mahasiswa mengerjakan / staf menilai)
// ════════════════════════════════════════════════════════

async function renderTugasDetail(params, c) {
  let first = true;
  await swr('assignment.get', { assignment_id: params.assignment_id }, g => { drawTugasDetail(c, g, first); first = false; }, { empty: () => { c.innerHTML = skeleton('list'); } });
}

function drawTugasDetail(c, g, first) {
  AppState.task = g;
  if (first) AppState.gradeFilter = AppState.params.filter || 'semua'; // datang dari dashboard → langsung tersaring
  const a = g.assignment, acc = g.access, dl = relDeadline(a.tenggat);
  const canEdit = acc.perms.includes('tugas') && !g.kelas.archived;
  $('#pageTitle').textContent = a.judul;
  c.innerHTML = `
    <div class="page-head"><div class="min-w-0">
        <a href="javascript:void(0)" class="small-ss fw-600 text-decoration-none" onclick="navigateTo('kelas-detail',{class_id:'${g.kelas.class_id}',tab:'tugas'})"><i class="bi bi-arrow-left"></i> ${esc(g.kelas.nama_kelas)}</a>
        <h1 class="mt-1">${esc(a.judul)}</h1>
        <div class="d-flex flex-wrap gap-2 mt-2">${badge(TIPE_JAWABAN[a.tipe_jawaban], 'b-accent')}${badge(a.mode === 'kelompok' ? 'Kelompok' : 'Individu', 'b-muted', a.mode === 'kelompok' ? 'bi-people' : 'bi-person')}
          ${badge('Bobot: ' + (a.komponen_nama || kompLabel(a.komponen_bobot)), 'b-muted')}${badge('Nilai maks ' + a.nilai_maks, 'b-muted')}<span class="badge-ss ${dl.cls}"><i class="bi bi-clock"></i>${esc(dl.text)}</span></div></div>
      ${canEdit ? `<div class="d-flex gap-2"><button class="btn btn-soft btn-sm" onclick="openAssignmentForm({assignment_id:'${a.assignment_id}',class_id:'${g.kelas.class_id}'})"><i class="bi bi-pencil"></i> Ubah</button>
        <button class="btn btn-danger-soft btn-sm" onclick="deleteAssignment('${a.assignment_id}','${g.kelas.class_id}')"><i class="bi bi-trash"></i></button></div>` : ''}</div>
    ${a.draft ? `<div class="ann-banner penting"><i class="bi bi-pencil-square"></i><div class="flex-grow-1"><div class="fw-bold">Draft — belum terlihat oleh mahasiswa</div>
      <div class="small-ss">Lengkapi lalu terbitkan. Mahasiswa baru mendapat notifikasi saat tugas diterbitkan.</div></div>
      ${canEdit ? `<div class="d-flex flex-wrap gap-2"><button class="btn btn-soft btn-sm" onclick="openAssignmentForm({assignment_id:'${a.assignment_id}',class_id:'${g.kelas.class_id}'})"><i class="bi bi-pencil"></i> Lanjutkan mengedit</button>
        <button class="btn btn-ink btn-sm" onclick="publishAssignment('${a.assignment_id}', this)" data-loading="Menerbitkan…"><i class="bi bi-send"></i> Terbitkan</button></div>` : ''}</div>` : ''}
    <div class="ss-card mb-3"><div class="small-ss text-secondary-ss mb-1">${esc(g.pertemuan)}</div>
      <div style="white-space:pre-wrap">${a.instruksi ? esc(a.instruksi) : '<span class="text-muted-ss">Tidak ada instruksi tambahan.</span>'}</div>
      ${g.rubric ? `<hr><div class="small-ss fw-600 mb-2">Rubrik: ${esc(g.rubric.nama_rubrik)}</div>
        <div class="d-flex flex-wrap gap-2">${g.rubric.kriteria.map(k => badge(k.nama + ' (' + k.skor_maks + ')', 'b-muted')).join('')}</div>` : ''}</div>
    ${acc.isStudent ? '<div id="studentWork"></div>' : ''}
    ${acc.perms.includes('nilai') && !a.draft ? `<div id="gradingArea" class="${acc.isStudent ? 'mt-4' : ''}">${loadingBlock('Memuat daftar pengiriman…')}</div>` : ''}`;
  if (acc.isStudent) renderStudentWork(g);
  if (acc.perms.includes('nilai') && !a.draft) { if (first || !AppState.grading) loadGrading(); else drawGrading(); }
}

async function publishAssignment(id, btn) {
  await withBtn(btn, async () => {
    try { await api('assignment.publish', { assignment_id: id }); toast('Tugas diterbitkan', 'Mahasiswa mendapat notifikasi.', 'success'); refreshPage(); }
    catch (e) { toastErr(e); }
  });
}

async function deleteAssignment(id, classId) {
  if (!await confirmDialog('Hapus tugas ini? Tugas yang sudah memiliki pengiriman tidak bisa dihapus.', { okText: 'Hapus', danger: true })) return;
  try { await api('assignment.delete', { assignment_id: id }); toast('Tugas dihapus', '', 'success'); navigateTo('kelas-detail', { class_id: classId, tab: 'tugas' }, { noHistory: true }); }
  catch (e) { toastErr(e); }
}

// ── Mahasiswa: kerjakan, simpan draft, kirim, riwayat versi ──
function renderStudentWork(g) {
  const a = g.assignment, st = g.state, box = $('#studentWork');
  if (g.ujian) return renderExamCard(g, box);
  const latest = g.versions[0] || null;
  const editable = (!latest || ['Draft', 'Perlu Revisi'].includes(latest.status)) && !g.kelas.archived && !(st.lewat_tenggat && !a.terima_terlambat);
  const groupBlocked = a.mode === 'kelompok' && !g.group;
  const src = latest && latest.status === 'Draft' ? latest : (latest || {});
  const pgAns = src.jawaban_pg || {};
  const revNote = latest && latest.status === 'Perlu Revisi' && latest.nilai ? latest.nilai.komentar : '';
  const showText = ['teks', 'campuran'].includes(a.tipe_jawaban), showPg = ['pilihan_ganda', 'campuran'].includes(a.tipe_jawaban), showFile = ['file', 'campuran'].includes(a.tipe_jawaban);
  box.innerHTML = `
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="ss-card">
          <div class="card-head"><h2>Jawaban</h2>${subStatusBadge(st.status)}</div>
          ${a.mode === 'kelompok' ? (g.group ? `<div class="small-ss mb-3"><i class="bi bi-people"></i> ${esc(g.group.nama_kelompok)}: ${g.group.anggota.map(m => esc(m.nama)).join(', ')}
              <span class="text-secondary-ss">— satu pengiriman mewakili seluruh kelompok.</span></div>`
            : `<div class="answer-box mb-3" style="white-space:normal">Tugas kelompok. Kamu belum punya kelompok.
              <button class="btn btn-soft btn-sm ms-2" onclick="navigateTo('kelas-detail',{class_id:'${g.kelas.class_id}',tab:'kelompok'})">Pilih kelompok</button></div>`) : ''}
          ${revNote ? `<div class="answer-box mb-3" style="border-color:var(--warn);background:var(--warn-soft)"><b>Catatan revisi:</b> ${esc(revNote)}</div>` : ''}
          ${st.lewat_tenggat && editable ? `<div class="small-ss mb-3" style="color:var(--warn)"><i class="bi bi-exclamation-triangle"></i> Tenggat sudah lewat. Pengiriman akan ditandai terlambat.</div>` : ''}
          ${editable && !groupBlocked ? `
            ${showPg ? `<div class="mb-3">${g.questions.map((q, i) => `<fieldset class="mb-3"><legend class="fs-6 fw-600">${i + 1}. ${qRich(q.pertanyaan, a.assignment_id)} <span class="small-ss text-muted-ss">(${q.poin} poin)</span></legend>
                ${q.opsi.map((o, j) => `<label class="option-tile"><input class="form-check-input mt-1" type="radio" name="pg_${q.question_id}" value="${j}" ${String(pgAns[q.question_id]) === String(j) ? 'checked' : ''}>
                  <span><b>${String.fromCharCode(65 + j)}.</b> ${qRich(o, a.assignment_id)}</span></label>`).join('')}</fieldset>`).join('')}</div>` : ''}
            ${showText ? `<div class="mb-3"><label class="form-label" for="swText">Jawaban teks</label><textarea class="form-control" id="swText" rows="8">${esc(src.jawaban_teks || '')}</textarea></div>` : ''}
            ${showFile ? `<div class="mb-3"><label class="form-label" for="swFile">Unggah file</label>
                <input class="form-control" id="swFile" type="file" accept="${FILE_ACCEPT}">
                <div class="form-text">PDF/DOC/DOCX/JPG/PNG maks 10 MB, MP4 maks 30 MB.${src.nama_file ? ' File tersimpan: ' + esc(src.nama_file) + '.' : ''}</div></div>
              <div class="mb-3"><label class="form-label" for="swLink">Atau tempel link (Drive/YouTube/GitHub)</label><input class="form-control" id="swLink" type="url" placeholder="https://" value="${esc(src.link_eksternal || '')}"></div>` : ''}
            <div class="d-flex flex-wrap gap-2 justify-content-end">
              <button class="btn btn-soft" id="swDraft" data-loading="Menyimpan…"><i class="bi bi-save"></i> Simpan draft</button>
              <button class="btn btn-ink" id="swSend" data-loading="Mengirim…"><i class="bi bi-send"></i> Kirim jawaban</button></div>`
          : `<p class="text-secondary-ss mb-0">${latest ? (latest.status === 'Dinilai' ? 'Tugas sudah dinilai.' : 'Jawaban sudah dikirim. Tunggu penilaian atau permintaan revisi dari dosen.') : groupBlocked ? '' : st.lewat_tenggat ? 'Tenggat sudah lewat dan pengiriman terlambat tidak diterima.' : 'Kelas sudah diarsipkan.'}</p>`}
        </div>
      </div>
      <div class="col-lg-4">
        <div class="ss-card"><div class="card-head"><h2>Nilai & riwayat versi</h2></div>
          ${st.skor !== null ? `<div class="d-flex align-items-baseline gap-2 mb-3"><span class="kpi-value" style="margin:0">${st.skor}</span><span class="text-secondary-ss">/ ${a.nilai_maks}</span></div>` : ''}
          ${g.versions.length ? g.versions.map(v => versionCardHtml(v, g)).join('') : '<p class="small-ss text-muted-ss mb-0">Belum ada pengiriman.</p>'}
        </div>
      </div>
    </div>`;
  if (!editable || groupBlocked) return;
  const collect = kirim => {
    const p = { assignment_id: a.assignment_id, kirim };
    if (showText) p.jawaban_teks = $('#swText').value;
    if (showPg) { p.jawaban_pg = {}; g.questions.forEach(q => { const r = $(`input[name="pg_${q.question_id}"]:checked`); if (r) p.jawaban_pg[q.question_id] = Number(r.value); }); }
    if (showFile) p.link_eksternal = $('#swLink').value.trim();
    return p;
  };
  const send = async (btn, kirim) => withBtn(btn, async () => {
    try {
      const p = collect(kirim);
      if (showFile && $('#swFile').files[0]) p.file = await readFileBase64($('#swFile').files[0]);
      if (kirim && !await confirmDialog('Kirim jawaban sekarang? Setelah dikirim, jawaban terkunci sampai dinilai atau diminta revisi.', { okText: 'Kirim' })) return;
      const r = await api('submission.save', p);
      toast(kirim ? 'Jawaban terkirim' : 'Draft tersimpan', r.status === 'Dinilai' ? 'Dinilai otomatis.' : '', 'success');
      refreshPage();
    } catch (err) { toastErr(err); }
  });
  $('#swDraft').onclick = e => send(e.currentTarget, false);
  $('#swSend').onclick = e => send(e.currentTarget, true);
}

function versionCardHtml(v, g) {
  const n = v.nilai;
  return `<div class="item-row" style="display:block">
    <div class="d-flex justify-content-between align-items-center"><b class="small-ss">Versi ${v.versi}</b>${subStatusBadge(v.status)}</div>
    <div class="small-ss text-secondary-ss">${v.waktu_kirim ? 'Dikirim ' + esc(fmtDateTime(v.waktu_kirim)) : 'Belum dikirim'}${v.terlambat === 'TRUE' ? ' — terlambat' : ''}</div>
    ${v.skor_pg !== '' && v.skor_pg !== undefined && g.questions.length ? `<div class="small-ss">Skor pilihan ganda: ${esc(v.skor_pg)}%</div>` : ''}
    ${n && n.skor !== null ? `<div class="small-ss mt-1"><b>Nilai ${n.skor}</b></div>` : ''}
    ${n && n.skor_rubrik && g.rubric ? `<div class="small-ss text-secondary-ss">${g.rubric.kriteria.map((k, i) => esc(k.nama) + ': ' + esc(n.skor_rubrik[i] !== undefined ? n.skor_rubrik[i] : '-')).join(', ')}</div>` : ''}
    ${n && n.komentar ? `<div class="small-ss mt-1">"${esc(n.komentar)}"</div>` : ''}
    <div class="d-flex flex-wrap gap-2 mt-2">
      ${v.drive_file_id ? `<button class="btn btn-soft btn-sm" onclick="previewFile('submission','${v.submission_id}')"><i class="bi bi-file-earmark"></i> File</button>` : ''}
      ${v.link_eksternal ? `<a class="btn btn-soft btn-sm" href="${esc(v.link_eksternal)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-link-45deg"></i> Link</a>` : ''}
      ${v.jawaban_teks ? `<button class="btn btn-ghost btn-sm" onclick="this.nextElementSibling.classList.toggle('d-none')">Lihat teks</button><div class="answer-box d-none w-100">${esc(v.jawaban_teks)}</div>` : ''}
    </div></div>`;
}

// ── Staf: daftar pengiriman & penilaian ──
AppState.gradeFilter = 'semua';

async function loadGrading() {
  const area = $('#gradingArea'); if (!area) return;
  try {
    await swr('grading.list', { assignment_id: AppState.params.assignment_id }, d => { AppState.grading = d; drawGrading(); },
      { empty: () => { area.innerHTML = loadingBlock('Memuat daftar pengiriman…'); } });
  } catch (e) { area.innerHTML = errorBlock(e, 'loadGrading()'); }
}

function unitStatus(u) { return u.latest ? u.latest.status : 'Belum dikumpulkan'; }
function unitScore(u) {
  if (!u.latest) return null;
  for (const v of u.versions) { const n = v.nilai[u.members[0] && u.members[0].user_id]; if (n && n.skor !== null) return n.skor; }
  return null;
}

function drawGrading() {
  const d = AppState.grading, a = d.assignment, area = $('#gradingArea');
  const ro = d.kelas.archived;
  const f = AppState.gradeFilter;
  const units = d.units.filter(u => {
    const s = unitStatus(u);
    if (f === 'menunggu') return s === 'Dikirim' || s === 'Dikirim Ulang';
    if (f === 'belum') return !u.latest || s === 'Draft';
    if (f === 'dinilai') return s === 'Dinilai';
    if (f === 'revisi') return s === 'Perlu Revisi';
    return true;
  });
  const cnt = k => d.units.filter(u => { const s = unitStatus(u); return k === 'menunggu' ? (s === 'Dikirim' || s === 'Dikirim Ulang') : k === 'dinilai' ? s === 'Dinilai' : k === 'revisi' ? s === 'Perlu Revisi' : (!u.latest || s === 'Draft'); }).length;
  const group = a.mode === 'kelompok';
  area.innerHTML = `
    <div class="card-head flex-wrap"><h2 class="section-title">Penilaian</h2>
      <div class="d-flex flex-wrap gap-2">${['pilihan_ganda', 'campuran'].includes(a.tipe_jawaban) && !ro ? `<button class="btn btn-soft btn-sm" onclick="regradePg()"><i class="bi bi-arrow-repeat"></i> Nilai ulang pilihan ganda</button>` : ''}</div></div>
    <div class="tabs-pill">${[['semua', 'Semua', d.units.length], ['menunggu', 'Menunggu', cnt('menunggu')], ['belum', 'Belum kirim', cnt('belum')], ['revisi', 'Revisi', cnt('revisi')], ['dinilai', 'Dinilai', cnt('dinilai')]]
      .map(([k, l, n]) => `<button class="${f === k ? 'active' : ''}" onclick="AppState.gradeFilter='${k}';drawGrading()">${l} <span class="opacity-75">${n}</span></button>`).join('')}</div>
    ${!ro && !group ? `<div class="ss-card ss-card-tight mb-3 d-flex flex-wrap align-items-center gap-2">
      <span class="small-ss fw-600">Penilaian massal:</span><span class="small-ss text-secondary-ss" id="bulkCount">0 dipilih</span>
      <input class="form-control form-control-sm" id="bulkScore" type="number" min="0" max="${a.nilai_maks}" placeholder="Nilai" style="width:100px;min-height:36px" aria-label="Nilai massal">
      <button class="btn btn-ink btn-sm" onclick="bulkGrade(this)"><i class="bi bi-check2-all"></i> Beri nilai sama</button></div>` : ''}
    ${units.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr>
        ${!ro && !group ? `<th style="width:40px"><input class="form-check-input" type="checkbox" id="chkAll" aria-label="Pilih semua"></th>` : ''}
        <th>${group ? 'Kelompok' : 'Mahasiswa'}</th><th>Status</th><th>Dikirim</th>
        ${['pilihan_ganda', 'campuran'].includes(a.tipe_jawaban) ? '<th>Skor PG</th>' : ''}<th>Nilai</th><th></th></tr></thead><tbody>
      ${units.map(u => {
        const s = unitStatus(u), sc = unitScore(u), v = u.latest;
        const inlineOk = !ro && !group && !u.is_self && !d.rubric && (!v || v.status !== 'Draft');
        return `<tr>
          ${!ro && !group ? `<td><input class="form-check-input unit-chk" type="checkbox" value="${esc(u.unit_id)}" ${u.is_self || (v && v.status === 'Draft') ? 'disabled' : ''} aria-label="Pilih ${esc(u.label)}"></td>` : ''}
          <td><div class="fw-600">${esc(u.label)}</div><div class="small-ss text-secondary-ss">${esc(u.sub_label)}${u.is_self ? ' — milik Anda' : ''}</div></td>
          <td>${subStatusBadge(s)}${v && Number(v.versi) > 1 ? ` <span class="small-ss text-muted-ss">v${esc(v.versi)}</span>` : ''}${u.ujian && u.ujian.jumlah_keluar ? ' ' + badge(u.ujian.jumlah_keluar + '× keluar', 'b-warn', 'bi-exclamation-triangle') : ''}</td>
          <td class="small-ss">${v && v.waktu_kirim ? esc(fmtDateTime(v.waktu_kirim)) + (v.terlambat === 'TRUE' ? '<br>' + badge('Terlambat', 'b-warn') : '') : '-'}</td>
          ${['pilihan_ganda', 'campuran'].includes(a.tipe_jawaban) ? `<td class="tabular">${v && v.skor_pg !== '' ? esc(v.skor_pg) + '%' : '-'}</td>` : ''}
          <td>${inlineOk ? `<input class="form-control form-control-sm score-input tabular" type="number" min="0" max="${a.nilai_maks}" value="${sc === null ? '' : sc}" data-unit="${esc(u.unit_id)}" aria-label="Nilai ${esc(u.label)}">`
            : `<span class="tabular fw-600">${sc === null ? '-' : sc}</span>`}</td>
          <td class="text-end"><button class="btn btn-soft btn-sm" onclick="openGradeModal('${esc(u.unit_id)}')" ${u.is_self ? 'disabled title="Tidak dapat menilai milik sendiri"' : ''}>${v ? 'Periksa' : 'Nilai'}</button></td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('Tidak ada data', 'Tidak ada pengiriman pada filter ini.')}`;
  // Simpan nilai langsung dari tabel
  $$('.score-input', area).forEach(inp => {
    const save = async () => {
      const u = d.units.find(x => x.unit_id === inp.dataset.unit);
      const val = inp.value.trim(); const old = unitScore(u);
      if (val === '' || Number(val) === old) return;
      inp.disabled = true;
      try {
        await api('grading.save', { assignment_id: a.assignment_id, items: [unitItem(u, { skor: Number(val), status: 'Dinilai', komentar: (u.latest && u.latest.nilai[u.members[0].user_id] || {}).komentar || '' })] });
        toast('Nilai disimpan', u.label + ': ' + val, 'success'); loadGrading();
      } catch (e) { toastErr(e); inp.disabled = false; }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
    inp.onchange = save;
  });
  const chkAll = $('#chkAll');
  const syncCount = () => { const n = $$('.unit-chk:checked').length; const el = $('#bulkCount'); if (el) el.textContent = n + ' dipilih'; };
  if (chkAll) chkAll.onchange = () => { $$('.unit-chk:not(:disabled)').forEach(c => c.checked = chkAll.checked); syncCount(); };
  $$('.unit-chk').forEach(c => c.onchange = syncCount);
}

function unitItem(u, extra) {
  const it = Object.assign({}, extra);
  if (u.latest) it.submission_id = u.latest.submission_id;
  else if (u.group_id) it.group_id = u.group_id;
  else it.user_id = u.user_id;
  return it;
}

async function bulkGrade(btn) {
  const d = AppState.grading;
  const ids = $$('.unit-chk:checked').map(c => c.value);
  const val = $('#bulkScore').value.trim();
  if (!ids.length) return toast('Pilih mahasiswa', 'Centang minimal satu baris.', 'warning');
  if (val === '') return toast('Isi nilai', '', 'warning');
  if (!await confirmDialog(`Beri nilai ${val} untuk ${ids.length} mahasiswa?`, { okText: 'Simpan nilai' })) return;
  await withBtn(btn, async () => {
    try {
      const items = ids.map(id => unitItem(d.units.find(u => u.unit_id === id), { skor: Number(val), status: 'Dinilai' }));
      const r = await api('grading.save', { assignment_id: d.assignment.assignment_id, items });
      toast('Nilai massal disimpan', r.disimpan + ' baris', 'success'); loadGrading();
    } catch (e) { toastErr(e); }
  });
}

async function regradePg() {
  if (!await confirmDialog('Hitung ulang skor pilihan ganda semua jawaban memakai kunci jawaban terbaru?', { okText: 'Hitung ulang' })) return;
  try { const r = await api('grading.regradePg', { assignment_id: AppState.grading.assignment.assignment_id }); toast('Selesai', `${r.dihitung} jawaban dihitung, ${r.diperbarui} nilai berubah.`, 'success'); loadGrading(); }
  catch (e) { toastErr(e); }
}

/** Modal periksa jawaban + rubrik + nilai per anggota + revisi. */
function openGradeModal(unitId, versionIdx = 0) {
  const d = AppState.grading, a = d.assignment, u = d.units.find(x => x.unit_id === unitId);
  const v = u.versions[versionIdx] || null;
  const ro = d.kelas.archived || versionIdx !== 0;
  const first = u.members[0] ? u.members[0].user_id : '';
  const nCur = v ? (v.nilai[first] || {}) : {};
  const rb = d.rubric;
  const answerHtml = !v ? `<div class="answer-box" style="white-space:normal">Belum ada pengiriman. Anda tetap bisa memberi nilai (mis. presentasi atau ujian luring).</div>` : `
    ${v.terlambat === 'TRUE' ? badge('Dikirim terlambat', 'b-warn', 'bi-clock') : ''}
    ${d.questions.length ? `<h3 class="h6 mt-3">Pilihan ganda ${v.skor_pg !== '' ? `<span class="text-secondary-ss small-ss">(${esc(v.skor_pg)}%)</span>` : ''}</h3>
      ${d.questions.map((q, i) => { const ans = v.jawaban_pg[q.question_id]; return `<div class="mb-2"><div class="small-ss fw-600">${i + 1}. ${qRich(q.pertanyaan, d.assignment.assignment_id)}</div>
        ${q.opsi.map((o, j) => `<div class="option-tile py-2 mb-1 ${String(j) === String(q.kunci_jawaban) ? 'correct' : String(ans) === String(j) ? 'wrong' : ''}" style="cursor:default">
          <span class="small-ss">${String(ans) === String(j) ? '<i class="bi bi-record-circle"></i>' : '<i class="bi bi-circle"></i>'} ${String.fromCharCode(65 + j)}. ${qRich(o, d.assignment.assignment_id)}</span></div>`).join('')}</div>`; }).join('')}` : ''}
    ${v.jawaban_teks ? `<h3 class="h6 mt-3">Jawaban teks</h3><div class="answer-box">${esc(v.jawaban_teks)}</div>` : ''}
    <div class="d-flex flex-wrap gap-2 mt-3">
      ${v.drive_file_id ? `<button class="btn btn-soft btn-sm" onclick="previewFile('submission','${v.submission_id}')"><i class="bi bi-file-earmark"></i> ${esc(v.nama_file || 'File')}</button>` : ''}
      ${v.link_eksternal ? `<a class="btn btn-soft btn-sm" href="${esc(v.link_eksternal)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-link-45deg"></i> Buka link</a>` : ''}
    </div>
    ${!v.jawaban_teks && !v.drive_file_id && !v.link_eksternal && !d.questions.length ? '<p class="text-muted-ss small-ss">Dinilai tanpa pengiriman.</p>' : ''}`;
  const prevRub = nCur.skor_rubrik || [];
  openModal({
    title: `${u.label} — ${a.judul}`, size: 'modal-xl',
    body: `<div class="row g-4">
      <div class="col-lg-7">
        ${u.versions.length > 1 ? `<div class="d-flex flex-wrap gap-2 mb-3">${u.versions.map((x, i) => `<button class="version-tab ${i === versionIdx ? 'active' : ''}" onclick="openGradeModal('${esc(unitId)}',${i})">Versi ${esc(x.versi)}</button>`).join('')}</div>` : ''}
        ${v ? `<div class="small-ss text-secondary-ss mb-2">Versi ${esc(v.versi)} — ${subStatusBadge(v.status)} ${v.waktu_kirim ? '— ' + esc(fmtDateTime(v.waktu_kirim)) : ''}</div>` : ''}
        ${u.ujian ? examLogHtml(u) : ''}${answerHtml}
      </div>
      <div class="col-lg-5">
        <div class="ss-card" style="background:var(--surface-2)">
          ${rb ? `<h3 class="h6">Rubrik: ${esc(rb.nama_rubrik)}</h3><div id="sugBar" class="mb-2"></div>
            ${rb.kriteria.map((k, i) => `<div class="rubric-row"><div class="d-flex justify-content-between align-items-center gap-2">
              <label class="small-ss fw-600" for="rk${i}">${esc(k.nama)}<div class="text-muted-ss fw-normal">${esc(k.deskripsi || '')}</div></label>
              <div class="d-flex align-items-center gap-1"><input class="form-control form-control-sm rub-in tabular" id="rk${i}" type="number" min="0" max="${k.skor_maks}" step="0.5" style="width:80px;min-height:36px" value="${esc(prevRub[i] !== undefined ? prevRub[i] : '')}" ${ro ? 'disabled' : ''}>
              <span class="small-ss text-secondary-ss">/ ${k.skor_maks}</span></div></div><div class="rb-sug" id="sug${i}"></div></div>`).join('')}
            <div class="small-ss mt-2">Total rubrik → nilai: <b id="rubTotal">-</b></div><hr>` : ''}
          <h3 class="h6">Nilai (maks ${a.nilai_maks})</h3>
          ${u.members.map(m => `<div class="d-flex align-items-center justify-content-between gap-2 mb-2">
            <label class="small-ss" for="sc_${m.user_id}">${esc(m.nama)} <span class="text-muted-ss">${esc(m.npm)}</span></label>
            <input class="form-control form-control-sm member-score tabular" id="sc_${m.user_id}" data-uid="${m.user_id}" type="number" min="0" max="${a.nilai_maks}" step="0.5" style="width:100px;min-height:36px"
              value="${v && v.nilai[m.user_id] && v.nilai[m.user_id].skor !== null ? v.nilai[m.user_id].skor : (v && a.tipe_jawaban === 'campuran' && v.skor_pg !== '' ? Math.round(Number(v.skor_pg) / 100 * a.nilai_maks) : '')}" ${ro ? 'disabled' : ''}></div>`).join('')}
          ${u.members.length > 1 && !ro ? `<button class="btn btn-ghost btn-sm mb-2" type="button" onclick="sameForAll()"><i class="bi bi-arrow-down-up"></i> Samakan untuk semua anggota</button>` : ''}
          <label class="form-label mt-2" for="gComment">Komentar / catatan</label>
          <textarea class="form-control" id="gComment" rows="3" ${ro ? 'disabled' : ''}>${esc(nCur.komentar || '')}</textarea>
          ${nCur.waktu ? `<div class="form-text">Terakhir dinilai ${esc(fmtDateTime(nCur.waktu))}</div>` : ''}
        </div>
      </div></div>`,
    footer: ro ? `<button class="btn btn-soft" data-bs-dismiss="modal">Tutup</button>` : `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button>
      ${a.izinkan_revisi && v && v.status !== 'Draft' ? `<button class="btn btn-soft" id="gRevise"><i class="bi bi-arrow-counterclockwise"></i> Minta revisi</button>` : ''}
      <button class="btn btn-ink" id="gSave" ${v && v.status === 'Draft' ? 'disabled' : ''}><i class="bi bi-check2"></i> Simpan nilai</button>`
  });
  if (ro) return;
  if (rb) {
    if (v && v.status !== 'Draft' && rb.kriteria.some(k => k.aturan && Object.keys(k.aturan).length)) loadSuggestions(v.submission_id);
    const sumMax = rb.kriteria.reduce((s, k) => s + Number(k.skor_maks), 0);
    const calc = () => {
      const vals = $$('.rub-in').map(i => i.value === '' ? null : Number(i.value));
      if (vals.some(x => x === null)) { $('#rubTotal').textContent = '-'; return; }
      const total = Math.round(vals.reduce((s, x) => s + x, 0) / sumMax * a.nilai_maks * 10) / 10;
      $('#rubTotal').textContent = total;
      $$('.member-score').forEach(i => { i.value = total; });
    };
    $$('.rub-in').forEach(i => i.oninput = calc); calc();
  }
  const submit = (btn, status) => withBtn(btn, async () => {
    const scores = $$('.member-score').map(i => ({ user_id: i.dataset.uid, skor: i.value === '' ? '' : Number(i.value) }));
    const skor_rubrik = rb ? $$('.rub-in').map(i => i.value === '' ? null : Number(i.value)) : '';
    const komentar = $('#gComment').value.trim();
    if (status === 'Perlu Revisi' && !komentar) return toast('Tulis catatan revisi', 'Mahasiswa perlu tahu apa yang harus diperbaiki.', 'warning');
    if (status === 'Dinilai' && scores.some(s => s.skor === '')) return toast('Nilai belum lengkap', 'Isi nilai untuk semua anggota.', 'warning');
    try {
      await api('grading.save', { assignment_id: a.assignment_id, items: [unitItem(u, { scores, skor_rubrik, komentar, status })] });
      closeModal(); toast(status === 'Perlu Revisi' ? 'Revisi diminta' : 'Nilai disimpan', u.label, 'success'); loadGrading();
    } catch (e) { toastErr(e); }
  });
  $('#gSave').onclick = e => submit(e.currentTarget, 'Dinilai');
  if ($('#gRevise')) $('#gRevise').onclick = e => submit(e.currentTarget, 'Perlu Revisi');
}
/** Ambil saran nilai berbasis aturan untuk satu pengiriman, tampilkan per kriteria. Hanya saran: dosen yang menerima/mengubah. */
async function loadSuggestions(submissionId) {
  const bar = $('#sugBar'); if (!bar) return;
  bar.innerHTML = '<span class="small-ss text-muted-ss"><span class="spinner-inline"></span> Menghitung saran…</span>';
  try {
    const g = await api('grading.suggest', { submission_id: submissionId });
    if (!$('#sugBar')) return;
    if (!g.ada_aturan) { bar.innerHTML = ''; return; }
    AppState.sug = g;
    g.kriteria.forEach(k => {
      const el = $('#sug' + k.index); if (!el || k.saran === null) return;
      el.innerHTML = `<div class="sug-box"><div class="d-flex align-items-center gap-2 flex-wrap"><span class="small-ss"><i class="bi bi-lightbulb"></i> Saran: <b>${k.saran}</b> / ${k.skor_maks}</span>
        <button type="button" class="btn btn-soft btn-sm" onclick="useSug(${k.index}, ${k.saran})">Pakai</button></div>
        <ul class="small-ss text-secondary-ss mb-0 ps-3 mt-1">${k.bukti.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
    });
    bar.innerHTML = `<div class="sug-box"><div class="small-ss"><i class="bi bi-lightbulb"></i> <b>Saran sistem</b> (berbasis aturan sederhana, bukan penilaian akhir). Total saran ${g.total} / ${g.total_maks}${g.nilai_saran !== null ? ' → nilai ' + g.nilai_saran : ''}.
      Periksa isi jawaban sebelum menerima.</div><button type="button" class="btn btn-ink btn-sm mt-2" onclick="useAllSug()"><i class="bi bi-check2-all"></i> Pakai semua saran</button></div>`;
  } catch (e) { bar.innerHTML = `<span class="small-ss" style="color:var(--bad)">Saran tidak tersedia: ${esc(e.message)}</span>`; }
}
function useSug(i, val) { const el = $('#rk' + i); if (el) { el.value = val; el.dispatchEvent(new Event('input')); } }
function useAllSug() { ((AppState.sug || {}).kriteria || []).forEach(k => { if (k.saran !== null) useSug(k.index, k.saran); }); toast('Saran diterapkan', 'Periksa lalu tekan Simpan nilai.', 'info'); }
function sameForAll() { const ins = $$('.member-score'); const v = ins[0].value; ins.forEach(i => { i.value = v; }); }

// ════════════════════════════════════════════════════════
// BAGIAN 16: ANGGOTA, ASISTEN & KELOMPOK
// ════════════════════════════════════════════════════════

async function renderAnggotaTab(body, d) {
  const id = d.cls.class_id;
  let members = null, groups = null;
  const draw = () => { if (members && groups) drawAnggota(body, d, members, groups); };
  await Promise.all([
    swr('class.members', { class_id: id }, m => { members = m; draw(); }, { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } }),
    swr('group.list', { class_id: id }, g => { groups = g; draw(); }, { scope: 'tab' })
  ]);
}

function drawAnggota(body, d, members, groups) {
  const acc = d.access, owner = acc.isOwner && !acc.archived;
  AppState.members = members; AppState.groups = groups;
  const q0 = $('#memSearch') ? $('#memSearch').value : '';
  body.innerHTML = `
    <div class="row g-3">
      <div class="col-12">
        <div class="card-head flex-wrap"><h2 class="section-title">Peserta kelas (${members.length})</h2>
          <input type="search" class="form-control" id="memSearch" placeholder="Cari nama/NPM" style="max-width:220px;border-radius:999px" aria-label="Cari mahasiswa" value="${esc(q0)}"></div>
        ${owner ? `<div class="ss-card ss-card-tight mb-3 d-flex flex-wrap align-items-center gap-3">
            <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="lockJoin" ${d.cls.kunci_gabung ? 'checked' : ''} onchange="toggleLockJoin(this)">
              <label class="form-check-label small-ss fw-600" for="lockJoin">Kunci pendaftaran (kode kelas tidak bisa dipakai untuk daftar maupun gabung)</label></div>
            <button class="btn btn-danger-soft btn-sm ms-auto" id="bulkRemoveBtn" onclick="removeSelectedMembers()" disabled><i class="bi bi-person-x"></i> Keluarkan terpilih</button>
          </div>` : ''}
        <div id="memTable"></div>
      </div>
      <div class="col-12">
        <div class="card-head"><h2 class="section-title">Kelompok (${groups.groups.length})</h2>
          ${owner ? `<button class="btn btn-soft btn-sm" onclick="createGroupPrompt()"><i class="bi bi-plus-lg"></i> Kelompok</button>` : ''}</div>
        <p class="small-ss text-secondary-ss">Mahasiswa membentuk kelompok sendiri. ${owner ? 'Kunci kelompok agar anggotanya tidak berubah.' : ''}</p>
        <div id="groupBox">${groupsStaffHtml(groups, owner)}</div>
      </div>
    </div>`;
  const syncBulk = () => { const n = $$('.mem-chk:checked').length; const b = $('#bulkRemoveBtn'); if (b) { b.disabled = !n; b.innerHTML = `<i class="bi bi-person-x"></i> Keluarkan terpilih${n ? ' (' + n + ')' : ''}`; } };
  const draw = () => {
    const q = ($('#memSearch').value || '').toLowerCase();
    const list = members.filter(m => !q || (m.nama_lengkap + ' ' + m.npm).toLowerCase().includes(q));
    $('#memTable').innerHTML = list.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr>
        ${owner ? '<th style="width:40px"><input class="form-check-input" type="checkbox" id="memAll" aria-label="Pilih semua"></th>' : ''}
        <th>Mahasiswa</th><th>Program studi</th><th>Bergabung</th><th>Peran</th>${owner ? '<th class="text-end">Aksi</th>' : ''}</tr></thead><tbody>
      ${list.map(m => `<tr>
        ${owner ? `<td><input class="form-check-input mem-chk" type="checkbox" value="${m.user_id}" aria-label="Pilih ${esc(m.nama_lengkap)}"></td>` : ''}
        <td><div class="d-flex align-items-center gap-2"><span class="avatar avatar-sm">${esc(initials(m.nama_lengkap))}</span>
          <div><div class="fw-600">${esc(m.nama_lengkap)}</div><div class="small-ss text-secondary-ss">${esc(m.npm)}${m.email ? ' — ' + esc(m.email) : ''}</div></div></div></td>
        <td class="small-ss">${esc(m.program_studi)}</td>
        <td class="small-ss">${esc(fmtDate(m.tanggal_gabung))}</td>
        <td><div class="d-flex flex-wrap gap-1">${m.asisten ? `<span title="${esc(m.asisten.map(p => PERM_LABEL[p]).join(', '))}">${badge('Asisten', 'b-accent', 'bi-person-badge')}</span>` : ''}
          ${m.is_pj ? badge('PJ', 'b-info', 'bi-flag') : ''}${!m.asisten && !m.is_pj ? '<span class="small-ss text-muted-ss">Mahasiswa</span>' : ''}</div></td>
        ${owner ? `<td class="text-end text-nowrap">
          <div class="dropdown d-inline-block"><button class="btn btn-ghost btn-sm" data-bs-toggle="dropdown" aria-label="Atur ${esc(m.nama_lengkap)}">Atur <i class="bi bi-chevron-down"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="openAssistantForm('${m.user_id}')"><i class="bi bi-person-badge me-2"></i>${m.asisten ? 'Ubah akses asisten' : 'Jadikan asisten'}</a></li>
              ${m.asisten ? `<li><a class="dropdown-item" href="javascript:void(0)" onclick="setAssistant('${m.user_id}', null)"><i class="bi bi-person-dash me-2"></i>Cabut asisten</a></li>` : ''}
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="setPj('${m.user_id}', ${!m.is_pj})"><i class="bi bi-flag me-2"></i>${m.is_pj ? 'Cabut PJ mata kuliah' : 'Jadikan PJ mata kuliah'}</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="resetMemberPassword('${m.user_id}')"><i class="bi bi-key me-2"></i>Reset kata sandi</a></li>
            </ul></div>
          <button class="btn btn-danger-soft btn-sm" onclick="removeMember('${m.user_id}')"><i class="bi bi-person-x"></i> Keluarkan</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : emptyState('Belum ada mahasiswa', 'Bagikan kode gabung kelas kepada mahasiswa.');
    const all = $('#memAll');
    if (all) all.onchange = () => { $$('.mem-chk').forEach(c => { c.checked = all.checked; }); syncBulk(); };
    $$('.mem-chk').forEach(c => { c.onchange = syncBulk; });
    syncBulk();
  };
  draw();
  $('#memSearch').oninput = debounce(draw, 150);
}

async function toggleLockJoin(el) {
  el.disabled = true;
  try {
    await api('class.lockJoin', { class_id: AppState.params.class_id, kunci: el.checked });
    const d = AppState.classCache[AppState.params.class_id]; if (d) d.cls.kunci_gabung = el.checked;
    toast(el.checked ? 'Pendaftaran dikunci' : 'Pendaftaran dibuka', el.checked ? 'Mahasiswa baru tidak bisa bergabung memakai kode.' : '', 'success');
  } catch (e) { el.checked = !el.checked; toastErr(e); }
  el.disabled = false;
}

async function removeSelectedMembers() {
  const ids = $$('.mem-chk:checked').map(c => c.value);
  if (!ids.length) return;
  const names = ids.map(id => (AppState.members.find(m => m.user_id === id) || {}).nama_lengkap).filter(Boolean);
  if (!await confirmDialog(`Keluarkan ${ids.length} mahasiswa dari kelas? (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}). Data nilai & absensinya tetap tersimpan.`, { okText: 'Keluarkan', danger: true })) return;
  try { const r = await api('class.removeMember', { class_id: AppState.params.class_id, user_ids: ids }); toast('Mahasiswa dikeluarkan', r.dikeluarkan + ' orang', 'success'); loadClassTab('anggota'); }
  catch (e) { toastErr(e); }
}

async function setPj(userId, pj) {
  try { await api('class.setPj', { class_id: AppState.params.class_id, user_id: userId, pj }); toast(pj ? 'PJ mata kuliah ditetapkan' : 'PJ dicabut', pj ? 'Mahasiswa ini dapat mencatat kehadiran dosen.' : '', 'success'); loadClassTab('anggota'); }
  catch (e) { toastErr(e); }
}

function groupsStaffHtml(g, owner) {
  const free = g.groups.filter(x => !x.terkunci);
  const addOpts = `<option value="">Masukkan ke kelompok…</option>` + free.map(x => `<option value="${x.group_id}">${esc(x.nama_kelompok)}</option>`).join('');
  return `${g.groups.map(x => `<div class="ss-card ss-card-tight mb-2">
      <div class="d-flex align-items-center gap-2 mb-2"><b class="flex-grow-1">${esc(x.nama_kelompok)} <span class="small-ss text-muted-ss">(${x.anggota.length})</span></b>
        ${x.terkunci ? badge('Terkunci', 'b-muted', 'bi-lock') : ''}
        ${owner ? `<button class="btn ${x.terkunci ? 'btn-soft' : 'btn-ink'} btn-sm" onclick="lockGroup('${x.group_id}',${!x.terkunci})" title="${x.terkunci ? 'Buka kunci agar anggota bisa diubah' : 'Kunci agar anggota tidak berubah'}"><i class="bi ${x.terkunci ? 'bi-unlock' : 'bi-lock'}"></i> ${x.terkunci ? 'Buka kunci' : 'Kunci'}</button>
          <button class="icon-action" onclick="deleteGroup('${x.group_id}')" aria-label="Hapus kelompok" ${x.terkunci ? 'disabled title="Buka kunci dulu"' : ''}><i class="bi bi-trash"></i></button>` : ''}</div>
      ${x.anggota.length ? x.anggota.map(m => `<div class="d-flex align-items-center gap-2 small-ss py-1"><span class="flex-grow-1">${esc(m.nama)} <span class="text-muted-ss">${esc(m.npm)}</span></span>
        ${owner ? `<button class="btn btn-ghost btn-sm" ${x.terkunci ? 'disabled title="Buka kunci dulu"' : `onclick="moveMember('${m.user_id}','')"`} aria-label="Keluarkan ${esc(m.nama)} dari kelompok"><i class="bi bi-x-lg"></i> Keluarkan</button>` : ''}</div>`).join('')
        : '<div class="small-ss text-muted-ss">Belum ada anggota.</div>'}</div>`).join('')}
    ${g.tanpa_kelompok.length ? `<div class="ss-card ss-card-tight" style="background:var(--surface-2)"><b class="small-ss">Belum punya kelompok (${g.tanpa_kelompok.length})</b>
      ${g.tanpa_kelompok.map(m => `<div class="d-flex align-items-center gap-2 small-ss py-1"><span class="flex-grow-1">${esc(m.nama)} <span class="text-muted-ss">${esc(m.npm)}</span></span>
        ${owner && free.length ? `<select class="pill-select" style="max-width:min(100%,230px)" onchange="if(this.value)moveMember('${m.user_id}', this.value)" aria-label="Masukkan ${esc(m.nama)} ke kelompok">${addOpts}</select>` : ''}</div>`).join('')}</div>` : ''}
    ${!g.groups.length && !g.tanpa_kelompok.length ? '<p class="small-ss text-muted-ss">Belum ada kelompok.</p>' : ''}`;
}

function openAssistantForm(userId) {
  const m = AppState.members.find(x => x.user_id === userId);
  const cur = m.asisten || ['nilai', 'absensi'];
  openModal({
    title: (m.asisten ? 'Ubah akses asisten — ' : 'Jadikan asisten — ') + m.nama_lengkap,
    body: `<p class="small-ss text-secondary-ss">Centang fitur yang boleh dipakai asisten di kelas ini. Asisten tetap tidak dapat menilai tugasnya sendiri, tugas kelompoknya, atau mengubah absensinya sendiri.</p>
      ${Object.entries(PERM_LABEL).map(([k, l]) => `<label class="option-tile"><input class="form-check-input mt-1 perm-chk" type="checkbox" value="${k}" ${cur.includes(k) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="asstSave">Simpan akses</button>`
  });
  $('#asstSave').onclick = e => withBtn(e.currentTarget, async () => {
    await setAssistant(userId, $$('.perm-chk:checked').map(c => c.value));
    closeModal();
  });
}

async function setAssistant(userId, izin) {
  if (izin === null && !await confirmDialog('Cabut akses asisten mahasiswa ini?', { okText: 'Cabut', danger: true })) return;
  try { await api('assistant.set', { class_id: AppState.params.class_id, user_id: userId, izin }); toast(izin ? 'Akses asisten disimpan' : 'Asisten dicabut', '', 'success'); loadClassTab('anggota'); }
  catch (e) { toastErr(e); }
}

/** Hasil reset: kata sandi sementara ditampilkan sekali agar dosen bisa menyampaikannya langsung ke mahasiswa. */
function showTempPassword(r) {
  openModal({ title: 'Kata sandi sementara',
    body: `<p class="mb-2">Berikan kata sandi ini langsung kepada <b>${esc(r.nama)}</b>${r.npm ? ' (' + esc(r.npm) + ')' : ''}. Saat masuk ia wajib membuat kata sandi baru.</p>
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap"><code class="fs-4 px-3 py-2" style="background:var(--surface-2);border-radius:12px;letter-spacing:.12em;user-select:all">${esc(r.password)}</code>
        <button class="btn btn-soft" onclick="copyText('${esc(r.password)}', 'Kata sandi sementara disalin')"><i class="bi bi-copy"></i> Salin</button></div>
      <div class="small-ss text-secondary-ss">Hanya ditampilkan sekarang. Masuk memakai NPM atau email. Huruf kecil semua; tanpa angka 0/1 dan huruf i/l/o agar mudah dibaca.</div>`,
    footer: `<button class="btn btn-ink" data-bs-dismiss="modal">Selesai</button>` });
}
async function resetMemberPassword(userId) {
  const m = AppState.members.find(x => x.user_id === userId);
  if (!await confirmDialog(`Reset kata sandi ${m.nama_lengkap}? Kata sandi lamanya tidak berlaku lagi, dan ia diminta membuat yang baru saat masuk.`, { okText: 'Reset', danger: true })) return;
  try { showTempPassword(await api('class.resetPassword', { class_id: AppState.params.class_id, user_id: userId })); } catch (e) { toastErr(e); }
}
async function adminResetPw(userId) {
  const u = (AppState.adminDosen || []).find(x => x.user_id === userId) || {};
  if (!await confirmDialog(`Reset kata sandi ${u.nama_lengkap || 'akun ini'}? Kata sandi lamanya tidak berlaku lagi, dan ia diminta membuat yang baru saat masuk.`, { okText: 'Reset', danger: true })) return;
  try { showTempPassword(await api('admin.resetPassword', { user_id: userId })); } catch (e) { toastErr(e); }
}

async function removeMember(userId) {
  const m = AppState.members.find(x => x.user_id === userId);
  if (!await confirmDialog(`Keluarkan ${m.nama_lengkap} dari kelas? Data nilai & absensinya tetap tersimpan.`, { okText: 'Keluarkan', danger: true })) return;
  try { await api('class.removeMember', { class_id: AppState.params.class_id, user_id: userId }); toast('Mahasiswa dikeluarkan', '', 'success'); loadClassTab('anggota'); }
  catch (e) { toastErr(e); }
}

function createGroupPrompt() {
  const d = AppState.classCache[AppState.params.class_id];
  const owner = d && d.access.isOwner;
  const free = owner && AppState.groups ? AppState.groups.tanpa_kelompok : [];
  openModal({
    title: 'Kelompok baru',
    body: `<label class="form-label" for="grName">Nama kelompok</label><input class="form-control" id="grName" maxlength="60" placeholder="mis. Kelompok 1">
      ${owner ? `<label class="form-label mt-3">Anggota (opsional)</label>
        ${free.length ? `<div style="max-height:260px;overflow:auto">${free.map(m => `<label class="option-tile py-2 mb-1"><input class="form-check-input mt-1 grp-mem" type="checkbox" value="${m.user_id}"><span class="small-ss">${esc(m.nama)} <span class="text-muted-ss">${esc(m.npm)}</span></span></label>`).join('')}</div>
          <div class="form-text">Hanya mahasiswa yang belum punya kelompok yang ditampilkan.</div>` : '<p class="small-ss text-muted-ss">Semua mahasiswa sudah punya kelompok.</p>'}`
        : '<div class="form-text">Kamu otomatis menjadi anggota pertama. Teman lain bisa bergabung dari daftar kelompok.</div>'}`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="grSave">Buat kelompok</button>`,
    onShown: () => $('#grName').focus()
  });
  $('#grSave').onclick = e => withBtn(e.currentTarget, async () => {
    try {
      await api('group.create', { class_id: AppState.params.class_id, nama_kelompok: $('#grName').value.trim(), anggota: $$('.grp-mem:checked').map(c => c.value) });
      closeModal(); toast('Kelompok dibuat', '', 'success'); loadClassTab(AppState.params.tab || 'anggota');
    } catch (err) { toastErr(err); }
  });
}
async function lockGroup(id, terkunci) {
  try { await api('group.lock', { group_id: id, terkunci }); toast(terkunci ? 'Kelompok dikunci' : 'Kunci dibuka', terkunci ? 'Anggota tidak bisa keluar, pindah, atau ditambah.' : 'Anggota kini bisa diubah.', 'success'); loadClassTab('anggota'); } catch (e) { toastErr(e); }
}
async function deleteGroup(id) {
  if (!await confirmDialog('Hapus kelompok ini? Anggota menjadi tanpa kelompok.', { okText: 'Hapus', danger: true })) return;
  try { await api('group.delete', { group_id: id }); toast('Kelompok dihapus', '', 'success'); loadClassTab('anggota'); } catch (e) { toastErr(e); }
}
async function moveMember(userId, toGroupId) {
  try { await api('group.move', { class_id: AppState.params.class_id, user_id: userId, to_group_id: toGroupId }); toast(toGroupId ? 'Anggota dimasukkan ke kelompok' : 'Anggota dikeluarkan dari kelompok', '', 'success'); loadClassTab('anggota'); }
  catch (e) { toastErr(e); loadClassTab('anggota'); }
}

/** Tab Kelompok untuk mahasiswa. */
async function renderKelompokTab(body, d) {
  await swr('group.list', { class_id: d.cls.class_id }, g => drawKelompok(body, d, g), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawKelompok(body, d, g) {
  const ro = d.access.archived;
  const mine = g.groups.find(x => x.group_id === g.my_group_id);
  body.innerHTML = `
    ${mine ? `<div class="ss-card highlight-card mb-3"><div class="d-flex align-items-center gap-2"><h3 class="mb-0 flex-grow-1">Kelompokmu: ${esc(mine.nama_kelompok)}</h3>
        ${mine.terkunci ? badge('Dikunci dosen', 'b-muted', 'bi-lock') : !ro ? `<button class="btn btn-soft btn-sm" onclick="leaveGroup('${mine.group_id}')">Keluar</button>` : ''}</div>
        <div class="small-ss mt-2">${mine.anggota.map(m => esc(m.nama)).join(', ')}</div></div>`
      : `<div class="ss-card mb-3 d-flex flex-wrap align-items-center gap-2"><div class="flex-grow-1"><b>Kamu belum punya kelompok.</b><div class="small-ss text-secondary-ss">Buat kelompok baru atau gabung ke kelompok yang ada.</div></div>
        ${!ro ? `<button class="btn btn-ink btn-sm" onclick="createGroupPrompt()"><i class="bi bi-plus-lg"></i> Buat kelompok</button>` : ''}</div>`}
    <h2 class="section-title mb-2">Semua kelompok</h2>
    ${g.groups.length ? `<div class="row g-2">${g.groups.map(x => `<div class="col-md-6"><div class="ss-card ss-card-tight h-100">
        <div class="d-flex align-items-center gap-2"><b class="flex-grow-1">${esc(x.nama_kelompok)}</b>${x.terkunci ? badge('Terkunci', 'b-muted', 'bi-lock') : ''}
          ${!mine && !x.terkunci && !ro ? `<button class="btn btn-soft btn-sm" onclick="joinGroup('${x.group_id}')">Gabung</button>` : ''}</div>
        <div class="small-ss text-secondary-ss mt-1">${x.anggota.length ? x.anggota.map(m => esc(m.nama)).join(', ') : 'Belum ada anggota'}</div></div></div>`).join('')}</div>`
      : emptyState('Belum ada kelompok', 'Jadilah yang pertama membuat kelompok.')}`;
}
async function joinGroup(id) { try { await api('group.join', { group_id: id }); toast('Bergabung ke kelompok', '', 'success'); loadClassTab('kelompok'); } catch (e) { toastErr(e); } }
async function leaveGroup(id) {
  if (!await confirmDialog('Keluar dari kelompok ini?', { okText: 'Keluar' })) return;
  try { await api('group.leave', { group_id: id }); toast('Kamu keluar dari kelompok', '', 'success'); loadClassTab('kelompok'); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 17: PENGATURAN KELAS (bobot, absensi, kode, arsip)
// ════════════════════════════════════════════════════════

async function renderPengaturanTab(body, d) {
  const c = d.cls, ro = d.access.archived;
  body.innerHTML = `
    <div class="row g-3">
      <div class="col-lg-6">
        <div class="ss-card mb-3"><div class="card-head"><h2>Identitas kelas</h2>${!ro ? `<button class="btn btn-soft btn-sm" onclick='openClassForm(AppState.classCache[AppState.params.class_id].cls)'><i class="bi bi-pencil"></i> Ubah</button>` : ''}</div>
          <dl class="row small-ss mb-0">
            <dt class="col-5 fw-600">Nama kelas</dt><dd class="col-7">${esc(c.nama_kelas)}</dd>
            <dt class="col-5 fw-600">Mata kuliah</dt><dd class="col-7">${esc(c.mata_kuliah)}</dd>
            <dt class="col-5 fw-600">Semester</dt><dd class="col-7">${esc(c.semester)} ${esc(c.tahun_ajaran)}</dd>
            <dt class="col-5 fw-600">Kuota peserta</dt><dd class="col-7">${c.kuota ? esc(c.kuota) + ' mahasiswa' : 'Tanpa batas'}</dd>
            <dt class="col-5 fw-600">Kode gabung</dt><dd class="col-7"><span class="code-chip">${esc(c.kode_gabung)}</span>
              <button class="btn btn-soft btn-sm ms-1" onclick="copyInvite()"><i class="bi bi-send"></i> Salin undangan</button>
              ${!ro ? `<button class="btn btn-ghost btn-sm ms-1" onclick="resetJoinCode()"><i class="bi bi-arrow-repeat"></i> Reset</button>` : ''}</dd></dl></div>
        <div class="ss-card mb-3"><div class="card-head"><h2>Absensi QR</h2></div>
          <form id="attSet" class="row g-3">
            <div class="col-sm-6"><label class="form-label" for="stInt">Ganti QR tiap (detik)</label><input class="form-control" id="stInt" type="number" min="5" max="120" value="${esc(c.qr_interval_detik || 15)}" ${ro ? 'disabled' : ''}></div>
            <div class="col-sm-6"><label class="form-label" for="stLate">Terlambat setelah (menit)</label><input class="form-control" id="stLate" type="number" min="0" max="240" value="${esc(c.batas_terlambat_menit || 15)}" ${ro ? 'disabled' : ''}></div>
            <div class="col-12"><hr class="my-1"><div class="small-ss fw-600 mb-1">Jadwal kuliah <span class="text-muted-ss fw-normal">— otomatis masuk ke rekap kehadiran dosen</span></div></div>
            <div class="col-sm-4"><label class="form-label" for="stHari">Hari</label><select class="form-select" id="stHari" ${ro ? 'disabled' : ''}><option value="">Belum diatur</option>
              ${['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map((h, i) => `<option value="${i}" ${String(c.jadwal_hari) === String(i) ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
            <div class="col-sm-4"><label class="form-label" for="stMulai">Jam mulai</label><input class="form-control" id="stMulai" type="time" value="${esc(c.jam_mulai || '')}" ${ro ? 'disabled' : ''}></div>
            <div class="col-sm-4"><label class="form-label" for="stSelesai">Jam selesai</label><input class="form-control" id="stSelesai" type="time" value="${esc(c.jam_selesai || '')}" ${ro ? 'disabled' : ''}></div>
            <div class="col-sm-6"><label class="form-label" for="stPoin">Nilai kehadiran saat terlambat (0–100)</label><input class="form-control" id="stPoin" type="number" min="0" max="100" value="${esc(c.poin_terlambat === '' || c.poin_terlambat === undefined ? 100 : c.poin_terlambat)}" ${ro ? 'disabled' : ''}>
              <div class="form-text">Hadir = 100. Izin dan sakit tidak dihitung.</div></div>
            ${!ro ? `<div class="col-12 text-end"><button class="btn btn-ink btn-sm" type="submit">Simpan pengaturan absensi</button></div>` : ''}
          </form></div>
      </div>
      <div class="col-lg-6">
        <div class="ss-card mb-3"><div class="card-head"><h2>Komponen & bobot nilai</h2><span class="small-ss" id="wTotal"></span></div>
          <p class="small-ss text-secondary-ss">Atur sendiri nama, jenis, dan bobot tiap komponen (total 100%). Contoh: Tugas, Kuis, Praktikum, UTS, UAS.</p>
          <div id="wRows"></div>
          ${!ro ? `<div class="d-flex flex-wrap gap-2 justify-content-between mt-2">
            <div class="d-flex flex-wrap gap-2"><button class="btn btn-soft btn-sm" id="wAdd"><i class="bi bi-plus-lg"></i> Komponen</button><button class="btn btn-ghost btn-sm" id="wReset">Kembalikan ke bawaan</button></div>
            <button class="btn btn-ink btn-sm" id="wSave">Simpan bobot</button></div>` : ''}
          <details class="mt-3 small-ss text-secondary-ss"><summary class="fw-600">Apa bedanya jenis komponen?</summary>
            <ul class="mt-2 mb-0 ps-3">
              <li><b>Kehadiran</b>: skor dari absensi (hadir 100, terlambat sesuai Pengaturan, izin/sakit tidak dihitung). Maksimal satu komponen.</li>
              <li><b>Dari tugas</b>: rata-rata nilai tugas yang dialokasikan ke komponen ini saat membuat tugas.</li>
              <li><b>Koreksi</b>: apa pun jenisnya, dosen tetap bisa menimpa nilai satu komponen untuk satu mahasiswa di tab Nilai (mis. bila terjadi kesalahan). Kosongkan untuk kembali ke hitungan otomatis.</li>
              <li><b>Input manual</b>: nilai diketik atau diimpor dari Excel di tab Nilai (cocok untuk UTS/UAS yang dilaksanakan di platform lain). Bila kosong, dipakai rata-rata tugas yang dialokasikan.</li></ul></details></div>
        <div class="ss-card"><div class="card-head"><h2>${ro ? 'Pulihkan kelas' : 'Arsipkan kelas'}</h2></div>
          <p class="small-ss text-secondary-ss">${ro ? 'Kelas kembali aktif dan bisa diubah.' : 'Di akhir semester: kelas menjadi hanya-baca dan hilang dari daftar aktif. Foto selfie absensi lama (bila ada) ikut dihapus; data nilai, tugas, dan status hadir tetap tersimpan.'}</p>
          ${AppState.config.autoArsipAktif === false ? '' : `<p class="small-ss text-secondary-ss"><i class="bi bi-clock-history"></i> Kelas juga diarsipkan otomatis bila tidak ada aktivitas selama ${AppState.config.autoArsipHari || 100} hari. Anda diberi tahu 14 dan 3 hari sebelumnya; cukup buka kelas ini untuk membatalkan.</p>`}
          <button class="btn ${ro ? 'btn-ink' : 'btn-danger-soft'}" onclick="archiveClass(${!ro})"><i class="bi ${ro ? 'bi-arrow-counterclockwise' : 'bi-archive'}"></i> ${ro ? 'Pulihkan kelas' : 'Arsipkan kelas'}</button></div>
      </div>
    </div>`;
  AppState.wDraft = d.weights.map(w => ({ komponen: w.komponen, nama: w.label, jenis: w.jenis, bobot_persen: w.bobot_persen, dipakai_tugas: w.dipakai_tugas || 0, nilai_manual: w.nilai_manual || 0 }));
  AppState.wOrig = AppState.wDraft.map(w => Object.assign({}, w));
  renderWeightRows(ro);
  if (!ro) {
    $('#wAdd').onclick = wAdd; $('#wReset').onclick = wReset;
    $('#attSet').onsubmit = async e => {
      e.preventDefault();
      await withBtn(e.target.querySelector('button[type=submit]'), async () => {
        try {
          const r = await api('class.update', Object.assign({}, c, { qr_interval_detik: $('#stInt').value, batas_terlambat_menit: $('#stLate').value, poin_terlambat: $('#stPoin').value, jadwal_hari: $('#stHari').value, jam_mulai: $('#stMulai').value, jam_selesai: $('#stSelesai').value }));
          Object.assign(d.cls, r); toast('Pengaturan absensi disimpan', '', 'success');
        } catch (err) { toastErr(err); }
      });
    };
    $('#wSave').onclick = e => withBtn(e.currentTarget, async () => {
      const list = AppState.wDraft.map(w => ({ komponen: w.komponen, nama: String(w.nama || '').trim(), jenis: w.jenis, bobot_persen: Number(w.bobot_persen) }));
      if (list.some(w => !w.nama)) return toast('Nama komponen wajib diisi', '', 'warning');
      const keep = new Set(list.map(w => w.komponen).filter(Boolean));
      const removed = AppState.wOrig.filter(w => !keep.has(w.komponen));
      const used = removed.find(w => w.dipakai_tugas > 0);
      if (used) return toast('Komponen masih dipakai', `"${used.nama}" dipakai ${used.dipakai_tugas} tugas. Pindahkan tugasnya ke komponen lain dulu (ubah tugas → Alokasi nilai).`, 'warning');
      const withScores = removed.filter(w => w.nilai_manual > 0);
      let hapus = false;
      if (withScores.length) {
        if (!await confirmDialog(`Komponen ${withScores.map(w => '"' + w.nama + '"').join(', ')} sudah punya nilai manual (${withScores.reduce((s, w) => s + w.nilai_manual, 0)} nilai). Menghapus komponen juga menghapus nilai itu. Lanjutkan?`, { okText: 'Hapus & simpan', danger: true })) return;
        hapus = true;
      }
      try { d.weights = await api('weights.save', { class_id: c.class_id, weights: list, hapus_nilai_manual: hapus }); toast('Komponen & bobot disimpan', '', 'success'); loadClassTab('pengaturan'); }
      catch (err) { toastErr(err); }
    });
  }
}

const JENIS_LABEL = { absensi: 'Kehadiran', tugas: 'Dari tugas', manual: 'Input manual' };
const WEIGHT_DEFAULTS = [
  { komponen: 'absensi', nama: 'Aktivitas Partisipatif', jenis: 'absensi', bobot_persen: 10 }, { komponen: 'proyek', nama: 'Hasil Proyek', jenis: 'tugas', bobot_persen: 40 },
  { komponen: 'tugas', nama: 'Tugas', jenis: 'tugas', bobot_persen: 10 }, { komponen: 'uts', nama: 'Ujian Tengah Semester', jenis: 'manual', bobot_persen: 15 },
  { komponen: 'uas', nama: 'Ujian Akhir Semester', jenis: 'manual', bobot_persen: 25 }
];
function renderWeightRows(ro) {
  const rows = AppState.wDraft, absIdx = rows.findIndex(r => r.jenis === 'absensi');
  $('#wRows').innerHTML = rows.map((w, i) => `<div class="w-row" data-i="${i}">
    ${ro ? '' : `<div class="w-move"><button type="button" class="icon-action" onclick="wMove(${i},-1)" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan ${esc(w.nama)}"><i class="bi bi-chevron-up"></i></button>
      <button type="button" class="icon-action" onclick="wMove(${i},1)" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Turunkan ${esc(w.nama)}"><i class="bi bi-chevron-down"></i></button></div>`}
    <input class="form-control w-nama" maxlength="40" value="${esc(w.nama)}" placeholder="Nama komponen" aria-label="Nama komponen ${i + 1}" ${ro ? 'disabled' : ''}>
    <select class="form-select w-jenis" aria-label="Jenis komponen ${esc(w.nama)}" ${ro ? 'disabled' : ''}>${Object.entries(JENIS_LABEL).map(([k, l]) => `<option value="${k}" ${w.jenis === k ? 'selected' : ''} ${k === 'absensi' && absIdx > -1 && absIdx !== i ? 'disabled' : ''}>${l}</option>`).join('')}</select>
    <div class="input-group w-pct"><input class="form-control w-val tabular" type="number" min="0" max="100" step="0.5" value="${esc(w.bobot_persen)}" aria-label="Bobot ${esc(w.nama)}" ${ro ? 'disabled' : ''}><span class="input-group-text" style="background:var(--surface-2);color:var(--text-2);border-color:var(--border-strong)">%</span></div>
    ${ro ? '' : `<button type="button" class="icon-action" onclick="wRemove(${i})" aria-label="Hapus komponen ${esc(w.nama)}" ${rows.length <= 1 ? 'disabled' : ''}><i class="bi bi-trash"></i></button>`}
    ${(w.dipakai_tugas || w.nilai_manual) ? `<div class="w-note small-ss text-muted-ss">Dipakai: ${[w.dipakai_tugas ? w.dipakai_tugas + ' tugas' : '', w.nilai_manual ? w.nilai_manual + ' nilai manual' : ''].filter(Boolean).join(', ')}</div>` : ''}</div>`).join('');
  $$('#wRows .w-row').forEach(row => {
    const i = Number(row.dataset.i);
    $('.w-nama', row).oninput = e => { AppState.wDraft[i].nama = e.target.value; };
    $('.w-jenis', row).onchange = e => { AppState.wDraft[i].jenis = e.target.value; renderWeightRows(ro); };
    $('.w-val', row).oninput = e => { AppState.wDraft[i].bobot_persen = e.target.value; calcWeightTotal(); };
  });
  calcWeightTotal();
}
function calcWeightTotal() {
  const t = AppState.wDraft.reduce((s, w) => s + Number(w.bobot_persen || 0), 0);
  const el = $('#wTotal'); if (el) el.innerHTML = Math.abs(t - 100) < 0.001 ? badge('Total 100%', 'b-ok') : badge('Total ' + Math.round(t * 10) / 10 + '%', 'b-bad');
  const btn = $('#wSave'); if (btn) btn.disabled = Math.abs(t - 100) >= 0.001;
}
function wMove(i, dir) { const a = AppState.wDraft, j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; renderWeightRows(false); }
function wRemove(i) {
  const w = AppState.wDraft[i];
  if (w.dipakai_tugas > 0) return toast('Komponen masih dipakai', `"${w.nama || 'Komponen'}" dipakai ${w.dipakai_tugas} tugas. Pindahkan tugasnya ke komponen lain dulu.`, 'warning');
  AppState.wDraft.splice(i, 1); renderWeightRows(false);
}
function wAdd() {
  if (AppState.wDraft.length >= 10) return toast('Maksimal 10 komponen', '', 'warning');
  AppState.wDraft.push({ komponen: '', nama: '', jenis: 'tugas', bobot_persen: 0, dipakai_tugas: 0, nilai_manual: 0 });
  renderWeightRows(false); const ins = $$('#wRows .w-nama'); if (ins.length) ins[ins.length - 1].focus();
}
function wReset() {
  const orig = AppState.wOrig;
  AppState.wDraft = WEIGHT_DEFAULTS.map(d => { const o = orig.find(x => x.komponen === d.komponen); return Object.assign({}, d, { dipakai_tugas: o ? o.dipakai_tugas : 0, nilai_manual: o ? o.nilai_manual : 0 }); });
  renderWeightRows(false); toast('Dikembalikan ke komponen bawaan', 'Tekan Simpan bobot untuk menerapkan.', 'info');
}
async function resetJoinCode() {
  if (!await confirmDialog('Buat kode gabung baru? Kode lama langsung tidak berlaku.', { okText: 'Reset kode' })) return;
  try { const k = await api('class.resetCode', { class_id: AppState.params.class_id }); toast('Kode baru', k, 'success'); refreshPage(); } catch (e) { toastErr(e); }
}
async function archiveClass(arsip) {
  if (arsip && !await confirmDialog('Arsipkan kelas ini? Semua data menjadi hanya-baca, dan foto selfie absensi LAMA (bila ada) kelas ini dihapus dari Google Drive untuk menghemat ruang (status hadir tetap tersimpan). Foto yang dihapus tidak bisa dikembalikan.', { okText: 'Arsipkan & hapus selfie', danger: true })) return;
  try {
    const r = await api('class.archive', { class_id: AppState.params.class_id, arsip });
    toast(arsip ? 'Kelas diarsipkan' : 'Kelas dipulihkan', arsip ? r.selfie_dihapus + ' foto selfie dihapus.' : '', 'success'); refreshPage();
  } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 18: ABSENSI — STAF (buka sesi, proyektor, rekap, galeri)
// ════════════════════════════════════════════════════════

async function renderAbsensiTab(body, d) {
  await swr('att.overview', { class_id: d.cls.class_id }, ov => drawAbsensiTab(body, d, ov), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawAbsensiTab(body, d, ov) {
  const ro = d.access.archived;
  const today = new Date().toISOString().slice(0, 10);
  const defMeeting = (ov.meetings.find(m => m.tanggal === today) || ov.meetings.find(m => !m.jumlah_sesi) || ov.meetings[ov.meetings.length - 1] || {}).meeting_id;
  const open = ov.sesi_terbuka;
  const openM = open ? ov.meetings.find(m => m.meeting_id === open.meeting_id) : null;
  if (open) AppState.sessionTitles[open.session_id] = d.cls.nama_kelas + (openM ? ' — ' + openM.judul : '');
  const lectBadge = st => st ? badge(LECT_LABEL[st] || st, st === 'tidak_hadir' ? 'b-bad' : st === 'digantikan' ? 'b-warn' : 'b-ok') : '<span class="small-ss text-muted-ss">Belum dicatat</span>';
  body.innerHTML = `
    <div class="row g-3 mb-3"><div class="col-lg-6">
      ${open ? `<div class="ss-card highlight-card h-100">
          <h3 class="mb-1"><span class="live-dot"></span>Sesi absensi ${open.mode === 'daring' ? 'daring' : 'luring'} berlangsung</h3>
          <p class="small-ss mb-3">${esc(openM ? openM.judul : '')} — dibuka ${esc(fmtTime(open.waktu_buka))}${open.mode === 'daring' ? ' — memakai kode 6 angka' : ' — mahasiswa memindai QR di layar'}</p>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-ink" onclick="openProjector('${open.session_id}')"><i class="bi bi-qr-code"></i> Tampilkan ${open.mode === 'daring' ? 'kode & QR' : 'QR'}</button>
            <button class="btn btn-soft" onclick="openAttMeeting('${open.meeting_id}')"><i class="bi bi-list-check"></i> Rekap langsung</button>
            <button class="btn btn-danger-soft" onclick="closeAttSession('${open.session_id}')"><i class="bi bi-stop-circle"></i> Tutup sesi</button></div>
          <p class="small-ss text-secondary-ss mt-3 mb-0">Saat sesi ditutup, mahasiswa yang belum absen otomatis tercatat Alpa. Sesi dapat dibuka ulang untuk yang terlambat.</p></div>`
      : `<div class="ss-card h-100"><div class="card-head"><h2>Buka sesi absensi</h2></div>
          ${ov.meetings.length && !ro ? `<form id="openAtt" class="row g-2">
            <div class="col-12"><div class="seg" style="margin-bottom:4px" role="radiogroup" aria-label="Mode kelas">
              <button type="button" class="active" data-mode="luring"><i class="bi bi-building"></i> Luring (di kelas)</button>
              <button type="button" data-mode="daring"><i class="bi bi-camera-video"></i> Daring (online)</button></div></div>
            <div class="col-12"><label class="form-label" for="oaMeet">Pertemuan</label>
              <select class="form-select" id="oaMeet">${ov.meetings.map(m => `<option value="${m.meeting_id}" ${m.meeting_id === defMeeting ? 'selected' : ''}>${esc(m.judul)}${m.tanggal ? ' — ' + esc(fmtDate(m.tanggal)) : ''}${m.jumlah_sesi ? ' (sudah ' + m.jumlah_sesi + ' sesi)' : ''}</option>`).join('')}</select></div>
            <div class="col-12" id="oaBtnCol"><button class="btn btn-ink w-100" type="submit" data-loading="Membuka sesi…"><i class="bi bi-play-circle"></i> Buka sesi</button></div>
            <div class="col-12 form-text" id="oaHint">Luring: mahasiswa memindai QR yang tampil di layar kelas. Tanpa lokasi dan tanpa foto.</div></form>`
          : `<p class="small-ss text-secondary-ss mb-0">${ro ? 'Kelas diarsipkan.' : 'Tambahkan pertemuan di Timeline terlebih dahulu.'}</p>`}</div>`}
    </div>
    <div class="col-lg-6"><div class="ss-card h-100"><div class="card-head"><h2>Ringkasan</h2>
        <button class="btn btn-soft btn-sm" onclick="printAttendancePdf(this)" data-loading="Membuat PDF…"><i class="bi bi-file-earmark-pdf"></i> Daftar hadir (PDF)</button></div>
      <div class="row g-2 text-center">${['hadir', 'terlambat', 'izin', 'sakit', 'alpa'].map(k => `<div class="col"><div class="kpi-value" style="font-size:1.6rem">${ov.meetings.reduce((s, m) => s + m.rekap[k], 0)}</div><div class="small-ss text-secondary-ss">${ATT_LABEL[k]}</div></div>`).join('')}</div>
      <p class="small-ss text-secondary-ss mt-3 mb-0">${ov.total_mhs} mahasiswa — QR luring berganti tiap ${ov.kelas.qr_interval_detik} detik, kode daring tiap 60 detik — terlambat setelah ${ov.kelas.batas_terlambat_menit} menit.</p></div></div></div>
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2"><div class="seg" id="attViewSeg" role="tablist" aria-label="Tampilan rekap"><button type="button" role="tab" data-v="pertemuan" class="active">Per pertemuan</button><button type="button" role="tab" data-v="mahasiswa">Rekap per mahasiswa</button></div>
      <span class="small-ss text-secondary-ss" id="attViewHint">Klik Rekap untuk melihat dan mengoreksi status mahasiswa</span></div>
    <div id="attByMeeting">${ov.meetings.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th>Pertemuan</th><th>Hadir</th><th>Terlambat</th><th>Izin/Sakit</th><th>Alpa</th><th>Dosen</th><th></th></tr></thead><tbody>
      ${ov.meetings.map(m => `<tr><td><div class="fw-600">${esc(m.judul)}</div><div class="small-ss text-secondary-ss">${m.tanggal ? esc(fmtDate(m.tanggal)) : '-'} ${m.terbuka ? badge('Berlangsung', 'b-ok') : ''}</div></td>
        <td class="tabular">${m.rekap.hadir}</td><td class="tabular">${m.rekap.terlambat}</td><td class="tabular">${m.rekap.izin + m.rekap.sakit}</td><td class="tabular">${m.rekap.alpa}</td>
        <td>${lectBadge(m.dosen)}</td>
        <td class="text-end"><button class="btn btn-soft btn-sm" onclick="openAttMeeting('${m.meeting_id}')">Rekap & koreksi</button></td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Belum ada pertemuan', 'Absensi dibuka per pertemuan di Timeline.')}</div><div id="attByStudent" class="d-none"></div>`;
  const setView = v => {
    AppState.attView = v;
    $$('#attViewSeg button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    $('#attByMeeting').classList.toggle('d-none', v !== 'pertemuan'); $('#attByStudent').classList.toggle('d-none', v !== 'mahasiswa');
    $('#attViewHint').textContent = v === 'pertemuan' ? 'Klik Rekap untuk melihat dan mengoreksi status mahasiswa' : 'Seperti Daftar Hadir Mahasiswa kampus. Klik sel untuk mengoreksi pada pertemuan itu.';
    if (v === 'mahasiswa') showAttMatrix();
  };
  $$('#attViewSeg button').forEach(b => b.onclick = () => setView(b.dataset.v));
  if (AppState.attView === 'mahasiswa') setView('mahasiswa');
  const f = $('#openAtt');
  if (!f) return;
  let mode = 'luring';
  $$('#openAtt .seg button').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$('#openAtt .seg button').forEach(x => x.classList.toggle('active', x === b));
    $('#oaHint').textContent = mode === 'daring'
      ? 'Daring: mahasiswa memasukkan kode 6 angka (berganti tiap 60 detik) yang Anda tampilkan lewat berbagi layar di Zoom/Meet.'
      : 'Luring: mahasiswa memindai QR yang tampil di layar kelas. Tanpa lokasi dan tanpa foto.';
  });
  f.onsubmit = async e => {
    e.preventDefault();
    await withBtn(f.querySelector('button[type=submit]'), async () => {
      try {
        const title = d.cls.nama_kelas + ' — ' + $('#oaMeet').selectedOptions[0].textContent.split(' — ')[0];
        const p = { class_id: d.cls.class_id, meeting_id: $('#oaMeet').value, mode };
        const s = await api('att.open', p);
        toast('Sesi absensi dibuka', mode === 'daring' ? 'Bagikan layar kode ke peserta.' : '', 'success');
        openProjector(s.session_id, title);
        loadClassTab('absensi');
      } catch (err) { toastErr(err); }
    });
  };
}

const ATT_CHIP = { hadir: ['H', 'b-ok', 'Hadir'], terlambat: ['T', 'b-warn', 'Terlambat'], izin: ['I', 'b-info', 'Izin'], sakit: ['S', 'b-info', 'Sakit'], alpa: ['A', 'b-bad', 'Tidak hadir'] };
/** Rekap kehadiran per mahasiswa × pertemuan (setara Daftar Hadir Mahasiswa kampus). */
async function showAttMatrix() {
  const box = $('#attByStudent'); if (!box) return;
  if (!AppState.attRecap) box.innerHTML = loadingBlock('Menyusun rekap…');
  try { AppState.attRecap = await api('att.recap', { class_id: AppState.params.class_id }); } catch (e) { box.innerHTML = errorBlock(e, 'showAttMatrix()'); return; }
  const rc = AppState.attRecap, cols = rc.cols.filter(c => c.meeting_id);
  if (!cols.length) { box.innerHTML = emptyState('Belum ada pertemuan', 'Rekap muncul setelah pertemuan dibuat di Timeline.'); return; }
  box.innerHTML = `<div class="d-flex flex-wrap align-items-center gap-2 mb-2"><span class="small-ss text-secondary-ss">${Object.entries(ATT_CHIP).map(([k, v]) => `<span class="badge-ss ${v[1]}">${v[0]}</span> ${v[2]}`).join(' · ')} · <b>–</b> belum tercatat</span>
      <span class="ms-auto"></span><button class="btn btn-soft btn-sm" onclick="printAttendancePdf(this)" data-loading="Membuat PDF…"><i class="bi bi-file-earmark-pdf"></i> Daftar Hadir Mahasiswa (PDF)</button>
      <button class="btn btn-soft btn-sm" onclick="exportAttMatrixExcel()"><i class="bi bi-file-earmark-excel"></i> Excel</button></div>
    ${rc.rows.length ? `<div class="table-wrap"><table class="table-ss att-matrix"><thead><tr><th>No</th><th class="l sticky-col">Nama / NPM</th><th>Jumlah<br>Kehadiran</th>
      ${cols.map(c => `<th title="${esc(c.judul)}"><button class="btn btn-link p-0 fw-600 small-ss" onclick="openAttMeeting('${c.meeting_id}')">${c.label}</button><br><span class="small-ss text-muted-ss">${c.tanggal ? esc(c.tanggal.slice(8, 10) + '/' + c.tanggal.slice(5, 7)) : '–'}</span></th>`).join('')}</tr></thead><tbody>
      ${rc.rows.map(r => `<tr><td>${r.no}</td><td class="l sticky-col"><div class="fw-600">${esc(r.nama)}</div><div class="small-ss text-secondary-ss">NPM: ${esc(r.npm)}</div></td><td class="tabular fw-600">${r.jumlah}</td>
        ${rc.cols.map((c, i) => c.meeting_id ? attMatrixCell(r.cells[i], c.meeting_id) : '').join('')}</tr>`).join('')}</tbody></table></div>`
      : emptyState('Belum ada mahasiswa', 'Rekap muncul setelah mahasiswa bergabung.')}`;
}
function attMatrixCell(c, meetingId) {
  if (!c) return `<td><button class="att-cell none" onclick="openAttMeeting('${meetingId}')" aria-label="Belum tercatat">–</button></td>`;
  const m = ATT_CHIP[c.status] || [c.status, 'b-muted', c.status];
  return `<td><button class="att-cell badge-ss ${m[1]}" onclick="openAttMeeting('${meetingId}')" title="${esc(m[2] + (c.catatan ? ' — ' + c.catatan : ''))}" aria-label="${esc(m[2])}">${m[0]}${c.catatan ? '<sup>*</sup>' : ''}</button></td>`;
}
async function exportAttMatrixExcel() {
  const rc = AppState.attRecap; if (!rc) return;
  try {
    await loadScript(XLSX_SRC);
    const cols = rc.cols.filter(c => c.meeting_id), cls = AppState.classCache[AppState.params.class_id].cls;
    const cellText = c => c ? (ATT_CHIP[c.status] || [0, 0, c.status])[2] + (c.catatan ? ' (' + c.catatan + ')' : '') : '-';
    const head = ['No', 'NPM', 'Nama', 'Jumlah Kehadiran'].concat(cols.map(c => c.label + (c.tanggal ? ' (' + c.tanggal.slice(8, 10) + '/' + c.tanggal.slice(5, 7) + ')' : '')));
    const aoa = [head].concat(rc.rows.map(r => [r.no, r.npm, r.nama, r.jumlah].concat(rc.cols.reduce((arr, c, i) => { if (c.meeting_id) arr.push(cellText(r.cells[i])); return arr; }, []))));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 32 }, { wch: 10 }].concat(cols.map(() => ({ wch: 13 })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Daftar Hadir');
    XLSX.writeFile(wb, `Daftar Hadir Mahasiswa - ${cls.nama_kelas}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  } catch (e) { toastErr(e); }
}

async function printAttendancePdf(btn) {
  await withBtn(btn, async () => {
    try { showReportModal(await api('report.attendancePdf', { class_id: AppState.params.class_id })); } catch (e) { toastErr(e); }
  });
}

async function closeAttSession(sessionId) {
  if (!await confirmDialog('Tutup sesi absensi? Mahasiswa yang belum absen akan tercatat Alpa.', { okText: 'Tutup sesi', danger: true })) return;
  try {
    const r = await api('att.close', { session_id: sessionId });
    toast('Sesi ditutup', r.alpa ? r.alpa + ' mahasiswa ditandai Alpa.' : 'Semua mahasiswa sudah tercatat.', 'success');
    closeProjector();
    if (AppState.page === 'kelas-detail') loadClassTab('absensi'); else refreshPage();
  } catch (e) { toastErr(e); }
}

// ── Layar proyektor: QR berganti otomatis + hitung mundur + jumlah hadir langsung ──
const Projector = { timer: null, tick: null, deadline: 0, interval: 15000, qr: null, sessionId: null };

function openProjector(sessionId, title) {
  title = title || AppState.sessionTitles[sessionId] || 'Absensi';
  const el = $('#projector');
  Projector.sessionId = sessionId;
  el.innerHTML = `
    <div class="projector-head">
      <div class="d-flex align-items-center gap-3"><div class="brand-mark"><i class="bi bi-mortarboard"></i></div>
        <div><div class="fw-bold fs-5">${esc(title || 'Absensi')}</div><div class="text-secondary-ss small-ss">Buka menu Absen di Ruang Ajar, lalu pindai/foto QR ini</div></div></div>
      <div class="d-flex gap-2"><button class="btn btn-soft" onclick="toggleFullscreen()"><i class="bi bi-arrows-fullscreen"></i><span class="d-none d-md-inline"> Layar penuh</span></button>
        <button class="btn btn-danger-soft" onclick="closeAttSession('${sessionId}')"><i class="bi bi-stop-circle"></i><span class="d-none d-md-inline"> Tutup sesi</span></button>
        <button class="btn btn-ink" onclick="closeProjector()"><i class="bi bi-x-lg"></i><span class="d-none d-md-inline"> Keluar layar</span></button></div></div>
    <div class="projector-main">
      <div class="qr-frame"><div id="qrBox" aria-label="Kode QR absensi"></div></div>
      <div class="d-grid gap-3" style="width:100%;max-width:380px">
        <div class="ss-card d-none text-center" id="pjCodeCard"><div class="small-ss text-secondary-ss mb-1">Kode absensi daring</div>
          <div class="big-code" id="pjCode">––––––</div><div class="small-ss text-secondary-ss mt-1">Masukkan di menu Absen → Kode</div></div>
        <div class="ss-card d-flex align-items-center gap-3">
          <svg class="qr-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="50"/><circle class="bar" id="ringBar" cx="60" cy="60" r="50" stroke-dasharray="314.16" stroke-dashoffset="0"/>
            <text x="60" y="68" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor" id="ringText">–</text></svg>
          <div><div class="fw-600">QR berganti</div><div class="small-ss text-secondary-ss">QR lama langsung tidak berlaku</div></div></div>
        <div class="ss-card"><div class="small-ss text-secondary-ss">Sudah absen</div>
          <div class="d-flex align-items-baseline gap-2"><span class="big-count" id="pjCount">0</span><span class="fs-5 text-secondary-ss" id="pjTotal">/ 0</span></div></div>
        <div class="ss-card"><div class="small-ss text-secondary-ss mb-2">Baru saja absen</div><ul class="recent-names" id="pjRecent"><li class="text-muted-ss">Belum ada</li></ul></div>
      </div></div>`;
  el.classList.remove('d-none');
  document.body.style.overflow = 'hidden';
  Projector.qr = null;
  loadLib('qrcode').then(fetchQr).catch(e => { toastErr(e); $('#qrBox').innerHTML = '<p class="p-4">Pustaka QR gagal dimuat. Periksa koneksi lalu buka ulang.</p>'; });
  Projector.tick = setInterval(drawRing, 250);
  AppState.cleanups.push(closeProjector);
}

async function fetchQr() {
  clearTimeout(Projector.timer);
  if (!Projector.sessionId) return;
  try {
    const r = await api('att.qr', { session_id: Projector.sessionId }, { retries: 2 });
    if (!Projector.sessionId) return;
    $('#pjCount').textContent = r.hadir; $('#pjTotal').textContent = '/ ' + r.total;
    $('#pjRecent').innerHTML = r.terbaru.length ? r.terbaru.map(n => `<li>${esc(n)}</li>`).join('') : '<li class="text-muted-ss">Belum ada</li>';
    if (!r.terbuka) {
      $('#qrBox').innerHTML = `<div class="text-center p-5" style="color:#25252B"><i class="bi bi-lock" style="font-size:3rem"></i><div class="fw-700 mt-2">Sesi sudah ditutup</div></div>`;
      clearInterval(Projector.tick); return;
    }
    if (!Projector.qr) { $('#qrBox').innerHTML = ''; Projector.qr = new QRCode($('#qrBox'), { text: r.token, width: 512, height: 512, correctLevel: QRCode.CorrectLevel.M, colorDark: '#1E1E24', colorLight: '#FFFFFF' }); }
    else { Projector.qr.clear(); Projector.qr.makeCode(r.token); }
    const cc = $('#pjCodeCard');
    if (cc) { cc.classList.toggle('d-none', r.mode !== 'daring'); if (r.kode) $('#pjCode').textContent = r.kode; }
    Projector.interval = r.interval_ms;
    Projector.deadline = Date.now() + r.ms_tersisa;
    Projector.timer = setTimeout(fetchQr, r.ms_tersisa + 150);
  } catch (e) {
    toastErr(e);
    Projector.timer = setTimeout(fetchQr, 3000);
  }
}

function drawRing() {
  const bar = $('#ringBar'), txt = $('#ringText'); if (!bar) return;
  const left = Math.max(0, Projector.deadline - Date.now());
  bar.setAttribute('stroke-dashoffset', (314.16 * (1 - left / Projector.interval)).toFixed(1));
  txt.textContent = Math.ceil(left / 1000);
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else ($('#projector').requestFullscreen || function () { toast('Layar penuh tidak didukung', 'Tekan F11 pada browser.', 'info'); }).call($('#projector'));
  } catch (e) { toast('Layar penuh tidak tersedia', 'Tekan F11 pada browser.', 'info'); }
}

function closeProjector() {
  Projector.sessionId = null;
  clearTimeout(Projector.timer); clearInterval(Projector.tick);
  const el = $('#projector'); if (el) { el.classList.add('d-none'); el.innerHTML = ''; }
  document.body.style.overflow = '';
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* abaikan */ } }
}

// ── Rekap per pertemuan + koreksi status ──
async function openAttMeeting(meetingId) {
  const body = openModal({ title: 'Rekap absensi', body: loadingBlock(), size: 'modal-xl' });
  try {
    const d = await api('att.meeting', { meeting_id: meetingId });
    AppState.attMeeting = d;
    document.getElementById('appModalTitle').textContent = 'Rekap — ' + d.meeting.judul;
    const sum = s => d.students.filter(x => x.status === s).length;
    body.innerHTML = `
      <div class="d-flex flex-wrap gap-2 mb-3">${['hadir', 'terlambat', 'izin', 'sakit', 'alpa'].map(k => badge(ATT_LABEL[k] + ' ' + sum(k), attBadgeCls(k))).join('')}${badge('Belum ' + d.students.filter(x => !x.status).length, 'b-muted')}</div>
      <div class="answer-box small-ss mb-3" style="white-space:normal"><i class="bi bi-pencil-square"></i> <b>Koreksi kehadiran:</b> ubah status di kolom paling kanan (mis. tercatat Hadir padahal Alpa karena kendala koneksi). Perubahan langsung tersimpan dan tercatat di log audit.</div>
      <div id="attBody"><div class="table-wrap"><table class="table-ss"><thead><tr><th>Mahasiswa</th><th>Waktu scan</th><th>Status (bisa diubah)</th></tr></thead><tbody>
        ${d.students.map(s => `<tr><td><div class="fw-600">${esc(s.nama)}</div><div class="small-ss text-secondary-ss">${esc(s.npm)}</div></td>
          <td class="small-ss">${s.waktu_scan ? esc(fmtTime(s.waktu_scan)) : '-'}</td>
          <td>${d.archived || (s.is_self && !d.is_owner) ? attBadge(s.status) + (s.is_self ? ' <span class="small-ss text-muted-ss">(milik Anda)</span>' : '')
            : `<select class="pill-select" onchange="setAttStatus('${meetingId}','${s.user_id}',this)" aria-label="Status ${esc(s.nama)}">
              ${!s.status ? '<option value="" selected>Belum</option>' : ''}${Object.entries(ATT_LABEL).map(([k, l]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <input class="form-control form-control-sm mt-1" style="min-height:32px;min-width:150px" maxlength="120" placeholder="Keterangan (tampil di PDF)" value="${esc(s.catatan || '')}" ${!s.status ? 'disabled' : ''} onchange="setAttNote('${meetingId}','${s.user_id}',this)" aria-label="Keterangan ${esc(s.nama)}">
              ${s.dikoreksi ? '<i class="bi bi-pencil-square text-muted-ss ms-1" title="Pernah dikoreksi manual"></i>' : ''}`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  } catch (e) { body.innerHTML = errorBlock(e); }
}
function attBadgeCls(k) { return { hadir: 'b-ok', terlambat: 'b-warn', izin: 'b-info', sakit: 'b-info', alpa: 'b-bad' }[k] || 'b-muted'; }

async function setAttNote(meetingId, userId, inp) {
  const sel = inp.closest('td').querySelector('select'); if (!sel || !sel.value) return;
  try { await api('att.setStatus', { meeting_id: meetingId, user_id: userId, status: sel.value, catatan: inp.value.trim() }); toast('Keterangan disimpan', '', 'success'); AppState.attRecap = null; }
  catch (e) { toastErr(e); }
}
/** Optimistis: pilihan langsung berlaku di layar; server menyusul. Bila gagal, pilihan dikembalikan. */
function setAttStatus(meetingId, userId, sel) {
  if (!sel.value) return;
  const prev = sel.dataset.cur !== undefined ? sel.dataset.cur : ((Array.from(sel.options).find(o => o.defaultSelected) || {}).value || '');
  const note = sel.closest('td').querySelector('input');
  sel.dataset.cur = sel.value; if (note) note.disabled = false;
  const st = AppState.attMeeting && AppState.attMeeting.students.find(x => x.user_id === userId);
  if (st) st.status = sel.value;
  toast('Kehadiran dikoreksi', (st ? st.nama + ': ' : '') + ATT_LABEL[sel.value], 'success');
  AppState.attRecap = null;
  api('att.setStatus', { meeting_id: meetingId, user_id: userId, status: sel.value, catatan: note ? note.value.trim() : undefined })
    .then(() => {
      if (AppState.page === 'kelas-detail' && AppState.params.tab === 'absensi') { const b = $('#tabBody'); const d = AppState.classCache[AppState.params.class_id]; if (b && d) renderAbsensiTab(b, d); }
    })
    .catch(e => { sel.value = prev; sel.dataset.cur = prev; if (st) st.status = prev; toastErr(e); });
}

// ════════════════════════════════════════════════════════
// BAGIAN 19: ABSENSI — MAHASISWA
// Absen cukup memindai QR di layar kelas (luring) atau memasukkan kode 6 angka (daring). Tanpa lokasi & foto.
// Kamera langsung dipakai bila diizinkan; bila Google memblokir kamera di dalam
// aplikasi (permissions policy), otomatis beralih ke kamera bawaan HP (ambil foto).
// ════════════════════════════════════════════════════════

const Absen = { scanner: null, stream: null, permWatch: null, busy: false };
const UA = { ios: /iPhone|iPad|iPod/i.test(navigator.userAgent), android: /Android/i.test(navigator.userAgent) };

/** true/false bila browser bisa memastikan fitur diizinkan bingkai ini; null bila tidak diketahui. */
function framePolicyAllows(feature) {
  const pol = document.permissionsPolicy || document.featurePolicy;
  try { if (pol && typeof pol.allowsFeature === 'function') return pol.allowsFeature(feature); } catch (e) { /* abaikan */ }
  return null;
}
async function permStatus(name) { try { return await navigator.permissions.query({ name }); } catch (e) { return null; } }

function stopAbsenMedia() {
  if (Absen.scanner) { const s = Absen.scanner; Absen.scanner = null; try { if (s.isScanning) s.stop().then(() => s.clear()).catch(() => { }); } catch (e) { /* abaikan */ } }
  if (Absen.stream) { Absen.stream.getTracks().forEach(t => t.stop()); Absen.stream = null; }
  if (Absen.permWatch) { Absen.permWatch.onchange = null; Absen.permWatch = null; }
}

function permissionSteps(kind) {
  const k = kind === 'kamera' ? 'Kamera' : 'Lokasi';
  if (UA.android) return ['Ketuk ikon gembok/pengaturan di sebelah kiri alamat situs.', `Pilih <b>Izin</b> → <b>${k}</b> → <b>Izinkan</b>.`, `Bila masih diblokir: <b>Setelan HP → Aplikasi → Chrome → Izin → ${k}</b> → Izinkan.`];
  if (UA.ios) return ['Ketuk <b>aA</b> di bilah alamat Safari → <b>Pengaturan Situs Web</b>.', `Ubah <b>${k}</b> menjadi <b>Izinkan</b>.`, `Bila masih diblokir: <b>Pengaturan iPhone → Safari → ${k}</b> → Izinkan.`];
  return ['Klik ikon gembok di sebelah kiri alamat situs.', `Ubah <b>${k}</b> menjadi <b>Izinkan</b>.`, 'Muat ulang halaman bila diminta.'];
}

function absenFrame(step, inner) {
  return `<div class="mx-auto" style="max-width:480px">
    <div class="page-head"><div><h1>Absen</h1><p>${step === 1 ? 'Pindai/foto QR yang tampil di layar kelas, atau masukkan kode untuk kelas daring.' : step === 2 ? 'Memeriksa absensi…' : 'Selesai.'}</p></div></div>
    <div class="ss-card">${inner}</div></div>`;
}

async function renderAbsen(params, c) {
  AppState.cleanups.push(stopAbsenMedia);
  Object.assign(Absen, { busy: false });
  c.innerHTML = absenFrame(1, `
    <div id="daringBox"></div>
    <h2 class="h6 mb-2"><i class="bi bi-qr-code-scan"></i> QR absensi</h2>
    <div id="qrArea">${loadingBlock('Menyiapkan kamera…')}</div>
    <div id="activeInfo" class="mt-3"></div>`);
  loadActiveSessions();
  setupQrCapture();
}

async function loadActiveSessions() {
  try {
    const list = (await api('att.active')).filter(x => x.peran === 'mahasiswa');
    const info = $('#activeInfo'); if (!info) return;
    info.innerHTML = list.length ? list.map(s => `<div class="item-row"><div class="item-icon ${s.mode === 'daring' ? 'ii-file' : 'ii-link'}"><i class="bi ${s.mode === 'daring' ? 'bi-camera-video' : 'bi-broadcast'}"></i></div>
      <div class="flex-grow-1"><div class="i-title">${esc(s.nama_kelas)}</div><div class="i-sub">${esc(s.pertemuan)} — ${s.mode === 'daring' ? 'daring' : 'luring'}</div></div>
      ${s.link_meet ? `<a class="btn btn-soft btn-sm" href="${esc(s.link_meet)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-camera-video"></i> Meet</a>` : ''}
      ${s.sudah_absen ? badge('Sudah absen', 'b-ok') : badge('Dibuka', 'b-accent')}</div>`).join('')
      : `<p class="small-ss text-muted-ss text-center mb-0">Belum ada sesi absensi yang dibuka di kelasmu.</p>`;
    const daring = list.find(s => s.mode === 'daring' && !s.sudah_absen);
    const box = $('#daringBox');
    if (daring && box) {
      box.innerHTML = `<div class="ss-card highlight-card mb-3">
        <h3 class="h6 mb-1"><i class="bi bi-camera-video"></i> Kelas daring: masukkan kode</h3>
        <p class="small-ss mb-2">${esc(daring.nama_kelas)} — kode 6 angka dari layar dosen (berganti tiap 60 detik).</p>
        <form id="codeForm" class="d-flex gap-2"><input class="form-control code-input" id="codeIn" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-label="Kode absensi">
          <button class="btn btn-ink" type="submit">Absen</button></form></div>`;
      $('#codeForm').onsubmit = e => {
        e.preventDefault();
        const kode = $('#codeIn').value.replace(/\D/g, '');
        if (kode.length !== 6) return toast('Kode 6 angka', 'Periksa kembali kode di layar dosen.', 'warning');
        startCheckin({ kode });
      };
    }
  } catch (e) { /* info tambahan saja */ }
}

/** Pilih cara memindai QR sesuai kemampuan & izin perangkat — tanpa menebak-nebak. */
async function setupQrCapture() {
  const area = $('#qrArea'); if (!area) return;
  const pol = framePolicyAllows('camera');
  if (pol === false) return showPhotoQr('blocked');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showPhotoQr('unsupported');
  try { await loadLib('scanner'); } catch (e) { return showPhotoQr('unsupported'); }
  const st = await permStatus('camera');
  if (st && st.state === 'denied') { showPhotoQr('denied'); return showCameraHelp(st); }
  if (st && st.state === 'prompt') {
    area.innerHTML = `<div class="photo-cta"><i class="bi bi-camera-video"></i><p class="mt-2 mb-0">Menunggu izin kamera…</p></div>`;
    openModal({
      title: 'Izinkan kamera',
      body: `<p>Aplikasi perlu kamera untuk memindai QR absensi. Setelah menekan tombol di bawah, pilih <b>Izinkan</b> pada pesan browser.</p>`,
      footer: `<button class="btn btn-soft" id="camPhoto"><i class="bi bi-camera"></i> Pakai kamera HP (foto)</button><button class="btn btn-ink" id="camAllow"><i class="bi bi-check2"></i> Izinkan kamera</button>`
    });
    $('#camAllow').onclick = () => { closeModal(); startLiveScanner(); };
    $('#camPhoto').onclick = () => { closeModal(); showPhotoQr('manual'); };
    return;
  }
  startLiveScanner();
}

/** Pop-up panduan izin + kamera otomatis menyala begitu izin diberikan. */
function showCameraHelp(status) {
  openModal({
    title: 'Kamera belum diizinkan',
    body: `<p class="mb-2">Browser memblokir kamera untuk aplikasi ini. Buka pengaturan dan izinkan kamera:</p>
      <ol class="help-steps small-ss">${permissionSteps('kamera').map(x => `<li>${x}</li>`).join('')}</ol>
      <div class="answer-box small-ss mt-3" style="white-space:normal"><span class="spinner-inline"></span> Menunggu izin. Kamera akan menyala otomatis setelah diizinkan.</div>`,
    footer: `<button class="btn btn-soft" id="helpPhoto"><i class="bi bi-camera"></i> Pakai kamera HP (foto)</button><button class="btn btn-ink" id="helpRetry">Saya sudah mengizinkan</button>`
  });
  $('#helpRetry').onclick = () => { closeModal(); startLiveScanner(); };
  $('#helpPhoto').onclick = () => { closeModal(); showPhotoQr('manual'); };
  if (status) {
    Absen.permWatch = status;
    status.onchange = () => {
      if (status.state === 'granted') { status.onchange = null; closeModal(); toast('Kamera diizinkan', 'Memulai pemindai…', 'success'); startLiveScanner(); }
    };
  }
}

async function startLiveScanner() {
  const area = $('#qrArea'); if (!area) return;
  if (Absen.scanner) { try { await Absen.scanner.stop(); } catch (e) { /* abaikan */ } Absen.scanner = null; }
  area.innerHTML = `<div class="scan-box"><div id="reader"></div></div>
    <div id="scanMsg" class="small-ss text-secondary-ss text-center mt-2">Mengaktifkan kamera…</div>
    <div class="text-center mt-1"><button class="btn btn-ghost btn-sm" onclick="showPhotoQr('manual')"><i class="bi bi-camera"></i> Kesulitan? Foto QR saja</button></div>`;
  try {
    const scanner = new Html5Qrcode('reader', { verbose: false });
    Absen.scanner = scanner;
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; }, aspectRatio: 1 },
      text => { if (!Absen.busy) startCheckin({ qr: text }); }, () => { });
    const m = $('#scanMsg'); if (m) m.textContent = 'Kamera aktif. Arahkan ke QR di layar.';
  } catch (e) {
    Absen.scanner = null;
    const msg = String(e && (e.name || e.message || e));
    if (/NotAllowed|Permission/i.test(msg)) {
      const st = await permStatus('camera');
      if (st && st.state === 'denied') { showPhotoQr('denied'); showCameraHelp(st); }
      else showPhotoQr('blocked'); // izin HP sudah ada, tetapi bingkai aplikasi memblokir kamera
    } else showPhotoQr('error', cameraError(e));
  }
}

function cameraError(e) {
  const s = String(e && (e.name || e.message || e));
  if (/NotFound|Overconstrained/i.test(s)) return 'Kamera tidak ditemukan di perangkat ini.';
  if (/NotReadable|in use/i.test(s)) return 'Kamera sedang dipakai aplikasi lain.';
  return 'Kamera tidak dapat dibuka: ' + (e && e.message ? e.message : s);
}

/** Mode foto: membuka kamera bawaan HP (tidak terpengaruh blokir kamera di dalam aplikasi). */
function showPhotoQr(reason, detail) {
  if (Absen.scanner) { const s = Absen.scanner; Absen.scanner = null; try { s.stop().catch(() => { }); } catch (e) { /* abaikan */ } }
  const area = $('#qrArea'); if (!area) return;
  const why = {
    blocked: 'Google membatasi kamera langsung di dalam aplikasi ini. Kamu tetap bisa absen memakai kamera bawaan HP: foto QR-nya.',
    denied: 'Izin kamera browser sedang diblokir. Sambil mengatur izin, kamu tetap bisa absen dengan memfoto QR.',
    unsupported: 'Browser ini tidak mendukung kamera langsung. Gunakan kamera bawaan HP untuk memfoto QR.',
    manual: 'Ambil foto QR memakai kamera bawaan HP.',
    error: detail || 'Kamera langsung gagal dibuka.'
  }[reason] || '';
  area.innerHTML = `<div class="photo-cta"><i class="bi bi-camera"></i>
    <p class="mt-2 mb-3">${esc(why)}</p>
    <label class="btn btn-ink"><i class="bi bi-qr-code-scan"></i> Foto QR sekarang<input type="file" accept="image/jpeg,image/png" capture="environment" class="d-none" id="qrPhoto"></label>
    <div class="small-ss text-secondary-ss mt-3">Dekatkan sampai QR terlihat penuh dan tajam, lalu langsung ambil foto (QR berganti beberapa detik sekali).</div>
    <div id="qrPhotoMsg" class="small-ss mt-2" role="status"></div>
    ${['denied', 'manual', 'error'].includes(reason) ? `<button class="btn btn-ghost btn-sm mt-2" onclick="setupQrCapture()"><i class="bi bi-arrow-repeat"></i> Coba kamera langsung lagi</button>` : ''}</div>`;
  $('#qrPhoto').onchange = async ev => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const msg = $('#qrPhotoMsg');
    msg.innerHTML = '<span class="spinner-inline"></span> Membaca QR dari foto…';
    try { const text = await decodeQrFromFile(file); startCheckin({ qr: text }); }
    catch (e) { msg.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
  };
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
    img.src = URL.createObjectURL(file);
  });
}
function imageToFile(img, max) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(b => res(new File([b], 'qr.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92));
}

/** Baca QR dari foto: BarcodeDetector bawaan browser bila ada, lalu html5-qrcode pada beberapa ukuran. */
async function decodeQrFromFile(file) {
  const img = await loadImageFile(file);
  try {
    if ('BarcodeDetector' in window) {
      try { const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(img); if (r && r.length) return r[0].rawValue; } catch (e) { /* lanjut */ }
    }
    try { await loadLib('scanner'); } catch (e) { throw new Error('Pembaca QR gagal dimuat. Periksa koneksi internet.'); }
    for (const max of [1600, 1000, 2400]) {
      const f = await imageToFile(img, max);
      const h = new Html5Qrcode('qrFileReader', { verbose: false });
      try { const t = await h.scanFile(f, false); try { h.clear(); } catch (e) { /* abaikan */ } return t; }
      catch (e) { try { h.clear(); } catch (e2) { /* abaikan */ } }
    }
    throw new Error('QR tidak terbaca. Foto ulang lebih dekat, pastikan QR utuh dan tidak buram.');
  } finally { URL.revokeObjectURL(img.src); }
}

/** Kirim QR/kode ke server. Bila benar, kehadiran LANGSUNG tercatat (tanpa lokasi dan tanpa foto). */
async function startCheckin(payload) {
  if (Absen.busy) return;
  Absen.busy = true;
  stopAbsenMedia();
  if (navigator.vibrate) navigator.vibrate(60);
  container().innerHTML = absenFrame(2, `<div class="text-center py-4"><div class="spinner-ring mx-auto mb-3"></div><b>${payload.kode ? 'Memeriksa kode…' : 'Memeriksa QR…'}</b></div>`);
  try {
    const r = await api('att.scan', payload, { retries: 2 });
    SWR.clear();
    showAbsenResult(true, r.nama_kelas + ' — ' + r.pertemuan, r);
  } catch (e) {
    if (/sudah tercatat/.test(e.message)) showAbsenResult(true, e.message);     // mis. jaringan terputus setelah berhasil
    else showAbsenResult(false, e.message);
  } finally { Absen.busy = false; }
}

function showAbsenResult(ok, msg, r) {
  stopAbsenMedia();
  const late = r && r.status === 'terlambat';
  container().innerHTML = absenFrame(3, `<div class="text-center py-3">
    <div class="result-badge" style="background:${ok ? (late ? 'var(--warn-soft)' : 'var(--ok-soft)') : 'var(--bad-soft)'};color:${ok ? (late ? 'var(--warn)' : 'var(--ok)') : 'var(--bad)'}">
      <i class="bi ${ok ? 'bi-check-lg' : 'bi-x-lg'}"></i></div>
    <h2 class="h5">${ok ? (late ? 'Absen tercatat terlambat' : 'Absen berhasil') : 'Absen ditolak'}</h2>
    <p class="text-secondary-ss">${esc(msg)}${r && r.waktu ? ', ' + esc(fmtTime(r.waktu)) : ''}</p>
    <div class="d-flex gap-2 justify-content-center">${ok ? `<button class="btn btn-ink" onclick="navigateTo('dashboard',{}, {reset:true})">Ke beranda</button>`
      : `<button class="btn btn-ink" onclick="navigateTo('absen',{}, {noHistory:true})"><i class="bi bi-arrow-repeat"></i> Coba lagi</button>`}</div></div>`);
}

/** Tab "Absensi saya" untuk mahasiswa. */
async function renderAbsensiSayaTab(body, d) {
  await swr('att.mine', { class_id: d.cls.class_id }, r => drawAbsensiSaya(body, r), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

async function printMyAttendance(btn) {
  await withBtn(btn, async () => {
    try { const r = await api('report.myAttendancePdf', { class_id: AppState.params.class_id }); downloadBase64(r.base64, 'application/pdf', r.name); toast('PDF kehadiran diunduh', r.name, 'success'); }
    catch (e) { toastErr(e); }
  });
}

function drawAbsensiSaya(body, r) {
  const s = r.ringkasan;
  const cls = s.persen === null ? 'b-muted' : s.persen >= 85 ? 'b-ok' : s.persen >= 75 ? 'b-warn' : 'b-bad';
  body.innerHTML = `
    <div class="d-flex justify-content-end mb-2"><button class="btn btn-soft btn-sm" onclick="printMyAttendance(this)" data-loading="Membuat PDF…"><i class="bi bi-file-earmark-pdf"></i> Unduh daftar hadirku (PDF)</button></div>
    <div class="ss-card mb-3 d-flex flex-wrap align-items-center gap-3">
      <div><div class="small-ss text-secondary-ss">Persentase kehadiran</div><div class="kpi-value" style="margin:0">${s.persen === null ? '–' : s.persen + '%'}</div></div>
      ${badge(s.persen === null ? 'Belum ada data' : s.persen >= 85 ? 'Aman' : s.persen >= 75 ? 'Perlu perhatian' : 'Berisiko', cls)}
      <div class="ms-auto d-flex flex-wrap gap-2">${['hadir', 'terlambat', 'izin', 'sakit', 'alpa'].map(k => badge(ATT_LABEL[k] + ' ' + s[k], attBadgeCls(k))).join('')}</div></div>
    ${r.list.map(m => `<div class="item-row"><div class="flex-grow-1"><div class="i-title">${esc(m.judul)}</div><div class="i-sub">${m.tanggal ? esc(fmtDate(m.tanggal)) : '-'}${m.waktu_scan ? ' — scan ' + esc(fmtTime(m.waktu_scan)) : ''}</div></div>${attBadge(m.status)}</div>`).join('')
      || emptyState('Belum ada pertemuan', '')}
    <p class="small-ss text-muted-ss mt-2">Izin dan sakit tidak dihitung sebagai ketidakhadiran.</p>`;
}

// ════════════════════════════════════════════════════════
// BAGIAN 25: MANAJEMEN NILAI (bobot, UTS/UAS, impor & ekspor Excel, PDF)
// ════════════════════════════════════════════════════════

AppState.examEdits = {}; // { user_id: { uts, uas } } — perubahan yang belum disimpan

function fmtScore(v) { return v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','); }
function hurufCls(h) { return { A: 'b-ok', B: 'b-ok', C: 'b-warn', D: 'b-bad', E: 'b-bad' }[h] || 'b-muted'; }

async function renderNilaiTab(body, d) {
  AppState.examEdits = {};
  await swr('grade.summary', { class_id: d.cls.class_id }, g => {
    if (Object.keys(AppState.examEdits).length) return; // jangan timpa isian yang belum disimpan
    drawNilai(body, d, g);
  }, { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

/** Semua komponen punya kolom koreksi: nilai yang diketik menimpa hitungan otomatis; kosong = otomatis. */
function manualComps(g) { return g.weights; }

function drawNilai(body, d, g) {
  AppState.gradeData = g;
  const can = g.can_edit, manual = manualComps(g);
  const examCell = (r, w) => {
    const k = w.komponen, m = r.ujian[k], adj = m !== null && m !== undefined, auto = r.otomatis ? r.otomatis[k] : r.comps[k];
    const hint = (w.jenis === 'absensi' ? `Hadir ${r.kehadiran.hadir}, terlambat ${r.kehadiran.terlambat}, izin ${r.kehadiran.izin}, sakit ${r.kehadiran.sakit}, alpa ${r.kehadiran.alpa}. ` : '')
      + (auto !== null && auto !== undefined ? 'Hitungan otomatis: ' + fmtScore(auto) + '. ' : 'Belum ada hitungan otomatis. ') + (adj ? 'Nilai ini sudah dikoreksi dosen; kosongkan untuk kembali otomatis.' : 'Ketik angka untuk menimpa.');
    return can ? `<input class="form-control form-control-sm exam-input tabular ${adj ? 'adj' : ''}" type="number" min="0" max="100" step="0.5" data-uid="${r.user_id}" data-k="${esc(k)}"
        value="${adj ? m : ''}" placeholder="${auto !== null && auto !== undefined ? fmtScore(auto) : '–'}" aria-label="Nilai ${esc(w.label)} ${esc(r.nama)}" title="${esc(hint)}">`
      : `<span class="tabular" title="${esc(hint)}">${fmtScore(r.comps[k])}${adj ? ' <i class="bi bi-pencil-square text-muted-ss"></i>' : ''}</span>`;
  };
  const cell = (r, w) => examCell(r, w);
  const incomplete = g.rows.filter(r => !r.lengkap).length;
  const manualNames = manual.map(w => w.label);
  body.innerHTML = `
    <div class="ss-card mb-3">
      <div class="card-head flex-wrap"><h2>Komponen & bobot nilai</h2>
        ${d.access.isOwner ? `<button class="btn btn-ghost btn-sm" onclick="switchClassTab('pengaturan')"><i class="bi bi-sliders"></i> Ubah komponen & bobot</button>` : ''}</div>
      <div class="weight-chips">${g.weights.map(x => `<span class="weight-chip">${esc(x.label)} <b>${x.bobot_persen}%</b> <span class="text-muted-ss">(${esc(JENIS_LABEL[x.jenis] || x.jenis)}${g.jumlah_tugas[x.komponen] ? ', ' + g.jumlah_tugas[x.komponen] + ' tugas' : ''})</span></span>`).join('')}</div>
      <p class="small-ss text-secondary-ss mt-3 mb-0">Kolom komponen terisi <b>otomatis</b>: Kehadiran dari absensi (hadir 100, terlambat ${g.poin_terlambat}, izin/sakit tidak dihitung), komponen lain dari rata-rata nilai tugas yang dialokasikan (tugas lewat tenggat tanpa pengiriman = 0). Bila terjadi kesalahan atau perlu penyesuaian, <b>ketik nilai di kolom</b> mahasiswa itu: nilainya menimpa hitungan otomatis (kolom diberi warna). Kosongkan kolom untuk kembali otomatis. Angka abu-abu di kolom kosong adalah hitungan otomatisnya.</p>
    </div>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      ${can ? `<button class="btn btn-ink btn-sm" id="saveExams" disabled><i class="bi bi-save"></i> Simpan perubahan nilai</button>
        <label class="btn btn-soft btn-sm mb-0"><i class="bi bi-upload"></i> Impor nilai (Excel)<input type="file" accept=".xlsx,.xls,.csv" class="d-none" id="examImport"></label>
        <button class="btn btn-ghost btn-sm" onclick="downloadExamTemplate()"><i class="bi bi-file-earmark-spreadsheet"></i> Template Excel</button>` : ''}
      <span class="ms-auto"></span>
      <button class="btn btn-soft btn-sm" onclick="exportGradesExcel(this)" data-loading="Menyiapkan…"><i class="bi bi-file-earmark-excel"></i> Ekspor Excel</button>
      <button class="btn btn-soft btn-sm" onclick="printGradesPdf(this)" data-loading="Membuat PDF…"><i class="bi bi-file-earmark-pdf"></i> Cetak PDF</button>
    </div>
    <div id="examNote" class="small-ss mb-2" role="status"></div>
    ${incomplete ? `<p class="small-ss text-secondary-ss">${incomplete} mahasiswa nilainya belum lengkap (komponen bertanda – dihitung 0).</p>` : ''}
    ${g.rows.length ? `<div class="table-wrap"><table class="table-ss grade-table"><thead><tr>
        <th>No</th><th class="l sticky-col">Mahasiswa</th>
        ${g.weights.map(w => `<th>${esc(w.label)}<br><span class="text-muted-ss">${w.bobot_persen}%</span></th>`).join('')}
        <th>Nilai akhir</th><th>Huruf</th></tr></thead><tbody>
      ${g.rows.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td class="l sticky-col"><button class="name-link" onclick="openRincianMahasiswa('${r.user_id}')" title="Lihat asal nilai ${esc(r.nama)}">${esc(r.nama)}</button><div class="small-ss text-secondary-ss">${esc(r.npm)}</div></td>
        ${g.weights.map(w => `<td>${cell(r, w)}</td>`).join('')}
        <td class="final tabular">${fmtScore(r.akhir)}</td>
        <td>${badge(r.huruf, hurufCls(r.huruf))}${r.lengkap ? '' : ' <i class="bi bi-exclamation-circle text-muted-ss" title="Ada komponen yang belum ada nilainya"></i>'}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('Belum ada mahasiswa', 'Nilai muncul setelah mahasiswa bergabung ke kelas.')}`;
  if (!can) return;
  $$('.exam-input', body).forEach(inp => {
    inp.oninput = () => {
      const uid = inp.dataset.uid, k = inp.dataset.k;
      const row = g.rows.find(r => r.user_id === uid);
      const orig = row.ujian[k] === null || row.ujian[k] === undefined ? '' : String(row.ujian[k]);
      AppState.examEdits[uid] = AppState.examEdits[uid] || {};
      if (inp.value.trim() === orig) delete AppState.examEdits[uid][k]; else AppState.examEdits[uid][k] = inp.value.trim();
      if (!Object.keys(AppState.examEdits[uid]).length) delete AppState.examEdits[uid];
      inp.classList.toggle('changed', inp.value.trim() !== orig);
      syncExamSave();
    };
  });
  $('#saveExams').onclick = e => saveExamEdits(e.currentTarget);
  $('#examImport').onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importExamExcel(f); };
}

function syncExamSave() {
  const n = Object.keys(AppState.examEdits).length;
  const b = $('#saveExams');
  if (b) { b.disabled = !n; b.innerHTML = `<i class="bi bi-save"></i> Simpan perubahan nilai${n ? ' (' + n + ' mahasiswa)' : ''}`; }
}

async function saveExamEdits(btn) {
  const names = {}; (AppState.gradeData.weights || []).forEach(w => { names[w.komponen] = w.label; });
  const items = Object.entries(AppState.examEdits).map(([user_id, v]) => Object.assign({ user_id }, v));
  for (const it of items) {
    for (const k of Object.keys(it)) {
      if (k === 'user_id' || it[k] === '') continue;
      const n = Number(String(it[k]).replace(',', '.'));
      if (isNaN(n) || n < 0 || n > 100) return toast('Nilai tidak valid', `${names[k] || k} harus 0–100.`, 'warning');
      it[k] = n;
    }
  }
  await withBtn(btn, async () => {
    try {
      const r = await api('grade.saveExams', { class_id: AppState.params.class_id, items });
      AppState.examEdits = {};
      toast('Nilai disimpan', r.diubah + ' nilai diperbarui', 'success');
      loadClassTab('nilai');
    } catch (e) { toastErr(e); }
  });
}

function normNpm(v) { return String(v === undefined || v === null ? '' : v).replace(/\.0+$/, '').replace(/\s+/g, '').toLowerCase(); }
function normHead(v) { return String(v === undefined || v === null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Impor nilai manual dari Excel: kolom NPM wajib; tiap komponen "Input manual" dikenali dari judul kolom (sama dengan nama komponen). */
async function importExamExcel(file) {
  const note = $('#examNote');
  note.innerHTML = '<span class="spinner-inline"></span> Membaca file Excel…';
  try {
    await loadScript(XLSX_SRC);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const hIdx = rows.findIndex(r => r.some(c => /^(npm|nim)$/i.test(String(c).trim()) || /npm|nim/i.test(String(c))));
    if (hIdx < 0) throw new Error('Kolom NPM tidak ditemukan. Gunakan judul kolom "NPM".');
    const head = rows[hIdx].map(normHead);
    const cNpm = head.findIndex(h => /npm|nim/.test(h));
    const g = AppState.gradeData, manual = manualComps(g);
    const taken = new Set([cNpm]);
    const alias = { uts: /uts|tengah/, uas: /uas|akhirsemester|ujianakhir/ };
    const cols = [];
    manual.forEach(w => {
      const nm = normHead(w.label);
      let ci = head.findIndex((h, i) => !taken.has(i) && h && h === nm);
      if (ci < 0 && alias[w.komponen]) ci = head.findIndex((h, i) => !taken.has(i) && alias[w.komponen].test(h));
      if (ci < 0 && nm.length >= 3) ci = head.findIndex((h, i) => !taken.has(i) && h.length >= 3 && (h.includes(nm) || nm.includes(h)) && !/nama|npm|nim/.test(h));
      if (ci >= 0) { taken.add(ci); cols.push({ w, ci }); }
    });
    if (!cols.length) throw new Error('Tidak ada kolom yang cocok dengan nama komponen (' + manual.map(w => w.label).join(', ') + '). Samakan judul kolom dengan nama komponen, atau unduh Template Excel.');
    const byNpm = {}; g.rows.forEach(r => { byNpm[normNpm(r.npm)] = r; });
    let matched = 0; const unknown = [], invalid = [];
    rows.slice(hIdx + 1).forEach(r => {
      const npm = normNpm(r[cNpm]); if (!npm) return;
      const st = byNpm[npm]; if (!st) { unknown.push(r[cNpm]); return; }
      let any = false;
      cols.forEach(({ w, ci }) => {
        const raw = String(r[ci]).trim().replace(',', '.'); if (raw === '') return;
        const n = Number(raw);
        if (isNaN(n) || n < 0 || n > 100) { invalid.push(r[cNpm] + ' (' + w.label + ')'); return; }
        const inp = $(`.exam-input[data-uid="${st.user_id}"][data-k="${w.komponen}"]`);
        if (inp) { inp.value = n; inp.dispatchEvent(new Event('input')); any = true; }
      });
      if (any) matched++;
    });
    note.innerHTML = `<div class="answer-box" style="white-space:normal"><b>${matched} mahasiswa</b> terisi dari Excel (kolom terbaca: ${esc(cols.map(c => c.w.label).join(', '))}). Periksa lalu tekan <b>Simpan perubahan nilai</b>.
      ${cols.length < manual.length ? `<br><span style="color:var(--warn)">Kolom tidak ditemukan untuk: ${esc(manual.filter(w => !cols.some(c => c.w === w)).map(w => w.label).join(', '))}</span>` : ''}
      ${unknown.length ? `<br><span style="color:var(--warn)">NPM tidak ada di kelas: ${esc(unknown.slice(0, 10).join(', '))}${unknown.length > 10 ? ', …' : ''}</span>` : ''}
      ${invalid.length ? `<br><span style="color:var(--bad)">Nilai tidak valid (harus 0–100): ${esc(invalid.slice(0, 10).join(', '))}</span>` : ''}</div>`;
  } catch (e) { note.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}

async function downloadExamTemplate() {
  try {
    await loadScript(XLSX_SRC);
    const g = AppState.gradeData, c = AppState.classCache[AppState.params.class_id].cls, manual = manualComps(g);
    const aoa = [['NPM', 'Nama Mahasiswa'].concat(manual.map(w => w.label))].concat(g.rows.map(r => [r.npm, r.nama].concat(manual.map(w => r.ujian[w.komponen] === null || r.ujian[w.komponen] === undefined ? '' : r.ujian[w.komponen]))));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 14 }, { wch: 32 }].concat(manual.map(() => ({ wch: 14 })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Nilai manual');
    XLSX.writeFile(wb, `Template Nilai - ${c.nama_kelas}.xlsx`);
  } catch (e) { toastErr(e); }
}

/** Ekspor: NPM, Nama, lalu setiap komponen sesuai pengaturan kelas (urutan & nama mengikuti pengaturan dosen). */
async function exportGradesExcel(btn) {
  await withBtn(btn, async () => {
    try {
      await loadScript(XLSX_SRC);
      const g = AppState.gradeData, c = AppState.classCache[AppState.params.class_id].cls;
      const v = x => x === null || x === undefined ? '' : x;
      const aoa = [['NPM', 'Nama Mahasiswa'].concat(g.weights.map(w => w.label))]
        .concat(g.rows.map(r => [r.npm, r.nama].concat(g.weights.map(w => v(r.comps[w.komponen])))));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 14 }, { wch: 32 }].concat(g.weights.map(() => ({ wch: 14 })));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rekap Nilai');
      XLSX.writeFile(wb, `Rekap Nilai - ${c.nama_kelas}.xlsx`);
    } catch (e) { toastErr(e); }
  });
}

async function printGradesPdf(btn) {
  await withBtn(btn, async () => {
    try { showReportModal(await api('report.gradesPdf', { class_id: AppState.params.class_id })); } catch (e) { toastErr(e); }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 26: KEHADIRAN DOSEN (dicatat dosen sendiri atau mahasiswa PJ)
// ════════════════════════════════════════════════════════

async function renderKehadiranDosenTab(body, d) {
  await swr('lecturer.list', { class_id: d.cls.class_id }, r => drawKehadiranDosen(body, d, r), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawKehadiranDosen(body, d, r) {
  const cls = st => st === 'tidak_hadir' ? 'b-bad' : st === 'digantikan' ? 'b-warn' : 'b-ok';
  const j = r.jadwal || {};
  const jadwalTxt = j.hari && j.jam_mulai ? `${j.hari}, ${j.jam_mulai}${j.jam_selesai ? ' – ' + j.jam_selesai : ''}` : '';
  body.innerHTML = `
    <div class="ss-card mb-3 d-flex flex-wrap align-items-center gap-3">
      <div><div class="small-ss text-secondary-ss">Dosen pengampu</div><div class="fw-bold">${esc(r.dosen_nama)}</div></div>
      <div class="ms-md-3"><div class="small-ss text-secondary-ss">Jadwal kuliah</div>
        ${jadwalTxt ? `<div class="fw-bold">${esc(jadwalTxt)}</div>` : (d.access.isOwner ? `<a href="javascript:void(0)" class="small-ss fw-600" onclick="switchClassTab('pengaturan')">Atur jadwal di Pengaturan</a>` : '<span class="small-ss text-muted-ss">Belum diatur</span>')}</div>
      <div class="ms-md-3"><div class="small-ss text-secondary-ss">Hadir (luring + daring)</div><div class="kpi-value" style="margin:0;font-size:1.6rem">${r.ringkasan.hadir} <span class="fs-6 text-secondary-ss">dari ${r.ringkasan.total} pertemuan</span></div></div>
      ${r.can_print ? `<button class="btn btn-soft btn-sm ms-md-auto" onclick="printLecturerPdf(this)" data-loading="Membuat PDF…"><i class="bi bi-file-earmark-pdf"></i> Daftar Hadir Dosen (PDF)</button>` : ''}
    </div>
    <p class="small-ss text-secondary-ss">${r.can_edit ? (d.access.isPj ? 'Sebagai PJ mata kuliah, kamu mencatat kehadiran dosen setiap pertemuan.' : 'Dicatat oleh Anda atau mahasiswa PJ. Status "Hadir" juga tercatat otomatis saat Anda membuka sesi absensi.') : 'Dicatat oleh dosen atau mahasiswa PJ mata kuliah.'}
      Jam masuk/keluar mengikuti jadwal kuliah, materi mengikuti topik pertemuan.</p>
    ${r.list.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th>No</th><th>Hari, tanggal</th><th>Materi kuliah</th><th>Metode</th><th>Jam</th><th>Mhs hadir</th><th>Kehadiran dosen</th><th>Catatan</th></tr></thead><tbody>
      ${r.list.map(m => `<tr data-mid="${m.meeting_id}">
        <td>${m.no}</td>
        <td class="small-ss text-nowrap">${esc(m.hari || '-')}${m.tanggal ? ', ' + esc(fmtDate(m.tanggal)) : ''}</td>
        <td style="min-width:180px"><div class="fw-600 small-ss">${esc(m.topik)}</div>${m.topik !== m.judul ? `<div class="small-ss text-muted-ss">${esc(m.judul)}</div>` : ''}</td>
        <td>${m.metode === '-' ? '<span class="text-muted-ss">-</span>' : badge(m.metode, m.metode === 'Online' ? 'b-info' : 'b-muted')}</td>
        <td class="small-ss text-nowrap tabular">${m.jam_masuk ? esc(m.jam_masuk) + (m.jam_keluar ? ' – ' + esc(m.jam_keluar) : '') : '<span class="text-muted-ss">-</span>'}</td>
        <td class="tabular">${m.jumlah_hadir}</td>
        <td>${r.can_edit ? `<select class="pill-select la-status" aria-label="Kehadiran dosen ${esc(m.judul)}"><option value="">Belum dicatat</option>
            ${Object.entries(r.statuses).map(([k, l]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
          : (m.status ? badge(r.statuses[m.status], cls(m.status)) : '<span class="small-ss text-muted-ss">Belum dicatat</span>')}
          ${m.dicatat_oleh ? `<div class="small-ss text-muted-ss mt-1">${esc(m.dicatat_oleh)} (${m.peran_pencatat === 'pj' ? 'PJ' : 'dosen'})</div>` : ''}</td>
        <td>${r.can_edit ? `<input class="form-control form-control-sm la-note" style="min-height:36px;min-width:150px" maxlength="300" value="${esc(m.catatan)}" placeholder="mis. digantikan asisten" aria-label="Catatan ${esc(m.judul)}">` : `<span class="small-ss">${esc(m.catatan)}</span>`}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('Belum ada pertemuan', 'Pertemuan dibuat dosen di tab Timeline.')}`;
  if (!r.can_edit) return;
  const save = async tr => {
    const sel = $('.la-status', tr), note = $('.la-note', tr);
    sel.disabled = true;
    try {
      await api('lecturer.set', { meeting_id: tr.dataset.mid, status: sel.value, catatan: note.value });
      toast('Kehadiran dosen dicatat', sel.value ? r.statuses[sel.value] : 'Dikosongkan', 'success');
      AppState.formDirty = false;
      loadClassTab('kehadiran-dosen');
    } catch (e) { toastErr(e); sel.disabled = false; }
  };
  $$('tr[data-mid]', body).forEach(tr => {
    $('.la-status', tr).onchange = () => save(tr);
    $('.la-note', tr).onchange = () => { if ($('.la-status', tr).value) save(tr); };
  });
}

async function printLecturerPdf(btn) {
  await withBtn(btn, async () => {
    try { showReportModal(await api('report.lecturerPdf', { class_id: AppState.params.class_id })); } catch (e) { toastErr(e); }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 27: NILAI SAYA (mahasiswa memantau — tanpa unduhan)
// ════════════════════════════════════════════════════════

function missingComps(g) { return g.weights.filter(w => w.bobot_persen > 0 && (g.comps[w.komponen] === null || g.comps[w.komponen] === undefined)).map(w => w.short || w.label); }

function gradeCardHtml(g, onclick) {
  const miss = missingComps(g);
  return `<div class="ss-card ${onclick ? 'class-card' : ''}" ${onclick ? `role="button" tabindex="0" onclick="${onclick}" onkeydown="if(event.key==='Enter')this.click()"` : ''}>
    <div class="d-flex align-items-start gap-3 mb-3">
      <div class="sched-thumb" style="width:52px;height:52px">${coverSVG(g.class_id, g.warna)}</div>
      <div class="flex-grow-1 min-w-0"><div class="fw-bold text-truncate">${esc(g.nama_kelas)}</div><div class="small-ss text-secondary-ss text-truncate">${esc(g.mata_kuliah)}</div></div>
      <div class="text-end">${g.akhir !== null ? `<div class="kpi-value" style="margin:0;font-size:1.7rem">${fmtScore(g.akhir)}</div>${badge(g.huruf, hurufCls(g.huruf))}` : badge('Belum final', 'b-muted')}</div></div>
    ${g.weights.map(w => { const v = g.comps[w.komponen]; return `<div class="mb-2"><div class="d-flex justify-content-between small-ss"><span>${esc(w.label)} <span class="text-muted-ss">(bobot ${w.bobot_persen}%)</span>${(g.disesuaikan || []).includes(w.komponen) ? ' <i class="bi bi-pencil-square text-muted-ss" title="Nilai komponen ini disesuaikan oleh dosen"></i>' : ''}</span><b class="tabular">${fmtScore(v)}</b></div>
      <div class="score-bar" aria-hidden="true"><span style="width:${v === null || v === undefined ? 0 : Math.min(100, v)}%"></span></div></div>`; }).join('')}
    ${miss.length ? `<p class="small-ss text-secondary-ss mt-2 mb-0">Nilai akhir muncul setelah komponen lengkap. Menunggu: ${esc(miss.join(', '))}.</p>` : ''}</div>`;
}

async function renderNilaiSaya(params, c) {
  c.innerHTML = `<div class="page-head"><div><h1>Nilai saya</h1><p>Pantau perkembangan nilai tiap kelas. Hanya untuk dilihat.</p></div>
    <button class="btn btn-soft btn-sm" onclick="navigateTo('tugas-saya',{},{reset:true})"><i class="bi bi-clipboard-check"></i> Tugas saya</button></div><div id="nsBody"></div>`;
  await swr('grade.mine', {}, list => {
    $('#nsBody').innerHTML = list.length ? `<div class="row g-3">${list.map(g => `<div class="col-lg-6">${gradeCardHtml(g, `navigateTo('kelas-detail',{class_id:'${g.class_id}',tab:'nilai-saya'})`)}</div>`).join('')}</div>`
      : emptyState('Belum ada nilai', 'Nilai muncul setelah kamu bergabung ke kelas dan mengerjakan tugas.');
  }, { empty: () => { $('#nsBody').innerHTML = skeleton('list'); } });
}

async function renderNilaiSayaTab(body, d) {
  await swr('grade.mine', { class_id: d.cls.class_id }, list => {
    const g = list[0];
    if (!g) { body.innerHTML = emptyState('Belum ada data nilai', ''); return; }
    body.innerHTML = `<div class="row g-3"><div class="col-lg-6">${rincianCardHtml(g)}</div>
      <div class="col-lg-6"><div class="ss-card"><div class="card-head"><h2>Nilai tugas</h2></div>
        ${g.tugas && g.tugas.length ? g.tugas.map(t => `<div class="item-row clickable" role="button" tabindex="0" onclick="navigateTo('tugas-detail',{assignment_id:'${t.assignment_id}'})" onkeydown="if(event.key==='Enter')this.click()">
          <div class="item-icon ii-task"><i class="bi bi-clipboard-check"></i></div>
          <div class="flex-grow-1 min-w-0"><div class="i-title text-truncate">${esc(t.judul)}</div><div class="i-sub">${esc(t.komponen_nama || kompLabel(t.komponen))}</div></div>
          ${t.skor !== null ? badge(fmtScore(t.skor) + ' / ' + t.nilai_maks, 'b-ok') : subStatusBadge(t.status)}</div>`).join('') : '<p class="small-ss text-muted-ss mb-0">Belum ada tugas.</p>'}
        <p class="small-ss text-muted-ss mt-3 mb-0">Tugas yang lewat tenggat tanpa pengiriman dihitung 0. UTS dan UAS diisi dosen.</p></div></div></div>`;
  }, { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

// ════════════════════════════════════════════════════════
// BAGIAN 28: PENGUMUMAN KELAS
// ════════════════════════════════════════════════════════

async function renderPengumumanTab(body, d) {
  await swr('ann.list', { class_id: d.cls.class_id }, r => drawPengumuman(body, d, r), { scope: 'tab', empty: () => { body.innerHTML = skeleton('list'); } });
}

function drawPengumuman(body, d, r) {
  AppState.annList = r.items;
  body.innerHTML = `${r.can_edit ? `<div class="d-flex justify-content-end mb-3"><button class="btn btn-ink btn-sm" onclick="openAnnForm()"><i class="bi bi-megaphone"></i> Buat pengumuman</button></div>` : ''}
    ${r.items.length ? r.items.map(x => `<div class="ss-card ann-card mb-3 ${x.penting ? 'penting' : ''} ${x.aktif ? '' : 'opacity-75'}">
      <div class="d-flex flex-wrap align-items-start gap-2 mb-1"><h3 class="h6 mb-0 flex-grow-1">${x.penting ? '<i class="bi bi-megaphone-fill" style="color:var(--warn)"></i> ' : ''}${esc(x.judul)}</h3>
        ${x.penting ? badge('Penting', 'b-warn') : ''}${x.aktif ? '' : badge('Sudah tidak tampil', 'b-muted')}
        ${r.can_edit ? `<button class="icon-action" onclick="openAnnForm('${x.ann_id}')" aria-label="Ubah pengumuman"><i class="bi bi-pencil"></i></button><button class="icon-action" onclick="deleteAnn('${x.ann_id}')" aria-label="Hapus pengumuman"><i class="bi bi-trash"></i></button>` : ''}</div>
      <div class="ann-isi">${esc(x.isi)}</div>
      <div class="small-ss text-muted-ss mt-2">${esc(x.oleh)} — ${esc(fmtDateTime(x.waktu))}${x.kelas.length > 1 ? ' — untuk: ' + esc(x.kelas.join(', ')) : ''}${x.berlaku_sampai ? ' — tampil sampai ' + esc(fmtDate(x.berlaku_sampai)) : ''}</div></div>`).join('')
      : emptyState('Belum ada pengumuman', r.can_edit ? 'Umumkan perubahan jadwal, ketidakhadiran, info UTS/UAS, dan lainnya. Mahasiswa mendapat notifikasi.' : 'Pengumuman dari dosen akan muncul di sini.',
        r.can_edit ? '<button class="btn btn-ink" onclick="openAnnForm()"><i class="bi bi-megaphone"></i> Buat pengumuman</button>' : '')}`;
}

async function openAnnForm(id) {
  const x = id ? (AppState.annList || []).find(a => a.ann_id === id) : null;
  const classes = await swr('class.list', {}, () => { }).catch(() => []);
  const mine = (classes || []).filter(k => k.status === 'aktif' && !k.is_assistant);
  const cur = AppState.params.class_id;
  const sel = x ? x.class_ids : [cur];
  openModal({
    title: x ? 'Ubah pengumuman' : 'Pengumuman baru', size: 'modal-lg',
    body: `<form id="annForm" novalidate>
      <div class="mb-3"><label class="form-label" for="anJudul">Judul</label><input class="form-control" id="anJudul" maxlength="150" required value="${esc(x ? x.judul : '')}" placeholder="mis. Kuliah minggu depan daring"></div>
      <div class="mb-3"><label class="form-label" for="anIsi">Isi pengumuman</label><textarea class="form-control" id="anIsi" rows="5" maxlength="5000" required>${esc(x ? x.isi : '')}</textarea></div>
      <div class="mb-3"><label class="form-label">Tampilkan di kelas</label>
        ${mine.map(k => `<label class="option-tile py-2 mb-1"><input class="form-check-input mt-1 an-cls" type="checkbox" value="${k.class_id}" ${sel.includes(k.class_id) ? 'checked' : ''}><span class="small-ss">${esc(k.nama_kelas)} <span class="text-muted-ss">— ${esc(k.mata_kuliah)}</span></span></label>`).join('')}</div>
      <div class="row g-3"><div class="col-sm-6"><label class="form-label" for="anSampai">Tampil sampai (opsional)</label><input class="form-control" id="anSampai" type="date" value="${esc(x ? x.berlaku_sampai : '')}"></div>
        <div class="col-sm-6 d-flex align-items-end"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="anPenting" ${x && x.penting ? 'checked' : ''}><label class="form-check-label" for="anPenting">Tandai penting (disorot)</label></div></div></div></form>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-ink" id="anSave" data-loading="Menyimpan…"><i class="bi bi-send"></i> ${x ? 'Simpan' : 'Umumkan'}</button>`
  });
  $('#anSave').onclick = e => withBtn(e.currentTarget, async () => {
    const class_ids = $$('.an-cls:checked').map(c => c.value);
    try {
      await api('ann.save', { ann_id: id || '', judul: $('#anJudul').value.trim(), isi: $('#anIsi').value.trim(), penting: $('#anPenting').checked, berlaku_sampai: $('#anSampai').value, class_ids });
      closeModal(); toast('Pengumuman disimpan', 'Mahasiswa mendapat notifikasi.', 'success'); refreshPage();
    } catch (err) { toastErr(err); }
  });
}

async function deleteAnn(id) {
  if (!await confirmDialog('Hapus pengumuman ini dari semua kelas tujuannya?', { okText: 'Hapus', danger: true })) return;
  try { await api('ann.delete', { ann_id: id }); toast('Pengumuman dihapus', '', 'success'); refreshPage(); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 20: TUGAS SAYA (mahasiswa, lintas kelas)
// ════════════════════════════════════════════════════════

async function renderTugasSaya(params, c) {
  const f = params.f || 'aktif';
  c.innerHTML = `<div class="page-head"><div><h1>Tugas saya</h1><p>Semua tugas dari kelas aktif.</p></div>
    <button class="btn btn-soft btn-sm" onclick="navigateTo('nilai-saya')"><i class="bi bi-star"></i> Nilai saya</button></div>
    <div class="tabs-pill">${[['aktif', 'Perlu dikerjakan'], ['revisi', 'Perlu revisi'], ['kirim', 'Sudah dikirim'], ['nilai', 'Sudah dinilai'], ['semua', 'Semua']]
      .map(([k, l]) => `<button class="${f === k ? 'active' : ''}" onclick="navigateTo('tugas-saya',{f:'${k}'},{noHistory:true})">${l}</button>`).join('')}</div>
    <div id="tsList"></div>`;
  await swr('assignment.mine', {}, list => drawTugasSaya(list, f), { empty: () => { $('#tsList').innerHTML = skeleton('list'); } });
}

function drawTugasSaya(list, f) {
  const pick = {
    aktif: t => ['Belum dikumpulkan', 'Draft', 'Belum ada kelompok'].includes(t.state.status),
    revisi: t => t.state.status === 'Perlu Revisi',
    kirim: t => ['Dikirim', 'Dikirim Ulang'].includes(t.state.status),
    nilai: t => t.state.status === 'Dinilai',
    semua: () => true
  }[f];
  const items = list.filter(pick);
  $('#tsList').innerHTML = items.length ? items.map(t => taskRowHtml(t, true)).join('')
    : emptyState(f === 'aktif' ? 'Tidak ada tugas tertunda' : 'Tidak ada tugas', f === 'aktif' ? 'Semua tugas sudah kamu kerjakan.' : 'Belum ada tugas pada kategori ini.');
}

// ════════════════════════════════════════════════════════
// BAGIAN 21: PROFIL
// ════════════════════════════════════════════════════════

function renderProfil(params, c) {
  const u = AppState.user, mhs = u.role === 'mahasiswa';
  const prodi = (AppState.config.prodi || []).map(p => `<option ${p.nama_prodi === u.program_studi ? 'selected' : ''}>${esc(p.nama_prodi)}</option>`).join('');
  c.innerHTML = `<div class="page-head"><div><h1>Profil</h1><p>${esc(ROLE_LABEL[u.role])}</p></div></div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="ss-card">
        <div class="d-flex align-items-center gap-3 mb-4"><span class="avatar" style="width:64px;height:64px;font-size:1.3rem">${esc(initials(u.nama_lengkap))}</span>
          <div><div class="fw-bold fs-5">${esc(u.nama_lengkap)}</div><div class="small-ss text-secondary-ss">${esc(u.email)}${u.npm ? ' — ' + esc(u.npm) : ''}</div></div></div>
        <form id="pfForm">
          <div class="mb-3"><label class="form-label" for="pfNama">Nama lengkap</label><input class="form-control" id="pfNama" required maxlength="120" value="${esc(u.nama_lengkap)}"></div>
          ${mhs ? `<div class="mb-3"><label class="form-label" for="pfProdi">Program studi</label><select class="form-select" id="pfProdi">${prodi || `<option>${esc(u.program_studi)}</option>`}</select></div>` : ''}
          <div class="mb-3"><label class="form-label">Email</label><input class="form-control" value="${esc(u.email)}" disabled></div>
          ${mhs ? `<div class="mb-3"><label class="form-label">NPM</label><input class="form-control" value="${esc(u.npm)}" disabled><div class="form-text">NPM dan email tidak dapat diubah sendiri.</div></div>` : ''}
          <button class="btn btn-ink" type="submit">Simpan profil</button></form></div></div>
      <div class="col-lg-6">
        <div class="ss-card mb-3"><div class="card-head"><h2>Ganti kata sandi</h2></div>
          <form id="pwForm">
            <div class="mb-3"><label class="form-label" for="pwOld">Kata sandi saat ini</label><input class="form-control" id="pwOld" type="password" required autocomplete="current-password"></div>
            <div class="mb-3"><label class="form-label" for="pwNew">Kata sandi baru</label><input class="form-control" id="pwNew" type="password" minlength="8" required autocomplete="new-password"></div>
            <button class="btn btn-soft" type="submit">Ganti kata sandi</button></form></div>
        <div class="ss-card"><div class="card-head"><h2>Tampilan</h2></div>
          <div class="d-flex justify-content-between align-items-center"><span>Mode gelap</span>
            <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="pfDark" ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'checked' : ''} onchange="toggleDarkMode()" aria-label="Mode gelap"></div></div>
          ${mhs ? `<hr><button class="btn btn-soft w-100" onclick="navigateTo('sertifikat-saya')"><i class="bi bi-award"></i> Sertifikat saya</button>` : ''}
          <hr><button class="btn btn-danger-soft w-100" onclick="handleLogout()"><i class="bi bi-box-arrow-right"></i> Keluar</button></div>
      </div></div>`;
  $('#pfForm').onsubmit = async e => {
    e.preventDefault();
    await withBtn(e.target.querySelector('button[type=submit]'), async () => {
      try {
        AppState.user = await api('profile.update', { nama_lengkap: $('#pfNama').value.trim(), program_studi: mhs ? $('#pfProdi').value : '' });
        renderNavigation(); updateActiveNav('profil'); toast('Profil disimpan', '', 'success');
      } catch (err) { toastErr(err); }
    });
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault();
    await withBtn(e.target.querySelector('button[type=submit]'), async () => {
      try { await api('profile.password', { lama: $('#pwOld').value, baru: $('#pwNew').value }); e.target.reset(); toast('Kata sandi diganti', '', 'success'); }
      catch (err) { toastErr(err); }
    });
  };
}

// ════════════════════════════════════════════════════════
// BAGIAN 22: PANEL SUPER ADMIN (kode redeem, dosen, master prodi, pengaturan, kapasitas)
// ════════════════════════════════════════════════════════

async function renderAdmin(params, c) {
  const tab = params.tab || 'kode';
  const tabs = [['kode', 'Kode redeem'], ['dosen', 'Dosen'], ['prodi', 'Program studi'], ['app', 'Pengaturan aplikasi'], ['kapasitas', 'Kapasitas']];
  c.innerHTML = `<div class="page-head"><div><h1>Super Admin</h1><p>Kelola akses dosen dan pengaturan aplikasi.</p></div></div>
    <div class="tabs-pill">${tabs.map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" onclick="navigateTo('admin',{tab:'${k}'},{noHistory:true})">${l}</button>`).join('')}</div>
    <div id="adminBody">${loadingBlock()}</div>`;
  const b = $('#adminBody');
  if (tab === 'kode') {
    const codes = await api('admin.codes');
    const cls = { aktif: 'b-ok', terpakai: 'b-info', dicabut: 'b-muted', kedaluwarsa: 'b-warn' };
    b.innerHTML = `<div class="ss-card mb-3"><form id="codeForm" class="row g-2 align-items-end">
        <div class="col-6 col-md-3"><label class="form-label" for="cdN">Jumlah kode</label><input class="form-control" id="cdN" type="number" min="1" max="20" value="1"></div>
        <div class="col-6 col-md-3"><label class="form-label" for="cdH">Berlaku (hari)</label><input class="form-control" id="cdH" type="number" min="1" max="365" value="30"></div>
        <div class="col-md-3"><button class="btn btn-ink w-100" type="submit"><i class="bi bi-key"></i> Buat kode</button></div>
        <div class="col-12 form-text">Kode sekali pakai. Berikan ke dosen yang Anda izinkan memakai aplikasi.</div></form></div>
      ${codes.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th>Kode</th><th>Status</th><th>Dipakai oleh</th><th>Kedaluwarsa</th><th></th></tr></thead><tbody>
        ${codes.map(x => `<tr><td><span class="code-chip" style="letter-spacing:.06em">${esc(x.code)}</span></td><td>${badge(x.status, cls[x.status] || 'b-muted')}</td>
          <td class="small-ss">${esc(x.dipakai_nama || '-')}${x.tanggal_pakai ? '<br><span class="text-muted-ss">' + esc(fmtDate(x.tanggal_pakai)) + '</span>' : ''}</td>
          <td class="small-ss">${esc(fmtDate(x.kedaluwarsa))}</td>
          <td class="text-end">${x.status === 'aktif' ? `<button class="icon-action" onclick="copyText('${esc(x.code)}')" aria-label="Salin kode"><i class="bi bi-copy"></i></button>
            <button class="btn btn-danger-soft btn-sm" onclick="revokeCode('${esc(x.code)}')">Cabut</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Belum ada kode', 'Buat kode redeem untuk mengundang dosen.')}`;
    $('#codeForm').onsubmit = async e => {
      e.preventDefault();
      await withBtn(e.target.querySelector('button[type=submit]'), async () => {
        try { const list = await api('admin.createCodes', { jumlah: $('#cdN').value, hari: $('#cdH').value }); toast('Kode dibuat', list.join(', '), 'success'); refreshPage(); }
        catch (err) { toastErr(err); }
      });
    };
  } else if (tab === 'dosen') {
    const list = await api('admin.dosen');
    AppState.adminDosen = list;
    const dosen = list.filter(u => u.role === 'dosen');
    const aktif = dosen.filter(u => u.status_aktif).length;
    const totalKelas = list.reduce((s, u) => s + u.kelas_aktif, 0);
    b.innerHTML = `
      <div class="d-flex flex-wrap gap-2 mb-3">
        ${badge(dosen.length + ' akun dosen', 'b-accent', 'bi-people')}${badge(aktif + ' aktif', 'b-ok')}${dosen.length - aktif ? badge((dosen.length - aktif) + ' dinonaktifkan', 'b-muted') : ''}${badge(totalKelas + ' kelas aktif', 'b-info')}
      </div>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Dosen</th><th>Peran</th><th>Kelas</th><th>Bergabung</th><th>Akses</th></tr></thead><tbody>
      ${list.map(u => `<tr><td><div class="fw-600">${esc(u.nama_lengkap)}</div><div class="small-ss text-secondary-ss">${esc(u.email)}</div></td>
        <td>${badge(ROLE_LABEL[u.role], u.role === 'superadmin' ? 'b-accent' : 'b-muted')}</td>
        <td><button class="btn btn-soft btn-sm" onclick="openDosenKelas('${u.user_id}')" aria-label="Kelola kelas ${esc(u.nama_lengkap)}"><i class="bi bi-journal-bookmark"></i> ${u.kelas_aktif} aktif${u.kelas_arsip ? ' · ' + u.kelas_arsip + ' arsip' : ''}</button></td>
        <td class="small-ss">${esc(fmtDate(u.created_at))}</td>
        <td>${u.role === 'dosen' ? `<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${u.status_aktif ? 'checked' : ''} onchange="toggleDosen('${u.user_id}', this)" aria-label="Akses ${esc(u.nama_lengkap)}"></div>
          <button class="btn btn-ghost btn-sm ms-2" onclick="adminResetPw('${u.user_id}')" aria-label="Reset kata sandi ${esc(u.nama_lengkap)}" title="Reset kata sandi"><i class="bi bi-key"></i></button>` : '<span class="small-ss text-muted-ss">Pemilik</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small-ss text-secondary-ss mt-2">Mematikan akses membuat dosen tidak bisa masuk. Saat dimatikan, Anda bisa sekaligus mengarsipkan kelasnya. Kelas yang tidak ada aktivitas ${AppState.config.autoArsipAktif === false ? '(pengarsipan otomatis sedang dimatikan)' : 'selama ' + (AppState.config.autoArsipHari || 100) + ' hari diarsipkan otomatis'}.</p>`;
  } else if (tab === 'prodi') {
    const prodi = AppState.config.prodi || [];
    b.innerHTML = `<div class="row g-3"><div class="col-lg-5"><div class="ss-card"><div class="card-head"><h2 id="pdTitle">Tambah program studi</h2></div>
        <form id="pdForm"><input type="hidden" id="pdId">
          <div class="mb-3"><label class="form-label" for="pdNama">Nama program studi</label><input class="form-control" id="pdNama" required maxlength="120"></div>
          <div class="mb-3"><label class="form-label" for="pdFak">Fakultas</label><input class="form-control" id="pdFak" maxlength="120"></div>
          <div class="d-flex gap-2"><button class="btn btn-ink" type="submit">Simpan</button><button class="btn btn-ghost" type="button" onclick="refreshPage()">Batal</button></div></form></div></div>
      <div class="col-lg-7">${prodi.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th>Program studi</th><th>Fakultas</th><th></th></tr></thead><tbody>
        ${prodi.map(p => `<tr><td class="fw-600">${esc(p.nama_prodi)}</td><td class="small-ss">${esc(p.fakultas)}</td>
          <td class="text-end"><button class="icon-action" onclick="editProdi('${p.prodi_id}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button>
          <button class="icon-action" onclick="deleteProdi('${p.prodi_id}')" aria-label="Hapus"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Belum ada program studi', 'Daftar ini muncul di formulir pendaftaran mahasiswa.')}</div></div>`;
    $('#pdForm').onsubmit = async e => {
      e.preventDefault();
      await withBtn(e.target.querySelector('button[type=submit]'), async () => {
        try { AppState.config.prodi = await api('prodi.save', { prodi_id: $('#pdId').value, nama_prodi: $('#pdNama').value.trim(), fakultas: $('#pdFak').value.trim() }); toast('Program studi disimpan', '', 'success'); refreshPage(); }
        catch (err) { toastErr(err); }
      });
    };
  } else if (tab === 'app') {
    const cfg = AppState.config;
    b.innerHTML = `<div class="ss-card" style="max-width:640px"><form id="cfgForm">
        <div class="mb-3"><label class="form-label" for="cfgName">Nama aplikasi</label><input class="form-control" id="cfgName" maxlength="60" value="${esc(cfg.appName)}"></div>
        <div class="mb-3"><label class="form-label" for="cfgKampus">Nama kampus</label><input class="form-control" id="cfgKampus" maxlength="120" value="${esc(cfg.namaKampus)}"></div>
        <div class="mb-3"><label class="form-label" for="cfgLogo">URL logo (opsional)</label><input class="form-control" id="cfgLogo" type="url" value="${esc(cfg.logoUrl)}">
          <div class="form-text">Belum dipakai: kop PDF memakai logo kampus bawaan.</div></div>
        <hr><div class="mb-1 fw-600">Kop dokumen resmi (Daftar Hadir PDF)</div>
        ${[['cfgK1', 'Baris 1 (kementerian)', 'kop1'], ['cfgK2', 'Baris 2 (universitas)', 'kop2'], ['cfgK3', 'Baris 3 (fakultas)', 'kop3'], ['cfgKA', 'Alamat', 'kopAlamat'], ['cfgKK', 'Website / email', 'kopKontak']].map(([id, l, key]) => `<div class="mb-2"><label class="form-label small-ss" for="${id}">${l}</label><input class="form-control form-control-sm" id="${id}" maxlength="200" value="${esc((cfg.kop || {})[key] || '')}"></div>`).join('')}
        <hr>
        <div class="mb-3"><label class="form-label" for="cfgUrl">Alamat aplikasi untuk dibagikan ke mahasiswa</label><input class="form-control" id="cfgUrl" type="url" placeholder="${esc(pageUrl())}" value="${esc(cfg.urlAplikasiKustom ? cfg.urlAplikasi : '')}">
          <div class="form-text">Tampil di pesan undangan kelas. Isi dengan alamat halaman Blogger bila aplikasi ditanam di sana. Kosong = alamat /exec bawaan.</div></div>
        <hr>
        <div class="mb-1 fw-600">Pengarsipan kelas otomatis</div>
        <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="cfgAuto" ${cfg.autoArsipAktif === false ? '' : 'checked'}>
          <label class="form-check-label" for="cfgAuto">Arsipkan kelas yang tidak ada aktivitas</label></div>
        <div class="mb-3" style="max-width:260px"><label class="form-label" for="cfgHari">Batas tanpa aktivitas (hari)</label>
          <input class="form-control" id="cfgHari" type="number" min="30" max="730" value="${esc(cfg.autoArsipHari || 100)}"></div>
        <div class="form-text mb-3">Aktivitas = dosen membuka kelasnya, atau ada pertemuan/tugas/pengiriman/nilai/absensi/pengumuman baru. Dosen diberi tahu 14 dan 3 hari sebelumnya; membuka kelas membatalkannya. Saat diarsipkan, foto selfie absensi kelas dihapus permanen.</div>
        <button class="btn btn-ink" type="submit">Simpan pengaturan</button></form></div>`;
    $('#cfgForm').onsubmit = async e => {
      e.preventDefault();
      await withBtn(e.target.querySelector('button[type=submit]'), async () => {
        try { AppState.config = await api('admin.saveConfig', { appName: $('#cfgName').value, namaKampus: $('#cfgKampus').value, logoUrl: $('#cfgLogo').value, kop1: $('#cfgK1').value, kop2: $('#cfgK2').value, kop3: $('#cfgK3').value, kopAlamat: $('#cfgKA').value, kopKontak: $('#cfgKK').value, urlAplikasi: $('#cfgUrl').value.trim(), autoArsipAktif: $('#cfgAuto').checked, autoArsipHari: Number($('#cfgHari').value) }); toast('Pengaturan disimpan', '', 'success'); }
        catch (err) { toastErr(err); }
      });
    };
  } else {
    const s = await api('admin.storage');
    const pct = s.drive_batas > 0 ? Math.round(s.drive_terpakai / s.drive_batas * 100) : 0;
    b.innerHTML = `<div class="row g-3">
      <div class="col-md-6"><div class="ss-card h-100"><div class="kpi-label">Penyimpanan Google Drive</div>
        <div class="kpi-value mt-3">${pct}%</div><div class="kpi-note ${pct > 85 ? 'bad' : pct > 70 ? 'warn' : 'ok'}">${fmtBytes(s.drive_terpakai)} dari ${s.drive_batas > 0 ? fmtBytes(s.drive_batas) : 'tak terbatas'}</div>
        <div class="progress-thin"><span style="width:${pct}%;background:${pct > 85 ? 'var(--bad)' : 'var(--accent)'}"></span></div></div></div>
      <div class="col-md-6"><div class="ss-card h-100"><div class="kpi-label">Sisa kuota email hari ini</div><div class="kpi-value mt-3">${s.email_sisa}</div>
        <div class="kpi-note">Akun Gmail biasa ±100 penerima/hari. Email hanya dipakai untuk kode reset kata sandi.</div>
        <div class="small-ss mt-2" role="status">${!s.email_terakhir ? '<span class="text-muted-ss">Belum ada email yang dikirim.</span>'
          : s.email_terakhir.ok ? `<span style="color:var(--ok)"><i class="bi bi-check-circle"></i> Email terakhir terkirim (${esc(fmtDateTime(s.email_terakhir.t))}).</span>`
          : `<span style="color:var(--bad)"><i class="bi bi-exclamation-octagon"></i> Email terakhir GAGAL (${esc(fmtDateTime(s.email_terakhir.t))}): ${esc(s.email_terakhir.msg)}<br>Jalankan fungsi <b>testKirimEmail</b> dari editor Apps Script untuk memberi izin, atau gunakan tombol reset kata sandi.</span>`}</div></div></div>
      <div class="col-md-6"><div class="ss-card"><div class="kpi-label">Data</div><p class="mb-0 mt-2">${s.total_pengguna} pengguna — ${s.total_kelas} kelas</p></div></div>
      <div class="col-md-6"><div class="ss-card"><div class="kpi-label">Penyimpanan data</div>
        <div class="d-flex gap-2 mt-2"><a class="btn btn-soft btn-sm" href="${esc(s.spreadsheet_url)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-table"></i> Spreadsheet</a>
        <a class="btn btn-soft btn-sm" href="${esc(s.folder_url)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-folder2"></i> Folder Drive</a></div></div></div></div>`;
  }
}

async function revokeCode(code) {
  if (!await confirmDialog('Cabut kode ' + code + '? Kode tidak bisa dipakai lagi.', { okText: 'Cabut', danger: true })) return;
  try { await api('admin.revokeCode', { code }); toast('Kode dicabut', '', 'success'); refreshPage(); } catch (e) { toastErr(e); }
}
async function toggleDosen(userId, el) {
  const u = (AppState.adminDosen || []).find(x => x.user_id === userId) || {};
  const send = async arsipkan => {
    el.disabled = true;
    try {
      const r = await api('admin.toggleUser', { user_id: userId, aktif: el.checked, arsipkan_kelas: !!arsipkan });
      toast(el.checked ? 'Akses dosen diaktifkan' : 'Akses dosen dicabut', r.kelas_diarsipkan ? r.kelas_diarsipkan + ' kelas diarsipkan, ' + r.selfie_dihapus + ' foto selfie dihapus.' : (el.checked && u.kelas_arsip ? 'Kelas yang sudah diarsipkan tidak otomatis aktif kembali.' : ''), 'success');
      if (r.kelas_diarsipkan) refreshPage();
    } catch (e) { el.checked = !el.checked; toastErr(e); }
    el.disabled = false;
  };
  if (el.checked || !u.kelas_aktif) return send(false);          // mengaktifkan, atau dosen tanpa kelas aktif
  // Menonaktifkan dosen yang masih punya kelas aktif → tanyakan nasib kelasnya
  el.checked = true;                                             // tahan dulu sampai ada keputusan
  let decided = false;
  openModal({
    title: 'Nonaktifkan ' + u.nama_lengkap + '?',
    body: `<p>Dosen ini tidak akan bisa masuk lagi. Ia masih punya <b>${u.kelas_aktif} kelas aktif</b>. Apa yang dilakukan pada kelasnya?</p>
      <div class="answer-box small-ss" style="white-space:normal"><b>Arsipkan kelasnya</b>: kelas menjadi hanya-baca, kodenya tidak bisa dipakai lagi, dan <b>foto selfie absensi lama (bila ada) dihapus permanen</b> dari Drive. Nilai, tugas, dan status hadir tetap tersimpan, dan kelas bisa dipulihkan.<br>
      <b>Biarkan aktif</b>: kelas tetap berjalan tetapi tidak ada yang bisa mengelolanya, dan kodenya masih bisa dipakai mendaftar.</div>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button>
      <button class="btn btn-soft" id="tgKeep">Nonaktifkan, biarkan kelas</button>
      <button class="btn btn-danger-soft" id="tgArch"><i class="bi bi-archive"></i> Nonaktifkan & arsipkan kelas</button>`
  });
  $('#tgKeep').onclick = () => { decided = true; closeModal(); el.checked = false; send(false); };
  $('#tgArch').onclick = () => { decided = true; closeModal(); el.checked = false; send(true); };
  document.getElementById('appModal').addEventListener('hidden.bs.modal', function h() {
    document.getElementById('appModal').removeEventListener('hidden.bs.modal', h);
    if (!decided) el.checked = true;                             // dibatalkan → akses tetap aktif
  });
}

/** Daftar kelas satu dosen: lihat aktivitas terakhir, arsipkan/pulihkan satu per satu atau sekaligus. */
async function openDosenKelas(userId) {
  const body = openModal({ title: 'Kelas dosen', body: loadingBlock(), size: 'modal-xl' });
  try {
    const d = await api('admin.dosenKelas', { user_id: userId });
    document.getElementById('appModalTitle').textContent = 'Kelas — ' + d.dosen.nama_lengkap;
    AppState.dosenKelas = d;
    const idleBadge = k => k.hari_tidak_aktif === null ? '' : k.hari_tidak_aktif >= d.auto.hari - 14 && d.auto.aktif
      ? badge(k.hari_tidak_aktif + ' hari tanpa aktivitas', 'b-bad', 'bi-hourglass-bottom')
      : badge(k.hari_tidak_aktif === 0 ? 'Aktif hari ini' : k.hari_tidak_aktif + ' hari lalu', k.hari_tidak_aktif > 30 ? 'b-warn' : 'b-muted');
    const act = d.kelas.filter(k => k.status === 'aktif');
    body.innerHTML = d.kelas.length ? `
      <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <span class="small-ss text-secondary-ss flex-grow-1">${esc(d.dosen.email)} — ${act.length} aktif, ${d.kelas.length - act.length} arsip.
          ${d.auto.aktif ? `Arsip otomatis bila tanpa aktivitas ${d.auto.hari} hari.` : 'Arsip otomatis sedang dimatikan.'}</span>
        <button class="btn btn-danger-soft btn-sm" id="dkSel" disabled><i class="bi bi-archive"></i> Arsipkan terpilih</button>
      </div>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th style="width:40px"><input class="form-check-input" type="checkbox" id="dkAll" aria-label="Pilih semua kelas aktif" ${act.length ? '' : 'disabled'}></th>
        <th>Kelas</th><th>Mhs</th><th>Selfie lama</th><th>Aktivitas terakhir</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.kelas.map(k => `<tr><td><input class="form-check-input dk-chk" type="checkbox" value="${k.class_id}" ${k.status === 'aktif' ? '' : 'disabled'} aria-label="Pilih ${esc(k.nama_kelas)}"></td>
          <td><div class="fw-600">${esc(k.nama_kelas)}</div><div class="small-ss text-secondary-ss">${esc(k.mata_kuliah)} — ${esc(k.semester)} ${esc(k.tahun_ajaran)}</div></td>
          <td class="tabular">${k.jumlah_mhs}</td><td class="tabular">${k.selfie}</td>
          <td>${k.status === 'aktif' ? idleBadge(k) : '<span class="small-ss text-muted-ss">' + (k.terakhir_aktif ? esc(fmtDate(k.terakhir_aktif)) : '-') + '</span>'}</td>
          <td>${k.status === 'aktif' ? badge('Aktif', 'b-ok') : badge('Arsip', 'b-muted', 'bi-archive')}</td>
          <td class="text-end">${k.status === 'aktif'
            ? `<button class="btn btn-ghost btn-sm" onclick="archiveByAdmin(['${k.class_id}'], true)">Arsipkan</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="archiveByAdmin(['${k.class_id}'], false)">Pulihkan</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small-ss text-secondary-ss mt-3 mb-0"><i class="bi bi-exclamation-triangle" style="color:var(--warn)"></i> Mengarsipkan menghapus <b>permanen</b> foto selfie absensi lama kelas itu (kolom Selfie lama). Nilai, tugas, dan status hadir tetap tersimpan. Memulihkan kelas tidak mengembalikan foto.</p>`
      : emptyState('Belum ada kelas', 'Dosen ini belum membuat kelas.');
    const sync = () => { const n = $$('.dk-chk:checked').length; const b = $('#dkSel'); if (b) { b.disabled = !n; b.innerHTML = `<i class="bi bi-archive"></i> Arsipkan terpilih${n ? ' (' + n + ')' : ''}`; } };
    const all = $('#dkAll');
    if (all) all.onchange = () => { $$('.dk-chk:not(:disabled)').forEach(c => { c.checked = all.checked; }); sync(); };
    $$('.dk-chk').forEach(c => { c.onchange = sync; });
    if ($('#dkSel')) $('#dkSel').onclick = () => archiveByAdmin($$('.dk-chk:checked').map(c => c.value), true);
  } catch (e) { body.innerHTML = errorBlock(e); }
}

async function archiveByAdmin(ids, arsip) {
  const d = AppState.dosenKelas;
  const sel = d.kelas.filter(k => ids.includes(k.class_id));
  const selfie = sel.reduce((s, k) => s + k.selfie, 0);
  const msg = arsip
    ? `Arsipkan ${sel.length} kelas (${sel.map(k => k.nama_kelas).slice(0, 4).join(', ')}${sel.length > 4 ? ', …' : ''})? ${selfie} foto selfie lama akan dihapus PERMANEN. Nilai, tugas, dan status hadir tetap tersimpan.`
    : `Pulihkan ${sel.length} kelas menjadi aktif? Foto selfie yang sudah dihapus tidak kembali.`;
  if (!await confirmDialog(msg, { okText: arsip ? 'Arsipkan & hapus selfie' : 'Pulihkan', danger: arsip })) return;
  try {
    const r = await api('admin.archiveClasses', { class_ids: ids, arsip });
    toast(arsip ? 'Kelas diarsipkan' : 'Kelas dipulihkan', arsip ? r.diproses + ' kelas, ' + r.selfie_dihapus + ' foto selfie dihapus.' : r.diproses + ' kelas', 'success');
    openDosenKelas(d.dosen.user_id);
  } catch (e) { toastErr(e); }
}

function editProdi(id) {
  const p = AppState.config.prodi.find(x => x.prodi_id === id); if (!p) return;
  $('#pdId').value = p.prodi_id; $('#pdNama').value = p.nama_prodi; $('#pdFak').value = p.fakultas; $('#pdTitle').textContent = 'Ubah program studi'; $('#pdNama').focus();
}
async function deleteProdi(id) {
  if (!await confirmDialog('Hapus program studi ini dari daftar pilihan?', { okText: 'Hapus', danger: true })) return;
  try { AppState.config.prodi = await api('prodi.delete', { prodi_id: id }); toast('Dihapus', '', 'success'); refreshPage(); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 23: NOTIFIKASI (ikon lonceng)
// ════════════════════════════════════════════════════════

AppState.notif = { items: [], belum_dibaca: 0 };

function updateNotifBadge() {
  const n = AppState.notif; if (!n || !$('#notifBadge')) return;
  $('#notifBadge').classList.toggle('d-none', !n.belum_dibaca);
  $('#notifBtn').setAttribute('aria-label', `Notifikasi${n.belum_dibaca ? ', ' + n.belum_dibaca + ' belum dibaca' : ''}`);
}
async function refreshNotif() {
  if (!AppState.token) return;
  try { AppState.notif = await api('notif.list'); updateNotifBadge(); } catch (e) { /* senyap */ }
}

function toggleNotif() {
  const p = $('#notifPanel');
  if (!p.classList.contains('d-none')) return closeNotif();
  const n = AppState.notif;
  p.innerHTML = `<div class="d-flex justify-content-between align-items-center px-3 py-2" style="border-bottom:1px solid var(--border)"><b>Notifikasi</b>
      ${n.belum_dibaca ? `<button class="btn btn-ghost btn-sm" onclick="markNotifRead()">Tandai sudah dibaca</button>` : ''}</div>
    ${n.items.length ? n.items.map((x, i) => `<div class="notif-item ${x.dibaca ? '' : 'unread'}" role="button" tabindex="0" onclick="openNotif(${i})" onkeydown="if(event.key==='Enter')this.click()">
        ${x.dibaca ? '<span style="width:8px"></span>' : '<span class="dot"></span>'}
        <div class="min-w-0"><div class="fw-600 small-ss">${esc(x.judul)}</div><div class="small-ss text-secondary-ss">${esc(x.pesan)}</div>
          <div class="small-ss text-muted-ss">${esc(fmtDateTime(x.waktu))}</div></div></div>`).join('')
      : `<p class="small-ss text-muted-ss p-3 mb-0">Belum ada notifikasi.</p>`}`;
  p.classList.remove('d-none');
  $('#notifBtn').setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('click', outsideNotif), 0);
}
function outsideNotif(e) { if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) closeNotif(); }
function closeNotif() {
  const p = $('#notifPanel'); if (p) p.classList.add('d-none');
  const b = $('#notifBtn'); if (b) b.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', outsideNotif);
}
/** Optimistis: lencana & daftar langsung berubah; server menyusul di latar belakang (dikoreksi bila gagal). */
function markNotifRead() {
  const n = AppState.notif;
  if (n) { n.items.forEach(x => x.dibaca = true); n.belum_dibaca = 0; updateNotifBadge(); }
  closeNotif();
  api('notif.read').catch(() => refreshNotif());
}
function openNotif(i) {
  const x = AppState.notif.items[i]; closeNotif();
  if (x.tautan && x.tautan.page) navigateTo(x.tautan.page, x.tautan.params || {});
  if (!x.dibaca) markNotifRead();
}

// ════════════════════════════════════════════════════════
// BAGIAN 29: AKTIVITAS — MODUL ASINKRONUS
// ════════════════════════════════════════════════════════

/* ── Markdown ringan yang aman: teks selalu di-escape, tautan/gambar hanya http(s) atau gambar Drive modul ── */
function safeUrl(u) { return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function ytId(u) { const m = String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
function mdInline(raw, actId) {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))/g;
  let out = '', last = 0, m;
  while ((m = re.exec(raw))) {
    out += esc(raw.slice(last, m.index)); last = m.index + m[0].length;
    const t = m[0];
    if (m[1]) out += '<code>' + esc(t.slice(1, -1)) + '</code>';
    else if (m[2]) out += '<strong>' + esc(t.slice(2, -2)) + '</strong>';
    else if (m[3]) out += '<em>' + esc(t.slice(1, -1)) + '</em>';
    else if (m[4]) {
      const mm = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/), alt = mm[1], src = mm[2], d = src.match(/^drive:([A-Za-z0-9_-]+)$/);
      if (d) out += `<img class="md-img" data-drive="${esc(d[1])}" data-act="${esc(actId || '')}" data-kind="modul" alt="${esc(alt)}">`;
      else if (safeUrl(src)) out += `<img class="md-img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
      else out += esc(t);
    } else if (m[5]) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out += safeUrl(mm[2]) ? `<a href="${esc(mm[2])}" target="_blank" rel="noopener noreferrer">${esc(mm[1])}</a>` : esc(t);
    }
  }
  return out + esc(raw.slice(last));
}
function mdRender(text, actId) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let html = '', i = 0, list = null, para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + mdInline(para.join(' '), actId) + '</p>'; para = []; } };
  const flushList = () => { if (list) { html += `<${list.t}>${list.items.map(x => '<li>' + mdInline(x, actId) + '</li>').join('')}</${list.t}>`; list = null; } };
  while (i < lines.length) {
    const ln = lines[i]; let m;
    if (/^```/.test(ln)) { flushPara(); flushList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html += '<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>'; continue; }
    if ((m = ln.match(/^(#{1,3})\s+(.+)$/))) { flushPara(); flushList(); const lv = m[1].length + 2; html += `<h${lv}>${mdInline(m[2], actId)}</h${lv}>`; }
    else if ((m = ln.match(/^@video\s+(\S+)/i))) { flushPara(); flushList(); const id = ytId(m[1]); html += id ? `<div class="md-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Video pembelajaran" allowfullscreen loading="lazy"></iframe></div>` : (safeUrl(m[1]) ? `<p><a href="${esc(m[1])}" target="_blank" rel="noopener noreferrer">Buka video</a></p>` : ''); }
    else if ((m = ln.match(/^[-*]\s+(.+)$/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = ln.match(/^\d+[.)]\s+(.+)$/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
    else if ((m = ln.match(/^>\s?(.*)$/))) { flushPara(); flushList(); html += '<blockquote class="md-quote">' + mdInline(m[1], actId) + '</blockquote>'; }
    else if (!ln.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(ln.trim()); }
    i++;
  }
  flushPara(); flushList(); return html;
}
const _imgCache = {};
/** Gambar yang diunggah ke Drive kelas dimuat lewat server (tidak dibagikan publik). */
function loadDriveImages(root) {
  $$('img[data-drive]', root || document).forEach(async img => {
    if (img.dataset.loaded) return; img.dataset.loaded = '1';
    const id = img.dataset.drive, act = img.dataset.act, kind = img.dataset.kind || 'modul';
    try {
      if (!_imgCache[id]) _imgCache[id] = api('file.get', kind === 'soal' ? { kind, id, assignment_id: act } : { kind, id, activity_id: act }).then(f => b64ToBlobUrl(f.base64, f.mime));
      img.src = await _imgCache[id];
    } catch (e) { img.alt = 'Gambar tidak dapat dimuat'; delete _imgCache[id]; delete img.dataset.loaded; }
  });
}
// Gambar yang muncul di halaman mana pun (soal, ujian, modul) dimuat otomatis
(function () { let t = null; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => loadDriveImages(document), 60); }).observe(document.body, { childList: true, subtree: true }); })();

/** Teks soal/opsi pilihan ganda: di-escape, baris baru dipertahankan, hanya ![ket](drive:ID | https://…) yang menjadi gambar. */
function qRich(text, ownerId) {
  const re = /!\[([^\]]*)\]\((drive:[A-Za-z0-9_-]+|https?:\/\/[^\s)"'<>]+)\)/g;
  return String(text || '').split('\n').map(line => {
    let out = '', last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index)); last = m.index + m[0].length;
      const d = m[2].match(/^drive:(.+)$/);
      out += d ? `<img class="q-img" data-drive="${esc(d[1])}" data-act="${esc(ownerId || '')}" data-kind="soal" alt="${esc(m[1])}">` : `<img class="q-img" src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">`;
    }
    return out + esc(line.slice(last));
  }).join('<br>');
}

/* ── Baris aktivitas di timeline ── */
function activityRowHtml(x, isStudent) {
  const p = x.progress;
  const st = isStudent
    ? (p ? (p.status === 'selesai' ? badge('Selesai', 'b-ok', 'bi-check-circle') : badge(`Halaman ${p.halaman_maks + 1}/${x.jumlah_halaman}`, 'b-info')) : badge('Belum dimulai', 'b-muted'))
    : (x.ringkas ? badge(x.ringkas.selesai + ' selesai', 'b-ok') + ' ' + (x.ringkas.berjalan ? badge(x.ringkas.berjalan + ' berjalan', 'b-info') : '') : '');
  return `<div class="item-row clickable" role="button" tabindex="0" onclick="navigateTo('aktivitas',{activity_id:'${x.activity_id}'})" onkeydown="if(event.key==='Enter')this.click()">
    <div class="item-icon" style="background:var(--accent-soft);color:var(--accent-strong)"><i class="bi bi-play-circle"></i></div>
    <div class="flex-grow-1 min-w-0"><div class="i-title text-truncate">${esc(x.judul)} ${x.draft ? badge('Draft', 'b-warn', 'bi-pencil-square') : ''}</div>
      <div class="i-sub text-truncate">Modul belajar mandiri — ${x.jumlah_halaman} halaman${x.pengaturan && x.pengaturan.hitung_hadir ? ' — selesai = hadir' : ''}</div></div>
    <div class="d-flex flex-column align-items-end gap-1">${st}</div></div>`;
}

/* ═══ Halaman aktivitas: mahasiswa = belajar; pengajar = pratinjau + pemantauan ═══ */
const Mod = { d: null, view: 0, pending: 0, pageSec: {}, lastInt: Date.now(), timers: [], monitor: null, tab: 'pratinjau', can_edit: false };

function modCleanup() {
  Mod.timers.forEach(clearInterval); Mod.timers = [];
  ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(ev => window.removeEventListener(ev, modInteract));
  if (Mod.d && !Mod.d.preview && Mod.pending >= 3 && Mod.d.progress.status !== 'selesai') {
    const detik = takePending(); api('activity.ping', { activity_id: Mod.d.activity.activity_id, index: Mod.view, detik }).catch(() => { });
  }
}
function modInteract() { Mod.lastInt = Date.now(); }
function takePending() { const s = Math.floor(Mod.pending); Mod.pending -= s; return s; }
function modFrontier() { const d = Mod.d; return !d.preview && d.progress.status !== 'selesai' && Mod.view === d.progress.halaman_maks; }

async function renderAktivitas(params, c) {
  modCleanup();
  c.innerHTML = skeleton('list');
  const d = await api('activity.open', { activity_id: params.activity_id });
  Mod.d = d; Mod.tab = params.tab || 'pratinjau'; Mod.pending = 0; Mod.pageSec = {};
  Mod.view = d.preview ? 0 : Math.min(d.progress.halaman_maks, d.pages.length - 1);
  if (d.progress.status === 'selesai' && !d.preview) Mod.view = 0;
  Mod.can_edit = false;
  if (d.preview) { try { const g = await api('activity.get', { activity_id: params.activity_id }); Mod.can_edit = g.can_edit; } catch (e) { /* hanya pratinjau */ } }
  AppState.cleanups.push(modCleanup);
  drawAktivitas(c);
  if (!d.preview && d.progress.status !== 'selesai') startModTracking();
}

function drawAktivitas(c) {
  c = c || container();
  const d = Mod.d, a = d.activity;
  $('#pageTitle').textContent = a.judul;
  const done = !d.preview && d.progress.status === 'selesai';
  c.innerHTML = `
    <div class="page-head"><div class="min-w-0">
        <a href="javascript:void(0)" class="small-ss fw-600 text-decoration-none" onclick="navigateTo('kelas-detail',{class_id:'${d.kelas.class_id}'})"><i class="bi bi-arrow-left"></i> ${esc(d.kelas.nama_kelas)}</a>
        <h1 class="mt-1">${esc(a.judul)}</h1>
        <div class="d-flex flex-wrap gap-2 mt-2">${badge('Modul belajar mandiri', 'b-accent', 'bi-play-circle')}${badge(d.total + ' halaman', 'b-muted')}${a.draft ? badge('Draft — belum terlihat mahasiswa', 'b-warn') : ''}
          ${a.pengaturan.hitung_hadir ? badge('Selesai = hadir', 'b-ok', 'bi-person-check') : ''}${a.pengaturan.batas_waktu ? badge('Batas ' + fmtDateTime(a.pengaturan.batas_waktu), 'b-muted', 'bi-clock') : ''}</div>
        ${a.deskripsi ? `<p class="text-secondary-ss mt-2 mb-0">${esc(a.deskripsi)}</p>` : ''}</div>
      ${d.preview && Mod.can_edit ? `<div class="d-flex flex-wrap gap-2">
        ${a.draft ? `<button class="btn btn-ink btn-sm" onclick="publishActivity('${a.activity_id}', this)" data-loading="Menerbitkan…"><i class="bi bi-send"></i> Terbitkan</button>` : ''}
        <button class="btn btn-soft btn-sm" onclick="openActivityForm({activity_id:'${a.activity_id}',class_id:'${d.kelas.class_id}'})"><i class="bi bi-pencil"></i> Ubah</button>
        <button class="btn btn-danger-soft btn-sm" onclick="deleteActivity('${a.activity_id}','${d.kelas.class_id}')" aria-label="Hapus aktivitas"><i class="bi bi-trash"></i></button></div>` : ''}</div>
    ${d.preview ? `<div class="tabs-pill"><button class="${Mod.tab === 'pratinjau' ? 'active' : ''}" onclick="modTab('pratinjau')">Pratinjau (tampilan mahasiswa)</button>
        <button class="${Mod.tab === 'pemantauan' ? 'active' : ''}" onclick="modTab('pemantauan')">Pemantauan mahasiswa</button></div>` : ''}
    ${done ? `<div class="ann-banner" style="background:var(--ok-soft)"><i class="bi bi-check-circle-fill" style="color:var(--ok)"></i><div><div class="fw-bold">Kamu sudah menyelesaikan modul ini</div>
      <div class="small-ss">${esc(fmtDateTime(d.progress.selesai))} — waktu belajar aktif ${esc(fmtDur(d.progress.detik_aktif))}. Kamu masih bisa membaca ulang.</div></div></div>` : ''}
    <div id="modBody"></div>`;
  if (d.preview && Mod.tab === 'pemantauan') return drawMonitor();
  drawModule();
}

function modTab(t) { Mod.tab = t; drawAktivitas(); }
function fmtDur(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); const m = Math.floor(sec / 60), s = sec % 60; return m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} m` : (m ? `${m} m ${s} d` : `${s} d`); }

function drawModule() {
  const d = Mod.d, pages = d.pages, maks = d.progress.halaman_maks, done = !d.preview && d.progress.status === 'selesai';
  const idx = Mod.view, pg = pages[idx], body = $('#modBody');
  const pct = Math.round((done || d.preview ? pages.length : maks) / pages.length * 100);
  const locked = i => !d.preview && !done && i > maks;
  body.innerHTML = `
    <div class="mod-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Kemajuan belajar"><span style="width:${pct}%"></span></div>
    <div class="mod-layout">
      <nav class="mod-steps" aria-label="Daftar halaman">${pages.map((p, i) => `<button class="mod-step ${i === idx ? 'cur' : ''} ${(i < maks || done) && !d.preview ? 'done' : ''}" ${locked(i) ? 'disabled' : ''} onclick="modGo(${i})">
          <span class="n">${locked(i) ? '<i class="bi bi-lock"></i>' : ((i < maks || done) && !d.preview ? '<i class="bi bi-check-lg"></i>' : i + 1)}</span><span class="t">${esc(p.judul)}</span></button>`).join('')}</nav>
      <section class="mod-content ss-card"><div class="small-ss text-secondary-ss mb-1">Halaman ${idx + 1} dari ${pages.length}</div>
        <h2 class="h4 mb-3">${esc(pg.judul)}</h2>
        <div class="md" id="modMd">${mdRender(pg.konten, d.activity.activity_id)}</div>
        ${pg.latihan ? exerciseHtml(pg) : ''}
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4 pt-3" style="border-top:1px solid var(--border)">
          <button class="btn btn-soft" onclick="modGo(${idx - 1})" ${idx === 0 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Sebelumnya</button>
          <span id="modGate" class="small-ss text-secondary-ss flex-grow-1 text-center"></span>
          <button class="btn btn-ink" id="modNext" onclick="modNext(this)" data-loading="Memeriksa…"></button></div>
      </section></div>`;
  loadDriveImages($('#modMd'));
  bindExercise(); updateGate();
}

function exerciseHtml(pg) {
  const l = pg.latihan, lulus = pg.lulus;
  const head = `<div class="mod-ex mt-4"><div class="d-flex align-items-center gap-2 mb-2"><i class="bi bi-pencil-square" style="color:var(--accent-strong)"></i><b>Latihan mandiri</b>${lulus ? badge('Selesai', 'b-ok', 'bi-check-circle') : ''}</div><p class="mb-2">${esc(l.pertanyaan)}</p>`;
  let inp = '';
  if (l.tipe === 'pg') inp = (l.opsi || []).map((o, j) => `<label class="option-tile"><input class="form-check-input mt-1" type="radio" name="ex" value="${j}"><span><b>${String.fromCharCode(65 + j)}.</b> ${esc(o)}</span></label>`).join('');
  else if (l.tipe === 'isian') inp = `<input class="form-control" id="exIn" maxlength="200" placeholder="Ketik jawabanmu" autocomplete="off">`;
  else inp = `<textarea class="form-control" id="exIn" rows="4" placeholder="Tulis jawabanmu (minimal ${l.min_kata || 20} kata)"></textarea><div class="form-text"><span id="exCount">0</span> kata</div>`;
  return `${head}${inp}<div class="d-flex flex-wrap gap-2 align-items-center mt-2"><button class="btn btn-soft btn-sm" id="exBtn" data-loading="Memeriksa…"><i class="bi bi-check2"></i> ${l.tipe === 'esai' ? 'Kirim jawaban' : 'Periksa jawaban'}</button></div>
    <div id="exFb" class="mt-2" role="status" aria-live="polite">${lulus ? '<span style="color:var(--ok)"><i class="bi bi-check-circle"></i> Latihan ini sudah kamu selesaikan.</span>' : ''}</div></div>`;
}
function bindExercise() {
  const btn = $('#exBtn'); if (!btn) return;
  const ta = $('#exIn'); if (ta && ta.tagName === 'TEXTAREA') ta.oninput = () => { $('#exCount').textContent = (ta.value.match(/\S+/g) || []).length; };
  btn.onclick = () => modAnswer(btn);
}

async function modAnswer(btn) {
  const d = Mod.d, pg = d.pages[Mod.view], l = pg.latihan; let jawaban;
  if (l.tipe === 'pg') { const r = $('input[name="ex"]:checked'); if (!r) return toast('Pilih salah satu jawaban', '', 'warning'); jawaban = Number(r.value); }
  else { jawaban = ($('#exIn').value || '').trim(); if (!jawaban) return toast('Isi jawabanmu dulu', '', 'warning'); }
  const detik = modFrontier() ? takePending() : 0;
  await withBtn(btn, async () => {
    try {
      const r = await api('activity.answer', { activity_id: d.activity.activity_id, index: Mod.view, jawaban, detik });
      pg.percobaan = r.percobaan; if (r.lulus) pg.lulus = true;
      const fb = $('#exFb');
      fb.innerHTML = r.benar
        ? `<div class="fb ok"><i class="bi bi-check-circle-fill"></i> <b>${l.tipe === 'esai' ? 'Jawabanmu diterima.' : 'Benar!'}</b>${r.penjelasan ? `<div class="mt-1">${esc(r.penjelasan)}</div>` : ''}</div>`
        : `<div class="fb bad"><i class="bi bi-x-circle-fill"></i> <b>${l.tipe === 'esai' ? 'Jawabanmu masih terlalu singkat.' : 'Belum tepat, coba lagi.'}</b>${r.penjelasan ? `<div class="mt-1">${esc(r.penjelasan)}</div>` : (r.percobaan >= 2 && l.tipe !== 'esai' ? '<div class="mt-1">Baca kembali materi di atas, lalu coba lagi. Penjelasan terbuka setelah 3 percobaan.</div>' : '')}</div>`;
      updateGate();
    } catch (e) { Mod.pending += detik; toastErr(e); }
  });
}

/** Status tombol "Lanjut": latihan wajib + waktu baca minimal (dihitung dari waktu aktif). */
function updateGate() {
  const d = Mod.d, pg = d.pages[Mod.view], next = $('#modNext'), gate = $('#modGate'); if (!next) return;
  const last = Mod.view === d.pages.length - 1, frontier = modFrontier();
  next.innerHTML = last ? '<i class="bi bi-flag"></i> Selesai' : 'Lanjut <i class="bi bi-chevron-right"></i>';
  if (!frontier) { gate.textContent = ''; next.disabled = false; next.classList.toggle('d-none', last); return; }   // halaman yang sudah lewat / pratinjau: bebas berpindah
  next.classList.remove('d-none');
  const need = Number(pg.min_detik || 0), have = Math.max(Number(pg.detik || 0), Mod.pageSec[Mod.view] || 0), sisa = Math.max(0, need - have);
  const needEx = pg.ada_latihan && !pg.lulus;
  next.disabled = needEx || sisa > 0;
  gate.innerHTML = needEx ? '<i class="bi bi-pencil-square"></i> Jawab latihan dengan benar untuk lanjut' : (sisa > 0 ? `<i class="bi bi-hourglass-split"></i> Baca halaman ini ±${sisa} detik lagi` : '');
}

function startModTracking() {
  ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(ev => window.addEventListener(ev, modInteract, { passive: true }));
  Mod.lastInt = Date.now();
  Mod.timers.push(setInterval(() => {            // hitung waktu aktif: tab terlihat, jendela fokus, dan ada interaksi dalam 45 detik terakhir
    if (!modFrontier()) return;
    if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - Mod.lastInt < 45000) {
      Mod.pending++; Mod.pageSec[Mod.view] = (Mod.pageSec[Mod.view] || 0) + 1; updateGate();
    }
  }, 1000));
  Mod.timers.push(setInterval(() => {            // laporkan ke server tiap 60 detik (bukti waktu belajar)
    if (!modFrontier() || Mod.pending < 5) return;
    const detik = takePending();
    api('activity.ping', { activity_id: Mod.d.activity.activity_id, index: Mod.view, detik }).catch(() => { Mod.pending += detik; });
  }, 60000));
}

function modGo(i) {
  const d = Mod.d; if (i < 0 || i >= d.pages.length) return;
  if (!d.preview && d.progress.status !== 'selesai' && i > d.progress.halaman_maks) return;
  Mod.view = i; drawModule(); window.scrollTo({ top: 0 });
}

async function modNext(btn) {
  const d = Mod.d;
  if (!modFrontier()) { if (Mod.view < d.pages.length - 1) modGo(Mod.view + 1); return; }
  const detik = takePending();
  await withBtn(btn, async () => {
    try {
      const r = await api('activity.next', { activity_id: d.activity.activity_id, index: Mod.view, detik });
      if (r.selesai) { Mod.timers.forEach(clearInterval); Mod.timers = []; return drawModuleDone(r); }
      const fresh = await api('activity.open', { activity_id: d.activity.activity_id });
      Mod.d = fresh; Mod.view = fresh.progress.halaman_maks; drawModule(); window.scrollTo({ top: 0 });
    } catch (e) { Mod.pending += detik; toastErr(e); updateGate(); }
  });
}

function drawModuleDone(r) {
  const d = Mod.d;
  $('#modBody').innerHTML = `<div class="ss-card text-center" style="max-width:560px;margin:24px auto">
    <div class="result-badge" style="background:var(--ok-soft);color:var(--ok)"><i class="bi bi-trophy"></i></div>
    <h2 class="h4">Modul selesai!</h2><p class="text-secondary-ss">Kamu sudah menyelesaikan semua halaman dan latihan.</p>
    <div class="row g-2 mb-3 text-start"><div class="col-6"><div class="ss-card ss-card-tight"><div class="small-ss text-secondary-ss">Waktu belajar aktif</div><div class="fw-bold fs-5">${esc(fmtDur(r.progress.detik_aktif))}</div></div></div>
      <div class="col-6"><div class="ss-card ss-card-tight"><div class="small-ss text-secondary-ss">Sejak mulai</div><div class="fw-bold fs-5">${esc(fmtDur(r.durasi_total))}</div></div></div></div>
    ${r.hadir ? `<p>${badge('Kehadiran tercatat: ' + (r.hadir === 'terlambat' ? 'Terlambat' : r.hadir === 'hadir' ? 'Hadir' : r.hadir), r.hadir === 'hadir' ? 'b-ok' : 'b-warn', 'bi-person-check')}</p>` : ''}
    <p class="small-ss text-muted-ss">Waktu selesai dan lama belajarmu tercatat dan bisa dilihat dosen.</p>
    <div class="d-flex gap-2 justify-content-center"><button class="btn btn-ink" onclick="navigateTo('kelas-detail',{class_id:'${d.kelas.class_id}'})">Kembali ke kelas</button>
      <button class="btn btn-soft" onclick="renderAktivitas({activity_id:'${d.activity.activity_id}'}, container())">Baca ulang</button></div></div>`;
  SWR.clear();
}

/* ── Pemantauan (pengajar) ── */
async function drawMonitor() {
  const body = $('#modBody'); body.innerHTML = loadingBlock('Memuat pemantauan…');
  try {
    const g = await api('activity.progress', { activity_id: Mod.d.activity.activity_id });
    const stBadge = r => r.status === 'selesai' ? badge('Selesai', 'b-ok') : r.status === 'berjalan' ? badge('Halaman ' + r.halaman + '/' + r.total, 'b-info') : badge('Belum mulai', 'b-muted');
    body.innerHTML = `
      <div class="d-flex flex-wrap gap-2 mb-3">${badge(g.ringkas.selesai + ' selesai', 'b-ok')}${badge(g.ringkas.berjalan + ' sedang berjalan', 'b-info')}${badge(g.ringkas.belum + ' belum mulai', 'b-muted')}
        ${g.ringkas.cepat ? badge(g.ringkas.cepat + ' terlalu cepat', 'b-bad', 'bi-lightning') : ''}</div>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Mahasiswa</th><th>Status</th><th>Mulai</th><th>Selesai</th><th>Waktu aktif</th><th>Sejak mulai</th><th>Dibanding patokan</th></tr></thead><tbody>
        ${g.rows.map(r => `<tr><td><div class="fw-600">${esc(r.nama)}</div><div class="small-ss text-secondary-ss">${esc(r.npm)}</div></td><td>${stBadge(r)}</td>
          <td class="small-ss">${r.mulai ? esc(fmtDateTime(r.mulai)) : '-'}</td><td class="small-ss">${r.selesai ? esc(fmtDateTime(r.selesai)) : '-'}</td>
          <td class="tabular">${r.status === 'belum' ? '-' : esc(fmtDur(r.detik_aktif))}</td><td class="tabular">${r.durasi_wall !== null ? esc(fmtDur(r.durasi_wall)) : '-'}</td>
          <td>${r.rasio !== null ? (r.cepat ? badge(Math.round(r.rasio * 100) + '% — terlalu cepat', 'b-bad', 'bi-lightning') : badge(Math.round(r.rasio * 100) + '%', 'b-ok')) : '<span class="text-muted-ss">-</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small-ss text-secondary-ss mt-2">Patokan waktu baca modul ini: ±${esc(fmtDur(g.diharapkan_detik))} (±200 kata/menit atau waktu minimal halaman). Waktu aktif dihitung hanya saat tab terlihat dan mahasiswa berinteraksi. Tanda "terlalu cepat" bila waktu aktif di bawah ${Math.round(g.batas_cepat * 100)}% patokan, tandanya hanya petunjuk untuk Anda tindak lanjuti.</p>
      <h2 class="section-title mt-4 mb-2">Per halaman</h2>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Halaman</th><th>Rata-rata waktu aktif</th><th>Lulus latihan</th><th>Rata-rata percobaan</th></tr></thead><tbody>
        ${g.halaman.map((h, i) => `<tr><td>${i + 1}. ${esc(h.judul)}</td><td class="tabular">${esc(fmtDur(h.rata_detik))}</td><td class="tabular">${h.lulus_persen === null ? '-' : h.lulus_persen + '%'}</td><td class="tabular">${h.rata_percobaan === null ? '-' : h.rata_percobaan}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { body.innerHTML = errorBlock(e, 'drawMonitor()'); }
}

async function publishActivity(id, btn) {
  await withBtn(btn, async () => { try { await api('activity.publish', { activity_id: id }); toast('Aktivitas diterbitkan', 'Mahasiswa mendapat notifikasi.', 'success'); refreshPage(); } catch (e) { toastErr(e); } });
}
async function deleteActivity(id, classId) {
  if (!await confirmDialog('Hapus aktivitas ini? Aktivitas yang sudah dikerjakan mahasiswa tidak bisa dihapus.', { okText: 'Hapus', danger: true })) return;
  try { await api('activity.delete', { activity_id: id }); toast('Aktivitas dihapus', '', 'success'); navigateTo('kelas-detail', { class_id: classId }, { noHistory: true }); } catch (e) { toastErr(e); }
}

/* ═══ Editor modul (pengajar) ═══ */
const Act = { id: '', meeting: '', klass: '', pages: [], idx: 0, dirty: false, saved: false, preview: false, canDraft: true };
function actBlankPage() { return { page_id: '', judul: '', konten: '', min_detik: 0, latihan: null }; }
function actLatihanComplete(l) {
  if (!l) return true; if (!String(l.pertanyaan || '').trim()) return false;
  if (l.tipe === 'pg') { const o = (l.opsi || []).filter(x => String(x).trim()); return o.length >= 2 && l.kunci !== '' && l.kunci !== undefined && !!String((l.opsi || [])[Number(l.kunci)] || '').trim(); }
  if (l.tipe === 'isian') return String(l.jawaban || '').split('\n').some(x => x.trim());
  return true;
}
function actPageComplete(p) { return !!String(p.judul || '').trim() && !!String(p.konten || '').trim() && actLatihanComplete(p.latihan); }

async function openActivityForm(ctx) {
  Object.assign(Act, { id: ctx.activity_id || '', klass: ctx.class_id || AppState.params.class_id, meeting: ctx.meeting_id || '', idx: 0, dirty: false, saved: false, preview: false });
  const body = openModal({ title: ctx.activity_id ? 'Ubah modul belajar' : 'Modul belajar baru', body: loadingBlock(), size: 'modal-xl', static: true });
  try {
    const [meetings, ex] = await Promise.all([ensureMeetings(Act.klass), ctx.activity_id ? api('activity.get', { activity_id: ctx.activity_id }) : Promise.resolve(null)]);
    if (!meetings.length) { body.innerHTML = emptyState('Belum ada pertemuan', 'Tambahkan pertemuan di tab Timeline dulu.'); return; }
    const a = ex ? ex.activity : { judul: '', deskripsi: '', draft: true, pengaturan: { hitung_hadir: true, batas_waktu: '' }, meeting_id: ctx.meeting_id || meetings[meetings.length - 1].meeting_id };
    Act.canDraft = !ex || a.draft;
    Act.meeting = a.meeting_id;
    Act.pages = ex ? ex.pages.map(p => ({ page_id: p.page_id, judul: p.judul, konten: p.konten, min_detik: p.min_detik, latihan: p.latihan ? Object.assign({}, p.latihan, { jawaban: Array.isArray(p.latihan.jawaban) ? p.latihan.jawaban.join('\n') : (p.latihan.jawaban || '') }) : null })) : [actBlankPage()];
    body.innerHTML = `<form id="acForm" novalidate onsubmit="return false">
      ${Act.canDraft ? '' : `<div class="answer-box small-ss mb-3" style="white-space:normal"><i class="bi bi-info-circle"></i> Modul ini sudah terbit. Perubahan langsung terlihat oleh mahasiswa; halaman yang sudah diselesaikan mahasiswa tetap tercatat.</div>`}
      <div class="row g-3">
        <div class="col-md-7"><label class="form-label" for="acJudul">Judul modul</label><input class="form-control" id="acJudul" maxlength="150" value="${esc(a.judul)}" placeholder="mis. Pertemuan 3 — Normalisasi Basis Data"></div>
        <div class="col-md-5"><label class="form-label" for="acMeet">Pertemuan</label><select class="form-select" id="acMeet">${meetings.map(m => `<option value="${m.meeting_id}" ${m.meeting_id === a.meeting_id ? 'selected' : ''}>${esc(m.judul)}</option>`).join('')}</select></div>
        <div class="col-12"><label class="form-label" for="acDesk">Pengantar singkat (opsional)</label><input class="form-control" id="acDesk" maxlength="2000" value="${esc(a.deskripsi || '')}" placeholder="Tujuan belajar atau petunjuk untuk mahasiswa"></div>
                <div class="col-md-6"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="acHadir" ${a.pengaturan.hitung_hadir !== false ? 'checked' : ''}><label class="form-check-label" for="acHadir">Menyelesaikan modul = tercatat <b>hadir</b></label></div>
          <div class="form-text">Izin/sakit yang Anda beri tidak ditimpa.</div></div>
        <div class="col-md-6"><label class="form-label" for="acBatas">Batas waktu menyelesaikan (opsional)</label><input class="form-control" id="acBatas" type="datetime-local" value="${esc(toLocalInput(a.pengaturan.batas_waktu))}"><div class="form-text">Selesai setelah batas → tercatat <b>terlambat</b>.</div></div>
      </div>
      <h3 class="h6 mt-4 mb-2">Halaman modul <span id="acCount" class="text-muted-ss fw-normal"></span></h3>
      <div id="acPages"></div></form>`;
    const foot = document.getElementById('appModalFooter'); foot.classList.remove('d-none'); delete foot.dataset.confirming;
    const btns = Act.canDraft
      ? `<span id="acStatus" class="small-ss text-muted-ss me-auto" role="status"></span><button class="btn btn-soft" id="acCancel">Batal</button><button class="btn btn-soft" id="acDraft" data-loading="Menyimpan…"><i class="bi bi-save"></i> Simpan draft</button><button class="btn btn-ink" id="acPublish" data-loading="Menerbitkan…"><i class="bi bi-send"></i> Terbitkan</button>`
      : `<span id="acStatus" class="small-ss text-muted-ss me-auto" role="status"></span><button class="btn btn-soft" id="acCancel">Batal</button><button class="btn btn-ink" id="acSave" data-loading="Menyimpan…">Simpan perubahan</button>`;
    foot.innerHTML = `<div id="acBtns" class="d-flex flex-wrap gap-2 align-items-center w-100">${btns}</div>
      <div id="acConfirm" class="flex-wrap gap-2 align-items-center w-100" style="display:none"><span class="me-auto small-ss" style="color:var(--warn)"><i class="bi bi-exclamation-triangle"></i> Ada perubahan yang belum disimpan.</span>
        <button class="btn btn-soft" id="acBack">Kembali mengedit</button><button class="btn btn-danger-soft" id="acDiscard">Tutup tanpa menyimpan</button></div>`;
    acRender();
    $('#acForm').addEventListener('input', () => { Act.dirty = true; }); $('#acForm').addEventListener('change', () => { Act.dirty = true; });
    const el = document.getElementById('appModal');
    const guard = e => { if (Act.dirty && document.getElementById('acForm')) { e.preventDefault(); $('#acBtns').style.display = 'none'; $('#acConfirm').style.display = 'flex'; } };
    el.addEventListener('hide.bs.modal', guard);
    el.addEventListener('hidden.bs.modal', function h() { el.removeEventListener('hide.bs.modal', guard); el.removeEventListener('hidden.bs.modal', h); if (Act.saved && !Act.nav) refreshPage(); Act.nav = false; });
    $('#acCancel').onclick = () => closeModal();
    $('#acBack').onclick = () => { $('#acConfirm').style.display = 'none'; $('#acBtns').style.display = 'flex'; };
    $('#acDiscard').onclick = () => { Act.dirty = false; closeModal(); };
    const payload = draft => {
      acCollect();
      const batas = $('#acBatas').value ? new Date($('#acBatas').value).toISOString() : '';
      return { activity_id: Act.id, meeting_id: $('#acMeet').value, tipe: 'asinkronus', judul: $('#acJudul').value.trim(), deskripsi: $('#acDesk').value.trim(), pengaturan: { hitung_hadir: $('#acHadir').checked, batas_waktu: batas }, draft,
        pages: Act.pages.map(p => ({ page_id: p.page_id, judul: p.judul, konten: p.konten, min_detik: Number(p.min_detik || 0), latihan: acLatihanOut(p.latihan) })) };
    };
    const finish = (r, msg) => { Act.dirty = false; Act.nav = true; closeModal(); toast(msg, '', 'success'); if (AppState.page === 'aktivitas') refreshPage(); else navigateTo('aktivitas', { activity_id: r.activity_id }); };
    if ($('#acDraft')) {
      $('#acDraft').onclick = e => withBtn(e.currentTarget, async () => {
        const p = payload(true); if (!p.judul) return toast('Judul modul wajib diisi', '', 'warning');
        try { const r = await api('activity.save', p); Act.id = r.activity_id; Act.dirty = false; Act.saved = true; Act.pagesSaved = true;
          $('#acStatus').innerHTML = `<i class="bi bi-check-circle" style="color:var(--ok)"></i> Draft tersimpan ${esc(fmtTime(new Date().toISOString()))}. Boleh dilanjutkan nanti.`; toast('Draft tersimpan', 'Belum terlihat oleh mahasiswa.', 'success');
          const g = await api('activity.get', { activity_id: Act.id }); g.pages.forEach((sp, i) => { if (Act.pages[i]) Act.pages[i].page_id = sp.page_id; });
        } catch (err) { toastErr(err); }
      });
      $('#acPublish').onclick = e => withBtn(e.currentTarget, async () => {
        const p = payload(false); if (!p.judul) return toast('Judul modul wajib diisi', '', 'warning');
        const bad = Act.pages.findIndex(x => !actPageComplete(x));
        if (!Act.pages.length) return toast('Belum ada halaman', '', 'warning');
        if (bad > -1) { acGo(bad); return toast(`Halaman ${bad + 1} belum lengkap`, 'Isi judul, isi halaman, dan lengkapi latihan (bila ada). Atau simpan sebagai draft dulu.', 'warning'); }
        try { const r = await api('activity.save', p); finish(r, 'Modul diterbitkan. Mahasiswa mendapat notifikasi.'); } catch (err) { toastErr(err); }
      });
    }
    if ($('#acSave')) $('#acSave').onclick = e => withBtn(e.currentTarget, async () => {
      const p = payload(false); if (!p.judul) return toast('Judul modul wajib diisi', '', 'warning');
      try { const r = await api('activity.save', p); finish(r, 'Perubahan disimpan'); } catch (err) { toastErr(err); }
    });
  } catch (e) { body.innerHTML = errorBlock(e); }
}

function acLatihanOut(l) {
  if (!l || !l.tipe) return null;
  const o = { tipe: l.tipe, pertanyaan: l.pertanyaan || '', penjelasan: l.penjelasan || '', wajib_benar: l.wajib_benar !== false };
  if (l.tipe === 'pg') { o.opsi = l.opsi || []; o.kunci = l.kunci === undefined ? '' : l.kunci; }
  else if (l.tipe === 'isian') o.jawaban = String(l.jawaban || '').split('\n');
  else o.min_kata = Number(l.min_kata || 20);
  return o;
}
function acSync() { const a = document.activeElement; if (a && a.closest && a.closest('#acPages')) a.blur(); acCollect(); }
function acCollect() {
  const el = $('#acPages [data-ap]'); if (!el) return;
  const p = Act.pages[Number(el.dataset.ap)]; if (!p) return;
  p.judul = $('.ap-judul', el).value; p.min_detik = Number($('.ap-min', el).value || 0); p.konten = $('.ap-konten', el).value;
  const t = el.dataset.ltipe || '';            // jenis latihan yang SEDANG tampil (bukan pilihan yang baru diubah)
  if (!t) { p.latihan = null; return; }
  const l = p.latihan || {}; l.tipe = t; l.pertanyaan = $('.ap-lq', el).value; l.penjelasan = $('.ap-lexp', el).value;
  const wb = $('.ap-lwb', el); l.wajib_benar = wb ? wb.checked : true;
  if (t === 'pg') { l.opsi = $$('.ap-lopt', el).map(x => x.value); const k = $('.ap-lkey:checked', el); l.kunci = k ? Number(k.value) : ''; }
  else if (t === 'isian') l.jawaban = $('.ap-lans', el).value;
  else l.min_kata = Number($('.ap-lmin', el).value || 20);
  p.latihan = l;
}
function acRender() {
  const box = $('#acPages'); if (!box) return;
  const arr = Act.pages, n = arr.length; Act.idx = Math.min(Math.max(Act.idx, 0), n - 1);
  const i = Act.idx, p = arr[i];
  const l = p.latihan || {}, done = arr.filter(actPageComplete).length;
  const cnt = $('#acCount'); if (cnt) cnt.textContent = `(${n} halaman, ${done} lengkap)`;
  if (l.tipe === 'pg' && (!l.opsi || l.opsi.length < 2)) l.opsi = ['', '', '', ''];
  box.innerHTML = `
    <div class="q-nav" role="navigation" aria-label="Daftar halaman modul">${arr.map((x, j) => `<button type="button" class="q-dot ${j === i ? 'cur' : ''} ${actPageComplete(x) ? 'ok' : 'warn'}" data-j="${j}" onclick="acGo(${j})" aria-label="Halaman ${j + 1}">${j + 1}</button>`).join('')}
      <button type="button" class="q-dot" onclick="acAdd()" aria-label="Tambah halaman" title="Tambah halaman"><i class="bi bi-plus-lg"></i></button></div>
    <div class="ss-card ss-card-tight" data-ap="${i}" data-ltipe="${esc(l.tipe || '')}">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><b>Halaman ${i + 1} <span class="text-muted-ss fw-normal">dari ${n}</span></b>
        <div class="d-flex gap-1 flex-wrap"><button type="button" class="btn btn-ghost btn-sm" onclick="acMove(-1)" ${i === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i> Naikkan</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="acMove(1)" ${i === n - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i> Turunkan</button>
          <button type="button" class="btn btn-ghost btn-sm" id="acDelBtn" onclick="acDel()" ${n <= 1 ? 'disabled' : ''}><i class="bi bi-trash"></i> Hapus</button></div></div>
      <div class="row g-2 mb-2"><div class="col-md-8"><label class="form-label small-ss">Judul halaman</label><input class="form-control ap-judul" maxlength="150" value="${esc(p.judul)}"></div>
        <div class="col-md-4"><label class="form-label small-ss">Waktu baca minimal (detik)</label><input class="form-control ap-min" type="number" min="0" max="1800" value="${esc(p.min_detik || 0)}"><div class="form-text">0 = tanpa batas minimal. Tombol Lanjut baru aktif setelah waktu ini.</div></div></div>
      <div class="d-flex flex-wrap gap-1 mb-1" role="toolbar" aria-label="Format teks">
        <button type="button" class="btn btn-soft btn-sm" onclick="acFmt('**','**','tebal')"><b>B</b></button><button type="button" class="btn btn-soft btn-sm" onclick="acFmt('*','*','miring')"><i>I</i></button>
        <button type="button" class="btn btn-soft btn-sm" onclick="acFmt('## ','','Subjudul')">Judul</button><button type="button" class="btn btn-soft btn-sm" onclick="acFmt('- ','','butir daftar')"><i class="bi bi-list-ul"></i></button>
        <button type="button" class="btn btn-soft btn-sm" onclick="acFmt('\`','\`','kode')"><i class="bi bi-code"></i></button><button type="button" class="btn btn-soft btn-sm" onclick="acFmt('\`\`\`\\n','\\n\`\`\`','blok kode')"><i class="bi bi-code-square"></i></button>
        <button type="button" class="btn btn-soft btn-sm" onclick="acFmt('[',  '](https://)','teks tautan')"><i class="bi bi-link-45deg"></i> Tautan</button>
        <button type="button" class="btn btn-soft btn-sm" onclick="acFmt('@video https://youtu.be/','','')"><i class="bi bi-youtube"></i> Video</button>
        <label class="btn btn-soft btn-sm mb-0"><i class="bi bi-image"></i> Gambar<input type="file" accept="image/jpeg,image/png" class="d-none" id="acImg"></label>
        <button type="button" class="btn btn-ghost btn-sm ms-auto" onclick="acTogglePreview()"><i class="bi bi-eye"></i> Pratinjau</button></div>
      <textarea class="form-control ap-konten" id="apKonten" rows="11" placeholder="Tulis materi di sini. Gunakan tombol di atas untuk format. Gambar JPG/PNG maks 3 MB.">${esc(p.konten)}</textarea>
      <div id="acPreview" class="md ss-card ss-card-tight mt-2 d-none"></div>
      <div class="mt-3 pt-3" style="border-top:1px solid var(--border)"><div class="row g-2 align-items-end"><div class="col-md-5"><label class="form-label small-ss"><i class="bi bi-pencil-square"></i> Latihan mandiri (mahasiswa wajib menjawab sebelum lanjut)</label>
          <select class="form-select ap-ltipe" onchange="acLTipe()"><option value="">Tanpa latihan</option><option value="pg" ${l.tipe === 'pg' ? 'selected' : ''}>Pilihan ganda</option><option value="isian" ${l.tipe === 'isian' ? 'selected' : ''}>Isian singkat (dicek otomatis)</option><option value="esai" ${l.tipe === 'esai' ? 'selected' : ''}>Esai singkat (cukup minimal kata)</option></select></div></div>
        ${l.tipe ? `<div class="mt-2"><label class="form-label small-ss">Pertanyaan</label><textarea class="form-control ap-lq" rows="2">${esc(l.pertanyaan || '')}</textarea>
          ${l.tipe === 'pg' ? `<div class="mt-2">${l.opsi.map((o, j) => `<div class="d-flex align-items-center gap-2 mb-1"><input class="form-check-input mt-0 ap-lkey" type="radio" name="apk" value="${j}" ${String(l.kunci) === String(j) ? 'checked' : ''} aria-label="Kunci ${String.fromCharCode(65 + j)}"><span class="small-ss fw-600" style="width:16px">${String.fromCharCode(65 + j)}</span><input class="form-control form-control-sm ap-lopt" style="min-height:36px" value="${esc(o)}" placeholder="Opsi ${String.fromCharCode(65 + j)}"></div>`).join('')}
            <div class="form-text">Pilih bulatan di kiri opsi sebagai kunci jawaban.</div></div>` : ''}
          ${l.tipe === 'isian' ? `<label class="form-label small-ss mt-2">Jawaban yang diterima (satu per baris; huruf besar/kecil dan spasi berlebih diabaikan)</label><textarea class="form-control ap-lans" rows="3" placeholder="Jakarta&#10;DKI Jakarta">${esc(l.jawaban || '')}</textarea>` : ''}
          ${l.tipe === 'esai' ? `<label class="form-label small-ss mt-2">Minimal jumlah kata agar diterima</label><input class="form-control ap-lmin" type="number" min="1" max="500" style="max-width:140px" value="${esc(l.min_kata || 20)}">` : ''}
          <label class="form-label small-ss mt-2">Penjelasan (ditampilkan setelah benar / 3 kali mencoba)</label><textarea class="form-control ap-lexp" rows="2">${esc(l.penjelasan || '')}</textarea>
          ${l.tipe !== 'esai' ? `<div class="form-check form-switch mt-2"><input class="form-check-input ap-lwb" type="checkbox" ${l.wajib_benar !== false ? 'checked' : ''}><label class="form-check-label small-ss">Harus benar untuk lanjut (bila mati: cukup menjawab)</label></div>` : ''}</div>` : ''}</div>
    </div>`;
  const ki = $('#acImg'); if (ki) ki.onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) acUploadImage(f); };
  box.querySelector('[data-ap]').addEventListener('input', acLive); box.querySelector('[data-ap]').addEventListener('change', acLive);
}
function acLive() { acCollect(); const dot = $(`#acPages .q-dot[data-j="${Act.idx}"]`); if (dot) { const ok = actPageComplete(Act.pages[Act.idx]); dot.classList.toggle('ok', ok); dot.classList.toggle('warn', !ok); } const cnt = $('#acCount'); if (cnt) cnt.textContent = `(${Act.pages.length} halaman, ${Act.pages.filter(actPageComplete).length} lengkap)`; }
function acGo(i) { if (i < 0 || i >= Act.pages.length) return; acSync(); Act.idx = i; acRender(); }
function acAdd() { acSync(); Act.pages.push(actBlankPage()); Act.idx = Act.pages.length - 1; Act.dirty = true; acRender(); const t = $('#acPages .ap-judul'); if (t) t.focus(); }
function acMove(dir) { acSync(); const a = Act.pages, i = Act.idx, j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; Act.idx = j; Act.dirty = true; acRender(); }
function acDel() {
  const b = $('#acDelBtn');
  if (!Act.delArmed) { Act.delArmed = true; if (b) b.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Klik lagi untuk hapus'; setTimeout(() => { Act.delArmed = false; const bb = $('#acDelBtn'); if (bb) bb.innerHTML = '<i class="bi bi-trash"></i> Hapus'; }, 3000); return; }
  Act.delArmed = false; acSync(); Act.pages.splice(Act.idx, 1); Act.dirty = true; acRender(); toast('Halaman dihapus', '', 'info');
}
function acLTipe() { acSync(); const p = Act.pages[Act.idx]; const t = $('#acPages .ap-ltipe').value; if (!t) p.latihan = null; else { const old = p.latihan || {}; p.latihan = { tipe: t, pertanyaan: old.pertanyaan || '', penjelasan: old.penjelasan || '', wajib_benar: true, opsi: old.opsi || ['', '', '', ''], kunci: '', jawaban: '', min_kata: 20 }; } Act.dirty = true; acRender(); }
function acFmt(before, after, ph) {
  const t = $('#apKonten'); if (!t) return;
  const s = t.selectionStart, e = t.selectionEnd, sel = t.value.slice(s, e) || ph;
  t.value = t.value.slice(0, s) + before + sel + after + t.value.slice(e); t.focus(); t.setSelectionRange(s + before.length, s + before.length + sel.length);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}
function acTogglePreview() { acCollect(); const pv = $('#acPreview'); pv.classList.toggle('d-none'); if (!pv.classList.contains('d-none')) { pv.innerHTML = mdRender(Act.pages[Act.idx].konten, Act.id); loadDriveImages(pv); } }
async function acUploadImage(file) {
  try {
    toast('Mengunggah gambar…', file.name, 'info');
    const f = await prepareImageForUpload(file);
    const r = await api('activity.uploadImage', { class_id: Act.klass, file: f });
    acFmt('![', `](drive:${r.file_id})`, 'deskripsi gambar'); toast('Gambar ditambahkan', 'Sisipan ![...](drive:…) ada di teks.', 'success');
  } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 30: UJIAN BERWAKTU (sisi mahasiswa & catatan untuk dosen)
// ════════════════════════════════════════════════════════
const Exam = { v: null, offset: 0, timers: [], away: null, fs: false, fsWanted: false, idx: 0, assignmentId: '', teksTimer: null, listeners: [], done: false, dirtyTeks: false };

function fmtClock(sec) { sec = Math.max(0, Math.ceil(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'); }
function fmtMenit(detik, perSoal) { return perSoal ? detik + ' detik' : (detik >= 3600 ? Math.floor(detik / 3600) + ' jam' + (detik % 3600 ? ' ' + Math.round(detik % 3600 / 60) + ' menit' : '') : Math.round(detik / 60) + ' menit'); }

/** Kartu ujian di halaman tugas mahasiswa (menggantikan form jawaban biasa). */
function renderExamCard(g, box) {
  const u = g.ujian, at = u.attempt, a = g.assignment, latest = g.versions[0] || null;
  const per = u.mode === 'per_soal';
  const rules = [
    per ? `Waktu <b>${u.detik} detik untuk setiap soal</b>. Soal yang habis waktunya terlewati dan tidak bisa dikerjakan kembali.` : `Waktu total <b>${fmtMenit(u.detik)}</b> untuk ${a.tipe_jawaban === 'teks' ? 'menulis jawaban' : 'semua soal'}.`,
    'Waktu berjalan di server dan <b>tidak berhenti</b> walau halaman ditutup. Kerjakan sampai selesai dalam satu kali duduk.',
    u.acak_soal && u.jumlah_soal ? 'Urutan soal diacak untuk tiap mahasiswa.' : '', u.acak_opsi && u.jumlah_soal ? 'Urutan pilihan jawaban juga diacak.' : '',
    u.pantau ? 'Bila kamu <b>meninggalkan halaman ujian</b> (pindah tab/aplikasi), peringatan muncul dan kejadiannya <b>tercatat dan terlihat oleh dosen</b>.' : '',
    u.layar_penuh ? 'Ujian akan dicoba dibuka dalam <b>layar penuh</b> (bila perangkatmu mendukung).' : '',
    a.tipe_jawaban === 'pilihan_ganda' ? `Terdapat <b>${u.jumlah_soal} soal</b> pilihan ganda.` : ''].filter(Boolean);
  const done = at && at.status !== 'berjalan';
  box.innerHTML = `<div class="ss-card"><div class="d-flex align-items-center gap-2 mb-2"><span class="result-badge" style="width:44px;height:44px;margin:0;background:var(--accent-soft);color:var(--accent-strong)"><i class="bi bi-stopwatch"></i></span><h2 class="h5 mb-0">Ujian berwaktu</h2></div>
    <ul class="small-ss mb-3 ps-3">${rules.map(r => `<li class="mb-1">${r}</li>`).join('')}</ul>
    ${done ? `<div class="answer-box" style="white-space:normal"><i class="bi bi-check-circle" style="color:var(--ok)"></i> <b>Kamu sudah mengerjakan ujian ini.</b>
        ${latest ? (latest.status === 'Dinilai' && latest.nilai && latest.nilai.skor !== null ? ` Nilai: <b>${esc(latest.nilai.skor)}</b> / ${esc(a.nilai_maks)}.` : ' Jawabanmu terkumpul dan menunggu dosen menilai.') : ''}${at.status === 'habis' ? ' <span class="text-muted-ss">(terkumpul otomatis karena waktu habis)</span>' : ''}</div>`
      : g.kelas.archived ? '<p class="text-secondary-ss">Kelas sudah diarsipkan.</p>'
      : `<button class="btn btn-ink btn-lg" id="exStart"><i class="bi bi-play-fill"></i> ${at ? 'Lanjutkan ujian' : 'Mulai ujian'}</button>
         <div class="form-text mt-2">${at ? 'Ujianmu sedang berjalan. Waktu tetap berkurang selama kamu pergi.' : 'Pastikan koneksi stabil dan baterai cukup. Setelah ditekan, waktu langsung berjalan.'}</div>`}
  </div>`;
  const b = $('#exStart'); if (b) b.onclick = () => startExam(a.assignment_id, u);
}

async function startExam(assignmentId, cfg) {
  Exam.fsWanted = !!cfg.layar_penuh; Exam.fs = false;
  if (Exam.fsWanted) { try { await document.documentElement.requestFullscreen(); Exam.fs = true; } catch (e) { Exam.fsNote = 'Layar penuh tidak tersedia di perangkat/peramban ini; ujian tetap berjalan.'; } }
  try {
    const v = await api('exam.start', { assignment_id: assignmentId });
    if (v.status !== 'berjalan') { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); toast('Waktu ujian sudah habis', 'Jawabanmu terkumpul otomatis.', 'info'); SWR.clear(); return refreshPage(); }
    Exam.assignmentId = assignmentId; Exam.done = false; Exam.idx = 0;
    openExamOverlay(v);
  } catch (e) { if (Exam.fs) document.exitFullscreen().catch(() => { }); toastErr(e); }
}

function examNowMs() { return Date.now() + Exam.offset; }
function examLeft() { const v = Exam.v; const t = v.mode === 'total' ? Date.parse(v.batas) : Date.parse(v.soal_batas); return (t - examNowMs()) / 1000; }

function openExamOverlay(v) {
  closeExamOverlay(true);
  Exam.v = v; Exam.offset = Date.parse(v.server_now) - Date.now();
  const ov = document.createElement('div'); ov.id = 'examOverlay'; ov.className = 'exam-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Ujian: ' + v.judul);
  ov.innerHTML = `<div class="exam-top"><div class="min-w-0"><div class="fw-bold text-truncate">${esc(v.judul)}</div><div class="small-ss text-secondary-ss" id="exInfo"></div></div><div class="exam-timer" id="exTimer" aria-label="Sisa waktu">--:--</div></div>
    ${Exam.fsNote ? `<div class="exam-note small-ss">${esc(Exam.fsNote)}</div>` : ''}<div class="exam-body" id="exBody"></div>
    <div class="exam-warn d-none" id="exWarn" role="alertdialog" aria-live="assertive"></div>`;
  document.body.appendChild(ov); document.body.classList.add('exam-on'); Exam.fsNote = '';
  ov.addEventListener('contextmenu', e => e.preventDefault()); ov.addEventListener('copy', e => e.preventDefault()); ov.addEventListener('cut', e => e.preventDefault());
  window.onbeforeunload = () => 'Ujian sedang berjalan.';
  if (v.pantau) examBindMonitoring();
  Exam.timers.push(setInterval(examTick, 250));
  drawExam();
}

function closeExamOverlay(silent) {
  Exam.timers.forEach(clearInterval); Exam.timers = []; clearTimeout(Exam.teksTimer);
  Exam.listeners.forEach(([t, ev, fn]) => t.removeEventListener(ev, fn)); Exam.listeners = [];
  window.onbeforeunload = null;
  const ov = document.getElementById('examOverlay'); if (ov) ov.remove(); document.body.classList.remove('exam-on');
  if (!silent && document.fullscreenElement) document.exitFullscreen().catch(() => { });
  Exam.away = null; Exam.fs = Exam.fs && !!document.fullscreenElement;
}

/** Pemantauan: hanya MENCATAT dan MENGINGATKAN. Tidak ada yang dihentikan otomatis. */
function examBindMonitoring() {
  const on = (t, ev, fn) => { t.addEventListener(ev, fn); Exam.listeners.push([t, ev, fn]); };
  on(document, 'visibilitychange', () => { if (document.hidden) examAway('keluar_tab'); else examBack(); });
  on(window, 'blur', () => setTimeout(() => { if (!document.hasFocus() && !document.hidden) examAway('jendela_tidak_fokus'); }, 800));
  on(window, 'focus', () => examBack());
  on(document, 'fullscreenchange', () => { if (Exam.fs && !document.fullscreenElement) { Exam.fs = false; examReport('keluar_layar_penuh', 0, true); } });
}
function examAway(tipe) { if (!Exam.away && !Exam.done) Exam.away = { t: Date.now(), tipe }; }
function examBack() {
  if (!Exam.away || Exam.done) return;
  const detik = Math.round((Date.now() - Exam.away.t) / 1000), tipe = Exam.away.tipe; Exam.away = null;
  if (tipe === 'jendela_tidak_fokus' && detik < 2) return;        // gangguan singkat tidak dihitung
  examReport(tipe, detik, false);
}
async function examReport(tipe, detik, fsExit) {
  let n = (Exam.v.jumlah_keluar || 0) + 1;
  try { const r = await api('exam.event', { attempt_id: Exam.v.attempt_id, tipe, detik }); n = r.jumlah_keluar; Exam.v.jumlah_keluar = n; } catch (e) { /* tetap tampilkan peringatan */ }
  const w = $('#exWarn'); if (!w) return;
  w.classList.remove('d-none');
  w.innerHTML = `<div class="exam-warn-card"><div class="result-badge" style="background:var(--warn-soft);color:var(--warn)"><i class="bi bi-exclamation-triangle"></i></div>
    <h2 class="h5">Kamu meninggalkan halaman ujian</h2>
    <p class="mb-2">${fsExit ? 'Kamu keluar dari layar penuh.' : `Kamu berada di luar halaman ujian selama sekitar <b>${detik} detik</b>.`} Ini sudah tercatat sebagai pelanggaran ke-<b>${n}</b> dan <b>terlihat oleh dosen</b>.</p>
    <p class="small-ss text-secondary-ss">Waktu ujian tetap berjalan. Tetaplah di halaman ini sampai ujian selesai. Bila terjadi karena hal tak disengaja (mis. telepon masuk), sampaikan kepada dosen setelah ujian.</p>
    <div class="d-flex gap-2 justify-content-center flex-wrap">${Exam.fsWanted && !document.fullscreenElement ? '<button class="btn btn-soft" id="exFsBtn"><i class="bi bi-arrows-fullscreen"></i> Masuk layar penuh lagi</button>' : ''}<button class="btn btn-ink" id="exOk">Saya mengerti, lanjutkan</button></div></div>`;
  $('#exOk').onclick = () => w.classList.add('d-none');
  const fb = $('#exFsBtn'); if (fb) fb.onclick = async () => { try { await document.documentElement.requestFullscreen(); Exam.fs = true; fb.remove(); } catch (e) { toast('Layar penuh tidak tersedia', '', 'info'); } };
}

function examTick() {
  const v = Exam.v; if (!v || Exam.done) return;
  const left = examLeft(), t = $('#exTimer'); if (!t) return;
  t.textContent = fmtClock(left); t.classList.toggle('low', left <= 60 && v.mode === 'total' || left <= 5);
  if (v.mode === 'per_soal') { const bar = $('#exBar'); if (bar) bar.style.width = Math.max(0, Math.min(100, left / v.durasi * 100)) + '%'; }
  if (left <= -1.2 && !Exam.syncing) examSync();
}
async function examSync() {
  Exam.syncing = true;
  try { const v = await api('exam.state', { attempt_id: Exam.v.attempt_id }); await examApply(v); } catch (e) { toastErr(e); }
  Exam.syncing = false;
}
async function examApply(v) {
  if (v.selesai || v.status !== 'berjalan') return examFinished(v.selesai ? v : { habis: v.status === 'habis' });
  Exam.offset = Date.parse(v.server_now) - Date.now(); Exam.v = Object.assign(Exam.v, v); drawExam();
}

function drawExam() {
  const v = Exam.v, body = $('#exBody'); if (!body) return;
  const info = $('#exInfo');
  if (v.tipe === 'teks') { info.textContent = 'Esai — waktu total'; return drawExamEssay(body); }
  if (v.mode === 'per_soal') { const s = v.soal[0]; info.textContent = `Soal ${s.nomor} dari ${v.jumlah_soal} — waktu per soal`; return drawExamPerSoal(body, s); }
  info.textContent = `${v.terjawab || 0} dari ${v.jumlah_soal} soal terjawab`;
  drawExamTotal(body);
}

function optionsHtml(s, onclick) {
  return s.opsi.map((o, j) => `<label class="option-tile ${s.jawab === j ? 'selected' : ''}" data-j="${j}"><input class="form-check-input mt-1" type="radio" name="exo" value="${j}" ${s.jawab === j ? 'checked' : ''}><span><b>${String.fromCharCode(65 + j)}.</b> ${qRich(o, Exam.assignmentId)}</span></label>`).join('');
}

function drawExamTotal(body) {
  const v = Exam.v, i = Math.min(Exam.idx, v.soal.length - 1), s = v.soal[i];
  body.innerHTML = `<div class="exam-grid"><nav class="exam-map" aria-label="Peta soal">${v.soal.map((q, j) => `<button class="q-dot ${j === i ? 'cur' : ''} ${q.jawab !== null ? 'ok' : ''}" onclick="examGo(${j})" aria-label="Soal ${j + 1}${q.jawab !== null ? ', terjawab' : ''}">${j + 1}</button>`).join('')}</nav>
    <section class="ss-card exam-q"><div class="small-ss text-secondary-ss mb-1">Soal ${i + 1} dari ${v.soal.length} · ${esc(s.poin)} poin</div>
      <div class="fs-6 mb-3">${qRich(s.pertanyaan, Exam.assignmentId)}</div><div id="exOpts">${optionsHtml(s)}</div>
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3 pt-3" style="border-top:1px solid var(--border)">
        <button class="btn btn-soft" onclick="examGo(${i - 1})" ${i === 0 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Sebelumnya</button>
        ${i < v.soal.length - 1 ? `<button class="btn btn-ink" onclick="examGo(${i + 1})">Berikutnya <i class="bi bi-chevron-right"></i></button>` : `<button class="btn btn-ink" id="exFinish"><i class="bi bi-flag"></i> Kumpulkan ujian</button>`}</div></section></div>`;
  $$('#exOpts .option-tile').forEach(el => el.onclick = () => examPick(s, Number(el.dataset.j)));
  const f = $('#exFinish'); if (f) f.onclick = () => examConfirmFinish();
}
function examGo(i) { if (i < 0 || i >= Exam.v.soal.length) return; Exam.idx = i; drawExamTotal($('#exBody')); }
async function examPick(s, j) {
  s.jawab = j; $$('#exOpts .option-tile').forEach(el => { el.classList.toggle('selected', Number(el.dataset.j) === j); el.querySelector('input').checked = Number(el.dataset.j) === j; });
  Exam.v.terjawab = Exam.v.soal.filter(q => q.jawab !== null).length; const info = $('#exInfo'); if (info && Exam.v.mode === 'total') info.textContent = `${Exam.v.terjawab} dari ${Exam.v.jumlah_soal} soal terjawab`;
  const dot = $(`.exam-map .q-dot:nth-child(${Exam.v.soal.indexOf(s) + 1})`); if (dot) dot.classList.add('ok');
  try { const r = await api('exam.answer', { attempt_id: Exam.v.attempt_id, question_id: s.question_id, jawaban: j }); if (r.selesai) examFinished({ habis: true }); }
  catch (e) { toast('Jawaban belum tersimpan', 'Periksa koneksi lalu pilih lagi.', 'warning'); }
}
function examConfirmFinish() {
  const v = Exam.v, belum = v.soal ? v.soal.filter(q => q.jawab === null).length : 0;
  const b = $('#exFinish'); if (!b) return;
  if (!Exam.finishArmed) { Exam.finishArmed = true; b.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${belum ? belum + ' soal belum dijawab. ' : ''}Klik lagi untuk kumpulkan`; setTimeout(() => { Exam.finishArmed = false; const bb = $('#exFinish'); if (bb) bb.innerHTML = '<i class="bi bi-flag"></i> Kumpulkan ujian'; }, 4000); return; }
  Exam.finishArmed = false; examSubmit();
}
async function examSubmit() {
  try {
    if (Exam.v.tipe === 'teks') await examSaveEssay(true);
    const r = await api('exam.finish', { attempt_id: Exam.v.attempt_id }); examFinished(r);
  } catch (e) { toastErr(e); }
}

function drawExamPerSoal(body, s) {
  const v = Exam.v;
  body.innerHTML = `<div class="exam-bar"><span id="exBar" style="width:100%"></span></div>
    <section class="ss-card exam-q" style="max-width:760px;margin:0 auto"><div class="small-ss text-secondary-ss mb-1">Soal ${s.nomor} dari ${v.jumlah_soal} · ${esc(s.poin)} poin · tidak bisa kembali ke soal sebelumnya</div>
      <div class="fs-5 mb-3">${qRich(s.pertanyaan, Exam.assignmentId)}</div><div id="exOpts">${optionsHtml(s)}</div>
      <div class="d-flex justify-content-end gap-2 mt-3 pt-3" style="border-top:1px solid var(--border)"><button class="btn btn-ink btn-lg" id="exNext">${s.nomor >= v.jumlah_soal ? '<i class="bi bi-flag"></i> Kunci & selesai' : 'Kunci jawaban & lanjut <i class="bi bi-chevron-right"></i>'}</button></div></section>`;
  $$('#exOpts .option-tile').forEach(el => el.onclick = () => examPick(s, Number(el.dataset.j)));
  $('#exNext').onclick = async e => { e.currentTarget.disabled = true; try { const r = await api('exam.next', { attempt_id: v.attempt_id }); await examApply(r.selesai ? r : r); } catch (err) { e.currentTarget.disabled = false; toastErr(err); } };
}

function drawExamEssay(body) {
  const v = Exam.v;
  body.innerHTML = `<section class="ss-card exam-q" style="max-width:860px;margin:0 auto"><div class="small-ss text-secondary-ss mb-2"><i class="bi bi-cloud-check"></i> <span id="exSaved">Tersimpan otomatis</span></div>
    <textarea class="form-control" id="exTeks" rows="16" placeholder="Tulis jawabanmu di sini…" ${v.pantau ? 'data-nopaste="1"' : ''}>${esc(v.teks || '')}</textarea>
    <div class="d-flex justify-content-between align-items-center mt-2"><span class="small-ss text-secondary-ss"><span id="exWc">0</span> kata${v.pantau ? ' · menempel (paste) dinonaktifkan' : ''}</span><button class="btn btn-ink" id="exFinish"><i class="bi bi-flag"></i> Kumpulkan ujian</button></div></section>`;
  const ta = $('#exTeks'), wc = () => { $('#exWc').textContent = (ta.value.match(/\S+/g) || []).length; }; wc();
  if (v.pantau) ta.addEventListener('paste', e => { e.preventDefault(); toast('Menempel dinonaktifkan', 'Ketik jawabanmu sendiri.', 'info'); });
  ta.oninput = () => { wc(); Exam.dirtyTeks = true; $('#exSaved').textContent = 'Menyimpan…'; clearTimeout(Exam.teksTimer); Exam.teksTimer = setTimeout(() => examSaveEssay(false), 6000); };
  ta.onblur = () => { if (Exam.dirtyTeks) examSaveEssay(false); };
  $('#exFinish').onclick = () => examConfirmFinish();
}
async function examSaveEssay(force) {
  const ta = $('#exTeks'); if (!ta || (!Exam.dirtyTeks && !force)) return;
  Exam.dirtyTeks = false;
  try { await api('exam.answer', { attempt_id: Exam.v.attempt_id, teks: ta.value }); const s = $('#exSaved'); if (s) s.textContent = 'Tersimpan otomatis ' + fmtTime(new Date().toISOString()); }
  catch (e) { Exam.dirtyTeks = true; const s = $('#exSaved'); if (s) s.textContent = 'Gagal menyimpan — periksa koneksi'; }
}

function examFinished(r) {
  Exam.done = true; Exam.timers.forEach(clearInterval); Exam.timers = []; window.onbeforeunload = null; clearTimeout(Exam.teksTimer);
  const body = $('#exBody'); if (!body) return;
  $('#exTimer').textContent = 'Selesai'; $('#exInfo').textContent = '';
  const nilai = r && r.nilai !== null && r.nilai !== undefined;
  body.innerHTML = `<div class="ss-card text-center" style="max-width:520px;margin:40px auto"><div class="result-badge" style="background:var(--ok-soft);color:var(--ok)"><i class="bi bi-check-lg"></i></div>
    <h2 class="h4">${r && r.habis ? 'Waktu habis — jawabanmu terkumpul' : 'Ujian dikumpulkan'}</h2>
    <p class="text-secondary-ss">${nilai ? `Nilaimu: <b class="fs-4">${esc(r.nilai)}</b> / ${esc(r.nilai_maks)}` : 'Jawabanmu sudah tersimpan. Nilai akan muncul setelah dosen memeriksa.'}</p>
    <button class="btn btn-ink" id="exClose">Tutup</button></div>`;
  $('#exClose').onclick = () => { closeExamOverlay(false); SWR.clear(); refreshPage(); };
}

/** Catatan ujian untuk dosen di modal penilaian. */
function examLogHtml(u) {
  const x = u.ujian, TIPE = { keluar_tab: 'Pindah tab / aplikasi', keluar_layar_penuh: 'Keluar layar penuh', jendela_tidak_fokus: 'Jendela tidak fokus' };
  const dur = x.mulai && x.selesai ? Math.max(0, Math.round((Date.parse(x.selesai) - Date.parse(x.mulai)) / 1000)) : null;
  return `<div class="ss-card ss-card-tight mb-3" style="background:var(--surface-2)"><div class="d-flex flex-wrap align-items-center gap-2 mb-1"><b class="small-ss"><i class="bi bi-stopwatch"></i> Catatan ujian berwaktu</b>
      ${x.jumlah_keluar ? badge(x.jumlah_keluar + '× keluar halaman', 'b-warn', 'bi-exclamation-triangle') : badge('Tidak ada pelanggaran tercatat', 'b-ok', 'bi-check')}</div>
    <div class="small-ss text-secondary-ss">Status: ${esc(x.status === 'habis' ? 'terkumpul otomatis (waktu habis)' : x.status)}${dur !== null ? ' · lama mengerjakan ' + esc(fmtDur(dur)) : ''}${x.detik_keluar ? ' · total di luar halaman ' + esc(fmtDur(x.detik_keluar)) : ''}</div>
    ${x.kejadian.length ? `<ul class="small-ss mb-1 mt-1 ps-3">${x.kejadian.map(k => `<li>${esc(fmtTime(k.t))} — ${esc(TIPE[k.tipe] || k.tipe)}${k.detik ? ', ' + k.detik + ' detik' : ''}</li>`).join('')}</ul><div class="form-text">Pencatatan hanyalah petunjuk, bukan bukti. Notifikasi atau telepon masuk di HP juga bisa tercatat.</div>` : ''}
    <button type="button" class="btn btn-ghost btn-sm mt-1" id="exReset" onclick="examResetArm('${esc(x.attempt_id)}')"><i class="bi bi-arrow-counterclockwise"></i> Izinkan mengulang</button></div>`;
}
let _resetArmed = false;
async function examResetArm(attemptId) {
  const b = $('#exReset'); if (!b) return;
  if (!_resetArmed) { _resetArmed = true; b.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Klik lagi: hapus jawaban & nilai lalu izinkan mengulang'; setTimeout(() => { _resetArmed = false; const bb = $('#exReset'); if (bb) bb.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i> Izinkan mengulang'; }, 4000); return; }
  _resetArmed = false;
  try { await api('exam.reset', { attempt_id: attemptId }); toast('Ujian direset', 'Mahasiswa dapat mengerjakan ulang.', 'success'); closeModal(); loadGrading(); } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 32: SESI KELAS INTERAKTIF (pendamping Google Meet)
// Mahasiswa membuka halaman ini sambil mengikuti Meet: kehadiran & durasi, angkat tangan, tanya jawab, kuis cepat, poin.
// ════════════════════════════════════════════════════════

const Live = { id: null, d: null, timer: null, tick: null, pollEnd: 0, sig: {}, busy: false, anon: false };
function stopLive() { clearInterval(Live.timer); clearInterval(Live.tick); Live.timer = Live.tick = null; Live.d = null; Live.sig = {}; }
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h} j ${String(m).padStart(2, '0')} mnt` : m ? `${m} mnt${s && m < 10 ? ' ' + s + ' dtk' : ''}` : `${s} dtk`;
}
/** Render sebuah bagian hanya bila isinya berubah (agar isian/fokus tidak hilang saat polling). */
function livePart(sel, key, html) {
  const el = $(sel); if (!el) return;
  const sig = typeof key === 'string' ? key : JSON.stringify(key);
  if (Live.sig[sel] === sig) return; Live.sig[sel] = sig; el.innerHTML = html;
  if (sel === '#lvPollBox') liveBindPollForm();
}

// ── Tab "Sesi kelas" di detail kelas ──
async function renderSesiTab(body, d) {
  const staff = d.access.perms.includes('absensi'), cid = d.cls.class_id, ro = d.access.archived;
  body.innerHTML = loadingBlock();
  const [list, active, meetings] = await Promise.all([api('live.list', { class_id: cid }), api('live.active'), staff && !ro ? ensureMeetings(cid) : Promise.resolve([])]);
  const act = active.find(x => x.class_id === cid);
  const today = new Date().toISOString().slice(0, 10), defM = (meetings.find(m => m.tanggal >= today) || meetings[0] || {}).meeting_id;
  const w = d.weights || [];
  body.innerHTML = `
    <div class="row g-3 mb-3"><div class="col-lg-${staff && !act ? 6 : 12}">
      ${act ? `<div class="ss-card highlight-card h-100"><h3 class="mb-1"><span class="live-dot"></span>Sesi kelas berlangsung</h3>
          <p class="small-ss mb-3">${esc(act.pertemuan)} — dibuka ${esc(fmtTime(act.waktu_buka))}</p>
          <div class="d-flex flex-wrap gap-2"><button class="btn btn-ink" onclick="navigateTo('sesi-live',{live_id:'${act.live_id}'})"><i class="bi bi-${staff ? 'sliders' : 'box-arrow-in-right'}"></i> ${staff ? 'Masuk ruang kontrol' : 'Gabung sesi kelas'}</button>
            ${act.link_meet ? `<a class="btn btn-soft" href="${esc(act.link_meet)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-camera-video"></i> Buka Meet</a>` : ''}</div>
          ${staff ? '' : '<p class="small-ss text-secondary-ss mt-3 mb-0">Tetap ikuti Meet di perangkat utama; buka halaman sesi ini di HP/jendela lain agar kehadiran, tanya jawab, dan kuis tercatat.</p>'}</div>`
        : staff ? (ro ? `<div class="ss-card h-100"><p class="small-ss text-secondary-ss mb-0">Kelas diarsipkan.</p></div>` : '') : `<div class="ss-card h-100"><div class="card-head"><h2>Sesi kelas</h2></div>
          <p class="small-ss text-secondary-ss mb-0">Belum ada sesi kelas yang berlangsung. Saat dosen memulai sesi, kamu akan mendapat notifikasi di sini.</p></div>`}
    </div>
    ${staff && !act && !ro ? `<div class="col-lg-6"><div class="ss-card h-100"><div class="card-head"><h2>Mulai sesi kelas</h2></div>
      ${meetings.length ? `<form id="lvStart" class="row g-2" novalidate>
        <div class="col-12"><label class="form-label" for="lvMeet">Pertemuan</label><select class="form-select" id="lvMeet">${meetings.map(m => `<option value="${m.meeting_id}" ${m.meeting_id === defM ? 'selected' : ''}>${esc(m.judul)}${m.tanggal ? ' — ' + esc(fmtDate(m.tanggal)) : ''}</option>`).join('')}</select></div>
        <div class="col-12"><details><summary class="small-ss fw-600" style="cursor:pointer">Pengaturan poin &amp; kehadiran</summary>
          <div class="row g-2 mt-1">
            <div class="col-6"><label class="form-label small-ss" for="lvKonf">Konfirmasi "masih di sini" (menit)</label><input class="form-control form-control-sm" id="lvKonf" type="number" min="0" max="60" value="15"><div class="form-text">0 = mati. Minimal 5.</div></div>
            <div class="col-6"><label class="form-label small-ss" for="lvMax">Poin untuk skor 100</label><input class="form-control form-control-sm" id="lvMax" type="number" min="1" max="100" value="10"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvPT">Poin per angkat tangan</label><input class="form-control form-control-sm" id="lvPT" type="number" min="0" max="10" step="0.5" value="1"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvMT">Maks. angkat tangan dihitung</label><input class="form-control form-control-sm" id="lvMT" type="number" min="0" max="20" value="3"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvPQ">Poin per pertanyaan</label><input class="form-control form-control-sm" id="lvPQ" type="number" min="0" max="10" step="0.5" value="1"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvMQ">Maks. pertanyaan dihitung</label><input class="form-control form-control-sm" id="lvMQ" type="number" min="0" max="20" value="3"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvKB">Poin kuis benar</label><input class="form-control form-control-sm" id="lvKB" type="number" min="0" max="10" step="0.5" value="2"></div>
            <div class="col-6"><label class="form-label small-ss" for="lvKC">Bonus jawab cepat</label><input class="form-control form-control-sm" id="lvKC" type="number" min="0" max="10" step="0.5" value="1"><div class="form-text">Benar dalam 40% pertama waktu kuis.</div></div>
            <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="lvHadir" checked><label class="form-check-label" for="lvHadir">Catat kehadiran dari durasi di sesi (≥ <input id="lvMinP" type="number" min="10" max="100" value="60" style="width:56px" class="form-control form-control-sm d-inline-block"> % waktu sesi)</label></div></div>
            <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="lvNilai"><label class="form-check-label" for="lvNilai">Hitung skor partisipasi ke nilai</label></div>
              <select class="form-select form-select-sm mt-1 d-none" id="lvKomp" aria-label="Komponen nilai">${w.map(x => `<option value="${esc(x.komponen)}">${esc(x.label)} (${x.bobot_persen}%)</option>`).join('')}</select>
              <div class="form-text">Skor 0–100 tiap sesi dirata-ratakan dengan sumber lain di komponen itu. Tetap bisa dikoreksi di tab Nilai.</div></div>
          </div></details></div>
        <div class="col-12"><button class="btn btn-ink w-100" type="submit" data-loading="Memulai…"><i class="bi bi-play-circle"></i> Mulai sesi kelas</button></div></form>`
        : `<p class="small-ss text-secondary-ss mb-0">Tambahkan pertemuan di Timeline terlebih dahulu.</p>`}</div></div>` : ''}</div>
    <div class="card-head"><h2 class="section-title">Riwayat sesi</h2></div>
    ${list.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th>Pertemuan</th><th>Waktu</th>${staff ? '<th>Hadir</th>' : '<th>Durasi</th><th>Skor</th>'}<th>Status</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr><td class="fw-600">${esc(s.pertemuan)}</td><td class="small-ss">${esc(fmtDateTime(s.waktu_buka))}</td>
        ${staff ? `<td class="tabular">${s.hadir_n}</td>` : `<td class="tabular">${s.saya ? esc(fmtDur(s.saya.durasi)) : '–'}</td><td class="tabular">${s.saya ? fmtScore(s.saya.skor) : '–'}${s.hitung_nilai ? ' <i class="bi bi-calculator text-muted-ss" title="Dihitung ke nilai ' + esc(s.komponen_nama) + '"></i>' : ''}</td>`}
        <td>${s.status === 'berlangsung' ? badge('Berlangsung', 'b-ok') : badge('Selesai', 'b-muted')}</td>
        <td class="text-end">${staff ? `<button class="btn btn-soft btn-sm" onclick="openLiveReport('${s.live_id}')">Laporan</button>` : s.saya ? `<button class="btn btn-ghost btn-sm" onclick="openLiveMine('${s.live_id}')">Hasil saya</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Belum ada sesi kelas', staff ? 'Mulai sesi kelas saat kuliah daring/luring berlangsung. Mahasiswa membukanya sambil mengikuti Meet.' : 'Riwayat partisipasimu muncul setelah dosen mengadakan sesi kelas.')}`;
  window.__liveList = list;
  const f = $('#lvStart'); if (!f) return;
  $('#lvNilai').onchange = e => $('#lvKomp').classList.toggle('d-none', !e.target.checked);
  f.onsubmit = async e => {
    e.preventDefault();
    await withBtn(f.querySelector('button[type=submit]'), async () => {
      try {
        const pengaturan = { konfirmasi_menit: $('#lvKonf').value, poin_maks: $('#lvMax').value, poin_tangan: $('#lvPT').value, maks_tangan: $('#lvMT').value, poin_tanya: $('#lvPQ').value, maks_tanya: $('#lvMQ').value, poin_kuis_benar: $('#lvKB').value, poin_kuis_cepat: $('#lvKC').value,
          catat_hadir: $('#lvHadir').checked, min_persen: $('#lvMinP').value, hitung_nilai: $('#lvNilai').checked, komponen_nilai: $('#lvKomp').value };
        const r = await api('live.start', { class_id: cid, meeting_id: $('#lvMeet').value, pengaturan });
        toast('Sesi kelas dimulai', 'Mahasiswa mendapat notifikasi.', 'success');
        navigateTo('sesi-live', { live_id: r.live_id });
      } catch (err) { toastErr(err); }
    });
  };
}

function openLiveMine(liveId) {
  const s = (window.__liveList || []).find(x => x.live_id === liveId); if (!s || !s.saya) return;
  const m = s.saya;
  openModal({ title: 'Hasil saya — ' + s.pertemuan, body: `<div class="row g-2 text-center">
    ${[['Durasi', fmtDur(m.durasi)], ['% sesi', m.persen + '%'], ['Angkat tangan', m.tangan_n], ['Pertanyaan', m.tanya_n], ['Kuis benar', m.kuis_benar + '/' + m.kuis_total], ['Poin', fmtScore(m.poin_total)]].map(([l, v]) => `<div class="col-4"><div class="kpi-value" style="font-size:1.3rem">${esc(String(v))}</div><div class="small-ss text-secondary-ss">${l}</div></div>`).join('')}</div>
    <p class="mt-3 mb-0">Skor partisipasi sesi ini: <b>${fmtScore(m.skor)}</b> / 100</p>` });
}

// ── Halaman sesi (ruang kontrol dosen & halaman peserta mahasiswa) ──
async function renderSesiLive(params, c) {
  stopLive(); AppState.cleanups.push(stopLive);
  Live.id = params.live_id;
  c.innerHTML = loadingBlock('Memuat sesi kelas…');
  try { Live.d = await api('live.state', { live_id: Live.id }); } catch (e) { c.innerHTML = errorBlock(e, `navigateTo('sesi-live',{live_id:'${params.live_id}'})`); return; }
  const staff = Live.d.role === 'staf';
  c.innerHTML = staff ? liveStaffShell() : liveStudentShell();
  liveDraw();
  if (Live.d.live.status === 'berlangsung') {
    Live.timer = setInterval(livePoll, (Live.d.polling_detik || 8) * 1000);
    Live.tick = setInterval(liveTick, 500);
    document.addEventListener('visibilitychange', liveVisible);
    AppState.cleanups.push(() => document.removeEventListener('visibilitychange', liveVisible));
  }
}
function liveVisible() { if (!document.hidden) livePoll(); }
async function livePoll() {
  if (Live.busy || !Live.id || AppState.page !== 'sesi-live') return;
  Live.busy = true;
  try {
    Live.d = await api('live.state', { live_id: Live.id });
    liveDraw();
    if (Live.d.live.status !== 'berlangsung') { stopLive0(); toast('Sesi kelas selesai', '', 'info'); }
  } catch (e) { /* jaringan putus sesaat: coba lagi di putaran berikut */ }
  Live.busy = false;
}
function stopLive0() { clearInterval(Live.timer); clearInterval(Live.tick); Live.timer = Live.tick = null; }
function liveTick() {
  const d = Live.d; if (!d) return;
  const el = $('#lvCount');
  if (el && Live.pollEnd) {
    const left = Math.max(0, Math.ceil((Live.pollEnd - Date.now()) / 1000));
    el.textContent = left + ' dtk'; const bar = $('#lvBar'); if (bar) bar.style.width = Math.min(100, left / (d.poll.durasi || 30) * 100) + '%';
    if (left === 0 && d.poll && d.poll.aktif) { Live.pollEnd = 0; livePoll(); }
  }
  const up = $('#lvElapsed'); if (up) up.textContent = fmtDur((Date.now() - Date.parse(d.live.waktu_buka) - (Live.skew || 0)) / 1000);
}
function liveDraw() {
  const d = Live.d; if (!d) return;
  Live.skew = Date.now() - Date.parse(d.server_now);        // selisih jam perangkat dengan server
  Live.pollEnd = d.poll && d.poll.aktif ? Date.now() + d.poll.sisa * 1000 : 0;
  d.role === 'staf' ? liveDrawStaff() : liveDrawStudent();
}

// ── Mahasiswa ──
function liveStudentShell() {
  const d = Live.d, l = d.live;
  return `<div class="mx-auto" style="max-width:760px">
    <div class="page-head"><div><h1>${esc(l.nama_kelas)}</h1><p>${esc(l.pertemuan)}</p></div>
      ${l.link_meet ? `<a class="btn btn-soft btn-sm" href="${esc(l.link_meet)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-camera-video"></i> Buka Meet</a>` : ''}</div>
    <div id="lvConfirm"></div><div id="lvHead"></div>
    <div id="lvPoll"></div>
    <div class="ss-card mb-3"><div class="card-head"><h2>Angkat tangan</h2></div><div id="lvHand"></div></div>
    <div class="ss-card mb-3"><div class="card-head"><h2>Tanya jawab</h2></div>
      <form id="lvAsk" class="mb-3" novalidate><textarea class="form-control mb-2" id="lvAskT" rows="2" maxlength="300" placeholder="Tulis pertanyaanmu untuk dosen…" aria-label="Pertanyaan"></textarea>
        <div class="d-flex flex-wrap align-items-center gap-2"><div class="form-check mb-0"><input class="form-check-input" type="checkbox" id="lvAnon"><label class="form-check-label small-ss" for="lvAnon">Kirim tanpa nama</label></div>
          <button class="btn btn-ink btn-sm ms-auto" type="submit" ${l.status !== 'berlangsung' ? 'disabled' : ''}><i class="bi bi-send"></i> Kirim</button></div></form>
      <div id="lvQ"></div></div></div>`;
}
function liveDrawStudent() {
  const d = Live.d, s = d.saya, run = d.live.status === 'berlangsung';
  livePart('#lvConfirm', [s.perlu_konfirmasi, run], run && s.perlu_konfirmasi ? `<div class="ss-card highlight-card mb-3 d-flex flex-wrap align-items-center gap-3"><div class="flex-grow-1"><b>Masih mengikuti kelas?</b><div class="small-ss">Ketuk untuk mengonfirmasi kehadiranmu.</div></div><button class="btn btn-ink" onclick="liveConfirm(this)">Saya masih di sini</button></div>` : '');
  livePart('#lvHead', [Math.floor(s.durasi / 30), s.poin_total, s.keluar_n, run], `<div class="row g-2 mb-3">
    ${[['Waktu di sesi', fmtDur(s.durasi || 0), 'bi-clock'], ['Poin saya', fmtScore(s.poin_total || 0), 'bi-star'], ['Skor sesi', fmtScore(s.skor || 0), 'bi-graph-up']].map(([l, v, i]) => `<div class="col-4"><div class="ss-card ss-card-tight text-center"><div class="small-ss text-secondary-ss"><i class="bi ${i}"></i> ${l}</div><div class="kpi-value" style="font-size:1.3rem;margin:0">${esc(String(v))}</div></div></div>`).join('')}</div>
    ${run ? '' : '<div class="answer-box small-ss mb-3" style="white-space:normal"><i class="bi bi-check-circle"></i> Sesi kelas ini sudah selesai.</div>'}`);
  livePart('#lvHand', [d.tangan_naik, d.antrean, run], run ? (d.tangan_naik
    ? `<div class="d-flex align-items-center gap-3 flex-wrap"><span class="badge-ss b-accent" style="font-size:1rem">✋ Tanganmu terangkat — antrean ke-${d.antrean}</span><button class="btn btn-soft" onclick="liveHand('turun')">Turunkan</button></div>`
    : `<button class="btn btn-ink btn-lg" onclick="liveHand('naik')">✋ Angkat tangan</button><span class="small-ss text-secondary-ss ms-2">Dosen melihat urutanmu.</span>`) : '<span class="small-ss text-muted-ss">Sesi selesai.</span>');
  livePart('#lvQ', d.tanya, d.tanya.length ? d.tanya.map(q => `<div class="q-item ${q.status === 'dijawab' ? 'done' : ''}"><div class="flex-grow-1"><div class="small-ss text-secondary-ss">${esc(q.nama)}${q.milik_saya ? ' (kamu)' : ''}${q.status === 'dijawab' ? ' · ' + 'dijawab' : ''}</div><div>${esc(q.teks)}</div></div>
      ${q.milik_saya || !run ? `<span class="small-ss tabular text-secondary-ss"><i class="bi bi-hand-thumbs-up"></i> ${q.dukung_n}</span>` : `<button class="btn btn-sm ${q.saya_dukung ? 'btn-ink' : 'btn-soft'}" onclick="liveVote('${q.event_id}')" aria-label="Dukung pertanyaan" aria-pressed="${q.saya_dukung}"><i class="bi bi-hand-thumbs-up"></i> ${q.dukung_n}</button>`}</div>`).join('')
    : '<p class="small-ss text-muted-ss mb-0">Belum ada pertanyaan. Jadilah yang pertama bertanya.</p>');
  livePart('#lvPoll', [d.poll && [d.poll.poll_id, d.poll.aktif, d.poll.sudah_jawab, d.poll.sebaran, d.poll.kunci, d.poll.benar_saya]], d.poll ? livePollStudentHtml(d.poll) : '');
  const sb = $('#lvAsk button[type=submit]'), ta = $('#lvAskT'); if (sb) sb.disabled = !run; if (ta) ta.disabled = !run;       // kunci otomatis saat sesi selesai
  const f = $('#lvAsk'); if (f && !f.dataset.bound) {
    f.dataset.bound = '1';
    f.onsubmit = async e => { e.preventDefault(); const t = $('#lvAskT').value.trim(); if (t.length < 3) return toast('Pertanyaan terlalu pendek', '', 'warning');
      // optimistis: pertanyaan langsung muncul di daftar dan kolom langsung kosong; server menyusul
      const anon = $('#lvAnon').checked, tmp = 'tmp' + Date.now();
      Live.d.tanya.push({ event_id: tmp, teks: t, nama: anon ? 'Anonim' : AppState.user.nama_lengkap, milik_saya: true, dukung_n: 0, saya_dukung: false, status: 'baru' });
      $('#lvAskT').value = ''; liveDraw();
      try { await api('live.ask', { live_id: Live.id, teks: t, anonim: anon }); toast('Pertanyaan terkirim', '', 'success'); }
      catch (err) { toastErr(err); $('#lvAskT').value = t; Live.d.tanya = Live.d.tanya.filter(x => x.event_id !== tmp); liveDraw(); return; }
      livePoll(); };
  }
}
function livePollStudentHtml(p) {
  if (p.aktif) {
    return `<div class="ss-card highlight-card mb-3"><div class="d-flex justify-content-between align-items-center mb-1"><b><i class="bi bi-lightning-charge"></i> Kuis cepat</b><span class="badge-ss b-warn tabular" id="lvCount">${p.sisa} dtk</span></div>
      <div class="score-bar mb-2" aria-hidden="true"><span id="lvBar" style="width:${Math.min(100, p.sisa / p.durasi * 100)}%"></span></div>
      <div class="fs-6 mb-3">${esc(p.pertanyaan)}</div>
      ${p.sudah_jawab ? `<div class="answer-box" style="white-space:normal"><i class="bi bi-check2-circle"></i> Jawabanmu terkirim. Tunggu waktu habis untuk melihat kunci.</div>`
        : p.tipe === 'pg' ? p.opsi.map((o, j) => `<button class="option-tile w-100 text-start mb-2" onclick="livePollAnswer('${p.poll_id}', ${j}, this)"><b>${String.fromCharCode(65 + j)}.</b> ${esc(o)}</button>`).join('')
        : `<form onsubmit="event.preventDefault();livePollAnswer('${p.poll_id}', this.jw.value, this)" class="d-flex gap-2"><input class="form-control" name="jw" maxlength="200" required autocomplete="off" placeholder="Ketik jawaban singkat"><button class="btn btn-ink" type="submit">Kirim</button></form>`}</div>`;
  }
  const kunciTxt = p.tipe === 'pg' ? `${String.fromCharCode(65 + p.kunci)}. ${esc(p.opsi[p.kunci] || '')}` : esc((p.kunci || []).join(' / '));
  const total = (p.sebaran || []).reduce((s, v) => s + v, 0) || 1;
  return `<div class="ss-card mb-3"><div class="d-flex justify-content-between mb-1"><b><i class="bi bi-lightning-charge"></i> Kuis cepat — selesai</b>${p.sudah_jawab ? (p.benar_saya ? badge('Benar', 'b-ok', 'bi-check-lg') : badge('Kurang tepat', 'b-bad', 'bi-x-lg')) : badge('Tidak dijawab', 'b-muted')}</div>
    <div class="mb-2">${esc(p.pertanyaan)}</div><div class="small-ss mb-2">Kunci: <b>${kunciTxt}</b> · ${p.benar_n} dari ${p.jawaban_n} menjawab benar</div>
    ${p.tipe === 'pg' ? p.opsi.map((o, j) => `<div class="poll-row"><span class="small-ss">${String.fromCharCode(65 + j)}</span><div class="poll-bar ${j === p.kunci ? 'key' : ''}"><span style="width:${Math.round((p.sebaran[j] || 0) / total * 100)}%"></span></div><span class="small-ss tabular">${p.sebaran[j] || 0}</span></div>`).join('') : ''}</div>`;
}
async function liveConfirm() {
  if (Live.d && Live.d.saya) { Live.d.saya.perlu_konfirmasi = false; liveDraw(); }                 // optimistis: spanduk langsung hilang
  try { await api('live.confirm', { live_id: Live.id }); } catch (e) { toastErr(e); }
  livePoll();
}
async function liveHand(aksi) {
  const d = Live.d;
  if (d) { d.tangan_naik = aksi === 'naik'; d.antrean = aksi === 'naik' ? Math.max(1, d.antrean || 1) : 0; liveDraw(); }   // optimistis
  try { await api('live.hand', { live_id: Live.id, aksi }); } catch (e) { toastErr(e); }
  livePoll();
}
async function liveVote(id) {
  const q = Live.d && Live.d.tanya.find(x => x.event_id === id);
  if (q) { q.saya_dukung = !q.saya_dukung; q.dukung_n += q.saya_dukung ? 1 : -1; liveDraw(); }                           // optimistis
  try { await api('live.vote', { live_id: Live.id, event_id: id }); } catch (e) { toastErr(e); }
  livePoll();
}
async function livePollAnswer(pollId, jawaban, el) {
  const p = Live.d && Live.d.poll;
  if (p && p.poll_id === pollId) { p.sudah_jawab = true; p.jawaban_saya = jawaban; liveDraw(); }                          // optimistis: "terkirim" seketika
  if (navigator.vibrate) navigator.vibrate(40);
  try { await api('live.pollAnswer', { live_id: Live.id, poll_id: pollId, jawaban }); } catch (e) { toastErr(e); }
  livePoll();                                                                                                              // bila gagal, keadaan sebenarnya dikembalikan
}

// ── Dosen: ruang kontrol ──
function liveStaffShell() {
  const l = Live.d.live;
  return `<div class="page-head"><div><h1>${esc(l.nama_kelas)}</h1><p>${esc(l.pertemuan)} — dibuka ${esc(fmtTime(l.waktu_buka))}${l.status === 'berlangsung' ? ` · berjalan <b id="lvElapsed">–</b>` : ' · selesai'}</p></div>
    <div class="d-flex flex-wrap gap-2">${l.link_meet ? `<a class="btn btn-soft btn-sm" href="${esc(l.link_meet)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-camera-video"></i> Buka Meet</a>` : ''}
      <button class="btn btn-soft btn-sm" onclick="openLiveReport('${l.live_id}')"><i class="bi bi-table"></i> Laporan</button>
      ${l.status === 'berlangsung' ? `<button class="btn btn-danger-soft btn-sm" onclick="liveCloseDialog()"><i class="bi bi-stop-circle"></i> Selesaikan sesi</button>` : ''}</div></div>
    <div id="lvTiles" class="row g-2 mb-3"></div>
    <div class="row g-3"><div class="col-lg-4"><div class="ss-card mb-3"><div class="card-head"><h2>✋ Angkat tangan</h2></div><div id="lvHands"></div></div>
        <div class="ss-card"><div class="card-head"><h2>Pertanyaan</h2></div><div id="lvQs"></div></div></div>
      <div class="col-lg-4"><div class="ss-card"><div class="card-head"><h2>⚡ Kuis cepat</h2></div><div id="lvPollBox"></div></div></div>
      <div class="col-lg-4"><div class="ss-card"><div class="card-head"><h2>Kehadiran</h2></div><div id="lvPeople"></div></div></div></div>`;
}
function liveDrawStaff() {
  const d = Live.d, run = d.live.status === 'berlangsung';
  livePart('#lvTiles', [d.online_n, d.hadir.length, d.total_mhs, d.tangan.length, d.tanya.length], [['Online', d.online_n, 'bi-wifi'], ['Pernah masuk', d.hadir.length + '/' + d.total_mhs, 'bi-people'], ['Tangan terangkat', d.tangan.length, 'bi-hand-index'], ['Pertanyaan', d.tanya.length, 'bi-chat-dots']]
    .map(([l, v, i]) => `<div class="col-6 col-md-3"><div class="ss-card ss-card-tight text-center"><div class="small-ss text-secondary-ss"><i class="bi ${i}"></i> ${l}</div><div class="kpi-value" style="font-size:1.4rem;margin:0">${esc(String(v))}</div></div></div>`).join(''));
  livePart('#lvHands', d.tangan, d.tangan.length ? d.tangan.map((h, i) => `<div class="q-item"><span class="badge-ss b-accent">${i + 1}</span><div class="flex-grow-1 fw-600">${esc(h.nama)}<div class="small-ss text-secondary-ss fw-normal">${esc(fmtTime(h.waktu))}</div></div>
      <button class="btn btn-soft btn-sm" onclick="liveStaffDo('live.handServe',{event_id:'${h.event_id}'})">Layani</button></div>`).join('') : '<p class="small-ss text-muted-ss mb-0">Tidak ada tangan terangkat.</p>');
  livePart('#lvQs', d.tanya, d.tanya.length ? d.tanya.slice().sort((a, b) => (a.status === 'dijawab') - (b.status === 'dijawab') || b.dukung_n - a.dukung_n).map(q => `<div class="q-item ${q.status === 'dijawab' ? 'done' : ''} ${q.status === 'abaikan' ? 'muted' : ''}"><div class="flex-grow-1"><div class="small-ss text-secondary-ss">${esc(q.nama)}${q.anonim ? ' · anonim bagi mahasiswa' : ''} · <i class="bi bi-hand-thumbs-up"></i> ${q.dukung_n}</div><div>${esc(q.teks)}</div></div>
      <div class="d-flex flex-column gap-1">${q.status !== 'dijawab' ? `<button class="btn btn-soft btn-sm" onclick="liveStaffDo('live.qStatus',{event_id:'${q.event_id}',status:'dijawab'})">Dijawab</button>` : `<button class="btn btn-ghost btn-sm" onclick="liveStaffDo('live.qStatus',{event_id:'${q.event_id}',status:'baru'})">Buka lagi</button>`}
        ${q.status === 'baru' ? `<button class="btn btn-ghost btn-sm" onclick="liveStaffDo('live.qStatus',{event_id:'${q.event_id}',status:'abaikan'})">Sembunyikan</button>` : ''}</div></div>`).join('') : '<p class="small-ss text-muted-ss mb-0">Belum ada pertanyaan.</p>');
  const p = d.poll;
  livePart('#lvPollBox', [p && [p.poll_id, p.aktif, p.jawaban_n, p.sebaran, p.benar_n], run], liveStaffPollHtml(p, run));
  livePart('#lvPeople', d.hadir.map(h => [h.user_id, h.online, Math.floor(h.durasi / 30), h.keluar_n, h.poin_total, h.tangan_n, h.tanya_n]), d.hadir.length ? `<div class="people-list">${d.hadir.map(h => `<div class="q-item"><span class="dot ${h.online ? 'on' : ''}" title="${h.online ? 'Online' : 'Tidak aktif'}"></span>
      <div class="flex-grow-1 min-w-0"><div class="fw-600 text-truncate">${esc(h.nama)}</div><div class="small-ss text-secondary-ss">${esc(fmtDur(h.durasi))}${h.keluar_n ? ' · terputus ' + h.keluar_n + '×' : ''}${h.konf_lewat ? ' · lewat konfirmasi ' + h.konf_lewat + '×' : ''} · ${fmtScore(h.poin_total)} poin</div></div>
      ${run ? `<div class="d-flex gap-1"><button class="btn btn-soft btn-sm" onclick="livePoint('${h.user_id}',1)" aria-label="Beri 1 poin ${esc(h.nama)}">+1</button><button class="btn btn-soft btn-sm" onclick="livePoint('${h.user_id}',2)" aria-label="Beri 2 poin ${esc(h.nama)}">+2</button></div>` : ''}</div>`).join('')}</div>`
    : '<p class="small-ss text-muted-ss mb-0">Belum ada mahasiswa yang membuka halaman sesi.</p>');
}
function liveStaffPollHtml(p, run) {
  const composer = !run ? '' : `<form id="lvPollForm" class="mt-2" novalidate>
      <label class="form-label small-ss" for="lvpQ">Pertanyaan kuis baru</label><textarea class="form-control mb-2" id="lvpQ" rows="2" maxlength="300" placeholder="mis. Proses menghilangkan redundansi data disebut…"></textarea>
      <div class="seg mb-2" role="radiogroup" aria-label="Tipe kuis"><button type="button" class="active" data-t="pg">Pilihan ganda</button><button type="button" data-t="isian">Isian singkat</button></div>
      <div id="lvpPg">${[0, 1, 2, 3].map(j => `<div class="d-flex align-items-center gap-2 mb-1"><input class="form-check-input mt-0" type="radio" name="lvpK" value="${j}" ${j === 0 ? 'checked' : ''} aria-label="Kunci opsi ${String.fromCharCode(65 + j)}"><span class="small-ss fw-600" style="width:14px">${String.fromCharCode(65 + j)}</span><input class="form-control form-control-sm lvp-o" maxlength="150" placeholder="Opsi ${String.fromCharCode(65 + j)}${j > 1 ? ' (opsional)' : ''}"></div>`).join('')}<div class="form-text mb-2">Pilih bulatan sebagai kunci jawaban.</div></div>
      <div id="lvpIs" class="d-none mb-2"><input class="form-control form-control-sm" id="lvpKey" maxlength="200" placeholder="Jawaban benar (pisahkan dengan | bila beberapa)"></div>
      <div class="d-flex gap-2 align-items-center"><label class="small-ss mb-0" for="lvpDur">Waktu</label><select class="form-select form-select-sm" id="lvpDur" style="width:auto">${[[20, '20 dtk'], [30, '30 dtk'], [60, '1 menit'], [120, '2 menit']].map(([v, l]) => `<option value="${v}" ${v === 30 ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn btn-ink btn-sm ms-auto" type="submit"><i class="bi bi-lightning-charge"></i> Luncurkan</button></div></form>`;
  if (!p) return composer || '<p class="small-ss text-muted-ss mb-0">Belum ada kuis.</p>';
  const total = (p.sebaran || []).reduce((s, v) => s + v, 0) || 1;
  const kunciTxt = p.tipe === 'pg' ? `${String.fromCharCode(65 + p.kunci)}. ${esc(p.opsi[p.kunci] || '')}` : esc((p.kunci || []).join(' / '));
  return `<div class="${p.aktif ? 'poll-live' : ''}"><div class="d-flex justify-content-between align-items-center mb-1">${p.aktif ? `<span class="badge-ss b-ok"><span class="live-dot"></span>Berlangsung</span><span class="badge-ss b-warn tabular" id="lvCount">${p.sisa} dtk</span>` : badge('Selesai', 'b-muted')}</div>
    ${p.aktif ? `<div class="score-bar mb-2" aria-hidden="true"><span id="lvBar" style="width:${Math.min(100, p.sisa / p.durasi * 100)}%"></span></div>` : ''}
    <div class="mb-2 fw-600">${esc(p.pertanyaan)}</div>
    ${p.tipe === 'pg' ? p.opsi.map((o, j) => `<div class="poll-row"><span class="small-ss">${String.fromCharCode(65 + j)}</span><div class="poll-bar ${j === p.kunci ? 'key' : ''}"><span style="width:${Math.round((p.sebaran[j] || 0) / total * 100)}%"></span></div><span class="small-ss tabular">${p.sebaran[j] || 0}</span></div>`).join('') : ''}
    <div class="small-ss text-secondary-ss mt-2">${p.jawaban_n} menjawab · ${p.benar_n} benar · kunci: <b>${kunciTxt}</b></div>
    ${p.aktif ? `<button class="btn btn-danger-soft btn-sm mt-2" onclick="liveStaffDo('live.pollEnd',{poll_id:'${p.poll_id}'})">Akhiri sekarang</button>` : ''}</div>${p.aktif ? '' : '<hr>' + composer}`;
}
function liveBindPollForm() {
  const f = $('#lvPollForm'); if (!f || f.dataset.bound) return; f.dataset.bound = '1';
  let tipe = 'pg';
  $$('#lvPollForm .seg button').forEach(b => b.onclick = () => { tipe = b.dataset.t; $$('#lvPollForm .seg button').forEach(x => x.classList.toggle('active', x === b)); $('#lvpPg').classList.toggle('d-none', tipe !== 'pg'); $('#lvpIs').classList.toggle('d-none', tipe === 'pg'); });
  f.onsubmit = async e => {
    e.preventDefault();
    const p = { live_id: Live.id, pertanyaan: $('#lvpQ').value.trim(), tipe, durasi_detik: Number($('#lvpDur').value) };
    if (tipe === 'pg') { p.opsi = $$('.lvp-o', f).map(x => x.value.trim()); const k = Number((f.querySelector('input[name=lvpK]:checked') || {}).value || 0); if (!p.opsi[k]) return toast('Kunci jawaban kosong', 'Pilih bulatan di opsi yang terisi.', 'warning'); const idxMap = []; p.opsi.forEach((o, i) => { if (o) idxMap.push(i); }); p.kunci = idxMap.indexOf(k); p.opsi = p.opsi.filter(Boolean); }
    else p.kunci = $('#lvpKey').value;
    try { await api('live.pollStart', p); Live.sig['#lvPollBox'] = null; livePoll(); } catch (err) { toastErr(err); }
  };
}
async function liveStaffDo(action, p) {
  const d = Live.d;
  if (d) {                                                                                  // optimistis: daftar langsung berubah
    if (action === 'live.handServe') d.tangan = d.tangan.filter(h => h.event_id !== p.event_id);
    else if (action === 'live.qStatus') { const q = d.tanya.find(x => x.event_id === p.event_id); if (q) q.status = p.status; }
    liveDraw();
  }
  try { await api(action, Object.assign({ live_id: Live.id }, p)); } catch (e) { toastErr(e); }
  livePoll();
}
async function livePoint(userId, poin) {
  const h = Live.d && Live.d.hadir.find(x => x.user_id === userId);
  if (h) { h.poin_total = Math.round((h.poin_total + poin) * 10) / 10; liveDraw(); }        // optimistis
  toast('+' + poin + ' poin', '', 'success');
  try { await api('live.points', { live_id: Live.id, user_id: userId, poin, alasan: 'Aktif di kelas' }); } catch (e) { toastErr(e); }
  livePoll();
}
function liveCloseDialog() {
  const d = Live.d, cfg = d.cfg;
  openModal({ title: 'Selesaikan sesi kelas?', body: `<p class="mb-2">Mahasiswa tidak bisa lagi mengirim pertanyaan, mengangkat tangan, atau menjawab kuis. Hasil tetap tersimpan di laporan.</p>
    <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="lcHadir" ${cfg.catat_hadir ? 'checked' : ''}><label class="form-check-label" for="lcHadir">Catat kehadiran dari durasi (≥ ${cfg.min_persen}% waktu sesi = hadir; yang sudah tercatat tidak ditimpa)</label></div>
    ${cfg.hitung_nilai ? `<p class="small-ss text-secondary-ss mt-2 mb-0"><i class="bi bi-calculator"></i> Skor partisipasi sesi ini dihitung ke komponen nilai yang Anda pilih.</p>` : ''}`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button class="btn btn-danger" id="lcOk">Selesaikan</button>` });
  $('#lcOk').onclick = e => withBtn(e.currentTarget, async () => {
    try { const r = await api('live.close', { live_id: Live.id, catat_hadir: $('#lcHadir').checked }); closeModal(); stopLive0(); toast('Sesi selesai', r.hadir_dicatat ? r.hadir_dicatat + ' kehadiran dicatat.' : '', 'success'); livePoll(); openLiveReport(Live.id); }
    catch (err) { toastErr(err); }
  });
}

// ── Laporan sesi (+ ekspor Excel) ──
async function openLiveReport(liveId) {
  const body = openModal({ title: 'Laporan sesi kelas', body: loadingBlock(), size: 'modal-xl' });
  try {
    const r = await api('live.report', { live_id: liveId }); window.__liveReport = r;
    const m = r.ringkas;
    body.innerHTML = `<div class="d-flex flex-wrap gap-2 mb-2">${badge(r.live.pertemuan, 'b-accent')}${badge('Hadir ' + m.hadir_n + '/' + m.total_mhs, 'b-ok')}${badge(m.tangan + ' angkat tangan', 'b-muted')}${badge(m.tanya + ' pertanyaan', 'b-muted')}${badge(m.kuis + ' kuis', 'b-muted')}
      <button class="btn btn-soft btn-sm ms-auto" onclick="exportLiveReport()"><i class="bi bi-file-earmark-excel"></i> Ekspor Excel</button></div>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Mahasiswa</th><th>Durasi</th><th>% sesi</th><th>Masuk</th><th>Terputus</th><th>Konfirmasi</th><th>✋</th><th>Tanya</th><th>Kuis</th><th>Poin</th><th>Skor</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr class="${x.hadir ? '' : 'text-muted-ss'}"><td><div class="fw-600">${esc(x.nama)}</div><div class="small-ss text-secondary-ss">${esc(x.npm)}</div></td><td class="tabular">${x.hadir ? esc(fmtDur(x.durasi)) : '–'}</td><td class="tabular">${x.hadir ? x.persen + '%' : '–'}</td>
        <td class="small-ss">${x.pertama_masuk ? esc(fmtTime(x.pertama_masuk)) : '–'}</td><td class="tabular">${x.hadir ? x.keluar_n + '×' : '–'}</td><td class="tabular small-ss">${x.hadir && r.cfg.konfirmasi_menit ? x.konf_ok + ' ok / ' + x.konf_lewat + ' lewat' : '–'}</td>
        <td class="tabular">${x.tangan_n}</td><td class="tabular">${x.tanya_n}</td><td class="tabular">${x.kuis_total ? x.kuis_benar + '/' + x.kuis_total : '–'}</td><td class="tabular">${fmtScore(x.poin_total)}</td><td class="tabular fw-600">${fmtScore(x.skor)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small-ss text-secondary-ss mt-2 mb-0">Durasi = lama halaman sesi terbuka di perangkat mahasiswa (jeda ≤ 2 menit tidak dihitung terputus). Skor = poin ÷ ${r.cfg.poin_maks} × 100 (maks. 100).${r.cfg.hitung_nilai ? ' Skor dihitung ke komponen nilai kelas.' : ''}</p>
      ${r.polls.length ? `<h3 class="h6 mt-3">Kuis</h3>${r.polls.map((p, i) => `<div class="small-ss mb-1"><b>${i + 1}.</b> ${esc(p.pertanyaan)} — ${p.benar_n}/${p.jawaban_n} benar</div>`).join('')}` : ''}
      ${r.pertanyaan.length ? `<h3 class="h6 mt-3">Pertanyaan mahasiswa</h3>${r.pertanyaan.map(q => `<div class="small-ss mb-1">• ${esc(q.teks)} <span class="text-muted-ss">— ${esc(q.nama)}${q.anonim ? ' (anonim)' : ''}, ${q.dukung_n} dukungan${q.status === 'dijawab' ? ', dijawab' : ''}</span></div>`).join('')}` : ''}`;
  } catch (e) { body.innerHTML = errorBlock(e, `openLiveReport('${liveId}')`); }
}
async function exportLiveReport() {
  const r = window.__liveReport; if (!r) return;
  try {
    await loadScript(XLSX_SRC);
    const rows = [['NPM', 'Nama', 'Hadir di sesi', 'Durasi (menit)', '% sesi', 'Masuk pertama', 'Terputus (kali)', 'Konfirmasi ok', 'Konfirmasi terlewat', 'Angkat tangan', 'Pertanyaan', 'Dukungan diterima', 'Kuis benar', 'Kuis dijawab', 'Rata-rata respon (dtk)', 'Poin manual', 'Poin total', 'Skor (0-100)']]
      .concat(r.rows.map(x => [x.npm, x.nama, x.hadir ? 'Ya' : 'Tidak', Math.round(x.durasi / 6) / 10, x.persen, x.pertama_masuk ? fmtTime(x.pertama_masuk) : '', x.keluar_n, x.konf_ok, x.konf_lewat, x.tangan_n, x.tanya_n, x.dukung_diterima, x.kuis_benar, x.kuis_total, x.respon_rata === null ? '' : x.respon_rata, x.poin_manual, x.poin_total, x.skor]));
    const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 14 }, { wch: 30 }].concat(Array(16).fill({ wch: 13 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap sesi');
    if (r.polls.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No', 'Pertanyaan', 'Jawaban', 'Benar']].concat(r.polls.map((p, i) => [i + 1, p.pertanyaan, p.jawaban_n, p.benar_n]))), 'Kuis');
    if (r.pertanyaan.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Pertanyaan', 'Penanya', 'Anonim', 'Dukungan', 'Status']].concat(r.pertanyaan.map(q => [q.teks, q.nama, q.anonim ? 'Ya' : 'Tidak', q.dukung_n, q.status]))), 'Pertanyaan');
    XLSX.writeFile(wb, `Sesi kelas - ${r.live.nama_kelas} - ${r.live.pertemuan}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  } catch (e) { toastErr(e); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 33: PENGHARGAAN & SERTIFIKAT
// Kalkulasi mahasiswa/kelompok berprestasi → pilih penerima → desain + tanda tangan → terbitkan ke akun mahasiswa.
// ════════════════════════════════════════════════════════

const AW_DESAIN = [
  { id: 'modern', nama: 'Modern Lavender', desk: 'Putih dengan pita ungu seperti tema Ruang Ajar — bersih dan segar.', mock: 'background:#fff;border:1px solid #d9d4f5;border-left:14px solid #7C6FE0;border-bottom:5px solid #7C6FE0' }
];
const Aw = { classId: '', id: '', tipe: 'mahasiswa', def: null, kand: null, pilih: {}, ttdId: '', ttdUri: '', desain: 'modern', status: 'draft', bobot: {} };

function certCardHtml(c) {
  return `<div class="ss-card ss-card-tight cert-card"><div class="d-flex align-items-start gap-3"><div class="item-icon" style="background:#fff4d6;color:#a8741a"><i class="bi bi-award"></i></div>
    <div class="flex-grow-1 min-w-0"><div class="fw-bold">${esc(c.judul)}</div><div class="small-ss text-secondary-ss">${esc(c.nama_kelas)}${c.mata_kuliah ? ' — ' + esc(c.mata_kuliah) : ''}</div>
      <div class="d-flex flex-wrap gap-1 mt-1">${badge(c.peringkat, 'b-accent', 'bi-trophy')}${c.group_nama ? badge(c.group_nama, 'b-muted', 'bi-people') : ''}<span class="small-ss text-muted-ss align-self-center">${esc(fmtDate(c.tanggal))} · No. ${esc(c.nomor)}</span></div></div>
    <button class="btn btn-ink btn-sm flex-shrink-0" onclick="downloadCert('${c.winner_id}', this)" data-loading="Menyiapkan…"><i class="bi bi-download"></i> Unduh PDF</button></div></div>`;
}
async function downloadCert(winnerId, btn) {
  await withBtn(btn, async () => { try { const r = await api('award.certificate', { winner_id: winnerId }); downloadBase64(r.base64, 'application/pdf', r.name); toast('Sertifikat diunduh', r.name, 'success'); } catch (e) { toastErr(e); } });
}
async function renderSertifikatSaya(params, c) {
  c.innerHTML = `<div class="page-head"><div><h1>Sertifikat saya</h1><p>Penghargaan yang diberikan dosen. Unduh sebagai PDF kapan saja.</p></div></div><div id="csBody">${loadingBlock()}</div>`;
  try { const list = await api('award.mine', {}); $('#csBody').innerHTML = list.length ? `<div class="row g-3">${list.map(x => `<div class="col-lg-6">${certCardHtml(x)}</div>`).join('')}</div>` : emptyState('Belum ada sertifikat', 'Sertifikat penghargaan dari dosen akan muncul di sini.'); }
  catch (e) { $('#csBody').innerHTML = errorBlock(e, "navigateTo('sertifikat-saya')"); }
}

// ── Tab "Penghargaan" (dosen) / "Sertifikat" (mahasiswa) di detail kelas ──
async function renderPenghargaanTab(body, d) {
  const owner = d.access.isOwner, cid = d.cls.class_id;
  body.innerHTML = loadingBlock();
  const list = await api('award.list', { class_id: cid });
  if (!owner) { body.innerHTML = list.length ? `<div class="row g-3">${list.map(x => `<div class="col-lg-6">${certCardHtml(x)}</div>`).join('')}</div>` : emptyState('Belum ada sertifikat', 'Sertifikat penghargaan dari dosen untuk kelas ini akan muncul di sini.'); return; }
  window.__awList = list;
  body.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-3"><p class="small-ss text-secondary-ss mb-0">Hitung mahasiswa atau kelompok berprestasi, pilih penerima, lalu terbitkan sertifikat ke akun mereka.</p>
      ${d.access.archived ? '' : `<button class="btn btn-ink btn-sm ms-md-auto" onclick="navigateTo('penghargaan-edit',{class_id:'${cid}'})"><i class="bi bi-plus-lg"></i> Penghargaan baru</button>`}</div>
    ${list.length ? `<div class="row g-3">${list.map(a => `<div class="col-lg-6"><div class="ss-card h-100"><div class="d-flex align-items-start gap-2"><div class="flex-grow-1 min-w-0"><div class="fw-bold">${esc(a.judul)}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">${badge(a.tipe === 'kelompok' ? 'Kelompok' : 'Individu', 'b-muted', a.tipe === 'kelompok' ? 'bi-people' : 'bi-person')}${badge((AW_DESAIN.find(x => x.id === a.desain) || {}).nama || a.desain, 'b-accent', 'bi-palette')}${a.status === 'terbit' ? badge('Terbit', 'b-ok', 'bi-check-circle') : badge('Draft', 'b-warn', 'bi-pencil')}</div>
        <div class="small-ss text-secondary-ss mt-2">${a.jumlah_penerima} penerima${a.status === 'terbit' ? ' · terbit ' + esc(fmtDate(a.terbit_at)) : ''}</div></div></div>
      <div class="d-flex flex-wrap gap-2 mt-3"><button class="btn btn-soft btn-sm" onclick="openAwardWinners('${a.award_id}')"><i class="bi bi-people"></i> Penerima</button>
        <button class="btn btn-soft btn-sm" onclick="navigateTo('penghargaan-edit',{class_id:'${cid}',award_id:'${a.award_id}'})"><i class="bi bi-pencil"></i> Ubah</button>
        <button class="btn btn-${a.status === 'terbit' ? 'ghost' : 'ink'} btn-sm" onclick="publishAward('${a.award_id}', ${a.status !== 'terbit'})">${a.status === 'terbit' ? 'Tarik dari mahasiswa' : '<i class="bi bi-send"></i> Terbitkan'}</button>
        <button class="btn btn-danger-soft btn-sm ms-auto" onclick="deleteAward('${a.award_id}')" aria-label="Hapus penghargaan"><i class="bi bi-trash"></i></button></div></div></div>`).join('')}</div>`
      : emptyState('Belum ada penghargaan', 'Buat penghargaan pertama: sistem menghitung kandidat berprestasi dari nilai, kehadiran, dan partisipasi.')}`;
}
async function publishAward(id, terbit) {
  if (terbit && !await confirmDialog('Terbitkan penghargaan ini? Penerima mendapat notifikasi dan dapat mengunduh sertifikatnya di akun mereka.', { okText: 'Terbitkan' })) return;
  if (!terbit && !await confirmDialog('Tarik penghargaan dari akun mahasiswa? Sertifikat tidak akan terlihat sampai diterbitkan lagi (nomor tetap).', { okText: 'Tarik', danger: true })) return;
  try { await api('award.publish', { award_id: id, terbit }); toast(terbit ? 'Penghargaan diterbitkan' : 'Penghargaan ditarik', '', 'success'); loadClassTab('penghargaan'); } catch (e) { toastErr(e); }
}
async function deleteAward(id) {
  if (!await confirmDialog('Hapus penghargaan ini beserta semua sertifikat penerimanya? Tindakan ini tidak bisa dibatalkan.', { okText: 'Hapus', danger: true })) return;
  try { await api('award.delete', { award_id: id }); toast('Penghargaan dihapus', '', 'success'); loadClassTab('penghargaan'); } catch (e) { toastErr(e); }
}
async function openAwardWinners(id) {
  const body = openModal({ title: 'Penerima penghargaan', body: loadingBlock(), size: 'modal-lg' });
  try {
    const r = await api('award.get', { award_id: id });
    body.innerHTML = `<div class="small-ss text-secondary-ss mb-2">${esc(r.award.judul)} — ${r.award.status === 'terbit' ? 'sudah terbit' : 'draft (hanya Anda yang bisa membuka PDF-nya)'}</div>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Penerima</th><th>Peringkat</th><th>No. sertifikat</th><th></th></tr></thead><tbody>
      ${r.winners.map(w => `<tr><td><div class="fw-600">${esc(w.nama)}</div><div class="small-ss text-secondary-ss">${esc(w.npm)}${w.group_nama ? ' · ' + esc(w.group_nama) : ''}</div></td><td>${esc(w.peringkat)}</td><td class="small-ss">${esc(w.nomor || '— (diberi saat terbit)')}</td>
        <td class="text-end"><button class="btn btn-soft btn-sm" onclick="downloadCert('${w.winner_id}', this)" data-loading="Menyiapkan…"><i class="bi bi-download"></i> PDF</button></td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { body.innerHTML = errorBlock(e); }
}
function showCertPreview(r) {
  const url = b64ToBlobUrl(r.base64, 'application/pdf');
  openModal({ title: 'Pratinjau sertifikat', size: 'modal-xl', body: `<iframe src="${url}" title="Pratinjau sertifikat" style="width:100%;height:68vh;border:1px solid var(--border);border-radius:12px"></iframe>
    <p class="small-ss text-secondary-ss mt-2 mb-0">Nama dan NPM di pratinjau adalah contoh. Bila PDF tidak tampil di perangkat ini, gunakan tombol unduh.</p>`,
    footer: `<button class="btn btn-soft" data-bs-dismiss="modal">Tutup</button><button class="btn btn-ink" id="dlPrev"><i class="bi bi-download"></i> Unduh</button>` });
  $('#dlPrev').onclick = () => downloadBase64(r.base64, 'application/pdf', r.name);
}

// ── Halaman pembuatan/ubah penghargaan ──
async function renderPenghargaanEdit(params, c) {
  Object.assign(Aw, { classId: params.class_id, id: params.award_id || '', tipe: 'mahasiswa', kand: null, pilih: {}, ttdId: '', ttdUri: '', desain: 'modern', status: 'draft', bobot: {}, def: null, minH: 0, top: 15 });
  c.innerHTML = loadingBlock();
  try {
    const [def, ex] = await Promise.all([api('award.defaults', { class_id: Aw.classId }), Aw.id ? api('award.get', { award_id: Aw.id }) : Promise.resolve(null)]);
    Aw.def = def; Aw.ttdId = def.ttd_file_id || ''; Aw.desain = 'modern';
    const cls = (AppState.classCache[Aw.classId] || {}).cls || {};
    let f = { judul: 'Mahasiswa Berprestasi', deskripsi: def.deskripsi, tempat: def.tempat, tanggal: new Date().toISOString().slice(0, 10), penandatangan: def.penandatangan, jabatan_ttd: def.jabatan_ttd, nip_ttd: def.nip_ttd };
    if (ex) {
      const a = ex.award; Aw.tipe = a.tipe; Aw.status = a.status; Aw.desain = 'modern'; Aw.ttdId = a.ttd_file_id || ''; Aw.bobot = (a.kriteria || {}).bobot || {}; Aw.minH = (a.kriteria || {}).min_kehadiran || 0;
      f = { judul: a.judul, deskripsi: a.deskripsi, tempat: a.tempat, tanggal: a.tanggal, penandatangan: a.penandatangan, jabatan_ttd: a.jabatan_ttd, nip_ttd: a.nip_ttd };
      ex.winners.forEach(w => { const key = a.tipe === 'kelompok' ? w.group_id : w.user_id; Aw.pilih[key] = { nama: a.tipe === 'kelompok' ? w.group_nama : w.nama, peringkat: w.peringkat, skor: w.skor }; });
    }
    Aw.f = f;
    awDraw(c);
    if (Aw.ttdId) awLoadTtd();
  } catch (e) { c.innerHTML = errorBlock(e, `navigateTo('penghargaan-edit',{class_id:'${params.class_id}'})`); }
}
function awSources() { return Aw.tipe === 'kelompok' ? Aw.def.sumber_kel : Aw.def.sumber_mhs; }
function awDraw(c) {
  c = c || container(); const f = Aw.f, cls = (AppState.classCache[Aw.classId] || {}).cls || {};
  const srcs = awSources();
  c.innerHTML = `<div class="page-head"><div><h1>${Aw.id ? 'Ubah penghargaan' : 'Penghargaan baru'}</h1><p>${esc(cls.nama_kelas || '')} — ${esc(cls.mata_kuliah || '')}</p></div>
      <button class="btn btn-soft btn-sm" onclick="navigateTo('kelas-detail',{class_id:'${Aw.classId}',tab:'penghargaan'})"><i class="bi bi-arrow-left"></i> Kembali</button></div>
    <div class="ss-card mb-3"><div class="card-head"><h2>1. Siapa yang dinilai?</h2></div>
      <div class="seg mb-3" id="awTipe" role="radiogroup" aria-label="Jenis penghargaan"><button type="button" data-t="mahasiswa" class="${Aw.tipe === 'mahasiswa' ? 'active' : ''}"><i class="bi bi-person"></i> Mahasiswa (individu)</button>
        <button type="button" data-t="kelompok" class="${Aw.tipe === 'kelompok' ? 'active' : ''}" ${Aw.def.jumlah_kelompok ? '' : 'disabled title="Belum ada kelompok di kelas ini"'}><i class="bi bi-people"></i> Kelompok</button></div>
      <div class="small-ss fw-600 mb-1">Dasar penilaian &amp; bobot (%)</div>
      <div class="row g-2 mb-2">${srcs.map(s => { const v = Aw.bobot[s.key] !== undefined ? Aw.bobot[s.key] : s.bobot; const off = s.ada === false;
        return `<div class="col-md-6 col-lg-4"><label class="form-label small-ss mb-1" for="aw_${esc(s.key)}">${esc(s.label)}${off ? ' <span class="text-muted-ss">(belum ada sesi kelas)</span>' : ''}</label><input class="form-control form-control-sm aw-w" id="aw_${esc(s.key)}" data-k="${esc(s.key)}" type="number" min="0" max="100" value="${off ? 0 : v}" ${off ? 'disabled' : ''}></div>`; }).join('')}</div>
      <div class="d-flex flex-wrap gap-3 align-items-end"><div><label class="form-label small-ss mb-1" for="awMin">Kehadiran minimal (%)</label><input class="form-control form-control-sm" id="awMin" type="number" min="0" max="100" value="${Aw.minH || 0}" style="width:110px"></div>
        <div><label class="form-label small-ss mb-1" for="awTop">Tampilkan teratas</label><select class="form-select form-select-sm" id="awTop" style="width:110px">${[10, 15, 25, 50].map(n => `<option ${n === (Aw.top || 15) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <button class="btn btn-ink" id="awHitung"><i class="bi bi-calculator"></i> Hitung kandidat</button></div>
      <div class="form-text mt-2">Skor = Σ(bobot × nilai) ÷ Σ bobot, skala 0–100. Sumber yang belum tersedia diabaikan otomatis.</div></div>
    <div class="ss-card mb-3"><div class="card-head"><h2>2. Pilih penerima</h2><div class="d-flex gap-2"><button class="btn btn-soft btn-sm" id="awTop3" ${Aw.kand ? '' : 'disabled'}>Pilih 3 teratas</button><button class="btn btn-ghost btn-sm" id="awClear">Kosongkan</button></div></div>
      <div id="awKand">${Aw.kand ? '' : '<p class="small-ss text-muted-ss mb-0">Tekan "Hitung kandidat" untuk melihat peringkat. Anda tetap bisa mengubah pilihan sebelum menyimpan.</p>'}</div>
      <hr><div class="small-ss fw-600 mb-1">Penerima terpilih <span id="awN"></span></div><div id="awSel"></div></div>
    <div class="ss-card mb-3"><div class="card-head"><h2>3. Isi sertifikat</h2></div>
      <div class="row g-2">
        <div class="col-md-8"><label class="form-label small-ss" for="awJudul">Judul penghargaan</label><input class="form-control" id="awJudul" maxlength="120" value="${esc(f.judul)}"></div>
        <div class="col-md-4"><label class="form-label small-ss" for="awTgl">Tanggal sertifikat</label><input class="form-control" id="awTgl" type="date" value="${esc(f.tanggal)}"></div>
        <div class="col-12"><label class="form-label small-ss" for="awDesk">Kalimat penghargaan</label><textarea class="form-control" id="awDesk" rows="2" maxlength="500">${esc(f.deskripsi)}</textarea>
          <div class="form-text">Isian otomatis: {peringkat} {mata_kuliah} {kelas} {semester} {tahun_ajaran} {kelompok}</div></div>
        <div class="col-md-4"><label class="form-label small-ss" for="awTempat">Tempat</label><input class="form-control" id="awTempat" maxlength="60" value="${esc(f.tempat)}"></div>
        <div class="col-md-4"><label class="form-label small-ss" for="awNama">Penandatangan</label><input class="form-control" id="awNama" maxlength="120" value="${esc(f.penandatangan)}"></div>
        <div class="col-md-4"><label class="form-label small-ss" for="awJab">Jabatan</label><input class="form-control" id="awJab" maxlength="80" value="${esc(f.jabatan_ttd)}"></div>
        <div class="col-md-4"><label class="form-label small-ss" for="awNip">NIP (opsional)</label><input class="form-control" id="awNip" maxlength="40" value="${esc(f.nip_ttd)}"></div>
        <div class="col-md-8"><label class="form-label small-ss">Tanda tangan</label><div class="d-flex flex-wrap align-items-center gap-3"><div id="awTtdBox" class="ttd-box"><span class="small-ss text-muted-ss">Belum ada</span></div>
          <div><label class="btn btn-soft btn-sm mb-1"><i class="bi bi-upload"></i> Unggah tanda tangan<input type="file" id="awTtdFile" accept="image/png,image/jpeg" class="d-none"></label>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="awTtdBg" checked><label class="form-check-label small-ss" for="awTtdBg">Hapus latar putih otomatis</label></div>
            <div class="form-text">Foto/scan tanda tangan di kertas putih. Disimpan di profil Anda dan dipakai untuk penghargaan berikutnya.</div></div></div></div>
      </div>
      <hr><div class="d-flex align-items-center gap-3"><div class="design-mock" style="${AW_DESAIN[0].mock};width:130px;flex:0 0 130px"><div class="dm-l1"></div><div class="dm-l2"></div><div class="dm-l3"></div></div>
        <div><div class="fw-600">Desain: ${AW_DESAIN[0].nama}</div><div class="small-ss text-secondary-ss">${AW_DESAIN[0].desk}</div></div></div>
      <div class="mt-3"><button class="btn btn-soft" id="awPrev"><i class="bi bi-eye"></i> Pratinjau PDF</button></div></div>
    <div class="d-flex flex-wrap gap-2 justify-content-end mb-4"><button class="btn btn-soft" id="awSave">Simpan${Aw.status === 'terbit' ? ' perubahan' : ' draft'}</button>${Aw.status === 'terbit' ? '' : '<button class="btn btn-ink" id="awSavePub"><i class="bi bi-send"></i> Simpan &amp; terbitkan</button>'}</div>`;
  awBind(); awDrawSel(); if (Aw.kand) awDrawKand(); awDrawTtd();
}
function awTtdHtml() { return Aw.ttdUri ? `<img src="${Aw.ttdUri}" alt="Tanda tangan" style="max-height:70px;max-width:180px">` : '<span class="small-ss text-muted-ss">Belum ada</span>'; }
function awDrawTtd() { const b = $('#awTtdBox'); if (b) b.innerHTML = awTtdHtml(); }
async function awLoadTtd() { try { const r = await api('file.get', { kind: 'ttd', id: Aw.ttdId }); Aw.ttdUri = `data:${r.mime || 'image/png'};base64,${r.base64}`; awDrawTtd(); } catch (e) { /* abaikan */ } }
function awRead() {
  const f = Aw.f = { judul: $('#awJudul').value.trim(), deskripsi: $('#awDesk').value.trim(), tempat: $('#awTempat').value.trim(), tanggal: $('#awTgl').value, penandatangan: $('#awNama').value.trim(), jabatan_ttd: $('#awJab').value.trim(), nip_ttd: $('#awNip').value.trim() };
  Aw.bobot = {}; $$('.aw-w').forEach(i => { if (!i.disabled) Aw.bobot[i.dataset.k] = Number(i.value || 0); });
  Aw.minH = Number($('#awMin').value || 0); Aw.top = Number($('#awTop').value || 15);
  return f;
}
function awPayload() {
  const f = awRead();
  return Object.assign({ class_id: Aw.classId, award_id: Aw.id, tipe: Aw.tipe, desain: Aw.desain, ttd_file_id: Aw.ttdId, bobot: Aw.bobot, min_kehadiran: Aw.minH,
    winners: Object.entries(Aw.pilih).map(([ref_id, v]) => ({ ref_id, peringkat: v.peringkat, skor: v.skor })) }, f);
}
function awBind() {
  $$('#awTipe button').forEach(b => b.onclick = () => { if (b.disabled || Aw.tipe === b.dataset.t) return; awRead(); Aw.tipe = b.dataset.t; Aw.pilih = {}; Aw.kand = null; Aw.bobot = {}; if (Aw.f.judul === 'Mahasiswa Berprestasi' && Aw.tipe === 'kelompok') Aw.f.judul = 'Kelompok Terbaik'; if (Aw.f.judul === 'Kelompok Terbaik' && Aw.tipe === 'mahasiswa') Aw.f.judul = 'Mahasiswa Berprestasi'; awDraw(); });
  $('#awHitung').onclick = e => withBtn(e.currentTarget, async () => {
    awRead();
    try { Aw.kand = await api('award.candidates', { class_id: Aw.classId, tipe: Aw.tipe, bobot: Aw.bobot, min_kehadiran: Aw.minH, top: Aw.top }); awDrawKand(); $('#awTop3').disabled = false; toast('Kandidat dihitung', Aw.kand.total + ' kandidat memenuhi syarat.', 'success'); }
    catch (err) { toastErr(err); }
  });
  $('#awTop3').onclick = () => { if (!Aw.kand) return; ['Juara I', 'Juara II', 'Juara III'].forEach((p, i) => { const k = Aw.kand.kandidat[i]; if (k) Aw.pilih[k.ref_id] = { nama: k.nama, peringkat: p, skor: k.skor }; }); awDrawKand(); awDrawSel(); };
  $('#awClear').onclick = () => { Aw.pilih = {}; if (Aw.kand) awDrawKand(); awDrawSel(); };
  $('#awTtdFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      toast('Memproses tanda tangan…', '', 'info');
      const b64 = await processSignature(file, $('#awTtdBg').checked);
      const r = await api('award.ttdUpload', { file: { name: 'ttd.png', base64: b64 } });
      Aw.ttdId = r.file_id; Aw.ttdUri = 'data:image/png;base64,' + b64; awDrawTtd(); toast('Tanda tangan tersimpan', '', 'success');
    } catch (err) { toastErr(err); }
  };
  $('#awPrev').onclick = e => withBtn(e.currentTarget, async () => {
    const p = awPayload(); try { showCertPreview(await api('award.sample', Object.assign({}, p, { peringkat: (Object.values(Aw.pilih)[0] || {}).peringkat || 'Juara I' }))); } catch (err) { toastErr(err); }
  });
  const save = async (publish, btn) => withBtn(btn, async () => {
    try {
      const a = await api('award.save', awPayload()); Aw.id = a.award_id;
      if (publish) await api('award.publish', { award_id: a.award_id });
      toast(publish ? 'Penghargaan diterbitkan' : 'Penghargaan disimpan', publish ? 'Penerima mendapat notifikasi.' : '', 'success');
      navigateTo('kelas-detail', { class_id: Aw.classId, tab: 'penghargaan' });
    } catch (err) { toastErr(err); }
  });
  $('#awSave').onclick = e => save(false, e.currentTarget);
  const sp = $('#awSavePub'); if (sp) sp.onclick = e => save(true, e.currentTarget);
}
function awDrawKand() {
  const k = Aw.kand; if (!k) return;
  const lbl = { akhir: 'Nilai akhir', kehadiran: 'Hadir', partisipasi: 'Partisipasi', tugas_kelompok: 'Tugas kelompok' };
  $('#awKand').innerHTML = k.kandidat.length ? `<div class="table-wrap"><table class="table-ss"><thead><tr><th></th><th>#</th><th>${Aw.tipe === 'kelompok' ? 'Kelompok' : 'Mahasiswa'}</th><th>Skor</th><th>Rincian</th></tr></thead><tbody>
    ${k.kandidat.map(x => `<tr><td><input class="form-check-input aw-pick" type="checkbox" data-ref="${esc(x.ref_id)}" ${Aw.pilih[x.ref_id] ? 'checked' : ''} aria-label="Pilih ${esc(x.nama)}"></td><td class="tabular">${x.rank}</td>
      <td><div class="fw-600">${esc(x.nama)}</div><div class="small-ss text-secondary-ss">${x.anggota.length ? esc(x.anggota.map(a => a.nama).join(', ')) : esc(x.npm)}</div></td><td class="tabular fw-600">${fmtScore(x.skor)}</td>
      <td class="small-ss">${Object.keys(lbl).filter(m => x.metrik[m] !== undefined && x.metrik[m] !== null).map(m => `${lbl[m]} ${fmtScore(x.metrik[m])}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-text">${k.total} kandidat memenuhi syarat${k.total > k.kandidat.length ? ' (menampilkan ' + k.kandidat.length + ' teratas)' : ''}.</div>`
    : emptyState('Tidak ada kandidat', 'Tidak ada yang memenuhi syarat kehadiran minimal. Turunkan batasnya.');
  $$('.aw-pick').forEach(cb => cb.onchange = () => {
    const x = k.kandidat.find(y => String(y.ref_id) === cb.dataset.ref);
    if (cb.checked) Aw.pilih[x.ref_id] = { nama: x.nama, peringkat: x.rank <= 3 ? ['Juara I', 'Juara II', 'Juara III'][x.rank - 1] : 'Berprestasi', skor: x.skor }; else delete Aw.pilih[x.ref_id];
    awDrawSel();
  });
}
function awDrawSel() {
  const ids = Object.keys(Aw.pilih); $('#awN').textContent = `(${ids.length})`;
  $('#awSel').innerHTML = ids.length ? ids.map(id => `<div class="d-flex align-items-center gap-2 mb-1"><div class="flex-grow-1 min-w-0 text-truncate fw-600">${esc(Aw.pilih[id].nama)}</div>
      <input class="form-control form-control-sm aw-per" data-ref="${esc(id)}" list="awPerList" maxlength="60" value="${esc(Aw.pilih[id].peringkat)}" style="max-width:200px" aria-label="Peringkat ${esc(Aw.pilih[id].nama)}">
      <button class="icon-action" onclick="awRemove('${esc(id)}')" aria-label="Hapus penerima"><i class="bi bi-x-lg"></i></button></div>`).join('') + `<datalist id="awPerList"><option>Juara I</option><option>Juara II</option><option>Juara III</option><option>Berprestasi</option><option>Terbaik</option></datalist>`
    : '<span class="small-ss text-muted-ss">Belum ada penerima dipilih.</span>';
  $$('.aw-per').forEach(i => i.oninput = () => { Aw.pilih[i.dataset.ref].peringkat = i.value; });
}
function awRemove(id) { delete Aw.pilih[id]; awDrawSel(); if (Aw.kand) awDrawKand(); }

/** Foto tanda tangan → PNG transparan kecil (latar putih dihapus, warna tinta dipertahankan). */
async function processSignature(file, removeBg) {
  const img = await loadImageFile(file);
  try {
    const sc = Math.min(1, 600 / img.naturalWidth), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * sc)); cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    if (removeBg) {
      const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 250) continue; const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i + 3] = lum > 225 ? 0 : Math.min(255, Math.round((225 - lum) * 3.2)); }
      ctx.putImageData(id, 0, 0);
    }
    return cv.toDataURL('image/png').split(',')[1];
  } finally { URL.revokeObjectURL(img.src); }
}


// ════════════════════════════════════════════════════════
// BAGIAN 34: RINCIAN ASAL NILAI (bisa ditelusuri per komponen)
// Tiap komponen bisa dibuka: kehadiran per pertemuan, tiap tugas, tiap sesi kelas, dan koreksi dosen.
// ════════════════════════════════════════════════════════

function rincianToggle(key, open) { (AppState.rincianOpen = AppState.rincianOpen || {})[key] = open; }
function rinScoreBadge(v) { return badge(fmtScore(v), v >= 70 ? 'b-ok' : v >= 50 ? 'b-warn' : 'b-bad'); }

function rincianSumberHtml(s, student) {
  const ico = { kehadiran: 'bi-calendar-check', tugas: 'bi-clipboard-check', sesi: 'bi-broadcast' }[s.jenis] || 'bi-dot';
  const nav = student && s.jenis === 'tugas' && s.assignment_id ? ` role="button" tabindex="0" onclick="navigateTo('tugas-detail',{assignment_id:'${s.assignment_id}'})" onkeydown="if(event.key==='Enter')this.click()"` : '';
  let sub = '';
  if (s.jenis === 'kehadiran' && s.pertemuan && s.pertemuan.length) {
    sub = `<details class="rin-sub"><summary>Lihat per pertemuan (${s.pertemuan.length})</summary>
      <div class="table-wrap"><table class="table-ss"><thead><tr><th>Pertemuan</th><th>Status</th><th class="text-end">Poin</th></tr></thead><tbody>
      ${s.pertemuan.map(p => `<tr><td>${esc(p.judul)}${p.tanggal ? `<div class="small-ss text-muted-ss">${esc(fmtDate(p.tanggal))}</div>` : ''}${p.catatan ? `<div class="small-ss text-secondary-ss">Keterangan: ${esc(p.catatan)}</div>` : ''}</td>
        <td>${badge(ATT_LABEL[p.status] || p.status, attBadgeCls(p.status))}</td><td class="text-end tabular">${p.poin === null ? '<span class="small-ss text-muted-ss">tidak dihitung</span>' : p.poin}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  return `<div class="rin-src ${s.dihitung ? '' : 'rin-off'}"><div class="d-flex align-items-start gap-2"${nav}>
      <div class="rin-ico"><i class="bi ${ico}"></i></div>
      <div class="flex-grow-1 min-w-0"><div class="fw-600 small-ss">${esc(s.judul)}</div><div class="small-ss text-secondary-ss">${esc(s.ket || '')}</div></div>
      <div class="flex-shrink-0">${s.dihitung ? rinScoreBadge(s.nilai) : badge('Belum dihitung', 'b-muted')}</div></div>${sub}</div>`;
}

function rincianKompHtml(w, c, student) {
  const v = c.nilai, has = v !== null && v !== undefined, key = 'k_' + w.komponen;
  const open = (AppState.rincianOpen || {})[key] ? ' open' : '';
  let body = '';
  if (c.koreksi !== null) body += `<div class="rin-note"><i class="bi bi-pencil-square"></i> Nilai ini <b>disesuaikan dosen</b> menjadi <b>${fmtScore(c.koreksi)}</b>${c.otomatis !== null ? ` (hitungan otomatis dari sumber di bawah: ${fmtScore(c.otomatis)})` : ''}.</div>`;
  if (c.sumber.length) {
    body += `<div class="small-ss text-secondary-ss mb-2">${c.koreksi !== null ? 'Sumber hitungan otomatis:' : `Rata-rata dari <b>${c.n_dihitung}</b> sumber yang sudah dihitung:`}</div>` + c.sumber.map(s => rincianSumberHtml(s, student)).join('');
  } else if (c.koreksi === null) {
    body += `<p class="small-ss text-muted-ss mb-2">${c.jenis === 'manual' ? 'Belum ada nilai. Komponen ini diisi oleh dosen.' : 'Belum ada tugas atau kegiatan yang dinilai untuk komponen ini.'}</p>`;
  }
  body += `<div class="rin-calc small-ss">Sumbangan ke nilai akhir: <b>${fmtScore(has ? v : 0)} × ${w.bobot_persen}% = ${fmtScore(c.kontribusi)} poin</b>${has ? '' : ' <span class="text-muted-ss">(belum ada nilai → dihitung 0 sementara)</span>'}</div>`;
  return `<details class="rincian"${open} ontoggle="rincianToggle('${esc(key)}', this.open)">
    <summary><div class="d-flex justify-content-between align-items-center small-ss"><span><b>${esc(w.label)}</b> <span class="text-muted-ss">(bobot ${w.bobot_persen}%)</span>${c.koreksi !== null ? ' <i class="bi bi-pencil-square text-muted-ss" title="Disesuaikan dosen"></i>' : ''}</span>
      <span class="d-flex align-items-center gap-2"><b>${has ? fmtScore(v) : '–'}</b><i class="bi bi-chevron-down rin-chev" aria-hidden="true"></i></span></div>
      <div class="score-bar" aria-hidden="true"><span style="width:${has ? Math.min(100, v) : 0}%"></span></div></summary>
    <div class="rincian-body">${body}</div></details>`;
}

function rincianFinalHtml(g) {
  const r = g.rincian || {}, sem = g.akhir_sementara !== undefined ? g.akhir_sementara : g.akhir;
  return `<div class="rin-final"><div class="fw-600 small-ss mb-2">Perhitungan nilai akhir</div>
    <div class="table-wrap"><table class="table-ss"><thead><tr><th>Komponen</th><th class="text-end">Nilai</th><th class="text-end">Bobot</th><th class="text-end">Poin</th></tr></thead><tbody>
    ${g.weights.map(w => { const c = r[w.komponen]; return `<tr><td>${esc(w.label)}</td><td class="text-end tabular">${c && c.nilai !== null ? fmtScore(c.nilai) : '–'}</td><td class="text-end tabular">${w.bobot_persen}%</td><td class="text-end tabular">${c ? fmtScore(c.kontribusi) : '–'}</td></tr>`; }).join('')}
    <tr class="fw-bold"><td colspan="3">${g.lengkap ? 'Nilai akhir' : 'Nilai akhir sementara'}</td><td class="text-end tabular">${fmtScore(sem)}${g.lengkap && g.huruf ? ' · ' + esc(g.huruf) : ''}</td></tr></tbody></table></div>
    ${g.lengkap ? '' : `<p class="small-ss text-secondary-ss mt-2 mb-0">Angka ini <b>sementara</b>: komponen yang belum ada nilainya dihitung 0. Nilai akhir resmi muncul setelah semua komponen lengkap.</p>`}</div>`;
}

/** Kartu "Nilai saya" untuk satu kelas, tiap komponen bisa dibuka untuk melihat asal nilainya. */
function rincianCardHtml(g) {
  if (!g.rincian) return gradeCardHtml(g, null);                                 // server lama: tampilan ringkas
  return `<div class="ss-card">
    <div class="d-flex align-items-start gap-3 mb-3">
      <div class="sched-thumb" style="width:52px;height:52px">${coverSVG(g.class_id, g.warna)}</div>
      <div class="flex-grow-1 min-w-0"><div class="fw-bold text-truncate">${esc(g.nama_kelas)}</div><div class="small-ss text-secondary-ss text-truncate">${esc(g.mata_kuliah)}</div></div>
      <div class="text-end">${g.akhir !== null ? `<div class="kpi-value" style="margin:0;font-size:1.7rem">${fmtScore(g.akhir)}</div>${badge(g.huruf, hurufCls(g.huruf))}` : badge('Belum final', 'b-muted')}</div></div>
    <div class="small-ss text-secondary-ss mb-2"><i class="bi bi-hand-index"></i> Ketuk tiap komponen untuk melihat nilai itu berasal dari mana.</div>
    ${g.weights.map(w => g.rincian[w.komponen] ? rincianKompHtml(w, g.rincian[w.komponen], true) : '').join('')}
    ${rincianFinalHtml(g)}</div>`;
}

/** Dosen: rincian asal nilai satu mahasiswa. */
async function openRincianMahasiswa(userId) {
  const body = openModal({ title: 'Rincian nilai', body: loadingBlock(), size: 'modal-lg' });
  try {
    const g = await api('grade.rincian', { class_id: AppState.params.class_id, user_id: userId });
    $('#appModalTitle').textContent = 'Rincian nilai — ' + g.nama;
    body.innerHTML = `<div class="small-ss text-secondary-ss mb-3">NPM ${esc(g.npm)} · Ketuk tiap komponen untuk melihat asal nilainya. Koreksi nilai dilakukan di tabel Nilai.</div>
      ${g.weights.map(w => g.rincian[w.komponen] ? rincianKompHtml(w, g.rincian[w.komponen], false) : '').join('')}${rincianFinalHtml(g)}`;
  } catch (e) { body.innerHTML = errorBlock(e, `openRincianMahasiswa('${userId}')`); }
}

// ════════════════════════════════════════════════════════
// BAGIAN 24: TABEL HALAMAN & INISIALISASI
// ════════════════════════════════════════════════════════

const PAGES = {
  login: renderLogin, register: renderRegister, forgot: renderForgot, 'ganti-sandi': renderForceChange,
  dashboard: renderDashboard, kelas: renderKelas, 'kelas-detail': renderClassDetail, 'tugas-detail': renderTugasDetail,
  'tugas-saya': renderTugasSaya, 'nilai-saya': renderNilaiSaya, aktivitas: renderAktivitas, 'sesi-live': renderSesiLive, 'penghargaan-edit': renderPenghargaanEdit, 'sertifikat-saya': renderSertifikatSaya, absen: renderAbsen, profil: renderProfil, admin: renderAdmin
};

function hideLoadingOverlay() {
  const o = $('#loadingOverlay'); if (!o) return;
  o.style.opacity = '0'; setTimeout(() => o.remove(), 300);
}

async function initApp() {
  if (window.__boot) { window.__boot.started = true; window.__boot.step = 'menyiapkan tampilan'; }
  applyTheme(LS.get('theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const token = LS.get('token');
  const cachedUser = json(LS.get('user'));
  const cachedCfg = json(LS.get('config'));
  if (cachedCfg) AppState.config = cachedCfg;
  // Jalur cepat: tampilkan aplikasi dari data terakhir, verifikasi sesi di latar belakang
  if (token && cachedUser && !cachedUser.wajib_ganti_password) {
    AppState.token = token; AppState.user = cachedUser;
    SWR.init(cachedUser.user_id);
    document.body.classList.remove('logged-out');
    renderNavigation();
    navigateTo('dashboard', {}, { reset: true });
    hideLoadingOverlay();
    api('auth.me').then(me => {
      const changed = JSON.stringify(me.user) !== JSON.stringify(AppState.user);
      AppState.user = me.user; AppState.config = me.config;
      LS.set('user', JSON.stringify(me.user)); LS.set('config', JSON.stringify(me.config));
      if (changed) { renderNavigation(); updateActiveNav(AppState.page); }
      if (me.user.wajib_ganti_password) navigateTo('ganti-sandi', {}, { reset: true });
      refreshNotif();
    }).catch(() => { /* sesi habis ditangani handleSessionExpired */ });
    startBackgroundTasks();
    return;
  }
  try {
    if (token) {
      if (window.__boot) window.__boot.step = 'memeriksa sesi login ke server (auth.me)';
      AppState.token = token;
      const me = await api('auth.me');
      AppState.user = me.user; AppState.config = me.config;
      LS.set('user', JSON.stringify(me.user)); LS.set('config', JSON.stringify(me.config));
      SWR.init(me.user.user_id);
      document.body.classList.remove('logged-out');
      renderNavigation();
      navigateTo('dashboard', {}, { reset: true });
      refreshNotif();
    } else {
      // Halaman masuk tampil SEKETIKA (tanpa menunggu server); konfigurasi (nama aplikasi, daftar prodi) menyusul di latar belakang
      if (window.__boot) window.__boot.step = 'menampilkan halaman masuk';
      navigateTo('login', {}, { reset: true });
      hideLoadingOverlay();
      window.__cfgReady = api('app.config').then(cfg => {
        AppState.config = cfg; LS.set('config', JSON.stringify(cfg));
        if (AppState.page === 'login' || AppState.page === 'register') document.title = (PAGE_TITLES[AppState.page] ? PAGE_TITLES[AppState.page] + ' — ' : '') + (cfg.appName || 'Ruang Ajar');
        return cfg;
      }).catch(() => AppState.config);
    }
  } catch (e) {
    AppState.token = null; LS.del('token');
    try { AppState.config = await api('app.config'); } catch (e2) { /* pakai default */ }
    navigateTo('login', {}, { reset: true });
    if (!/Sesi|masuk/i.test(e.message)) toast('Gagal memuat', e.message, 'danger');
  } finally {
    hideLoadingOverlay();
  }
  startBackgroundTasks();
}

function json(v) { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }

let _bgStarted = false;
/** Pemasangan Service Worker: kerangka aplikasi tersimpan di perangkat → pembukaan berikutnya hampir seketika. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdateBanner(); had = true; });
  navigator.serviceWorker.register('sw.js').catch(() => { /* tanpa SW aplikasi tetap berjalan normal */ });
}
/** Versi baru siap: jangan muat ulang otomatis (bisa sedang ujian); tawarkan saja. */
function showUpdateBanner() {
  if (document.getElementById('updBanner')) return;
  const b = document.createElement('div'); b.id = 'updBanner'; b.className = 'update-banner'; b.setAttribute('role', 'status');
  b.innerHTML = '<span>Versi baru Ruang Ajar tersedia.</span><button class="btn btn-ink btn-sm" onclick="location.reload()">Muat ulang</button><button class="icon-btn" aria-label="Tutup" onclick="this.parentNode.remove()"><i class="bi bi-x-lg"></i></button>';
  document.body.appendChild(b);
}

function startBackgroundTasks() {
  if (_bgStarted) return; _bgStarted = true;
  installIntentPrefetch();
  registerServiceWorker();
  // Muat pustaka berat di waktu senggang (bukan saat pembukaan awal)
  preloadLibs(AppState.user && AppState.user.role === 'mahasiswa' ? ['scanner'] : ['chart', 'qrcode']);
  // Perbarui notifikasi berkala (ringan) selama tab aktif
  setInterval(() => { if (!document.hidden) refreshNotif(); }, 120000);
  // Tandai form sedang diisi → pembaruan latar belakang tidak menimpa isian
  document.getElementById('app-container').addEventListener('input', e => { if (e.target.type !== 'search') AppState.formDirty = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeNotif(); if (!$('#projector').classList.contains('d-none')) closeProjector(); } });
}

// Jalankan init baik DOM masih dimuat maupun sudah siap (lingkungan iframe GAS bisa berbeda)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

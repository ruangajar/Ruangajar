// © 2026 Siska, Fasilkom. Seluruh hak dilindungi. Dilarang menyalin atau memakai ulang tanpa izin tertulis.
// ============================================
// KOMUNIKASI KE SERVER (Google Apps Script)
// ============================================
// Semua panggilan memakai satu pintu: POST ke GAS_URL.
// ⚠️ Content-Type WAJIB text/plain — "application/json" memicu CORS preflight (OPTIONS)
//    yang tidak didukung Apps Script, sehingga permintaan gagal.

const API_TIMEOUT_MS = 90000;   // GAS kadang lambat saat "cold start"; beri waktu lega

/**
 * Kirim satu aksi ke server.
 * @param {string} action   mis. 'class.list'
 * @param {string} token    token sesi (atau kosong untuk aksi publik)
 * @param {object} payload  data aksi
 * @param {number} [timeoutMs]
 * @returns {Promise<{success:boolean,data:any,message:string,code?:string}>}
 */
async function callServer(action, token, payload, timeoutMs) {
  if (typeof GAS_URL !== 'string' || GAS_URL.indexOf('script.google.com') === -1) {
    throw new Error('Alamat server belum diisi. Buka js/config.js lalu isi GAS_URL dengan URL /exec dari Apps Script.');
  }
  const ctrl = new AbortController();
  const ms = timeoutMs || API_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: token || '', payload: payload || {} }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Server menjawab HTTP ' + res.status + '.');
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('Balasan server bukan JSON. Pastikan deployment Apps Script: Execute as "Me", akses "Anyone", dan sudah memakai VERSI TERBARU.'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Server tidak menjawab dalam ' + Math.round(ms / 1000) + ' detik. Coba lagi.');
    if (e instanceof TypeError) throw new Error('Tidak dapat menghubungi server. Periksa koneksi internet, dan pastikan GAS_URL di js/config.js benar.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

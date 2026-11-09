# Ruang Ajar — Frontend

Tampilan (HTML/CSS/JS statis) untuk Ruang Ajar. Server dan database ada di **Google Apps Script** (berkas `Kode.gs`, tidak termasuk di folder ini).

```
index.html      → halaman utama (satu halaman, semua navigasi di dalam aplikasi)
404.html        → halaman "tidak ditemukan"
css/style.css   → seluruh gaya
js/config.js    → ★ satu-satunya berkas yang perlu diedit: GAS_URL (alamat /exec)
js/api.js       → komunikasi ke server (fetch → Apps Script)
js/app.js       → seluruh logika aplikasi
```

## Cara pakai singkat
1. Isi `GAS_URL` di `js/config.js`.
2. Push folder ini ke GitHub, aktifkan **Settings → Pages** (branch `main`, folder `/ (root)`).
3. Buka alamat `https://USERNAME.github.io/NAMA-REPO/`.

Langkah lengkap, uji, dan pemecahan masalah: lihat **PANDUAN-INSTALASI.md**.

## Alur data
```
Browser (GitHub Pages)  ──fetch POST text/plain {action, token, payload}──▶  Apps Script (doPost)
                        ◀────────────── JSON {success, data, message} ──────  Google Sheets / Drive
```
Perpustakaan Bootstrap, ikon, dan font dimuat dari CDN; pustaka Excel dan pemindai QR dimuat saat dibutuhkan.

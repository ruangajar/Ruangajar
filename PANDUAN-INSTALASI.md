# Panduan Instalasi — Ruang Ajar (Backend GAS + Frontend GitHub Pages)

Ruang Ajar sekarang terdiri dari **dua bagian terpisah**:

| Bagian | Tempat | Isi |
|---|---|---|
| **Backend** (server + database) | Google Apps Script + Google Sheets/Drive | `Kode.gs` — hanya melayani data (JSON) |
| **Frontend** (tampilan) | GitHub Pages | folder ini: `index.html`, `css/`, `js/` |

Data lama (kelas, mahasiswa, nilai, absensi, sertifikat) **tidak berubah dan tidak perlu dipindahkan** — database tetap di Google Sheets yang sama.

> ⚠️ Setelah migrasi, alamat `/exec` Apps Script **tidak lagi menampilkan aplikasi**, hanya data JSON. Aplikasi dibuka lewat alamat GitHub Pages. Tautan lama (mis. yang ditanam di Blogger) tidak akan menampilkan aplikasi lagi.

---

## BAGIAN A — Backend (Google Apps Script)

Lakukan **lebih dulu**, sebelum frontend.

### A1. Ganti kode server
1. Buka proyek Apps Script Ruang Ajar (script.google.com → proyek Anda).
2. Buka file **`Kode.gs`** → pilih semua isinya (Ctrl+A) → hapus → tempel isi `Kode.gs` yang baru. Klik 💾 Simpan.
3. *(Opsional, disarankan)* Pengaturan proyek (ikon ⚙️) → centang **"Show appsscript.json manifest file in editor"** → buka `appsscript.json` → ganti isinya dengan `appsscript.json` yang baru → Simpan.
4. File **`Index`**, **`JavaScript`**, dan **`Stylesheet`** (HTML) **tidak dipakai lagi**. Boleh dihapus setelah frontend berjalan.

### A2. Terapkan versi baru
1. Klik **Deploy → Manage deployments**.
2. Pada deployment yang ada klik ikon ✏️ (**Edit**).
3. **Version → New version**. Pastikan:
   - **Execute as: Me**
   - **Who has access: Anyone** (bukan "Anyone with Google account" — itu menyebabkan error CORS)
4. Klik **Deploy**. Alamat `/exec` **tetap sama**.

> Jika Anda memilih **New deployment** (bukan Edit), alamat `/exec` berubah — maka `GAS_URL` di frontend harus diperbarui.

### A3. Uji server
Buka di tab baru (ganti dengan alamat `/exec` Anda):

```
https://script.google.com/macros/s/XXXX/exec?action=ping
```

Harus tampil teks seperti:
```
{"success":true,"data":{"app":"Ruang Ajar","api":true, ...
```
Kalau tampil halaman Google/login atau HTML, deployment belum benar (lihat Pemecahan Masalah).

---

## BAGIAN B — Frontend (GitHub Pages)

### B0. Persiapan folder
1. Ekstrak **`ruang-ajar-frontend.zip`**. Hasilnya adalah folder **`ruang-ajar-frontend`**.
2. Folder inilah **satu-satunya** folder kerja untuk Git. Isinya harus langsung terlihat:
   ```
   ruang-ajar-frontend\
   ├── index.html        ← harus ada di sini
   ├── 404.html
   ├── README.md
   ├── PANDUAN-INSTALASI.md
   ├── css\
   │   └── style.css
   └── js\
       ├── config.js
       ├── api.js
       └── app.js
   ```
   Jika yang terlihat justru folder lain di dalamnya (mis. `ruang-ajar-frontend\ruang-ajar-frontend\`), masuklah ke folder dalam itu — yang berisi `index.html`.

### B1. Isi alamat server (SEBELUM push pertama)
Buka `js/config.js` dengan Notepad. Pastikan `GAS_URL` berisi alamat `/exec` Anda (Deploy → Manage deployments → salin "Web app URL"):

```js
const GAS_URL = 'https://script.google.com/macros/s/XXXX/exec';
```
Simpan.

### B2. Pasang Git (sekali saja)
- **Windows:** https://git-scm.com/download/win → install dengan pengaturan bawaan → buka **PowerShell**.
- **Mac:** buka Terminal, ketik `git --version` (macOS menawarkan pemasangan otomatis).

Cek: `git --version`

### B3. Buat akun & repository GitHub
1. Daftar di https://github.com (username Anda menjadi bagian alamat situs: `username.github.io`).
2. **+ → New repository** → nama, mis. `ruang-ajar` → **Public** → **jangan** centang README/.gitignore/license → **Create repository**.

> Public aman: isi repository hanya tampilan; tidak ada kata sandi atau data. Alamat `/exec` memang publik.

### B4. Identitas Git (sekali saja)
```bash
git config --global user.name "Nama Anda"
git config --global user.email "email-akun-github@contoh.com"
```

### B5. Buka PowerShell DI folder yang benar
Buka folder `ruang-ajar-frontend` di File Explorer → klik **address bar** → ketik `powershell` → Enter.

Cek isinya:
```powershell
dir
```
**`index.html`, `css`, dan `js` harus terlihat.** Jika yang terlihat `backend` / `frontend` atau folder lain, Anda berada di tempat yang salah — masuk lebih dalam dulu. (Git akan menerima folder yang salah tanpa protes, dan situs jadi 404.)

### B6. Push pertama
Satu per satu:
```bash
git init
git add .
git commit -m "Upload pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/ruang-ajar.git
git push -u origin main
```
- Ada **titik** di akhir `git add .`.
- Saat diminta **Username**: username GitHub. **Password**: **Personal Access Token** (bukan password akun). Saat paste token layar terlihat kosong — itu normal; tekan Enter.
- Membuat token: https://github.com/settings/tokens → **Generate new token (classic)** → centang **repo** → Generate → salin `ghp_...` (hanya tampil sekali).
- Sukses bila muncul `* [new branch] main -> main`.

### B7. Aktifkan GitHub Pages
Repo di github.com → **Settings → Pages**:

| Kolom | Nilai |
|---|---|
| Source | **Deploy from a branch** |
| Branch | **main** · **/ (root)** |
| Enforce HTTPS | ✅ dicentang |

**Save**, tunggu 1–2 menit, muncul: `Your site is live at https://USERNAME.github.io/ruang-ajar/`.

Buka alamat itu. Halaman **Masuk** Ruang Ajar harus tampil.

### B8. Setelah online
- Masuk sebagai Super Admin → **Admin → Pengaturan aplikasi → "Alamat aplikasi untuk dibagikan"**: isi alamat GitHub Pages Anda. (Jika dikosongkan, aplikasi otomatis memakai alamat halaman yang sedang dibuka.)
- Bagikan alamat GitHub Pages (bukan alamat `/exec`) kepada mahasiswa.

---

## Cara memperbarui nanti

**Tampilan (frontend):** ganti berkas di folder `ruang-ajar-frontend`, lalu:
```bash
git add .
git commit -m "Deskripsi perubahan"
git push
```
Tunggu 1–2 menit; tekan **Ctrl+Shift+R** bila masih tampil versi lama.

**Server (backend):** tempel `Kode.gs` baru → **Deploy → Manage deployments → ✏️ → New version → Deploy**. Menyimpan saja **tidak cukup**; harus ada versi baru.

---

## Daftar uji

1. Buka alamat GitHub Pages → halaman Masuk tampil lengkap dengan warna dan ikon.
2. Masuk dengan akun yang ada → beranda tampil.
3. Buka satu kelas → timeline tampil.
4. Dosen: buka sesi absensi → QR tampil. Mahasiswa: menu **Absen** → pindai QR memakai kamera (kini bisa langsung karena berjalan di halaman tingkat atas, bukan di dalam bingkai Google).
5. Buka F12 → tab **Network** → tidak ada merah (error) saat memuat.

---

## Pemecahan masalah

| Yang terlihat | Penyebab | Solusi |
|---|---|---|
| Halaman 404 GitHub Pages | `index.html` tidak di root repo, atau Settings → Pages belum diatur | Buka repo di browser: `index.html` harus terlihat di daftar paling atas. Cek Settings → Pages: branch `main`, folder `/ (root)` |
| Halaman polos tanpa warna; Console: 404 untuk `.css`/`.js` | Folder `css/` `js/` tidak ikut / berkas rata di root | Push ulang dari folder yang benar (B5–B6); jangan upload lewat tombol "Upload files" di web GitHub |
| "Alamat server belum diisi" | `GAS_URL` di `js/config.js` belum benar | Edit `js/config.js`, lalu `git add . && git commit -m "fix config" && git push` |
| "Balasan server bukan JSON" | Deployment belum versi terbaru, atau akses bukan "Anyone" | Ulangi A2; uji `?action=ping` (A3) |
| "Tidak dapat menghubungi server" / error CORS di Console | Akses deployment "Anyone with Google account", atau alamat `/exec` salah, atau tidak ada internet | Ubah ke **Anyone**, Deploy versi baru; cek `GAS_URL` |
| "Server tidak menjawab dalam 90 detik" | Apps Script sedang lambat/kena kuota | Coba lagi beberapa saat; cek **Executions** di editor Apps Script |
| Layar "Memuat…" terus, lalu pesan penyebab | Lihat teks di layar (menyebut langkah terakhir) | Ikuti petunjuk di pesan itu; kirim tangkapan layarnya bila perlu |
| Situs tampil versi lama setelah push | Cache browser | Ctrl+Shift+R atau jendela Incognito |
| `Password authentication is not supported` | GitHub menolak password biasa | Buat Personal Access Token (B6) |
| `remote origin already exists` | Sudah pernah disambungkan | Lewati; lanjut `git push` |
| `LF will be replaced by CRLF` | Peringatan format baris Windows | Abaikan, bukan error |

---

## Catatan
- **Keamanan:** token sesi disimpan di browser dan dikirim ke server tiap permintaan; kata sandi tetap di-hash di server. Repository publik tidak memuat rahasia apa pun.
- **Kuota Google:** batas eksekusi Apps Script berlaku seperti sebelumnya. Sesi kelas interaktif memanggil server tiap ±5–8 detik per pengguna; uji dulu pada satu pertemuan.
- **Domain sendiri:** nanti bisa dipasang di GitHub Pages (Settings → Pages → Custom domain). Tidak perlu mengubah kode.
- **Tidak ada iklan/pelacak pihak ketiga** di aplikasi ini.

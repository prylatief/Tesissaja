# Tesissaja

Pengecek tesis otomatis — seperti panel penilai, tapi langsung dari browser.
Unggah file `.docx` tesis dan PDF panduan penulisan, dapatkan temuan format,
catatan konten, dan pertanyaan sidang.

Dibangun dengan Next.js (App Router + TypeScript + Tailwind CSS).

## Cara kerja

1. **Cek format otomatis (client-side, tanpa server).** File `.docx` dibaca
   langsung di browser (JSZip + parser XML). Yang dicek:
   - F1 — penomoran footnote diulang dari 1 di tiap bab
   - F4 — ada bagan tapi tidak ada Daftar Gambar
   - F5 — Terjemah Kemenag dikutip di footnote tapi tidak ada di Daftar Pustaka
   - F7 — nomor volume jurnal di Daftar Pustaka tidak digarisbawahi
   - F8 — footnote pertama tanpa kota penerbit
   - F9 — footnote rujukan jurnal tanpa nomor halaman
   - F10 — penulisan “et.al.” yang salah
   - F11 — tanggal kosong di Abstrak/Kata Pengantar dan placeholder jumlah halaman
   - F12 — blok kutipan ayat tanpa spasi tunggal
   - F14 — penyebutan hadis tanpa footnote sanad/rawi/kitab (heuristik, perlu dicek)
   - F15 — jarak antar entri Daftar Pustaka bukan dua spasi
   - T7 — Bagan Kerangka Berpikir tanpa label “(Hipotesis Kerja)”
   - T8 — subbab “Wawancara” yang isinya menyatakan wawancara tidak dilakukan
   - F2 — nomor halaman Daftar Isi: **tidak bisa** diverifikasi di browser,
     ditampilkan sebagai peringatan cek manual (Update Field di Word)
2. **Panel AI (server-side, route `/api/analyze`).** Teks tesis dan panduan
   yang sudah diekstrak dikirim ke router Clouvia (OpenAI-compatible) untuk
   diperiksa 3 agen paralel: Agen Format, Agen Konten, dan Agen Penguji
   Kritis. Hasilnya: vonis, temuan tambahan, dan pertanyaan sidang
   (3 paling berbahaya ditandai).
3. **Laporan gabungan** bisa diunduh sebagai Markdown (`.md`).

File `.docx` mentah **tidak pernah** dikirim ke server — hanya teks yang
diekstrak.

## Panduan bawaan

`public/panduan-umj-2023.pdf` adalah *Panduan Penulisan Skripsi & Tesis
FAI UMJ 2023* (137 halaman) dan dipakai sebagai panduan default. Pengguna
juga bisa mengunggah PDF panduan lain.

Untuk mengganti panduan default: timpa file `public/panduan-umj-2023.pdf`
dengan PDF panduan lain, lalu perbarui labelnya di `app/page.tsx`.

## Menjalankan lokal

```bash
npm install
cp .env.local.example .env.local   # lalu isi CLOUVIA_API_KEY
npm run dev
```

Buka http://localhost:3000.

Tanpa `CLOUVIA_API_KEY`, cek format tetap jalan; panel AI akan meminta
API key (bisa juga ditempel langsung di halaman, tersimpan hanya di
localStorage browser).

## Deploy ke Vercel

1. Push repo ini ke GitHub.
2. Di Vercel: **Add New → Project → Import** repo ini.
3. Framework terdeteksi otomatis sebagai Next.js — biarkan pengaturan
   default.
4. Tambahkan Environment Variable: `CLOUVIA_API_KEY` = API key router
   Clouvia kamu.
5. Deploy.

## Environment variables

| Nama | Wajib | Keterangan |
| --- | --- | --- |
| `CLOUVIA_API_KEY` | Tidak (tapi panel AI butuh key) | API key router Clouvia (`https://router.clouvia.id/v1`). Bila kosong, pengguna wajib menempel key sendiri di halaman. |
| `CLOUVIA_MODEL` | Tidak | Model default panel AI (default: `gemini-3-flash`). Bila panggilan gagal, route mencoba sekali dengan model `auto`. |
| `CLOUVIA_BASE_URL` | Tidak | Base URL router (default: `https://router.clouvia.id`). Berguna untuk pengujian lokal dengan mock server. |

Jangan pernah menulis API key ke repo, ke log, atau ke kode. File
`.env.local` sudah masuk `.gitignore`.

## Batasan yang jujur

- **Nomor halaman Daftar Isi** tidak bisa diverifikasi di browser karena
  butuh pagination Word/LibreOffice. Selalu cek manual dengan
  Update Field di Word sebelum cetak.
- **Panel AI memakai model bahasa** dan bisa salah atau mengarang.
  Selalu cocokkan dengan panduan aslinya.
- **Cek F14 (hadis)** hanya heuristik — penyebutan hadis tanpa footnote
  di dekatnya ditandai “perlu dicek”, bukan vonis pasti.
- Teks yang dikirim ke panel AI dipotong (maks. ~100.000 karakter tesis,
  ~50.000 karakter panduan) agar panggilan API tetap cepat.

## Struktur

```
app/
  page.tsx            Halaman utama (upload, progres, hasil)
  api/analyze/route.ts  Panel AI 3 agen via Clouvia
lib/
  docx.ts             Parser .docx (JSZip + regex XML)
  formatChecks.ts     Cek format deterministik F1–F15, T7, T8
  pdf.ts              Ekstraksi teks PDF (pdfjs-dist)
  report.ts           Generator laporan Markdown
  types.ts            Tipe data bersama
public/
  panduan-umj-2023.pdf  Panduan default (FAI UMJ 2023)
  pdf.worker.min.mjs    Worker pdf.js (disajikan lokal, tanpa CDN)
```

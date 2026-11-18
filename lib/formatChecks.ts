import type { Finding, FormatCheckResult } from "./types";
import {
  getBibliographyEntries,
  getBibliographyText,
  type DocxData,
  type DocxParagraph,
} from "./docx";

/** Cek apakah angka volume pada paragraf ini digarisbawahi (run yang memuat angkanya punya <w:u>). */
function isVolumeUnderlined(p: DocxParagraph): boolean | null {
  const m = p.text.match(/(\d+)\s*\(\d+\)/); // pola "8 (5)"
  if (!m || m.index === undefined) return null;
  const volStart = m.index;
  const volEnd = volStart + m[1].length;
  let offset = 0;
  let found = false;
  let allUnderlined = true;
  for (const run of p.runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    if (runEnd > volStart && runStart < volEnd) {
      found = true;
      if (!run.underline) allUnderlined = false;
    }
    offset = runEnd;
  }
  return found ? allUnderlined : null;
}

export function runFormatChecks(doc: DocxData): FormatCheckResult {
  const findings: Finding[] = [];
  const passed: string[] = [];
  const fullText = doc.fullText;
  const bibEntries = getBibliographyEntries(doc);
  const bibText = getBibliographyText(doc);

  // ---------- F1: footnote diulang per bab ----------
  if (doc.footnoteRestartEachSection) {
    passed.push("F1 — Penomoran footnote diatur ulang dari 1 di tiap bab (Restart each section).");
  } else {
    findings.push({
      id: "F1",
      severity: "Kritis",
      title: "Penomoran footnote tidak diulang dari 1 di tiap bab",
      detail: `Ditemukan ${doc.footnotes.length} footnote dan pengaturan numRestart tidak ada di settings.xml — nomor footnote berjalan kontinu di seluruh dokumen. Panduan mewajibkan tiap bab mulai dari nomor 1.`,
      fix: "Di Word: References → Footnotes → Numbering → pilih “Restart each section” (tiap bab sudah section terpisah).",
      source: "format",
    });
  }

  // ---------- F2: nomor halaman Daftar Isi (JUJUR: tidak bisa diverifikasi di browser) ----------
  findings.push({
    id: "F2",
    severity: "Sedang",
    title: "Nomor halaman Daftar Isi tidak bisa diverifikasi di browser",
    detail:
      "Aplikasi web tidak bisa menghitung pagination seperti Word/LibreOffice, jadi nomor halaman pada Daftar Isi dan Daftar Tabel tidak bisa dicek otomatis di sini. Ini adalah temuan yang paling sering tertinggal puluhan halaman dari halaman sebenarnya.",
    fix: "Di Word: klik kanan Daftar Isi → Update Field → Update entire table, setelah naskah final. Lakukan hal yang sama untuk Daftar Tabel.",
    source: "format",
  });

  // ---------- F4: Daftar Gambar ----------
  const hasBagan = /\bBagan\s+\d/.test(fullText);
  const hasDaftarGambar = /DAFTAR\s+GAMBAR/i.test(fullText);
  if (hasBagan && !hasDaftarGambar) {
    const bagan = [...fullText.matchAll(/Bagan\s+\d+(?:\.\d+)?[^\n]{0,60}/g)]
      .slice(0, 3)
      .map((m) => m[0].trim());
    findings.push({
      id: "F4",
      severity: "Sedang",
      title: "Tidak ada Daftar Gambar, padahal ada bagan di dalam teks",
      detail: `Ditemukan penyebutan bagan (${bagan.join("; ") || "mis. Bagan 2.1"}) tetapi tidak ada bagian “Daftar Gambar” di bagian awal tesis.`,
      fix: "Tambahkan Daftar Gambar setelah Daftar Tabel yang memuat semua bagan, atau ganti istilahnya menjadi “Skema” agar konsisten.",
      source: "format",
    });
  } else if (hasBagan) {
    passed.push("F4 — Daftar Gambar tersedia untuk bagan yang dirujuk.");
  }

  // ---------- F5: Terjemah Kemenag dikutip tapi tidak ada di Daftar Pustaka ----------
  const footnoteText = doc.footnotes.map((f) => f.text).join("\n");
  const kemenagCited =
    /Kementerian Agama|Kemenag/i.test(footnoteText) ||
    /Terjemah/i.test(footnoteText);
  const kemenagInBib = /Kementerian Agama/i.test(bibText);
  if (kemenagCited && !kemenagInBib && bibEntries.length > 0) {
    findings.push({
      id: "F5",
      severity: "Sedang",
      title: "Terjemahan Al-Qur'an Kemenag dikutip di footnote tetapi tidak ada di Daftar Pustaka",
      detail:
        "Footnote mengutip terjemahan Kementerian Agama, tetapi tidak ditemukan entrinya di Daftar Pustaka.",
      fix: "Tambahkan entri: “Kementerian Agama Republik Indonesia. Al-Qur'an dan Terjemahnya. Jakarta: Kementerian Agama RI. 2019.” sesuai urutan alfabetis.",
      source: "format",
    });
  } else if (kemenagCited && kemenagInBib) {
    passed.push("F5 — Entri Terjemah Kemenag ada di Daftar Pustaka.");
  }

  // ---------- F7: volume jurnal tidak digarisbawahi ----------
  if (bibEntries.length > 0) {
    const withVolume = bibEntries.filter((p) => /(\d+)\s*\(\d+\)/.test(p.text));
    const notUnderlined = withVolume.filter((p) => isVolumeUnderlined(p) === false);
    if (notUnderlined.length > 0) {
      findings.push({
        id: "F7",
        severity: "Ringan",
        title: "Nomor volume jurnal di Daftar Pustaka tidak digarisbawahi",
        detail: `${notUnderlined.length} dari ${withVolume.length} entri jurnal berpola volume tidak digarisbawahi angkanya. Contoh: “${notUnderlined[0].text.slice(0, 90)}…”. Panduan: nomor volume ditulis angka Arab dan digarisbawahi tanpa kata “vol”.`,
        fix: "Beri underline (Ctrl+U) pada angka volume setiap entri jurnal di Daftar Pustaka.",
        source: "format",
      });
    } else if (withVolume.length > 0) {
      passed.push(`F7 — ${withVolume.length} nomor volume jurnal di Daftar Pustaka sudah digarisbawahi.`);
    }
  }

  // ---------- F8: footnote 1 tanpa kota penerbit ----------
  const fn1 = doc.footnotes[0];
  if (fn1 && /\([A-Z][A-Za-z ]*,\s*\d{4}\)/.test(fn1.text) && !/Jakarta:/.test(fn1.text)) {
    findings.push({
      id: "F8",
      severity: "Ringan",
      title: "Footnote pertama: format tempat penerbit tidak lengkap",
      detail: `Footnote ${fn1.id}: “…${fn1.text.slice(0, 120)}…” — tertulis “(Penerbit, Tahun)” tanpa kota.`,
      fix: "Tulis lengkap: “(Jakarta: APJII, 2026)” — kota, titik dua, penerbit, koma, tahun.",
      source: "format",
    });
  }

  // ---------- F9: footnote jurnal tanpa nomor halaman ----------
  const noPage = doc.footnotes.filter(
    (f) => /Vol\.|Jurnal/i.test(f.text) && !/\bh\.\s*\d/.test(f.text),
  );
  if (noPage.length > 0) {
    findings.push({
      id: "F9",
      severity: "Ringan",
      title: "Footnote rujukan jurnal tanpa nomor halaman",
      detail: `${noPage.length} footnote berisi rujukan jurnal (Vol./Jurnal) tetapi tidak mencantumkan rentang halaman. Contoh footnote ${noPage[0].id}: “…${noPage[0].text.slice(0, 110)}…”`,
      fix: "Tambahkan rentang halaman, mis. “, h. 182–209” di akhir footnote (cocokkan dengan Daftar Pustaka).",
      source: "format",
    });
  }

  // ---------- F10: "et.al." ----------
  const etAlWrong = (fullText.match(/et\.al\./g) || []).length;
  const etAlWrongFn = (footnoteText.match(/et\.al\./g) || []).length;
  const totalEtAlWrong = etAlWrong + etAlWrongFn;
  if (totalEtAlWrong > 0) {
    findings.push({
      id: "F10",
      severity: "Ringan",
      title: "Penulisan “et.al.” tidak konsisten",
      detail: `Ditemukan ${totalEtAlWrong} penulisan “et.al.” (dengan titik setelah “et”). Bentuk yang dipakai di Daftar Pustaka adalah “et al.”.`,
      fix: "Ganti semua “et.al.” menjadi “et al.” (Find & Replace di Word).",
      source: "format",
    });
  } else {
    passed.push("F10 — Penulisan “et al.” sudah konsisten (tidak ada “et.al.”).");
  }

  // ---------- F11: tanggal kosong & jumlah halaman ----------
  const frontMatter = doc.paragraphs.slice(0, 60).map((p) => p.text).join("\n");
  const blankDates = [...frontMatter.matchAll(/[.]{4,}\s*\d{4}/g)].map((m) => m[0].trim());
  if (blankDates.length > 0) {
    findings.push({
      id: "F11",
      severity: "Ringan",
      title: "Tanggal di Abstrak / Kata Pengantar masih kosong",
      detail: `Ditemukan ${blankDates.length} tanggal yang masih berupa titik-titik, contoh: “${blankDates[0]}”.`,
      fix: "Isi bulan dan tanggalnya, mis. “Tesis, November 2026” dan “Jakarta, November 2026 M”. Jangan mengisi tanggal Hijriah bila belum pasti.",
      source: "format",
    });
  }
  const pageCount = fullText.match(/([ivxl]+)\s*\+\s*(\d+)\s*halaman/i);
  if (pageCount) {
    if (pageCount[1].toLowerCase() === "x") {
      findings.push({
        id: "F11",
        severity: "Ringan",
        title: "Jumlah halaman di Abstrak masih memakai placeholder “x”",
        detail: `Tertulis “${pageCount[0]}” — angka Romawi bagian awal belum diisi.`,
        fix: "Hitung setelah pagination final: bagian awal dalam angka Romawi kecil + isi dalam angka Arab (mis. “xii + 123 halaman”).",
        source: "format",
      });
    } else {
      findings.push({
        id: "F11",
        severity: "Info",
        title: "Jumlah halaman di Abstrak perlu dicek manual",
        detail: `Tertulis “${pageCount[0]}”. Jumlah halaman hanya bisa dipastikan setelah pagination final di Word.`,
        fix: "Cek ulang angka ini setelah seluruh revisi selesai dan pagination final.",
        source: "format",
      });
    }
  }

  // ---------- F12: blok ayat tanpa spasi tunggal ----------
  // "Blok kutipan" = paragraf yang mayoritas huruf Arab dan cukup panjang
  // (bukan basmalah satu baris atau huruf hijaiyah di pedoman transliterasi).
  const isArabBlock = (p: (typeof doc.paragraphs)[number]) => {
    const arabChars = (p.text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabChars >= 20 && p.text.length >= 40;
  };
  const arabBlocks = doc.paragraphs.filter(isArabBlock);
  const arabBad = arabBlocks.filter(
    (p) => p.lineSpacing !== undefined && p.lineSpacing !== 240,
  );
  // Paragraf "Artinya:" dihitung bila mengikuti blok Arab (maks. 3 paragraf setelahnya)
  const artinyaBad = doc.paragraphs.filter((p) => {
    if (!/^Artinya/i.test(p.text.trim())) return false;
    if (p.lineSpacing === undefined || p.lineSpacing === 240) return false;
    for (let i = Math.max(0, p.index - 3); i < p.index; i++) {
      if (isArabBlock(doc.paragraphs[i])) return true;
    }
    return false;
  });
  if (arabBad.length > 0 || artinyaBad.length > 0) {
    findings.push({
      id: "F12",
      severity: "Ringan",
      title: "Blok kutipan ayat tidak memakai spasi tunggal",
      detail: `${arabBad.length} paragraf berhuruf Arab dan ${artinyaBad.length} paragraf terjemahan (“Artinya:…”) memakai spasi bukan tunggal (line spacing ≠ 240). Kutipan blok menurut panduan memakai spasi tunggal dengan indent kiri.`,
      fix: "Pilih blok ayat (Arab + “Artinya:” + terjemahan) → atur Line Spacing ke Single (1.0) dan indent kiri 720 twips (±5 ketukan).",
      source: "format",
    });
  } else if (arabBlocks.length > 0) {
    passed.push("F12 — Blok kutipan ayat sudah memakai spasi tunggal.");
  }

  // ---------- F14: hadis tanpa footnote rujukan ----------
  // Heuristik: footnote pertama SETELAH penyebutan hadis harus berisi rujukan
  // hadis (HR./nama kitab/no.). Bila footnote terdekat justru merujuk hal lain
  // (mis. kitab primer), penyebutan hadis itu ditandai "perlu dicek".
  const hadithRe = /HR\.|segumpal daging|istiqamah|beriman kepada Allah/i;
  const hadithRefRe =
    /HR\.|Bukhari|Muslim|Shahih|Tirmidzi|Abu D[au]wud|Nasa'?i|Ibnu Majah|Musnad|Ahmad/i;
  const footnoteById = new Map(doc.footnotes.map((f) => [f.id, f.text]));
  const hadithParas = doc.paragraphs.filter((p) => {
    // Bila sumber hadis sudah ditulis inline ("HR. al-Bukhari ..."), bukan temuan.
    if (/HR\.\s*(al-)?(Bukhari|Muslim|Tirmidzi|Abu|Nasa|Ibnu|Musnad|Ahmad)/i.test(p.text))
      return false;
    const m = p.text.match(hadithRe);
    if (!m || m.index === undefined) return false;
    const refAfter = p.footnoteRefs.find((r) => r.offset > m.index!);
    if (!refAfter) return true;
    const refText = footnoteById.get(refAfter.id) ?? "";
    return !hadithRefRe.test(refText);
  });
  if (hadithParas.length > 0) {
    findings.push({
      id: "F14",
      severity: "Ringan",
      title: "Penyebutan hadis tanpa footnote sanad/rawi/kitab",
      detail: `${hadithParas.length} penyebutan hadis tidak disertai footnote rujukan hadis (footnote terdekat setelah penyebutan merujuk hal lain). Contoh: “${hadithParas[0].text.slice(0, 140)}…”`,
      fix: "Tambahkan footnote berisi sanad/rawi dan kitab hadisnya (mis. “HR. al-Bukhari, Shahih al-Bukhari, Kitab al-Iman, no. 52; Muslim, Shahih Muslim, Kitab al-Musaqah, no. 1599”).",
      source: "format",
    });
  }

  // ---------- F15: spacing-after Daftar Pustaka ----------
  if (bibEntries.length > 0) {
    const withSpacing = bibEntries.filter((p) => p.spacingAfter !== undefined);
    const wrongSpacing = withSpacing.filter((p) => p.spacingAfter !== 480);
    if (wrongSpacing.length > 0) {
      findings.push({
        id: "F15",
        severity: "Ringan",
        title: "Jarak antar entri Daftar Pustaka bukan dua spasi",
        detail: `${wrongSpacing.length} dari ${withSpacing.length} entri memakai spacing-after ${wrongSpacing[0].spacingAfter} twips (bukan 480 twips ≈ dua spasi).`,
        fix: "Pilih semua entri Daftar Pustaka → Paragraph → Spacing After: 24 pt.",
        source: "format",
      });
    } else if (withSpacing.length > 0) {
      passed.push("F15 — Jarak antar entri Daftar Pustaka sudah dua spasi (480 twips).");
    }
  }

  // ---------- T7: Bagan 2.1 tanpa label hipotesis kerja ----------
  const baganMatch = fullText.match(/Bagan\s+\d+(?:\.\d+)?\s+Kerangka Berpikir[^\n]*/);
  if (baganMatch && !/Hipotesis Kerja/i.test(baganMatch[0])) {
    findings.push({
      id: "T7",
      severity: "Ringan",
      title: "Bagan Kerangka Berpikir tidak diberi label “hipotesis kerja”",
      detail: `Judul bagan tertulis “${baganMatch[0].trim()}” — rantai di dalamnya disajikan sebagai alur yang sudah pasti, padahal kedudukan dakwah–taklim adalah hipotesis/konstruksi yang diuji.`,
      fix: "Ubah judul menjadi “Bagan 2.1 Kerangka Berpikir (Hipotesis Kerja)”.",
      source: "format",
    });
  }

  // ---------- T8: subbab Wawancara yang isinya menyatakan tidak dilakukan ----------
  const wawancaraIdx = doc.paragraphs.findIndex((p) =>
    /^\s*(\d+\.\s*)?Wawancara\s*$/.test(p.text.trim()),
  );
  if (wawancaraIdx !== -1) {
    const next = doc.paragraphs[wawancaraIdx + 1];
    if (next && /tidak dilakukan/i.test(next.text)) {
      findings.push({
        id: "T8",
        severity: "Ringan",
        title: "Subbab “Wawancara” dicantumkan lalu dinyatakan tidak dilakukan",
        detail: `Subbab “Wawancara” di Bab III isinya hanya menyatakan wawancara tidak dilakukan karena tokoh sudah wafat.`,
        fix: "Hapus subbab tersebut dan ganti satu kalimat di awal Bab III D: “Seluruh data berasal dari teks sehingga tidak ada teknik wawancara.”",
        source: "format",
      });
    }
  }

  return {
    findings,
    passed,
    stats: {
      paragraphs: doc.paragraphs.length,
      footnotes: doc.footnotes.length,
      bibliographyEntries: bibEntries.length,
    },
  };
}

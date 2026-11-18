import type { CombinedReport, Severity } from "./types";

const SEV_ORDER: Severity[] = ["Kritis", "Sedang", "Ringan", "Info"];

export function buildMarkdownReport(r: CombinedReport): string {
  const lines: string[] = [];
  lines.push(`# Laporan Pengecekan Tesis — Tesissaja`);
  lines.push(``);
  lines.push(`- **File tesis:** ${r.thesisName}`);
  lines.push(`- **Panduan:** ${r.guideName}`);
  lines.push(`- **Tanggal:** ${r.generatedAt}`);
  if (r.ai) lines.push(`- **Model panel AI:** ${r.ai.model}`);
  lines.push(``);

  lines.push(`## Vonis`);
  lines.push(``);
  if (r.ai) {
    lines.push(`**${r.ai.verdict}** — ${r.ai.verdictReason}`);
  } else {
    lines.push(
      `Panel AI tidak berjalan${r.aiError ? ` (${r.aiError})` : ""}. Vonis di bawah ini hanya berdasarkan cek format otomatis.`,
    );
  }
  lines.push(``);

  const all = [
    ...r.format.findings,
    ...(r.ai ? r.ai.findings : []),
  ];
  const counts = (sev: Severity) => all.filter((f) => f.severity === sev).length;
  lines.push(`## Ringkasan temuan`);
  lines.push(``);
  lines.push(
    `- Kritis: ${counts("Kritis")} · Sedang: ${counts("Sedang")} · Ringan: ${counts("Ringan")} · Info: ${counts("Info")}`,
  );
  lines.push(
    `- Statistik dokumen: ${r.format.stats.paragraphs} paragraf, ${r.format.stats.footnotes} footnote, ${r.format.stats.bibliographyEntries} entri Daftar Pustaka.`,
  );
  lines.push(``);

  for (const sev of SEV_ORDER) {
    const list = all.filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    lines.push(`## ${sev} (${list.length})`);
    lines.push(``);
    for (const f of list) {
      lines.push(`### ${f.id} — ${f.title}`);
      lines.push(``);
      lines.push(f.detail);
      if (f.location) lines.push(`Lokasi: ${f.location}`);
      if (f.fix) lines.push(`Perbaikan: ${f.fix}`);
      lines.push(``);
    }
  }

  if (r.format.passed.length > 0) {
    lines.push(`## Yang sudah sesuai`);
    lines.push(``);
    for (const p of r.format.passed) lines.push(`- ${p}`);
    lines.push(``);
  }

  if (r.ai && r.ai.defenseQuestions.length > 0) {
    lines.push(`## Pertanyaan sidang (dari panel AI)`);
    lines.push(``);
    const dangerous = r.ai.defenseQuestions.filter((q) => q.dangerous);
    const rest = r.ai.defenseQuestions.filter((q) => !q.dangerous);
    if (dangerous.length > 0) {
      lines.push(`### Paling berbahaya`);
      lines.push(``);
      for (const q of dangerous) {
        lines.push(`- **${q.question}** (${q.category}) — ${q.why}`);
        if (q.hint) lines.push(`  Bocoran jawaban: ${q.hint}`);
      }
      lines.push(``);
    }
    for (const q of rest) {
      lines.push(`- **${q.question}** (${q.category}) — ${q.why}`);
      if (q.hint) lines.push(`  Bocoran jawaban: ${q.hint}`);
    }
    lines.push(``);
  }

  if (r.ai && r.ai.warnings.length > 0) {
    lines.push(`## Catatan panel AI`);
    lines.push(``);
    for (const w of r.ai.warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(
    `Batasan yang jujur: nomor halaman Daftar Isi tidak bisa diverifikasi di browser — cek manual dengan Update Field di Word. Panel AI memakai model bahasa dan bisa salah; selalu cocokkan dengan panduan aslinya. Dibuat dengan Tesissaja.`,
  );
  return lines.join("\n");
}

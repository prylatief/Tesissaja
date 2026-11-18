"use client";

import { useMemo, useRef, useState } from "react";
import { parseDocx } from "@/lib/docx";
import { runFormatChecks } from "@/lib/formatChecks";
import { extractPdfText } from "@/lib/pdf";
import { buildMarkdownReport } from "@/lib/report";
import type {
  AiAnalysis,
  CombinedReport,
  FormatCheckResult,
  Severity,
} from "@/lib/types";

type Phase =
  | "idle"
  | "reading-docx"
  | "reading-guide"
  | "analyzing"
  | "done"
  | "error";

const SEV_COLORS: Record<Severity, string> = {
  Kritis: "bg-red-100 text-red-800 border-red-300",
  Sedang: "bg-amber-100 text-amber-800 border-amber-300",
  Ringan: "bg-sky-100 text-sky-800 border-sky-300",
  Info: "bg-gray-100 text-gray-700 border-gray-300",
};

const SEV_ORDER: Severity[] = ["Kritis", "Sedang", "Ringan", "Info"];

const STEPS: { key: Phase; label: string }[] = [
  { key: "reading-docx", label: "Membaca file .docx & cek format" },
  { key: "reading-guide", label: "Membaca panduan" },
  { key: "analyzing", label: "Panel AI memeriksa isi" },
  { key: "done", label: "Selesai" },
];

export default function Home() {
  const [thesisFile, setThesisFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  // Muat key tersimpan (bila ada) — lazy initializer agar tidak setState di effect.
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem("tesissaja-clouvia-key") ?? "";
    } catch {
      return "";
    }
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<CombinedReport | null>(null);
  const [filter, setFilter] = useState<Severity | "Semua">("Semua");
  const resultRef = useRef<HTMLDivElement>(null);

  function saveApiKey(v: string) {
    setApiKey(v);
    try {
      if (v.trim()) localStorage.setItem("tesissaja-clouvia-key", v.trim());
      else localStorage.removeItem("tesissaja-clouvia-key");
    } catch {
      // abaikan
    }
  }

  const allFindings = useMemo(() => {
    if (!report) return [];
    return [
      ...report.format.findings,
      ...(report.ai ? report.ai.findings : []),
    ];
  }, [report]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { Kritis: 0, Sedang: 0, Ringan: 0, Info: 0 };
    for (const f of allFindings) c[f.severity]++;
    return c;
  }, [allFindings]);

  const visibleFindings = useMemo(
    () =>
      filter === "Semua"
        ? allFindings
        : allFindings.filter((f) => f.severity === filter),
    [allFindings, filter],
  );

  async function handleCheck() {
    if (!thesisFile) {
      setError("Pilih dulu file .docx tesisnya.");
      return;
    }
    setError("");
    setReport(null);
    setFilter("Semua");

    try {
      // 1. Baca .docx + cek format
      setPhase("reading-docx");
      setStatus("Membaca file .docx dan menjalankan cek format…");
      const buf = await thesisFile.arrayBuffer();
      const doc = await parseDocx(buf);
      const format: FormatCheckResult = runFormatChecks(doc);

      // 2. Baca panduan (upload atau bawaan UMJ 2023)
      setPhase("reading-guide");
      let guideName = "Panduan Penulisan Skripsi & Tesis FAI UMJ 2023 (bawaan)";
      let guideText = "";
      if (guideFile) {
        setStatus("Membaca PDF panduan yang diunggah…");
        const gbuf = await guideFile.arrayBuffer();
        const g = await extractPdfText(gbuf);
        guideText = g.text;
        guideName = guideFile.name;
      } else {
        setStatus("Membaca PDF panduan UMJ 2023 bawaan (137 halaman)…");
        const res = await fetch("/panduan-umj-2023.pdf");
        if (!res.ok) throw new Error("Gagal memuat panduan bawaan.");
        const gbuf = await res.arrayBuffer();
        const g = await extractPdfText(gbuf);
        guideText = g.text;
      }

      // 3. Panel AI (server-side)
      setPhase("analyzing");
      setStatus("Panel AI memeriksa isi tesis (3 agen: format, konten, penguji)…");
      let ai: AiAnalysis | null = null;
      let aiError: string | undefined;
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thesisText: doc.fullText,
            guideText,
            clientKey: apiKey.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          aiError = typeof data?.error === "string" ? data.error : "Panel AI gagal.";
        } else {
          ai = data as AiAnalysis;
        }
      } catch {
        aiError = "Tidak bisa menghubungi panel AI. Periksa koneksi lalu coba lagi.";
      }

      setReport({
        thesisName: thesisFile.name,
        guideName,
        format,
        ai,
        aiError,
        generatedAt: new Date().toLocaleString("id-ID", {
          dateStyle: "long",
          timeStyle: "short",
        }),
      });
      setPhase("done");
      setStatus("");
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof Error
          ? e.message
          : "Terjadi kesalahan saat memeriksa tesis.",
      );
    }
  }

  function downloadReport() {
    if (!report) return;
    const md = buildMarkdownReport(report);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "laporan-tesissaja.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = phase === "reading-docx" || phase === "reading-guide" || phase === "analyzing";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-emerald-800 sm:text-5xl">
          Tesissaja
        </h1>
        <p className="mt-3 text-base text-gray-600 sm:text-lg">
          Pengecek tesis otomatis — seperti panel penilai, tapi langsung dari
          browser. Unggah .docx tesis dan panduan, dapatkan temuan format,
          catatan konten, dan pertanyaan sidang.
        </p>
      </header>

      {/* ---------- Form ---------- */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-5">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-800">
              File tesis (.docx) <span className="text-red-600">*</span>
            </label>
            <input
              type="file"
              accept=".docx"
              disabled={busy}
              onChange={(e) => setThesisFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-800"
            />
            <p className="mt-1 text-xs text-gray-500">
              File tidak diunggah ke server — hanya teks yang diekstrak yang
              dikirim ke panel AI.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-800">
              Panduan penulisan (PDF, opsional)
            </label>
            <input
              type="file"
              accept=".pdf"
              disabled={busy}
              onChange={(e) => setGuideFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-gray-800"
            />
            <p className="mt-1 text-xs text-gray-500">
              Kosongkan untuk memakai panduan bawaan: Panduan Penulisan
              Skripsi &amp; Tesis FAI UMJ 2023.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-800">
              API key Clouvia (opsional — untuk panel AI)
            </label>
            <input
              type="password"
              value={apiKey}
              disabled={busy}
              onChange={(e) => saveApiKey(e.target.value)}
              placeholder="clv_live_…"
              autoComplete="off"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Kosongkan bila server sudah punya key (env CLOUVIA_API_KEY).
              Key yang ditempel di sini hanya tersimpan di browser kamu
              (localStorage) dan tidak pernah dikirim ke mana pun kecuali ke
              router Clouvia saat pemeriksaan berjalan.
            </p>
          </div>

          <button
            onClick={handleCheck}
            disabled={busy || !thesisFile}
            className="rounded-xl bg-emerald-700 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Memeriksa…" : "Periksa Tesis"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {busy && (
          <div className="mt-5">
            <ol className="space-y-2">
              {STEPS.map((s) => {
                const order = ["reading-docx", "reading-guide", "analyzing", "done"];
                const cur = order.indexOf(phase);
                const idx = order.indexOf(s.key);
                const done = idx < cur;
                const active = idx === cur;
                return (
                  <li key={s.key} className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                        done
                          ? "bg-emerald-600 text-white"
                          : active
                            ? "bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400"
                            : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {done ? "✓" : idx + 1}
                    </span>
                    <span className={active ? "font-semibold text-gray-900" : "text-gray-600"}>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            {status && <p className="mt-3 text-sm text-gray-500">{status}</p>}
          </div>
        )}
      </section>

      {/* ---------- Hasil ---------- */}
      {report && (
        <section ref={resultRef} className="mt-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-2xl font-bold text-gray-900">Hasil Pemeriksaan</h2>
            <p className="mt-1 text-sm text-gray-500">
              {report.thesisName} · {report.guideName} · {report.generatedAt}
            </p>

            {/* Vonis */}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-900">
                Vonis:{" "}
                {report.ai ? report.ai.verdict : "Cek format selesai (panel AI tidak berjalan)"}
              </p>
              {report.ai && (
                <p className="mt-1 text-sm text-emerald-900/80">{report.ai.verdictReason}</p>
              )}
              {report.aiError && (
                <p className="mt-1 text-sm text-amber-800">
                  Panel AI tidak berjalan: {report.aiError} Cek format di
                  bawah tetap bisa dipakai.
                </p>
              )}
              {report.ai && report.ai.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                  {report.ai.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Statistik */}
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">{report.format.stats.paragraphs}</p>
                <p className="text-xs text-gray-500">paragraf</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">{report.format.stats.footnotes}</p>
                <p className="text-xs text-gray-500">footnote</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">
                  {report.format.stats.bibliographyEntries}
                </p>
                <p className="text-xs text-gray-500">entri Daftar Pustaka</p>
              </div>
            </div>

            {/* Filter keparahan */}
            <div className="mt-6 flex flex-wrap gap-2">
              {(["Semua", ...SEV_ORDER] as const).map((sev) => {
                const n = sev === "Semua" ? allFindings.length : counts[sev];
                const active = filter === sev;
                return (
                  <button
                    key={sev}
                    onClick={() => setFilter(sev)}
                    className={`rounded-full border px-3 py-1 text-sm font-medium ${
                      active
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-gray-300 bg-white text-gray-700 hover:border-emerald-600"
                    }`}
                  >
                    {sev} ({n})
                  </button>
                );
              })}
            </div>

            {/* Daftar temuan */}
            <div className="mt-4 space-y-3">
              {visibleFindings.length === 0 && (
                <p className="text-sm text-gray-500">
                  Tidak ada temuan pada filter ini. Bagus!
                </p>
              )}
              {visibleFindings.map((f, i) => (
                <article key={`${f.id}-${i}`} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV_COLORS[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
                      {f.id}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {f.source === "format" ? "cek format" : "panel AI"}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold text-gray-900">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">{f.detail}</p>
                  {f.fix && (
                    <p className="mt-2 text-sm text-emerald-800">
                      <span className="font-semibold">Perbaikan: </span>
                      {f.fix}
                    </p>
                  )}
                </article>
              ))}
            </div>

            {/* Yang sudah sesuai */}
            {report.format.passed.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold text-gray-900">Yang sudah sesuai</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {report.format.passed.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pertanyaan sidang */}
            {report.ai && report.ai.defenseQuestions.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold text-gray-900">
                  Pertanyaan sidang (dari panel AI)
                </h3>
                {report.ai.defenseQuestions.filter((q) => q.dangerous).length > 0 && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-800">
                      Paling berbahaya — kuasai jawabannya sebelum sidang:
                    </p>
                    <ul className="mt-2 space-y-3">
                      {report.ai.defenseQuestions
                        .filter((q) => q.dangerous)
                        .map((q, i) => (
                          <li key={i} className="text-sm text-gray-800">
                            <span className="font-semibold">“{q.question}”</span>
                            <span className="text-gray-600"> ({q.category}) — {q.why}</span>
                            {q.hint && (
                              <span className="block text-gray-700">
                                Bocoran jawaban: {q.hint}
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                <ol className="mt-3 list-decimal space-y-3 pl-5">
                  {report.ai.defenseQuestions
                    .filter((q) => !q.dangerous)
                    .map((q, i) => (
                      <li key={i} className="text-sm text-gray-800">
                        <span className="font-semibold">“{q.question}”</span>
                        <span className="text-gray-600"> ({q.category}) — {q.why}</span>
                        {q.hint && (
                          <span className="block text-gray-700">
                            Bocoran jawaban: {q.hint}
                          </span>
                        )}
                      </li>
                    ))}
                </ol>
              </div>
            )}

            <button
              onClick={downloadReport}
              className="mt-6 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Unduh laporan (.md)
            </button>
          </div>
        </section>
      )}

      <footer className="mt-10 border-t border-gray-200 pt-5 text-center text-xs leading-relaxed text-gray-500">
        <p>
          Tesissaja — pengecek tesis otomatis. Cek format berjalan sepenuhnya
          di browser; panel AI memakai router Clouvia dan butuh API key.
        </p>
        <p className="mt-1">
          Batasan yang jujur: nomor halaman Daftar Isi tidak bisa diverifikasi
          di browser (cek manual dengan Update Field di Word). Hasil panel AI
          bisa salah — selalu cocokkan dengan panduan aslinya.
        </p>
      </footer>
    </main>
  );
}

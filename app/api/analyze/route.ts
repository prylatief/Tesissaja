import type { AiAnalysis, DefenseQuestion, Finding, Severity } from "@/lib/types";

export const maxDuration = 60;

const CLOUVIA_BASE_URL = (
  process.env.CLOUVIA_BASE_URL || "https://router.clouvia.id"
).replace(/\/$/, "");
const CLOUVIA_URL = `${CLOUVIA_BASE_URL}/v1/chat/completions`;
const DEFAULT_MODEL =
  process.env.CLOUVIA_MODEL || "gemini-3-flash";
const FALLBACK_MODEL = "auto";
const CALL_TIMEOUT_MS = 25_000;

const MAX_THESIS_CHARS = 100_000;
const MAX_GUIDE_CHARS = 50_000;

interface AnalyzeBody {
  thesisText?: string;
  guideText?: string;
  clientKey?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n\n[...teks dipotong untuk analisis...]" : s;
}

/** Ambil JSON dari jawaban model: coba parse langsung, lalu blok ```json, lalu objek pertama. */
function extractJson(text: string): unknown {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // lanjut
  }
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // lanjut
    }
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // lanjut
    }
  }
  throw new Error("Model tidak mengembalikan JSON yang valid.");
}

function isValidSeverity(s: unknown): s is Severity {
  return s === "Kritis" || s === "Sedang" || s === "Ringan" || s === "Info";
}

function normalizeFindings(raw: unknown): Finding[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { findings?: unknown }).findings;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f, i) => ({
      id: typeof f.id === "string" && f.id ? f.id : `AI-${i + 1}`,
      severity: isValidSeverity(f.severity) ? f.severity : "Ringan",
      title: typeof f.title === "string" ? f.title : "Temuan panel AI",
      detail: typeof f.detail === "string" ? f.detail : "",
      fix: typeof f.fix === "string" ? f.fix : undefined,
      source: "ai" as const,
    }))
    .filter((f) => f.title && f.detail);
}

function normalizeQuestions(raw: unknown): DefenseQuestion[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
    .map((q) => ({
      question: typeof q.question === "string" ? q.question : "",
      category: typeof q.category === "string" ? q.category : "Umum",
      why: typeof q.why === "string" ? q.why : "",
      dangerous: q.dangerous === true,
      hint: typeof q.hint === "string" ? q.hint : undefined,
    }))
    .filter((q) => q.question);
}

async function callClouvia(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(CLOUVIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Clouvia mengembalikan HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Clouvia mengembalikan jawaban kosong.");
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Panggilan ke Clouvia kehabisan waktu (timeout).");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Panggil Clouvia; bila model utama gagal, coba sekali dengan model fallback ("auto"). */
async function callClouviaWithFallback(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  try {
    return await callClouvia(apiKey, DEFAULT_MODEL, systemPrompt, userPrompt);
  } catch (err) {
    if (DEFAULT_MODEL === FALLBACK_MODEL) throw err;
    return await callClouvia(apiKey, FALLBACK_MODEL, systemPrompt, userPrompt);
  }
}

const FORMAT_SYSTEM = `Kamu adalah Agen Format & Footnote dalam panel penilai tesis. Tugasmu memeriksa naskah tesis terhadap panduan penulisan yang diberikan. Fokus pada: penomoran footnote (apakah diulang per bab), kelengkapan Daftar Isi/Daftar Tabel/Daftar Gambar, format Daftar Pustaka (alfabetis, volume jurnal, entri yang dikutip tapi tidak ada di daftar pustaka), tanggal kosong, spasi kutipan blok, dan konsistensi penulisan (mis. "et al."). Jangan mengarang nomor halaman — bila tidak bisa memastikan halaman, tulis apa adanya. Kembalikan HANYA JSON valid tanpa teks lain, dengan bentuk: {"findings": [{"id": "F1", "severity": "Kritis|Sedang|Ringan|Info", "title": "...", "detail": "...", "fix": "cara memperbaikinya"}]}. Maksimal 12 temuan, urutkan dari yang paling penting.`;

const CONTENT_SYSTEM = `Kamu adalah Agen Konten dalam panel penilai tesis. Tugasmu menilai substansi: konsistensi rantai masalah–tujuan–temuan–kesimpulan, klaim kebaruan (apakah klaim di Abstrak/Bab I selaras dengan yang dipertahankan di Bab IV), pembagian peran/konsep yang diakui sebagai konstruksi peneliti, ketegangan antara klaim kegunaan praktis dan keterbatasan temuan, masalah motivasi yang tidak dijawab, pembacaan sebagian atas sumber kunci, dan keterbatasan data. Beri vonis salah satu: "Siap sidang", "Siap sidang dengan revisi", atau "Belum siap sidang", beserta alasan satu kalimat. Kembalikan HANYA JSON valid tanpa teks lain, dengan bentuk: {"verdict": "...", "verdictReason": "...", "findings": [{"id": "T1", "severity": "Kritis|Sedang|Ringan|Info", "title": "...", "detail": "...", "fix": "..."}]}. Maksimal 10 temuan.`;

const EXAMINER_SYSTEM = `Kamu adalah Agen Penguji Kritis dalam panel penilai tesis — seorang penguji sidang yang tajam. Tugasmu menyusun pertanyaan jebakan sidang berdasarkan kelemahan nyata naskah: apakah konsep utama milik tokoh atau konstruksi peneliti, ketegangan antar bab, metodologi (triangulasi, aturan yang "bisa gagal"), keterbatasan data dan pembacaan sebagian, serta kegunaan hasil. Tandai 3 pertanyaan paling berbahaya dengan dangerous: true. Kembalikan HANYA JSON valid tanpa teks lain, dengan bentuk: {"questions": [{"question": "...", "category": "Konseptual|Metodologi|Data & Analisis|Kontribusi|Umum", "why": "mengapa pertanyaan ini muncul", "dangerous": false, "hint": "bocoran jawaban singkat"}]}. Buat 12–16 pertanyaan.`;

export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return Response.json(
      { error: "Body permintaan bukan JSON yang valid." },
      { status: 400 },
    );
  }

  const thesisText = typeof body.thesisText === "string" ? body.thesisText : "";
  const guideText = typeof body.guideText === "string" ? body.guideText : "";
  if (thesisText.trim().length < 200) {
    return Response.json(
      { error: "Teks tesis terlalu pendek atau kosong. Pastikan file .docx berhasil dibaca." },
      { status: 400 },
    );
  }

  const apiKey = (body.clientKey?.trim() || process.env.CLOUVIA_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "API key Clouvia belum tersedia. Tempelkan API key Clouvia di kolom yang disediakan, atau atur env CLOUVIA_API_KEY di server.",
      },
      { status: 400 },
    );
  }

  const thesis = truncate(thesisText, MAX_THESIS_CHARS);
  const guide = guideText
    ? truncate(guideText, MAX_GUIDE_CHARS)
    : "(Panduan tidak disertakan — nilai berdasarkan kaidah umum penulisan tesis.)";
  const userPrompt = `PANDUAN PENULISAN (dipotong bila terlalu panjang):\n${guide}\n\n==========\n\nNASKAH TESIS (dipotong bila terlalu panjang):\n${thesis}`;

  const model = DEFAULT_MODEL;
  const results = await Promise.allSettled([
    callClouviaWithFallback(apiKey, FORMAT_SYSTEM, userPrompt),
    callClouviaWithFallback(apiKey, CONTENT_SYSTEM, userPrompt),
    callClouviaWithFallback(apiKey, EXAMINER_SYSTEM, userPrompt),
  ]);

  const warnings: string[] = [];
  const findings: Finding[] = [];
  let verdict = "Siap sidang dengan revisi";
  let verdictReason = "Vonis default — agen konten tidak mengembalikan vonis.";
  const defenseQuestions: DefenseQuestion[] = [];

  const labels = ["Agen Format", "Agen Konten", "Agen Penguji"];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      warnings.push(`${labels[i]} gagal: ${r.reason instanceof Error ? r.reason.message : "error tidak diketahui"}`);
      return;
    }
    try {
      const parsed = extractJson(r.value);
      if (i === 0) {
        findings.push(...normalizeFindings(parsed));
      } else if (i === 1) {
        findings.push(...normalizeFindings(parsed));
        if (parsed && typeof parsed === "object") {
          const p = parsed as { verdict?: unknown; verdictReason?: unknown };
          if (typeof p.verdict === "string" && p.verdict) verdict = p.verdict;
          if (typeof p.verdictReason === "string" && p.verdictReason)
            verdictReason = p.verdictReason;
        }
      } else {
        defenseQuestions.push(...normalizeQuestions(parsed));
      }
    } catch {
      warnings.push(`${labels[i]} mengembalikan jawaban yang tidak bisa dibaca sebagai JSON.`);
    }
  });

  if (findings.length === 0 && defenseQuestions.length === 0) {
    return Response.json(
      {
        error:
          "Panel AI gagal menghasilkan hasil. " +
          (warnings.length > 0 ? warnings.join(" ") : "Coba lagi beberapa saat lagi."),
      },
      { status: 502 },
    );
  }

  // Batasi 3 pertanyaan paling berbahaya
  const dangerous = defenseQuestions.filter((q) => q.dangerous);
  if (dangerous.length > 3) {
    let kept = 0;
    for (const q of defenseQuestions) {
      if (q.dangerous) {
        kept++;
        if (kept > 3) q.dangerous = false;
      }
    }
  }

  const result: AiAnalysis = {
    verdict,
    verdictReason,
    findings,
    defenseQuestions,
    model,
    warnings,
  };
  return Response.json(result);
}

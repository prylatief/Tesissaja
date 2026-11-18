import JSZip from "jszip";

/**
 * Parser .docx murni berbasis regex (tanpa DOMParser) supaya bisa jalan
 * identik di browser maupun Node. Hanya mengambil struktur yang dibutuhkan
 * untuk cek format: paragraf + properti spasi/indent, run + underline,
 * footnote, dan settings.xml.
 */

export interface DocxRun {
  text: string;
  underline: boolean;
}

export interface DocxParagraph {
  index: number;
  text: string;
  xml: string;
  runs: DocxRun[];
  lineSpacing?: number; // w:line (240 = spasi tunggal, 480 = ganda)
  spacingAfter?: number; // w:after dalam twips
  indentLeft?: number;
  styleId?: string;
  hasFootnoteRef: boolean;
  /** Offset karakter (dalam teks paragraf) tempat footnoteReference muncul. */
  footnoteRefOffsets: number[];
  /** Footnote reference beserta id footnote-nya, urut kemunculan. */
  footnoteRefs: { offset: number; id: number }[];
}

export interface DocxFootnote {
  id: number;
  text: string;
}

export interface DocxData {
  paragraphs: DocxParagraph[];
  footnotes: DocxFootnote[];
  footnoteRestartEachSection: boolean;
  fullText: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTextFromXml(xml: string): string {
  const parts: string[] = [];
  const re = /<w:(t|tab|br)(?:\s[^>]*)?(\/>|>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    if (tag === "t") {
      const close = xml.indexOf("</w:t>", re.lastIndex);
      if (close === -1) break;
      parts.push(decodeEntities(xml.slice(re.lastIndex, close)));
      re.lastIndex = close + 6;
      last = re.lastIndex;
    } else if (tag === "tab") {
      parts.push("\t");
      last = re.lastIndex;
    } else if (tag === "br") {
      parts.push("\n");
      last = re.lastIndex;
    }
  }
  void last;
  return parts.join("");
}

function parseRuns(pXml: string): {
  runs: DocxRun[];
  footnoteRefOffsets: number[];
  footnoteRefs: { offset: number; id: number }[];
} {
  const runs: DocxRun[] = [];
  const footnoteRefOffsets: number[] = [];
  const footnoteRefs: { offset: number; id: number }[] = [];
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  let offset = 0;
  while ((m = runRe.exec(pXml)) !== null) {
    const runXml = m[1];
    const refRe = /<w:footnoteReference[^>]*w:id="(\d+)"[^>]*\/?>/g;
    let r: RegExpExecArray | null;
    while ((r = refRe.exec(runXml)) !== null) {
      const textBefore = extractTextFromXml(runXml.slice(0, r.index));
      footnoteRefOffsets.push(offset + textBefore.length);
      footnoteRefs.push({
        offset: offset + textBefore.length,
        id: parseInt(r[1], 10),
      });
    }
    const rPr = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const underline = !!rPr && /<w:u(?:\s|\/>|>)/.test(rPr[1]);
    const text = extractTextFromXml(runXml);
    if (text) runs.push({ text, underline });
    offset += text.length;
  }
  return { runs, footnoteRefOffsets, footnoteRefs };
}

function parseParagraph(pXml: string, index: number): DocxParagraph {
  const { runs, footnoteRefOffsets, footnoteRefs } = parseRuns(pXml);
  const text = runs.map((r) => r.text).join("");
  const pPr = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const pPrXml = pPr ? pPr[1] : "";
  const line = pPrXml.match(/<w:spacing[^>]*\sw:line="(\d+)"/);
  const after = pPrXml.match(/<w:spacing[^>]*\sw:after="(\d+)"/);
  const ind = pPrXml.match(/<w:ind[^>]*\sw:left="(\d+)"/);
  const style = pPrXml.match(/<w:pStyle[^>]*\sw:val="([^"]+)"/);
  return {
    index,
    text,
    xml: pXml,
    runs,
    lineSpacing: line ? parseInt(line[1], 10) : undefined,
    spacingAfter: after ? parseInt(after[1], 10) : undefined,
    indentLeft: ind ? parseInt(ind[1], 10) : undefined,
    styleId: style ? style[1] : undefined,
    hasFootnoteRef: footnoteRefOffsets.length > 0,
    footnoteRefOffsets,
    footnoteRefs,
  };
}

export async function parseDocx(
  data: ArrayBuffer | Uint8Array,
): Promise<DocxData> {
  const zip = await JSZip.loadAsync(data);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("File bukan .docx yang valid (word/document.xml tidak ditemukan).");
  const docXml = await docXmlFile.async("string");

  const paragraphs: DocxParagraph[] = [];
  const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = pRe.exec(docXml)) !== null) {
    const p = parseParagraph(m[1], idx);
    // Simpan xml lengkap paragraf (termasuk tag pembuka) untuk pengecekan lanjutan
    p.xml = m[0];
    paragraphs.push(p);
    idx++;
  }

  const footnotes: DocxFootnote[] = [];
  const fnFile = zip.file("word/footnotes.xml");
  if (fnFile) {
    const fnXml = await fnFile.async("string");
    const fnRe = /<w:footnote\s[^>]*w:id="(-?\d+)"[^>]*>([\s\S]*?)<\/w:footnote>/g;
    let f: RegExpExecArray | null;
    while ((f = fnRe.exec(fnXml)) !== null) {
      const id = parseInt(f[1], 10);
      // id <= 0 adalah separator/continuation (Word memakai 0/1/2, LibreOffice -1/0) — bukan footnote isi
      if (id <= 0) continue;
      footnotes.push({ id, text: extractTextFromXml(f[2]) });
    }
  }

  let footnoteRestartEachSection = false;
  const settingsFile = zip.file("word/settings.xml");
  if (settingsFile) {
    const settingsXml = await settingsFile.async("string");
    footnoteRestartEachSection =
      /<w:footnotePr>[\s\S]*?<w:numRestart[^>]*w:val="eachSect"/.test(settingsXml);
  }

  return {
    paragraphs,
    footnotes,
    footnoteRestartEachSection,
    fullText: paragraphs.map((p) => p.text).join("\n"),
  };
}

/** Ambil entri Daftar Pustaka: paragraf setelah heading DAFTAR PUSTAKA sampai heading besar berikutnya. */
export function getBibliographyEntries(doc: DocxData): DocxParagraph[] {
  const start = doc.paragraphs.findIndex((p) =>
    /^\s*DAFTAR\s+PUSTAKA\s*$/i.test(p.text.trim()),
  );
  if (start === -1) return [];
  const entries: DocxParagraph[] = [];
  for (let i = start + 1; i < doc.paragraphs.length; i++) {
    const t = doc.paragraphs[i].text.trim();
    if (/^(RIWAYAT HIDUP|LAMPIRAN|BAB\s+[IVXLC]+|DAFTAR\s+(TABEL|GAMBAR|GRAFIK|LAMPIRAN))\b/i.test(t)) break;
    if (t) entries.push(doc.paragraphs[i]);
  }
  return entries;
}

export function getBibliographyText(doc: DocxData): string {
  return getBibliographyEntries(doc)
    .map((p) => p.text)
    .join("\n");
}

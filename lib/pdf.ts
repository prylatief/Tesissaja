/**
 * Ekstraksi teks PDF client-side via pdfjs-dist.
 * Worker disajikan dari /public/pdf.worker.min.mjs agar tidak perlu CDN.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<{
  text: string;
  pages: number;
}> {
  const pdfjsLib = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? (it.str as string) : ""))
      .join(" ");
    text += `\n--- Halaman ${i} ---\n${pageText}`;
  }
  return { text, pages: pdf.numPages };
}

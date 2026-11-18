export type Severity = "Kritis" | "Sedang" | "Ringan" | "Info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  location?: string;
  fix?: string;
  source: "format" | "ai";
}

export interface DefenseQuestion {
  question: string;
  category: string;
  why: string;
  dangerous?: boolean;
  hint?: string;
}

export interface AiAnalysis {
  verdict: string;
  verdictReason: string;
  findings: Finding[];
  defenseQuestions: DefenseQuestion[];
  model: string;
  warnings: string[];
}

export interface FormatCheckResult {
  findings: Finding[];
  passed: string[];
  stats: {
    paragraphs: number;
    footnotes: number;
    bibliographyEntries: number;
  };
}

export interface CombinedReport {
  thesisName: string;
  guideName: string;
  format: FormatCheckResult;
  ai: AiAnalysis | null;
  aiError?: string;
  generatedAt: string;
}

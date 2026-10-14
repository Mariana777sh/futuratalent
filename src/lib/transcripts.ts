import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";

export type CandidateTranscriptDraft = {
  name: string;
  text: string;
  duplicate: boolean;
  sectionIndex: number;
};

const ignoredHeadings = new Set([
  "AB INBEV",
  "AI SEA",
  "AVENUE CODE",
  "BUNNY STUDIO",
  "EQUIPE SIGA",
  "ESTUDIAT COM VOCE",
  "FEEDBACK FOR HIM",
  "FIXED SOLUTIONS",
  "FRESH AND DASH",
  "GENOA PERFORMANCE",
  "GRUPO ALUS",
  "INFERENCE ANALYTICS",
  "JUNGLE SCOUT",
  "KUEPA EDUTECH",
  "LEMON ENERGIA",
  "LOST PROFILES",
  "MERCADO LIVRE",
  "PEDIDOS YA",
  "PIVOT VENTURES",
  "RAISE UP",
  "RIGHT BALANCE",
  "SPOZZ CLUB",
  "STEALTH STARTUP",
  "SIX FEET UP",
  "TORO INVESTIMENTOS",
  "VOZ AI",
  "ZE DELIVERY",
  "PROJECTOS DRIVEN",
  "BAIRES DEV",
  "INNOVACION IMFD",
]);

const namedCandidateHeadings = [
  "Arnold",
  "Cesar Pimiento",
  "Jose Miguel Quintana",
  "Jose Miguel",
  "Misael Torres",
  "Salomon Novoa",
  "Fabio Melo",
  "Alejo Lopez",
  "Sergio",
  "Benjamin Fintual",
  "Matias Martini",
];

const ignoredHeadingWords = new Set([
  "AI", "ANALYST", "ANALYTICS", "APP", "APRIL", "AUGUST", "BACKEND", "CAPITAL", "CARD", "CAREER",
  "CLUB", "CODE", "DECEMBER", "DATA", "DELIVERY", "EDUTECH", "ENERGIA", "ENERGY", "FEBRUARY",
  "FRIDAY", "HEALTHCARE", "INC", "INBEV", "INNOVATION", "INVESTIMENTOS", "IT", "JANUARY", "JULY",
  "JUNE", "LIVRE", "MARCH", "MONDAY", "NEXT", "NOVEMBER", "NOT", "OCTOBER", "ONLINE", "PARTNERS",
  "RELOCATION", "SATURDAY", "SEA", "SENIOR", "SEPTEMBER", "SIGA", "SOFTWARE", "SOLUTIONS", "STARTUP",
  "STUDIO", "SUNDAY", "TECH", "THURSDAY", "TUESDAY", "VENTURES", "WEDNESDAY", "WEEK", "WHY",
]);

function headingKey(value: string) {
  return value.replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function transcriptDirectory() {
  return path.join(process.cwd(), "data", "transcripts");
}

function headingName(line: string): string | null {
  const cleaned = line.trim().replace(/^[●•*-]\s*/, "");
  const knownCandidate = namedCandidateHeadings.find((name) => {
    const remainder = cleaned.slice(name.length);
    return normalizeCandidateName(cleaned.slice(0, name.length)) === normalizeCandidateName(name)
      && (!remainder || /^[\s—–:/-]/.test(remainder));
  });
  if (knownCandidate) return knownCandidate;

  const allCaps = cleaned.match(/^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'.-]*(?:\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'.-]*){1,3})(?:\s+[—–-].*)?$/u);
  if (allCaps) {
    const name = allCaps[1].trim().replace(/[.'-]+$/g, "");
    const words = headingKey(name).split(/\s+/);
    if (ignoredHeadings.has(headingKey(name)) || words.some((word) => ignoredHeadingWords.has(word))) return null;
    return name;
  }
  return null;
}

export function splitCandidateNotes(rawText: string, knownNames: Set<string>): CandidateTranscriptDraft[] {
  const text = rawText.replace(/^--\s+\d+\s+of\s+\d+\s+--\s*$/gm, "").trim();
  const lines = text.split(/\r?\n/);
  const starts: { line: number; name: string }[] = [];
  const separators = lines.flatMap((line, index) => /^\s*[_=*-]{8,}\s*$/.test(line) ? [index] : []);

  for (let i = 0; i < lines.length; i++) {
    const name = headingName(lines[i]);
    if (!name) continue;
    const normalized = normalizeCandidateName(name);
    const previous = starts[starts.length - 1];
    if (previous && normalizeCandidateName(previous.name) === normalized) continue;
    starts.push({ line: i, name });
  }

  const seenNames = new Set(knownNames);
  return starts.map(({ line, name }, index) => {
    const nextHeading = starts[index + 1]?.line ?? lines.length;
    const nextSeparator = separators.find((separator) => separator > line) ?? lines.length;
    const endLine = Math.min(nextHeading, nextSeparator);
    const normalized = normalizeCandidateName(name);
    const possibleDuplicate = [...seenNames].some((seen) => {
      const sameName = seen === normalized;
      const sharedFirstNames = [seen, normalized].some((value) => value.split(" ").length < 2);
      return sameName || (!sharedFirstNames && (seen.startsWith(`${normalized} `) || normalized.startsWith(`${seen} `)));
    });
    seenNames.add(normalized);
    return {
      name,
      text: lines.slice(line, endLine).join("\n").trim(),
      duplicate: possibleDuplicate,
      sectionIndex: index + 1,
    };
  }).filter((candidate) => candidate.text.length > 0);
}

export function normalizeCandidateName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function extractPdfText(data: Uint8Array) {
  const worker = path.join(process.cwd(), "node_modules", "pdf-parse", "dist", "pdf-parse", "esm", "pdf.worker.mjs");
  PDFParse.setWorker(pathToFileURL(worker).href);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function existingTranscriptNames() {
  const dir = transcriptDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const files = (await fs.promises.readdir(dir)).filter((name) => /\.(txt|md)$/i.test(name));
  const names = new Set<string>();
  for (const filename of files) {
    const firstLine = (await fs.promises.readFile(path.join(dir, filename), "utf8")).split(/\r?\n/, 1)[0]?.trim();
    if (firstLine) names.add(normalizeCandidateName(firstLine));
  }
  return names;
}

export function safeFilePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

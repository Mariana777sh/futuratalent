import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { existingTranscriptNames, extractPdfText, normalizeCandidateName, splitCandidateNotes } from "@/lib/transcripts";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: "Selecciona un archivo PDF." }, { status: 400 });
  }
  if (!uploaded.name.toLowerCase().endsWith(".pdf") || (uploaded.type && uploaded.type !== "application/pdf")) {
    return NextResponse.json({ error: "El archivo debe ser un PDF." }, { status: 400 });
  }
  if (uploaded.size === 0 || uploaded.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "El PDF debe pesar entre 1 byte y 10 MB." }, { status: 413 });
  }

  let extracted: string;
  try {
    extracted = await extractPdfText(new Uint8Array(await uploaded.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({ error: `No se pudo leer el PDF: ${String(error)}` }, { status: 422 });
  }
  if (!extracted.trim()) {
    return NextResponse.json({ error: "El PDF no contiene texto extraíble. Si es un escaneo, aplica OCR primero." }, { status: 422 });
  }

  const [knownNames, existingCandidates] = await Promise.all([
    existingTranscriptNames(),
    prisma.candidate.findMany({ select: { fields: { where: { key: "candidate_name" }, select: { value: true } } } }),
  ]);
  for (const candidate of existingCandidates) {
    for (const field of candidate.fields) knownNames.add(normalizeCandidateName(field.value));
  }

  const candidates = splitCandidateNotes(extracted, knownNames);
  if (!candidates.length) {
    return NextResponse.json({ error: "No se detectaron encabezados de candidatos. Puedes agregar los candidatos manualmente como archivos .txt." }, { status: 422 });
  }

  return NextResponse.json({
    sourceFilename: uploaded.name,
    candidates,
    warning: "La detección usa encabezados locales y puede incluir secciones que no sean candidatos. Revisa y edita cada nota antes de guardarla.",
  });
}

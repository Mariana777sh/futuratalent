import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { safeFilePart, transcriptDirectory } from "@/lib/transcripts";

type ImportCandidate = { name: string; text: string; sectionIndex: number };

export async function POST(request: Request) {
  let body: { sourceFilename?: unknown; candidates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es JSON válido." }, { status: 400 });
  }

  if (typeof body.sourceFilename !== "string" || !body.sourceFilename.trim() || !Array.isArray(body.candidates)) {
    return NextResponse.json({ error: "Se requiere el nombre del PDF y una lista de candidatos." }, { status: 400 });
  }
  if (body.candidates.length === 0 || body.candidates.length > 500) {
    return NextResponse.json({ error: "Selecciona entre 1 y 500 candidatos." }, { status: 400 });
  }

  const candidates: ImportCandidate[] = [];
  let totalCharacters = 0;
  for (const item of body.candidates) {
    if (!item || typeof item !== "object" || !("name" in item) || !("text" in item) || !("sectionIndex" in item)
      || typeof item.name !== "string" || typeof item.text !== "string"
      || typeof item.sectionIndex !== "number" || !Number.isInteger(item.sectionIndex) || item.sectionIndex < 1 || item.sectionIndex > 10000
      || !item.name.trim() || !item.text.trim()) {
      return NextResponse.json({ error: "Cada candidato debe tener una sección válida, nombre y notas." }, { status: 400 });
    }
    totalCharacters += item.name.length + item.text.length;
    candidates.push({ name: item.name.trim(), text: item.text.trim(), sectionIndex: item.sectionIndex });
  }
  if (totalCharacters > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "El texto seleccionado supera el límite de 10 MB." }, { status: 413 });
  }

  const sourceBase = safeFilePart(path.basename(body.sourceFilename, path.extname(body.sourceFilename))) || "pdf";
  const entries = candidates.map((candidate) => {
    const namePart = safeFilePart(candidate.name) || `candidate-${candidate.sectionIndex}`;
    return { filename: `pdf-${sourceBase}-section-${String(candidate.sectionIndex).padStart(3, "0")}-${namePart}.txt`, text: candidate.text };
  });
  if (new Set(entries.map((entry) => entry.filename)).size !== entries.length) {
    return NextResponse.json({ error: "Hay nombres duplicados. Edita los nombres para que cada archivo sea único." }, { status: 400 });
  }

  const dir = transcriptDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const existing = new Set(await fs.promises.readdir(dir));
  const conflicts = entries.filter((entry) => existing.has(entry.filename)).map((entry) => entry.filename);
  if (conflicts.length) {
    return NextResponse.json({ error: "Algunos archivos ya existen; no se sobrescribió ninguno.", conflicts }, { status: 409 });
  }

  const created: string[] = [];
  try {
    for (const entry of entries) {
      const destination = path.join(dir, entry.filename);
      await fs.promises.writeFile(destination, `${entry.text}\n`, { encoding: "utf8", flag: "wx" });
      created.push(destination);
    }
  } catch (error) {
    await Promise.all(created.map((filename) => fs.promises.unlink(filename)));
    throw error;
  }

  return NextResponse.json({ saved: entries.map((entry) => entry.filename) });
}

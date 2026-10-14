import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { safeFilePart, transcriptDirectory } from "@/lib/transcripts";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const uploads = form.getAll("files");
  if (uploads.length === 0 || uploads.length > 100 || uploads.some((file) => !(file instanceof File))) {
    return NextResponse.json({ error: "Selecciona entre 1 y 100 archivos .txt o .md." }, { status: 400 });
  }

  const entries: { filename: string; text: string; size: number }[] = [];
  let totalBytes = 0;
  for (const upload of uploads as File[]) {
    const extension = path.extname(upload.name).toLowerCase();
    if (![".txt", ".md"].includes(extension)) {
      return NextResponse.json({ error: `Formato no permitido: ${upload.name}. Solo se aceptan .txt y .md.` }, { status: 400 });
    }
    if (upload.size === 0 || upload.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${upload.name} debe pesar entre 1 byte y 5 MB.` }, { status: 413 });
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await upload.arrayBuffer());
    } catch {
      return NextResponse.json({ error: `${upload.name} no contiene texto UTF-8 válido.` }, { status: 400 });
    }
    if (!text.trim() || text.includes("\0")) {
      return NextResponse.json({ error: `${upload.name} está vacío o no parece ser un archivo de texto.` }, { status: 400 });
    }

    const base = safeFilePart(path.basename(upload.name, extension));
    if (!base) return NextResponse.json({ error: `El nombre ${upload.name} no es válido.` }, { status: 400 });
    const filename = `${base}${extension}`;
    if (entries.some((entry) => entry.filename === filename)) {
      return NextResponse.json({ error: `Hay más de un archivo llamado ${filename}. Renombra los archivos e inténtalo de nuevo.` }, { status: 400 });
    }
    totalBytes += upload.size;
    entries.push({ filename, text, size: upload.size });
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "El tamaño combinado supera el límite de 20 MB." }, { status: 413 });
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
      await fs.promises.writeFile(destination, entry.text, { encoding: "utf8", flag: "wx" });
      created.push(destination);
    }
  } catch (error) {
    await Promise.all(created.map((filename) => fs.promises.unlink(filename)));
    throw error;
  }

  return NextResponse.json({ saved: entries.map((entry) => entry.filename) });
}

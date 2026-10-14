import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { ingestDocument } from "@/lib/ingest";
import { transcriptDirectory } from "@/lib/transcripts";

export async function GET() {
  const dir = transcriptDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const filenames = (await fs.promises.readdir(dir)).filter((name) => /\.(txt|md)$/i.test(name)).sort();
  const documents = await prisma.document.findMany({
    where: { filename: { in: filenames } },
    select: {
      filename: true,
      sha256: true,
      status: true,
      error: true,
      candidate: { select: { fields: { where: { key: "candidate_name" }, select: { value: true } } } },
    },
  });
  const byFilename = new Map(documents.map((document) => [document.filename, document]));
  const files = await Promise.all(filenames.map(async (filename) => {
    const contents = await fs.promises.readFile(path.join(dir, filename));
    const document = byFilename.get(filename);
    const unchanged = document?.sha256 === crypto.createHash("sha256").update(contents).digest("hex");
    return {
      filename,
      candidateName: document?.candidate?.fields[0]?.value ?? null,
      bytes: contents.byteLength,
      status: unchanged ? document.status : "PENDING",
      error: unchanged ? document.error : null,
    };
  }));
  return NextResponse.json({ files: files.filter((file) => file.candidateName) });
}

// Ingests all .txt and .md files in ./data/transcripts (local-only tool).
export async function POST() {
  const dir = transcriptDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const filenames = (await fs.promises.readdir(dir)).filter((name) => /\.(txt|md)$/i.test(name)).sort();
  const results: Record<string, unknown> = {};
  for (const filename of filenames) {
    try { results[filename] = await ingestDocument(filename, await fs.promises.readFile(path.join(dir, filename), "utf8")); }
    catch (e) { results[filename] = { error: String(e) }; }
  }
  return NextResponse.json({ results, processed: filenames.length });
}

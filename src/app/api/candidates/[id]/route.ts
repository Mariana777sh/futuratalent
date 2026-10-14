import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { translateMap, Locale } from "@/lib/translate";
import { similarTo } from "@/lib/search";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = (new URL(req.url).searchParams.get("locale") || "en") as Locale;
  const c = await prisma.candidate.findUnique({
    where: { id },
    include: { fields: true, skills: true, companies: true, projects: true, achievements: true, followUps: true, document: { include: { notes: true } } },
  });
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Translate derived display strings only. Evidence quotes stay in their original language.
  const map: Record<string, string> = { summary: c.summary };
  c.projects.forEach((p) => { map[`p:${p.id}:n`] = p.name; map[`p:${p.id}:d`] = p.description; });
  c.achievements.forEach((a) => (map[`a:${a.id}`] = a.text));
  c.companies.forEach((x) => (map[`c:${x.id}:r`] = x.role ?? ""));
  const t = await translateMap("Candidate", c.id, map, locale);

  return NextResponse.json({
    id: c.id, candidateId: c.candidateId, sourceDocument: c.document.filename, sourceTranscript: c.document.rawText, summary: t.summary, original: { summary: c.summary },
    fields: c.fields, skills: c.skills,
    companies: c.companies.map((x) => ({ ...x, responsibilities: JSON.parse(x.responsibilities), role: t[`c:${x.id}:r`] || x.role })),
    projects: c.projects.map((p) => ({ ...p, name: t[`p:${p.id}:n`], description: t[`p:${p.id}:d`] })),
    achievements: c.achievements.map((a) => ({ ...a, text: t[`a:${a.id}`] })),
    followUps: c.followUps, recruiterNotes: c.document.notes, // kept separate, never merged into profile
    similar: await similarTo(c.id),
  });
}

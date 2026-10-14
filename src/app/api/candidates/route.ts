import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const rows = await prisma.candidate.findMany({ orderBy: { candidateId: "asc" }, include: { fields: { where: { key: { in: ["candidate_name", "current_role", "seniority", "english_level", "expected_salary_max"] } } } } });
  return NextResponse.json(rows.map((c) => ({ id: c.id, candidateId: c.candidateId, summary: c.summary, primarySkills: JSON.parse(c.primarySkills), fields: c.fields })));
}

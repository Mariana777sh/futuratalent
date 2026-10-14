import { NextResponse } from "next/server";
import { z } from "zod";
import { search } from "@/lib/search";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const body = z.object({ query: z.string().trim().min(1).max(2000) }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json(await search(body.data.query));
}

// search feedback loop
export async function PUT(req: Request) {
  const b = z.object({ queryId: z.string(), candidateId: z.string(), rating: z.union([z.literal(1), z.literal(-1)]) }).parse(await req.json());
  await prisma.searchFeedback.create({ data: b });
  return NextResponse.json({ ok: true });
}

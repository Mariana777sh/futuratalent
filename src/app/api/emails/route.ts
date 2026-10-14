import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateEmail } from "@/lib/email";

export async function GET() {
  return NextResponse.json(await prisma.email.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, subject: true, status: true, locale: true, candidateIds: true, createdAt: true } }));
}

export async function POST(req: Request) {
  const b = z.object({ candidateIds: z.array(z.string()).length(1), clientContext: z.string().max(2000).default("") }).parse(await req.json());
  return NextResponse.json(await generateEmail(b));
}

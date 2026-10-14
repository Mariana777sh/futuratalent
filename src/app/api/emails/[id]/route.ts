import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveEdit, transition, sendEmail, deleteReviewEmail } from "@/lib/email";

type P = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: P) {
  const { id } = await params;
  return NextResponse.json(await prisma.email.findUnique({ where: { id }, include: { revisions: true } }));
}

export async function PATCH(req: Request, { params }: P) {
  const { id } = await params;
  const b = z.object({ subject: z.string().optional(), html: z.string().optional(), text: z.string().optional() }).parse(await req.json());
  return NextResponse.json(await saveEdit(id, b));
}

export async function DELETE(_: Request, { params }: P) {
  const { id } = await params;
  try {
    await deleteReviewEmail(id);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 409 });
  }
}

// POST { action: "review" | "approve" | "draft" | "send", to? }
export async function POST(req: Request, { params }: P) {
  const { id } = await params;
  const body = z.object({ action: z.enum(["review", "approve", "draft", "send"]), to: z.string().email().optional() }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Provide a valid action and recipient email address." }, { status: 400 });
  const b = body.data;
  try {
    if (b.action === "send") {
      if (!b.to) throw new Error("`to` required");
      return NextResponse.json(await sendEmail(id, b.to));
    }
    const map = { review: "REVIEW", approve: "APPROVED", draft: "DRAFT" } as const;
    return NextResponse.json(await transition(id, map[b.action]));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 409 });
  }
}

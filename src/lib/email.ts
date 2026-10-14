import nodemailer from "nodemailer";
import { prisma, audit } from "./db";
import { PROCESSOR_VERSION } from "./local";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderPlainTextHtml(text: string): string {
  const body = text.split(/\r?\n/).map((line) => line ? `<p style="margin:0 0 12px">${esc(line)}</p>` : '<div style="height:8px"></div>').join("");
  return `<!doctype html><html><body style="margin:0;background:#f6f9fc;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><main style="max-width:640px;margin:32px auto;padding:24px;background:#fff;color:#334155;line-height:1.6">${body}</main></body></html>`;
}

export async function generateEmail(opts: { candidateIds: string[]; clientContext: string }) {
  if (opts.candidateIds.length !== 1) throw new Error("A candidate invitation must target exactly one candidate.");
  const cands = await prisma.candidate.findMany({
    where: { id: { in: opts.candidateIds } },
    include: { fields: true },
  });
  if (cands.length !== 1) throw new Error("The selected candidate could not be found.");
  const candidateName = cands[0].fields.find((field) => field.key === "candidate_name")?.value || "there";
  const opportunityDetails = opts.clientContext.trim() || "[Add a brief description of the role and client here.]";
  const subject = "An exciting opportunity with a new client";
  const text = [
    `Hi ${candidateName},`,
    "",
    "I hope you’re doing well. We’re partnering with a new client on an opportunity that may be a great match for your experience.",
    "",
    opportunityDetails,
    "",
    "I’d love to share more about the role, the team, and the work involved. Would you be open to a brief introductory conversation? If so, please let me know what times work for you.",
    "",
    "Best,",
    "[Your name]",
    "[Company]",
  ].join("\n");
  const email = await prisma.email.create({
    data: {
      candidateId: cands.length === 1 ? cands[0].id : null,
      candidateIds: JSON.stringify(opts.candidateIds),
      clientContext: opts.clientContext,
      locale: "en",
      subject,
      html: renderPlainTextHtml(text),
      text,
      promptVer: PROCESSOR_VERSION,
    },
  });
  await audit("Email", email.id, "GENERATED", "type=candidate-invitation; locale=en");
  return email;
}

const ORDER = ["DRAFT", "REVIEW", "APPROVED", "SENT"] as const;

export async function transition(id: string, to: (typeof ORDER)[number]) {
  const e = await prisma.email.findUniqueOrThrow({ where: { id } });
  const from = ORDER.indexOf(e.status as never);
  const next = ORDER.indexOf(to);
  const allowed = next === from + 1 || (to === "DRAFT" && e.status !== "SENT"); // can always send back to draft before sending
  if (!allowed) throw new Error(`Invalid transition ${e.status} -> ${to}`);
  if (to === "SENT") throw new Error("Use sendEmail()");
  const u = await prisma.email.update({ where: { id }, data: { status: to, approvedAt: to === "APPROVED" ? new Date() : null } });
  await audit("Email", id, `STATUS_${to}`);
  return u;
}

export async function saveEdit(id: string, patch: { subject?: string; html?: string; text?: string }) {
  const e = await prisma.email.findUniqueOrThrow({ where: { id } });
  if (e.status === "SENT") throw new Error("Sent emails are immutable");
  await prisma.emailRevision.create({ data: { emailId: id, beforeText: e.text, afterText: patch.text ?? e.text } });
  // Any edit invalidates a prior approval.
  const data = {
    ...patch,
    ...(patch.text !== undefined && patch.html === undefined ? { html: renderPlainTextHtml(patch.text) } : {}),
    status: "DRAFT",
    approvedAt: null,
  };
  const u = await prisma.email.update({ where: { id }, data });
  await audit("Email", id, "EDITED");
  return u;
}

export async function deleteReviewEmail(id: string) {
  const email = await prisma.email.findUniqueOrThrow({ where: { id } });
  if (email.status !== "REVIEW") throw new Error("Only emails in Review can be deleted.");
  await prisma.$transaction(async (tx) => {
    await tx.emailRevision.deleteMany({ where: { emailId: id } });
    await tx.auditLog.create({ data: { entity: "Email", entityId: id, action: "DELETED", detail: "status=REVIEW" } });
    await tx.email.delete({ where: { id } });
  });
}

/** Only APPROVED emails can be sent to the explicitly supplied recipient. */
export async function sendEmail(id: string, to: string) {
  const e = await prisma.email.findUniqueOrThrow({ where: { id } });
  if (e.status !== "APPROVED") throw new Error("Email must be APPROVED before sending");
  const smtpUrl = process.env.SMTP_URL?.trim();
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  const from = process.env.MAIL_FROM?.trim() || gmailUser;
  if (Boolean(gmailUser) !== Boolean(gmailAppPassword)) {
    throw new Error("Gmail SMTP is incomplete. Set both GMAIL_USER and GMAIL_APP_PASSWORD.");
  }
  if (!from) throw new Error("Email delivery is not configured. Set MAIL_FROM or configure Gmail.");
  const transport = gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailAppPassword },
    })
    : smtpUrl
      ? nodemailer.createTransport(smtpUrl)
      : null;
  if (!transport) throw new Error("Email delivery is not configured. Set SMTP_URL or configure Gmail SMTP.");
  await transport.sendMail({ from, to, subject: e.subject, html: e.html, text: e.text });
  const u = await prisma.email.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  await audit("Email", id, "SENT", to);
  return u;
}

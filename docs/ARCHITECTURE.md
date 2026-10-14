# Architecture

## ADR summary
| Decision | Why | Trade-off |
|---|---|---|
| Next.js (App Router) + API routes | One process, one language, no separate backend | Long LLM calls run inside request handlers |
| SQLite + Prisma | Zero-infra local run, typed access | JSON-in-string columns; no native vector index |
| Embeddings stored as JSON, cosine in app code | Fine for thousands of candidates; no vector DB | Linear scan; swap to sqlite-vec/pgvector if it grows |
| Deterministic local processing and keyword search | No model installation, network calls, or API key required | Search is literal keyword matching, and uncached profile text is not translated automatically |
| Prompts as versioned markdown files | Diffable, rollbackable; version stored on Document/Email | Manual version bump |
| Plain inline-styled HTML email (no React Email) | No extra dependency; email-client safe tables | Less component reuse |
| nodemailer + explicit approval and recipient | Gmail App Password or SMTP delivery only after human approval | Requires configured SMTP credentials; sent emails cannot be recalled |

## Ingestion
`.txt`/`.md` files in `data/transcripts` → sha256 skip if unchanged → deterministic evidence-only extraction → **grounding gate**: every item's `source_quote` must be a verbatim substring of the transcript (whitespace/quote-insensitive) or it is dropped (count audited) → enum validation for language levels, skill categories, and field keys → transactional write → local hashed embedding. Recruiter notes are stored in `RecruiterNote`, never in candidate tables. Multi-candidate PDFs are parsed locally and split using candidate-heading heuristics; review the preview before saving the text sections as transcripts. Scanned PDFs need OCR first.

## Search
Normalize query terms and match against candidate names, skills, companies, projects, and evidenced fields → rank exact term matches locally and show their source quotes. Thumbs feedback applies a ±3-point nudge. No model service or network request is used.

## Email
Candidate invitation emails are created from a local English template. States: DRAFT → REVIEW → APPROVED → SENT. Any edit resets to DRAFT and records an `EmailRevision`; emails in REVIEW can be deleted. Send requires APPROVED, an explicitly entered recipient, and either configured Gmail App Password credentials or `SMTP_URL`/`MAIL_FROM`; approval never sends automatically. Delivery failures are surfaced and leave the email approved for retry.

## Translation
Static UI strings: `i18n.ts`. Derived content (summaries, project names, achievements): `Translation` table keyed by entity/field/locale; existing cached translations may be reused, while uncached text remains in its original language. Source quotes are never translated.

## Security
- Localhost-only, no auth (add before any deployment).
- Approval gate + explicit-recipient SMTP send + audit log. Keep SMTP credentials in the local `.env`; Gmail uses an App Password with 2-Step Verification enabled. Deletion is restricted to REVIEW and audit-logged.
- HTML email content is escaped before rendering; preview uses a sandbox-less `srcDoc` iframe — add `sandbox=""` if emails may contain untrusted content.
- Transcripts contain PII: SQLite file and `.env` are git-ignored; transcript processing and search run locally.
- Untrusted transcript content is constrained by the evidence grounding gate and enum checks.

## Implementation plan
1. `npm run setup`, add transcripts. 2. Ingest, inspect evidence popovers. 3. Run local keyword searches. 4. Generate/review/approve candidate invitation emails and explicitly send via configured SMTP. 5. Next: timeline view, shadcn/ui, auth, sqlite-vec, translated search results, tests.

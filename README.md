# Futura Talent Desk

Local-first recruiting intelligence: transcripts → evidence-linked candidate profiles → semantic search → candidate invitation emails with review, approval, and SMTP delivery.

## Quick start
```bash
cp .env.example .env          # set Gmail App Password or SMTP_URL to enable email delivery
npm run setup                 # install, create SQLite DB, generate Prisma client
# put transcripts in data/transcripts/*.txt or *.md, sample emails in data/email_examples/
npm run ingest                # or click "Ingest transcripts" in the UI
npm run dev                   # http://localhost:3000
```
For Gmail delivery, enable 2-Step Verification on the sending Google account and create an App Password. Set `GMAIL_USER` to the Gmail address and `GMAIL_APP_PASSWORD` to that App Password in `.env` (spaces in the password are accepted). `MAIL_FROM` is optional; if set, use the authenticated Gmail address or a verified alias. Alternatively, configure `SMTP_URL` and `MAIL_FROM` for another SMTP provider.

An email can only be sent after it has been approved. Enter the candidate's email address in the approved draft and explicitly click **Send email**. Delivery requires configured SMTP credentials; without them, sending fails and the email remains approved. No email is sent automatically on approval.

The Candidates tab lists the `.txt` and `.md` files found in `data/transcripts` and their processing status;
use its upload control to add transcript files directly.
To import a PDF with notes for multiple candidates, choose it in the PDF import panel, review/edit the locally
detected sections, and save the selected sections as transcripts before processing them. Detection is heuristic,
so verify the candidate names and section boundaries. Each imported transcript retains its PDF section number in
its filename; sections with repeated headings may be imported separately when they contain distinct notes. Scanned
PDFs require OCR before import.
Transcript processing runs locally without a language model. It stores explicit transcript evidence and maps
recognized skills to the predefined `language`, `framework`, `scraping`, `cloud`, `database`, and `additional`
categories; unrecognized details remain in the source transcript. Search uses local keyword matching over
candidate names and evidenced profile details, with no network or model service required.

## Repo structure
```
prisma/schema.prisma     data model (SQLite)
src/lib/ingest.ts        local extraction + quote-grounding gate
src/lib/search.ts        local keyword matching and relevance ranking
src/lib/email.ts         generation, HTML/text render, state machine, send guard
src/lib/translate.ts     cached translation of derived content
src/lib/i18n.ts          static UI strings (EN / es-LATAM)
src/app/api/**           REST routes
src/app/page.tsx         dashboard
scripts/ingest.ts        CLI ingestion
docs/ARCHITECTURE.md     ADR, pipelines, security, plan
```
See `docs/ARCHITECTURE.md` for decisions and pipeline details.

## Known limitations (v0.1)
- Dashboard uses plain Tailwind, not shadcn/ui. No candidate timeline view yet.
- Editing the plain-text body in the UI does not regenerate the HTML version; edit and re-generate if you need both in sync.
- Similar-candidate suggestions use local hashed vectors; text search uses exact keyword matches rather than semantic interpretation.
- No authentication: intended for localhost use only.
- Not yet run end-to-end against a live API key; only type-checked.

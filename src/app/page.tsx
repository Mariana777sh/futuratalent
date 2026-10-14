"use client";
import { useEffect, useState } from "react";
import { UI } from "@/lib/i18n";
import { Claim } from "@/components/Evidence";

type Locale = "en" | "es-LATAM";
type Tab = "candidates" | "search" | "emails";
type TranscriptFile = { filename: string; candidateName: string; bytes: number; status: string; error?: string | null };
type PdfDraft = { name: string; text: string; duplicate: boolean; sectionIndex: number; include: boolean };
const SKILL_CATEGORIES = ["language", "framework", "scraping", "cloud", "database", "additional"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("en");
  const [tab, setTab] = useState<Tab>("candidates");
  const [darkMode, setDarkMode] = useState(false);
  const t = UI[locale];

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("futura-theme");
    const enabled = savedTheme === "dark";
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  const toggleTheme = () => {
    const enabled = !darkMode;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
    window.localStorage.setItem("futura-theme", enabled ? "dark" : "light");
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Futura Talent Desk</h1>
        <div className="flex flex-wrap items-center gap-4">
          <nav className="flex gap-1 text-sm">
            {(["candidates", "search", "emails"] as Tab[]).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1.5 ${tab === k ? "bg-slate-900 text-white" : "hover:bg-slate-200"}`}>{t[k]}</button>
            ))}
          </nav>
          <div className="flex overflow-hidden rounded border text-sm">
            <button onClick={() => setLocale("en")} className={`px-3 py-1 ${locale === "en" ? "bg-slate-900 text-white" : "bg-white"}`}>English</button>
            <button onClick={() => setLocale("es-LATAM")} className={`px-3 py-1 ${locale === "es-LATAM" ? "bg-slate-900 text-white" : "bg-white"}`}>Español LATAM</button>
          </div>
          <button type="button" onClick={toggleTheme} aria-pressed={darkMode} className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
            {darkMode ? t.lightMode : t.darkMode}
          </button>
        </div>
      </header>
      {tab === "candidates" && <Candidates t={t} locale={locale} />}
      {tab === "search" && <Search t={t} locale={locale} />}
      {tab === "emails" && <Emails t={t} />}
    </main>
  );
}

function Candidates({ t, locale }: { t: any; locale: Locale }) {
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [transcriptFiles, setTranscriptFiles] = useState<TranscriptFile[]>([]);
  const [showTranscriptFiles, setShowTranscriptFiles] = useState(false);
  const [transcriptUploads, setTranscriptUploads] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [ingestMessage, setIngestMessage] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfMessage, setPdfMessage] = useState("");
  const [pdfPreview, setPdfPreview] = useState<{ sourceFilename: string; warning: string; candidates: PdfDraft[] } | null>(null);
  const load = () => api("/api/candidates").then(setList);
  const loadTranscripts = () => api("/api/ingest").then((data) => setTranscriptFiles(data.files));
  useEffect(() => { load(); loadTranscripts(); }, []);
  useEffect(() => { if (sel) api(`/api/candidates/${sel.id}?locale=${locale}`).then(setSel2); }, [locale]); // eslint-disable-line
  const setSel2 = (d: any) => setSel(d);
  const open = (id: string) => api(`/api/candidates/${id}?locale=${locale}`).then(setSel);

  const uploadTranscripts = async () => {
    if (transcriptUploads.length === 0) return;
    setUploadBusy(true);
    setUploadError("");
    setUploadMessage("");
    try {
      const form = new FormData();
      transcriptUploads.forEach((file) => form.append("files", file));
      const response = await fetch("/api/ingest/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transcript upload failed");
      setUploadMessage(`${result.saved.length} ${t.transcriptsAdded}`);
      setTranscriptUploads([]);
      await loadTranscripts();
    } catch (error) {
      setUploadError(String(error));
    } finally {
      setUploadBusy(false);
    }
  };

  const previewPdf = async () => {
    if (!pdfFile) return;
    setPdfBusy(true);
    setPdfError("");
    setPdfMessage("");
    try {
      const form = new FormData();
      form.append("file", pdfFile);
      const response = await fetch("/api/ingest/preview", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "PDF preview failed");
      setPdfPreview({
        sourceFilename: data.sourceFilename,
        warning: data.warning,
        candidates: data.candidates.map((candidate: Omit<PdfDraft, "include">) => ({ ...candidate, include: !candidate.duplicate })),
      });
    } catch (error) {
      setPdfError(String(error));
    } finally {
      setPdfBusy(false);
    }
  };

  const savePdfDrafts = async () => {
    if (!pdfPreview) return;
    const candidates = pdfPreview.candidates.filter((candidate) => candidate.include).map(({ name, text, sectionIndex }) => ({ name, text, sectionIndex }));
    setPdfBusy(true);
    setPdfError("");
    setPdfMessage("");
    try {
      const result = await api("/api/ingest/import", "POST", { sourceFilename: pdfPreview.sourceFilename, candidates });
      setPdfMessage(`${result.saved.length} ${t.pdfSaved}`);
      setPdfPreview(null);
      setPdfFile(null);
      await loadTranscripts();
    } catch (error) {
      setPdfError(String(error));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      <section className="space-y-2">
        <button disabled={busy} onClick={async () => {
          setBusy(true); setIngestMessage("");
          try {
            const result = await api("/api/ingest", "POST");
            const outcomes = Object.values(result.results as Record<string, { error?: string }>);
            const failed = outcomes.filter((value) => value.error).length;
            setIngestMessage(outcomes.length === 0 ? t.noTranscriptFiles : failed ? `${outcomes.length - failed} succeeded; ${failed} failed. See file status below.` : `${outcomes.length} transcript(s) processed.`);
            await Promise.all([load(), loadTranscripts()]);
          } catch (error) { setIngestMessage(String(error)); }
          finally { setBusy(false); }
        }} className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">
          {busy ? "…" : t.ingest}
        </button>
        {ingestMessage && <p role="status" className="text-xs text-slate-600">{ingestMessage}</p>}
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.transcriptFiles}</h2>
            <button
              type="button"
              aria-expanded={showTranscriptFiles}
              onClick={() => setShowTranscriptFiles((visible) => !visible)}
              className="rounded border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {showTranscriptFiles ? t.hideTranscriptFiles : t.showTranscriptFiles}
              <span className="ml-1 text-slate-400">({transcriptFiles.length})</span>
            </button>
          </div>
          {showTranscriptFiles && (transcriptFiles.length === 0
            ? <p className="mt-2 text-xs text-slate-500">{t.noTranscriptFiles}</p>
            : <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs">
              {transcriptFiles.map((file) => {
                const status = file.status === "PROCESSED" ? t.processed : file.status === "FAILED" ? t.failed : t.pending;
                return <li key={file.filename} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="break-words">{file.candidateName}</span>
                    {file.error && <p title={file.error} className="mt-1 break-words text-rose-600">{file.error}</p>}
                  </div>
                  <span className={`shrink-0 ${file.status === "FAILED" ? "text-rose-600" : "text-slate-400"}`}>{status}</span>
                </li>;
              })}
            </ul>)}
          <div className="mt-3 space-y-2 border-t pt-3">
            <input type="file" multiple accept=".txt,.md,text/plain" onChange={(event) => { setTranscriptUploads(Array.from(event.target.files ?? [])); setUploadError(""); }} className="block w-full text-xs" aria-label={t.chooseTranscripts} />
            <button disabled={transcriptUploads.length === 0 || uploadBusy} onClick={uploadTranscripts} className="w-full rounded border px-3 py-1.5 text-xs disabled:opacity-50">{uploadBusy ? "…" : t.uploadTranscripts}</button>
            {uploadError && <p role="alert" className="break-words text-xs text-rose-600">{uploadError}</p>}
            {uploadMessage && <p role="status" className="text-xs text-emerald-700">{uploadMessage}</p>}
          </div>
        </div>
        <div className="space-y-2 rounded-lg border bg-white p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.pdfImport}</h2>
          <input type="file" accept=".pdf,application/pdf" onChange={(event) => { setPdfFile(event.target.files?.[0] ?? null); setPdfPreview(null); setPdfError(""); }} className="block w-full text-xs" aria-label={t.choosePdf} />
          <button disabled={!pdfFile || pdfBusy} onClick={previewPdf} className="w-full rounded border px-3 py-1.5 text-xs disabled:opacity-50">{pdfBusy ? "…" : t.previewPdf}</button>
          {pdfError && <p role="alert" className="break-words text-xs text-rose-600">{pdfError}</p>}
          {pdfMessage && <p role="status" className="text-xs text-emerald-700">{pdfMessage}</p>}
        </div>
        {list.map((c) => (
          <button key={c.id} onClick={() => open(c.id)} className="block w-full rounded-lg border bg-white p-3 text-left text-sm hover:border-slate-400">
            <div className="font-medium">{c.fields.find((field: any) => field.key === "candidate_name")?.value || c.candidateId}</div>
            <div className="text-xs text-slate-400">{c.candidateId}</div>
            <div className="line-clamp-2 text-slate-500">{c.summary}</div>
            <div className="mt-1 text-xs text-slate-400">{c.primarySkills.slice(0, 4).join(" · ")}</div>
          </button>
        ))}
      </section>
      <section className="col-span-2 space-y-4">
        {pdfPreview && <div className="space-y-3 rounded-lg border bg-white p-4">
          <div>
            <h2 className="font-semibold">{t.detected}: {pdfPreview.candidates.length}</h2>
            <p className="mt-1 text-xs text-amber-700">{pdfPreview.warning}</p>
          </div>
          <div className="max-h-[65vh] space-y-2 overflow-y-auto">
            {pdfPreview.candidates.map((candidate, index) => (
              <details key={`${candidate.name}-${index}`} className="rounded border p-3">
                <summary className="cursor-pointer text-sm">
                  <input type="checkbox" checked={candidate.include} onChange={(event) => setPdfPreview({ ...pdfPreview, candidates: pdfPreview.candidates.map((item, i) => i === index ? { ...item, include: event.target.checked } : item) })} onClick={(event) => event.stopPropagation()} aria-label={`${t.include} ${candidate.name}`} className="mr-2" />
                  <span className="mr-2 text-xs text-slate-400">PDF {t.pdfSection} {candidate.sectionIndex}</span>
                  <span className="font-medium">{candidate.name || `Candidate ${index + 1}`}</span>
                  {candidate.duplicate && <span className="ml-2 text-xs text-amber-700">{t.duplicate}</span>}
                </summary>
                <div className="mt-3 space-y-2">
                  <input value={candidate.name} onChange={(event) => setPdfPreview({ ...pdfPreview, candidates: pdfPreview.candidates.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} className="w-full rounded border p-2 text-sm" aria-label={`Candidate ${index + 1} name`} />
                  <label className="block text-xs text-slate-500">{t.editNotes}
                    <textarea value={candidate.text} onChange={(event) => setPdfPreview({ ...pdfPreview, candidates: pdfPreview.candidates.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} rows={8} className="mt-1 w-full rounded border p-2 font-mono text-xs" />
                  </label>
                </div>
              </details>
            ))}
          </div>
          <button disabled={pdfBusy || !pdfPreview.candidates.some((candidate) => candidate.include)} onClick={savePdfDrafts} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">{pdfBusy ? "…" : t.saveDrafts}</button>
        </div>}
        {sel ? <Profile d={sel} t={t} /> : <p className="text-sm text-slate-400">—</p>}
      </section>
    </div>
  );
}

function Profile({ d, t, initialEmail = null }: { d: any; t: any; initialEmail?: any }) {
  const [email, setEmail] = useState({ ctx: "" });
  const [msg, setMsg] = useState("");
  const [emailDraft, setEmailDraft] = useState<any>(null);
  const [savedEmail, setSavedEmail] = useState<any>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [recipient, setRecipient] = useState("");
  useEffect(() => {
    if (initialEmail) {
      setEmailDraft(initialEmail);
      setSavedEmail(initialEmail);
    }
  }, [initialEmail]);
  const emailDirty = Boolean(emailDraft && savedEmail &&
    (emailDraft.subject !== savedEmail.subject || emailDraft.text !== savedEmail.text));
  const candidateName = d.fields.find((field: any) => field.key === "candidate_name")?.value || d.candidateId;
  const previewHtml = (value: string) => `<html><body style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:20px">${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
  const generate = async () => {
    setEmailBusy(true);
    setEmailError("");
    try {
      const draft = await api("/api/emails", "POST", { candidateIds: [d.id], clientContext: email.ctx });
      setEmailDraft(draft);
      setSavedEmail(draft);
    } catch (error) {
      setEmailError(String(error));
    } finally {
      setEmailBusy(false);
    }
  };
  const saveEmail = async () => {
    if (!emailDraft) return;
    setEmailBusy(true);
    setEmailError("");
    try {
      const saved = await api(`/api/emails/${emailDraft.id}`, "PATCH", { subject: emailDraft.subject, text: emailDraft.text });
      setEmailDraft(saved);
      setSavedEmail(saved);
      setMsg(t.saved);
    } catch (error) {
      setEmailError(String(error));
    } finally {
      setEmailBusy(false);
    }
  };
  const advanceEmail = async (action: "review" | "approve" | "send") => {
    if (!emailDraft) return;
    setEmailBusy(true);
    setEmailError("");
    try {
      const saved = await api(`/api/emails/${emailDraft.id}`, "POST", action === "send" ? { action, to: recipient } : { action });
      setEmailDraft({ ...emailDraft, ...saved });
      setMsg(action === "send" ? t.sent : action === "approve" ? t.approved : t.inReview);
    } catch (error) {
      setEmailError(String(error));
    } finally {
      setEmailBusy(false);
    }
  };
  return (
    <div className="space-y-5 rounded-lg border bg-white p-5 text-sm">
      <div><h2 className="text-lg font-semibold">{candidateName}</h2><div className="text-xs text-slate-400">{d.candidateId}</div><div className="text-xs text-slate-400">{t.source}: {d.sourceDocument}</div></div>
      <p>{d.summary}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {d.fields.map((f: any) => (
          <div key={f.id}><span className="text-slate-400">{f.key}: </span><Claim text={f.value} ev={f} t={t} /></div>
        ))}
      </div>
      <Block title={t.skills}>{SKILL_CATEGORIES.map((category) => {
        const skills = d.skills.filter((skill: any) => skill.category === category);
        return skills.length > 0 && <div key={category}>
          <div className="text-xs font-medium text-slate-400">{t.skillCategories[category]}</div>
          <div>{skills.map((skill: any) => <span key={skill.id} className="mr-2 inline-block"><Claim text={skill.name} ev={skill} t={t} /></span>)}</div>
        </div>;
      })}</Block>
      <Block title={t.experience}>{d.companies.map((c: any) => <div key={c.id} className="mb-2"><Claim text={c.companyName} ev={c} t={t} /> {c.role && `— ${c.role}`} {c.duration && `(${c.duration})`}{c.responsibilities.length > 0 && <ul className="ml-5 list-disc text-slate-600">{c.responsibilities.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul>}</div>)}</Block>
      <Block title={t.projectsTitle}>{d.projects.map((p: any) => <div key={p.id}><Claim text={p.name} ev={p} t={t} />: {p.description}</div>)}</Block>
      <Block title={t.achievements}>{d.achievements.map((a: any) => <div key={a.id}>• <Claim text={a.text} ev={a} t={t} /></div>)}</Block>
      <Block title={t.followUps}>{d.followUps.map((item: any) => <div key={item.id}>• {item.text}</div>)}</Block>
      <Block title={t.recruiterNotes}>{d.recruiterNotes.map((n: any) => <div key={n.id} className="text-slate-500">[{n.kind}] {n.text}</div>)}</Block>
      <Block title={t.similar}>{d.similar.map((s: any) => <div key={s.id}>{s.candidateId} · {Math.round(s.similarity * 100)}%</div>)}</Block>
      <details className="rounded border p-3">
        <summary className="cursor-pointer font-medium">{t.originalTranscript}</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-600">{d.sourceTranscript}</pre>
      </details>
      <div className="border-t pt-4">
        <div className="mb-1 font-medium">{t.generate}</div>
        <textarea value={email.ctx} onChange={(e) => setEmail({ ctx: e.target.value })} placeholder={t.clientContext} className="w-full rounded border p-2" rows={2} />
        <div className="mt-2 flex items-center gap-2">
          <button disabled={emailBusy} onClick={generate} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">{emailBusy ? "…" : t.generate}</button>
          <span role="status" className="text-slate-500">{msg}</span>
        </div>
        {emailError && <p role="alert" className="mt-2 text-rose-600">{emailError}</p>}
        {emailDraft && <div className="mt-4 space-y-3 rounded border p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t.emailPreview}</h3>
            <span className="text-xs text-slate-500">{t.emailStatus}: {emailDraft.status}</span>
          </div>
          <label className="block text-xs text-slate-500">{t.emailSubject}
            <input value={emailDraft.subject} disabled={emailDraft.status === "SENT"} onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 text-sm text-slate-900" />
          </label>
          <label className="block text-xs text-slate-500">{t.emailBody}
            <textarea value={emailDraft.text} disabled={emailDraft.status === "SENT"} onChange={(e) => setEmailDraft({ ...emailDraft, text: e.target.value })} rows={10} className="mt-1 w-full rounded border p-2 text-sm text-slate-900" />
          </label>
          <p className="text-xs text-slate-500">{emailDirty ? t.unsavedEmail : t.editNotice}</p>
          <iframe title={t.emailPreview} srcDoc={previewHtml(emailDraft.text)} className="h-64 w-full rounded border bg-white" />
          <div className="flex flex-wrap items-center gap-2">
            {emailDraft.status !== "SENT" && <button disabled={emailBusy} onClick={saveEmail} className="rounded border px-3 py-1.5 disabled:opacity-50">{t.saveEmail}</button>}
            {emailDraft.status === "DRAFT" && <button disabled={emailBusy || emailDirty} onClick={() => advanceEmail("review")} className="rounded border px-3 py-1.5 disabled:opacity-50">{t.review}</button>}
            {emailDraft.status === "REVIEW" && <button disabled={emailBusy || emailDirty} onClick={() => advanceEmail("approve")} className="rounded border px-3 py-1.5 disabled:opacity-50">{t.approve}</button>}
            {emailDraft.status === "APPROVED" && <>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)} type="email" placeholder={t.candidateEmail} className="min-w-56 rounded border px-2 py-1.5" />
              <button disabled={emailBusy || emailDirty || !recipient} onClick={() => advanceEmail("send")} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">{t.sendEmail}</button>
              <span className="text-xs text-slate-500">{t.sendWarning}</span>
            </>}
          </div>
        </div>}
      </div>
    </div>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div><div className="space-y-0.5">{children}</div></div>
);

function Search({ t, locale }: { t: any; locale: Locale }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const openCandidate = async (candidateDbId: string) => {
    setSelected(null);
    setDetailBusy(true);
    setDetailError("");
    try {
      const profile = await api(`/api/candidates/${candidateDbId}?locale=${locale}`);
      let email = null;
      try {
        email = await api("/api/emails", "POST", { candidateIds: [candidateDbId], clientContext: "" });
      } catch (error) {
        setDetailError(String(error));
      }
      setSelected({ profile, email });
    } catch (error) {
      setDetailError(String(error));
    } finally {
      setDetailBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} className="flex-1 rounded border bg-white px-3 py-2 text-sm" />
        <button disabled={busy || !q.trim()} onClick={async () => { setBusy(true); setErr(""); try { setRes(await api("/api/search", "POST", { query: q })); } catch (e) { setErr(String(e)); } finally { setBusy(false); } }} className="rounded bg-slate-900 px-4 text-sm text-white disabled:opacity-50">{busy ? "…" : t.run}</button>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {res && res.results.length === 0 && <p className="text-sm text-slate-500">{t.noSearchResults}</p>}
      {res?.results.map((r: any) => (
        <div key={r.candidateDbId} className="rounded-lg border bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <div><button onClick={() => openCandidate(r.candidateDbId)} className="text-left font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900">{r.candidateName}</button><div className="text-xs text-slate-400">{r.candidateId}</div></div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-slate-900 px-2 py-0.5 text-white">{t.score} {r.score}%</span>
              <button onClick={() => api("/api/search", "PUT", { queryId: res.queryId, candidateId: r.candidateDbId, rating: 1 })}>👍</button>
              <button onClick={() => api("/api/search", "PUT", { queryId: res.queryId, candidateId: r.candidateDbId, rating: -1 })}>👎</button>
            </div>
          </div>
          <p className="my-2 text-slate-600">{r.summary}</p>
          <Block title={t.matched}>{r.matched.map((m: any, i: number) => <div key={i}>✓ {m.requirement} <span className="text-slate-400">— {m.reason}</span>{m.evidence[0] && <span className="ml-1 text-xs italic text-slate-400">“{m.evidence[0].quote}”</span>}</div>)}</Block>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Block title={t.searchExperience}>
              {r.experience.years.map((value: string, i: number) => <div key={`years-${i}`}>{t.years}: {value}</div>)}
              {r.experience.roles.map((value: string, i: number) => <div key={`role-${i}`}>{t.role}: {value}</div>)}
              {r.experience.seniority.map((value: string, i: number) => <div key={`seniority-${i}`}>{t.seniority}: {value}</div>)}
              {r.experience.leadership.map((value: string, i: number) => <div key={`leadership-${i}`}>{t.leadership}: {value}</div>)}
              {r.experience.companies.length > 0
                ? r.experience.companies.map((company: any, i: number) => <div key={`company-${i}`} className="mb-2">
                    <div className="font-medium">{company.name}{company.role ? ` — ${company.role}` : ""}{company.duration ? ` · ${company.duration}` : ""}</div>
                    {company.responsibilities.length > 0 && <ul className="ml-4 list-disc text-slate-600">{company.responsibilities.map((item: string, j: number) => <li key={j}>{item}</li>)}</ul>}
                  </div>)
                : <div className="text-slate-400">—</div>}
            </Block>
            <div className="space-y-3">
              <Block title={t.salary}>
                {r.compensation.current.map((value: string, i: number) => <div key={`current-${i}`}>{t.currentSalary}: {value}</div>)}
                {r.compensation.expected.map((value: string, i: number) => <div key={`expected-${i}`}>{t.expectedSalary}: {value}</div>)}
                {r.compensation.currency.map((value: string, i: number) => <div key={`currency-${i}`}>{value}</div>)}
                {!r.compensation.current.length && !r.compensation.expected.length && !r.compensation.currency.length && <div className="text-slate-400">—</div>}
              </Block>
              <Block title={t.availability}>
                {r.availability.type.map((value: string, i: number) => <div key={`type-${i}`}>{t.availabilityType}: {value}</div>)}
                {r.availability.hoursPerWeek.map((value: string, i: number) => <div key={`hours-${i}`}>{t.hoursPerWeek}: {value}</div>)}
                {r.availability.hoursPerDay.map((value: string, i: number) => <div key={`hours-day-${i}`}>{t.hoursPerDay}: {value}</div>)}
                {r.availability.immediate.map((value: string, i: number) => <div key={`immediate-${i}`}>{t.immediateAvailability}: {value}</div>)}
                {r.availability.noticePeriod.map((value: string, i: number) => <div key={`notice-${i}`}>{t.noticePeriod}: {value}</div>)}
                {r.availability.notes.map((value: string, i: number) => <div key={`notes-${i}`}>{t.availabilityNotes}: {value}</div>)}
                {!r.availability.type.length && !r.availability.hoursPerWeek.length && !r.availability.hoursPerDay.length && !r.availability.immediate.length && !r.availability.noticePeriod.length && !r.availability.notes.length && <div className="text-slate-400">—</div>}
              </Block>
              <Block title={t.languages}>
                {[...r.languages.english.map((value: string) => `${t.english}: ${value}`), ...r.languages.spanish.map((value: string) => `${t.spanish}: ${value}`)].map((value: string, i: number) => <div key={i}>{value}</div>)}
                {!r.languages.english.length && !r.languages.spanish.length && <div className="text-slate-400">—</div>}
              </Block>
            </div>
            <Block title={t.skills}>{SKILL_CATEGORIES.map((category) => {
              const skills = r.skillCategories[category] ?? [];
              return skills.length > 0 && <div key={category}>
                <div className="text-xs font-medium text-slate-400">{t.skillCategories[category]}</div>
                <div>{skills.join(", ")}</div>
              </div>;
            })}</Block>
            <Block title={t.projects}>{r.projects.length ? r.projects.map((p: any, i: number) => <div key={i}><div className="font-medium">{p.name}</div><div className="text-slate-600">{p.description}</div></div>) : "—"}</Block>
            <Block title={t.achievements}>{r.achievements.length ? r.achievements.map((item: any, i: number) => <div key={i}>{item.text}</div>) : "—"}</Block>
            {r.details.length > 0 && <Block title={t.otherDetails}>{r.details.map((item: any, i: number) => <div key={`${item.key}-${i}`}><span className="text-slate-400">{item.key.replace(/_/g, " ")}: </span>{item.value}</div>)}</Block>}
          </div>
        </div>
      ))}
      {(detailBusy || selected) && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => { setSelected(null); setDetailBusy(false); }}>
        <section role="dialog" aria-modal="true" aria-label={t.searchExperience} className="my-4 w-full max-w-5xl rounded-lg bg-slate-50 p-4 shadow-xl md:p-6" onClick={(event) => event.stopPropagation()}>
          <div className="mb-3 flex justify-end"><button onClick={() => { setSelected(null); setDetailBusy(false); }} className="rounded border bg-white px-3 py-1.5 text-sm">{t.close}</button></div>
          {detailBusy && !selected && <p className="text-sm text-slate-500">{t.loadingProfile}</p>}
          {detailError && <p role="alert" className="mb-3 text-sm text-rose-600">{detailError}</p>}
          {selected?.profile && <Profile key={selected.profile.id} d={selected.profile} t={t} initialEmail={selected.email} />}
        </section>
      </div>}
    </div>
  );
}

function Emails({ t }: { t: any }) {
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [err, setErr] = useState("");
  const [to, setTo] = useState("");
  const load = () => api("/api/emails").then(setList);
  const open = (id: string) => api(`/api/emails/${id}`).then(setSel);
  useEffect(() => { load(); }, []);
  const act = async (action: string) => {
    setErr("");
    try { await api(`/api/emails/${sel.id}`, "POST", { action, to }); await open(sel.id); await load(); } catch (e) { setErr(String(e)); }
  };
  const deleteReview = async () => {
    if (!sel || sel.status !== "REVIEW" || !window.confirm(t.confirmDeleteReview)) return;
    setErr("");
    try {
      await api(`/api/emails/${sel.id}`, "DELETE");
      setSel(null);
      setTo("");
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };
  const label: Record<string, string> = { DRAFT: t.draft, REVIEW: t.inReview, APPROVED: t.approved, SENT: t.sent };
  return (
    <div className="grid grid-cols-3 gap-6">
      <section className="space-y-2">
        {list.map((e) => (
          <button key={e.id} onClick={() => open(e.id)} className="block w-full rounded-lg border bg-white p-3 text-left text-sm hover:border-slate-400">
            <div className="font-medium">{e.subject}</div>
            <div className="text-xs text-slate-500">{label[e.status]} · {e.locale}</div>
          </button>
        ))}
      </section>
      <section className="col-span-2 space-y-3">
        {sel && (
          <>
            <input value={sel.subject} onChange={(e) => setSel({ ...sel, subject: e.target.value })} className="w-full rounded border bg-white px-3 py-2 text-sm font-medium" disabled={sel.status === "SENT"} />
            <textarea value={sel.text} onChange={(e) => setSel({ ...sel, text: e.target.value })} rows={8} className="w-full rounded border bg-white p-3 text-sm" disabled={sel.status === "SENT"} />
            <button disabled={sel.status === "SENT"} onClick={async () => { try { await api(`/api/emails/${sel.id}`, "PATCH", { subject: sel.subject, text: sel.text }); await open(sel.id); await load(); } catch (e) { setErr(String(e)); } }} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">Save (→ {t.draft})</button>
            <p className="text-xs text-slate-400">Saving edits resets status to Draft. HTML preview below shows the last generated HTML.</p>
            <iframe title="preview" srcDoc={sel.html} className="h-96 w-full rounded border bg-white" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-slate-200 px-2 py-1">{label[sel.status]}</span>
              {sel.status === "DRAFT" && <button onClick={() => act("review")} className="rounded bg-slate-900 px-3 py-1.5 text-white">{t.review}</button>}
              {sel.status === "REVIEW" && <button onClick={() => act("approve")} className="rounded bg-emerald-600 px-3 py-1.5 text-white">{t.approve}</button>}
              {sel.status === "REVIEW" && <button onClick={deleteReview} className="rounded border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50">{t.deleteReviewEmail}</button>}
              {sel.status === "APPROVED" && (
                <>
                  <input value={to} onChange={(e) => setTo(e.target.value)} type="email" placeholder={t.candidateEmail} className="rounded border px-2 py-1.5" />
                    <button disabled={!to} onClick={() => act("send")} className="rounded bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-50">{t.send}</button>
                    <span className="text-xs text-slate-500">{t.sendWarning}</span>
                  </>
                )}
              {err && <span className="text-rose-600">{err}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

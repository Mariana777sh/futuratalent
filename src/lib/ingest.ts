import crypto from "node:crypto";
import { prisma, audit } from "./db";
import { hashEmbed, PROCESSOR_VERSION } from "./local";

type Ev = { source_quote: string; confidence: number };
type Extraction = {
  fields: (Ev & { key: string; value: string })[];
  skills: (Ev & { category: string; name: string })[];
  companies: (Ev & { company_name: string; role?: string | null; duration?: string | null; responsibilities?: string[] })[];
  projects: (Ev & { name: string; description: string; company_name?: string | null })[];
  achievements: (Ev & { text: string })[];
  follow_ups: { text: string; source_quote: string }[];
  recruiter_notes: { kind: string; text: string; source_quote: string }[];
  summary: string;
  industry_tags: string[];
  seniority_tags: string[];
};

type CandidateSkillCategory = "language" | "framework" | "scraping" | "cloud" | "database" | "additional";

const SKILL_CATEGORIES = new Set<string>([
  "language", "framework", "scraping", "cloud", "database", "additional",
]);

const OFFLINE_SKILLS: { name: string; category: CandidateSkillCategory; pattern: RegExp }[] = [
  { name: "TypeScript", category: "language", pattern: /\btypescript\b/i },
  { name: "JavaScript", category: "language", pattern: /\bjavascript\b|\bnode\.?js\b/i },
  { name: "Python", category: "language", pattern: /\bpython\b/i },
  { name: "Java", category: "language", pattern: /\bjava\b/i },
  { name: "SQL", category: "language", pattern: /\bsql\b/i },
  { name: "Go", category: "language", pattern: /\bgo(?:lang)?\b/i },
  { name: "Ruby", category: "language", pattern: /\bruby\b/i },
  { name: "PHP", category: "language", pattern: /\bphp\b/i },
  { name: "C#", category: "language", pattern: /\bc#\b/i },
  { name: "C++", category: "language", pattern: /\bc\+\+\b/i },
  { name: "Kotlin", category: "language", pattern: /\bkotlin\b/i },
  { name: "Swift", category: "language", pattern: /\bswift\b/i },
  { name: "Rust", category: "language", pattern: /\brust\b/i },
  { name: "HTML", category: "language", pattern: /\bhtml\b/i },
  { name: "CSS", category: "language", pattern: /\bcss\b/i },
  { name: "React", category: "framework", pattern: /\breact(?:\.?js| native)?\b/i },
  { name: "Next.js", category: "framework", pattern: /\bnext\.?js\b/i },
  { name: "Django", category: "framework", pattern: /\bdjango\b/i },
  { name: "FastAPI", category: "framework", pattern: /\bfastapi\b/i },
  { name: "Flask", category: "framework", pattern: /\bflask\b/i },
  { name: "Spring", category: "framework", pattern: /\bspring(?: boot)?\b/i },
  { name: "Selenium", category: "framework", pattern: /\bselenium\b/i },
  { name: "Playwright", category: "framework", pattern: /\bplaywright\b/i },
  { name: "Puppeteer", category: "framework", pattern: /\bpuppeteer\b/i },
  { name: "TensorFlow", category: "framework", pattern: /\btensorflow\b/i },
  { name: "PyTorch", category: "framework", pattern: /\bpytorch\b/i },
  { name: "Scrapy", category: "scraping", pattern: /\bscrapy\b/i },
  { name: "BeautifulSoup", category: "scraping", pattern: /\bbeautiful\s*soup\b/i },
  { name: "Web Scraping", category: "scraping", pattern: /\bweb\s*scrap(?:ing|ping)\b|\bscrap(?:ing|ping)\b/i },
  { name: "Requests", category: "scraping", pattern: /\brequests?\b/i },
  { name: "Pandas", category: "additional", pattern: /\bpandas\b/i },
  { name: "AWS", category: "cloud", pattern: /\baws\b|amazon web services/i },
  { name: "GCP", category: "cloud", pattern: /\bgcp\b|google cloud/i },
  { name: "Azure", category: "cloud", pattern: /\bazure\b/i },
  { name: "PostgreSQL", category: "database", pattern: /\bpostgres(?:ql)?\b/i },
  { name: "MySQL", category: "database", pattern: /\bmysql\b/i },
  { name: "MongoDB", category: "database", pattern: /\bmongodb\b/i },
  { name: "Redis", category: "database", pattern: /\bredis\b/i },
  { name: "DynamoDB", category: "database", pattern: /\bdynamodb\b/i },
  { name: "SQL Server", category: "database", pattern: /\bsql server\b/i },
  { name: "Docker", category: "additional", pattern: /\bdocker\b/i },
  { name: "Kubernetes", category: "additional", pattern: /\bkubernetes\b/i },
  { name: "Power BI", category: "additional", pattern: /\bpower\s*bi\b/i },
  { name: "Git", category: "additional", pattern: /\bgit(?:hub|lab)?\b/i },
];

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

function offlineExtraction(rawText: string, filename: string): Extraction {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "Unknown candidate";
  const extractedName = firstLine
    .replace(/^[●•*-]\s*/, "")
    .split(/\s+(?:[—–-]|\/|\|)\s*|:\s*/, 1)[0]
    .trim();
  const anonymousOrganizationHeadings = new Set(["MERCADO LIBRE"]);
  const candidateName = anonymousOrganizationHeadings.has(extractedName.toUpperCase()) ? "" : extractedName;
  const sourceSection = filename.match(/-section-(\d+)-/i)?.[1];
  const nameQuote = candidateName && rawText.includes(candidateName) ? candidateName : firstLine;
  const fields: Extraction["fields"] = candidateName
    ? [{ key: "candidate_name", value: candidateName, source_quote: nameQuote, confidence: 1 }]
    : [];
  const quoteFields = (key: string, pattern: RegExp, valueFromMatch = (match: RegExpMatchArray) => match[0]) => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        fields.push({ key, value: valueFromMatch(match), source_quote: line, confidence: 0.95 });
        return;
      }
    }
  };

  quoteFields("years_of_experience", /\b(?:more than|over|at least)?\s*\d+(?:\.\d+)?\+?\s*(?:years?|años?)\b/i);
  quoteFields("hours_per_week", /\b\d+\s*(?:h\s*)?(?:[-–—]\s*\d+\s*(?:h\s*)?)?(?:hours?|hrs?|horas?)\s*(?:(?:per|a la|por)\s*(?:week|semana)|\/\s*(?:week|semana)|\/\s*wk)\b/i);
  quoteFields("hours_per_day", /\b\d+\s*(?:h\s*)?(?:hours?|hrs?|horas?)\s*(?:(?:per|a la|por)\s*(?:day|día|dia)|\/\s*(?:day|día|dia))\b/i);
  for (const line of lines) {
    const type = line.match(/\b(part[\s-]?time|full[\s-]?time|tiempo parcial|tiempo completo)\b/i);
    if (type) {
      const value = /part|parcial/i.test(type[0]) ? "Part-time" : "Full-time";
      fields.push({ key: "availability_type", value, source_quote: line, confidence: 0.9 });
      if (/\b(?:flexible|flexibilidad)\b/i.test(line)) {
        fields.push({ key: "availability_notes", value: line, source_quote: line, confidence: 0.85 });
      }
    }
    const immediate = line.match(/\b(?:available|availability|disponible|disponibilidad)\s+(?:immediately|right away|now|from now|inmediata(?:mente)?|ahora|desde ahora)\b/i)
      ?? line.match(/\b(?:immediately available|available immediately|disponible inmediatamente)\b/i);
    if (immediate) fields.push({ key: "immediate_availability", value: immediate[0], source_quote: line, confidence: 0.9 });
    const notice = line.match(/\b(?:notice period|preaviso|aviso previo)\s*[:=]?\s*[^,;.]+/i);
    if (notice) fields.push({ key: "notice_period", value: notice[0].trim(), source_quote: line, confidence: 0.9 });
  }
  quoteFields("team_size", /\b(?:team|equipo)\s+(?:of|de)\s+\d+\b|\b\d+\s+(?:developers|desarrolladores|people|personas)\b/i);

  const leadershipPatterns: [RegExp, string][] = [
    [/\bsquad lead\b/i, "Squad Lead"],
    [/\btech(?:nical)? lead\b/i, "Tech Lead"],
    [/\bengineering manager\b/i, "Engineering Manager"],
    [/\bteam lead\b/i, "Team Lead"],
    [/\barchitecture ownership\b/i, "Architecture Ownership"],
  ];
  for (const line of lines) {
    const role = leadershipPatterns.find(([pattern]) => pattern.test(line));
    if (role) {
      fields.push({ key: "leadership_role", value: role[1], source_quote: line, confidence: 0.95 });
      break;
    }
  }

  const salarySection: Partial<Record<"current_salary" | "expected_salary_min" | "expected_salary_max", { value: string; sourceQuote: string }>> = {};
  let salaryLabel: "current_salary" | "expected_salary_min" | null = null;
  for (const line of lines) {
    if (/^(?:current salary|salario actual)\s*:/i.test(line)) salaryLabel = "current_salary";
    else if (/^(?:expected|expected salary|expectativa salarial)\s*:/i.test(line)) salaryLabel = "expected_salary_min";
    else if (/^(?:salary|salario)\s*:/i.test(line)) {
      const values = [...line.matchAll(/[$€£]?\s*\d[\d,.]*(?:\s*[km])?/gi)].map((match) => match[0].trim());
      if (values.length > 0) {
        salarySection.current_salary = { value: values[0], sourceQuote: line };
        if (values.length > 1) {
          salarySection.expected_salary_min = { value: values[1], sourceQuote: line };
          salarySection.expected_salary_max = { value: values[1], sourceQuote: line };
        }
      }
      salaryLabel = null;
      continue;
    }
    else if (/^(?:call|review|check|revisar|anotar|chequear)\b/i.test(line)) salaryLabel = null;

    if (!salaryLabel) continue;
    const amount = line.match(/[$€£]?\s*\d[\d,.]*(?:\s*(?:k|m))?(?:\s*(?:-|–|—|to|a)\s*[$€£]?\s*\d[\d,.]*(?:\s*(?:k|m))?)?/i);
    if (!amount) continue;
    const value = amount[0].trim();
    if (salaryLabel === "current_salary") salarySection.current_salary = { value, sourceQuote: line };
    else {
      const values = value.split(/\s*(?:-|–|—|to|a)\s*/i).map((part) => part.trim()).filter(Boolean);
      salarySection.expected_salary_min = { value: values[0], sourceQuote: line };
      salarySection.expected_salary_max = { value: values[1] ?? values[0], sourceQuote: line };
    }
    salaryLabel = null;
  }
  for (const [key, entry] of Object.entries(salarySection)) {
    if (entry) fields.push({ key, value: entry.value, source_quote: entry.sourceQuote, confidence: 0.95 });
  }

  for (const [key, label] of [["english_level", "english"], ["spanish_level", "spanish"]] as const) {
    for (const line of lines) {
      const language = line.match(new RegExp(`\\b${label}\\s*[:=-]?\\s*(native|fluent|professional|conversational|basic)\\b`, "iu"));
      if (language) {
        const value = language[1][0].toUpperCase() + language[1].slice(1).toLowerCase();
        fields.push({ key, value, source_quote: line, confidence: 0.9 });
        break;
      }
    }
  }

  const skills: Extraction["skills"] = [];
  const seenSkills = new Set<string>();
  for (const line of lines) {
    for (const skill of OFFLINE_SKILLS) {
      if (skill.pattern.test(line) && !seenSkills.has(skill.name)) {
        skills.push({ name: skill.name, category: skill.category, source_quote: line, confidence: 0.9 });
        seenSkills.add(skill.name);
      }
    }
  }

  const companies: Extraction["companies"] = [];
  const nonCompanyHeadings = new Set([
    "availability", "career", "compensation", "education", "experience", "profile",
    "projects", "salary", "summary", "technical skills", "techdstack", "techstack",
    "tech stack", "work experience", "built with", "bypassed",
  ]);
  const companyHeading = (line: string) => {
    const colon = line.match(/^([A-Z][\p{L}\d&.'-]*(?:\s+[A-Z][\p{L}\d&.'-]*){0,3}):$/u);
    if (colon) return { name: colon[1].trim(), firstLine: "" };
    const dash = line.match(/^(?:[Tt]he company\s+)?([A-Z][\p{L}\d&.'-]*(?:\s+[A-Z][\p{L}\d&.'-]*){0,3})\s+[—–-]\s*(.*)$/u);
    return dash ? { name: dash[1].trim(), firstLine: dash[2].trim() } : null;
  };
  const companyHeadings = lines.map(companyHeading);
  for (let index = 0; index < lines.length; index++) {
    const heading = companyHeadings[index];
    if (!heading || norm(heading.name) === norm(candidateName) || nonCompanyHeadings.has(heading.name.toLowerCase()) ||
      /^(?:current salary|expected|salary)$/i.test(heading.name)) continue;
    const end = companyHeadings.findIndex((next, candidateIndex) => candidateIndex > index && next !== null);
    const block = lines.slice(index, end < 0 ? lines.length : end);
    const blockText = block.join("\n");
    const roleLine = block.find((line, lineIndex) => (lineIndex > 0 || Boolean(heading.firstLine)) &&
      /\b(?:(?:data|software|senior|junior|staff|principal|backend|front[- ]end|full[- ]stack)\s+)*(?:architect|engineer|developer|analyst|manager|lead)\b/i.test(line));
    const durationLine = block.find((line) => /\b\d+(?:\.\d+)?\s*(?:years?|años?)\b/i.test(line));
    companies.push({
      company_name: heading.name,
      role: roleLine?.match(/\b(?:(?:data|software|senior|junior|staff|principal|backend|front[- ]end|full[- ]stack)\s+)*(?:architect|engineer|developer|analyst|manager|lead)\b/i)?.[0] ?? null,
      duration: durationLine?.match(/\b\d+(?:\.\d+)?\s*(?:years?|años?)\b/i)?.[0] ?? null,
      responsibilities: [heading.firstLine, ...block.slice(1)].filter(Boolean),
      source_quote: blockText,
      confidence: 0.85,
    });
  }

  const achievements: Extraction["achievements"] = lines
    .filter((line) => /\b(?:built|created|developed|managed|led|scraped|automat(?:ed|ion)|constru[ií]|cre[eé]|lider[eó]|automatiz[eó])\b/i.test(line)
      && !/^built with\s*:?\s*$/i.test(line))
    .map((line) => ({ text: line, source_quote: line, confidence: 0.8 }));
  const followUps: Extraction["follow_ups"] = [];
  const recruiterNotes: Extraction["recruiter_notes"] = [];
  for (const line of lines) {
    if (/^(?:call|review|check|revisar|anotar|chequear)\b/i.test(line)) {
      recruiterNotes.push({ kind: "ACTION", text: line, source_quote: line });
    }
  }
  const skillSummary = skills.slice(0, 6).map((skill) => skill.name).join(", ");
  return {
    fields,
    skills,
    companies,
    projects: [],
    achievements,
    follow_ups: followUps,
    recruiter_notes: recruiterNotes,
    summary: `${candidateName ? `The notes identify ${candidateName}.` : `The source notes do not state the candidate's name${sourceSection ? ` (PDF section ${Number(sourceSection)})` : ""}.`}${skillSummary ? ` Explicitly listed skills include ${skillSummary}.` : " No skills from the predefined categories were detected automatically; the original notes are retained."}`,
    industry_tags: [],
    seniority_tags: [],
  };
}

/**
 * Anti-hallucination gate: an item survives only if its quote is a verbatim substring of the source
 * (whitespace/quote-insensitive). Everything else is dropped and counted.
 */
export function grounded<T extends { source_quote: string }>(items: T[] | undefined, raw: string, dropped: { n: number }): T[] {
  const hay = norm(raw);
  return (items ?? []).filter((i) => {
    const q = norm(i.source_quote || "");
    const ok = q.length >= 3 && hay.includes(q);
    if (!ok) dropped.n++;
    return ok;
  });
}

const FIELD_KEYS = new Set([
  "candidate_name","location","timezone","current_role","seniority","years_of_experience","english_level","spanish_level",
  "immediate_availability","availability_type","hours_per_week","hours_per_day","notice_period","part_time","full_time","availability_notes",
  "current_salary","expected_salary_min","expected_salary_max","currency","leadership_role","team_size",
]);
const LEVELS = new Set(["Native","Fluent","Professional","Conversational","Basic","Unknown"]);

export async function ingestDocument(filename: string, rawText: string) {
  const sha = crypto.createHash("sha256").update(rawText).digest("hex");
  const existing = await prisma.document.findUnique({ where: { filename } });
  if (existing?.sha256 === sha && existing.status === "PROCESSED" && existing.promptVer === PROCESSOR_VERSION) return { skipped: true };

  const doc = await prisma.document.upsert({
    where: { filename },
    create: { filename, rawText, sha256: sha },
    update: { rawText, sha256: sha, status: "PENDING", error: null },
  });

  try {
    const ex = offlineExtraction(rawText, filename);
    const dropped = { n: 0 };

    const fields = grounded(ex.fields, rawText, dropped).filter((f) => FIELD_KEYS.has(f.key) &&
      (!/_level$/.test(f.key) || LEVELS.has(f.value)));
    const skills = grounded(ex.skills, rawText, dropped).filter((skill) => SKILL_CATEGORIES.has(skill.category));
    const companies = grounded(ex.companies, rawText, dropped);
    const projects = grounded(ex.projects, rawText, dropped);
    const achievements = grounded(ex.achievements, rawText, dropped);
    const followUps = grounded(ex.follow_ups, rawText, dropped);
    const notes = grounded(ex.recruiter_notes, rawText, dropped);

    const previousCandidate = await prisma.candidate.findUnique({ where: { documentId: doc.id }, select: { candidateId: true } });
    let candidateId = previousCandidate?.candidateId ?? "";
    if (!candidateId) {
      const usedIds = new Set((await prisma.candidate.findMany({ select: { candidateId: true } })).map((candidate) => candidate.candidateId));
      let next = 1;
      while (usedIds.has(`CAND-${String(next).padStart(3, "0")}`)) next++;
      candidateId = `CAND-${String(next).padStart(3, "0")}`;
    }
    const vectorText = [
      ex.summary,
      ...skills.map((s) => s.name),
      ...projects.map((p) => `${p.name} ${p.description}`),
      ...companies.map((c) => c.company_name),
      ...(ex.industry_tags ?? []),
    ].join(" ");

    await prisma.$transaction(async (tx) => {
      await tx.candidate.deleteMany({ where: { documentId: doc.id } });
      await tx.recruiterNote.deleteMany({ where: { documentId: doc.id } });
      const c = await tx.candidate.create({
        data: {
          documentId: doc.id,
          candidateId,
          summary: ex.summary ?? "",
          primarySkills: JSON.stringify(skills.slice(0, 8).map((s) => s.name)),
          industryTags: JSON.stringify(ex.industry_tags ?? []),
          seniorityTags: JSON.stringify(ex.seniority_tags ?? []),
          embedding: JSON.stringify(hashEmbed(vectorText)),
        },
      });
      const base = { candidateId: c.id, document: filename };
      await tx.field.createMany({ data: fields.map((f) => ({ ...base, key: f.key, value: String(f.value), sourceQuote: f.source_quote, confidence: f.confidence })) });
      await tx.skill.createMany({ data: skills.map((s) => ({ ...base, category: s.category, name: s.name, sourceQuote: s.source_quote, confidence: s.confidence })) });
      await tx.companyExperience.createMany({ data: companies.map((x) => ({ ...base, companyName: x.company_name, role: x.role ?? null, duration: x.duration ?? null, responsibilities: JSON.stringify(x.responsibilities ?? []), sourceQuote: x.source_quote, confidence: x.confidence })) });
      await tx.projectExperience.createMany({ data: projects.map((p) => ({ ...base, name: p.name, description: p.description, companyName: p.company_name ?? null, sourceQuote: p.source_quote, confidence: p.confidence })) });
      await tx.achievement.createMany({ data: achievements.map((a) => ({ ...base, text: a.text, sourceQuote: a.source_quote, confidence: a.confidence })) });
      await tx.followUp.createMany({ data: followUps.map((f) => ({ candidateId: c.id, text: f.text, sourceQuote: f.source_quote })) });
      await tx.recruiterNote.createMany({ data: notes.map((n) => ({ documentId: doc.id, kind: n.kind, text: n.text, sourceQuote: n.source_quote })) });
    });

    await prisma.document.update({ where: { id: doc.id }, data: { status: "PROCESSED", promptVer: PROCESSOR_VERSION } });
    await audit("Document", doc.id, "INGESTED", `mode=local; dropped_ungrounded=${dropped.n}`);
    return { skipped: false, candidateId, dropped: dropped.n, mode: "local" };
  } catch (e) {
    await prisma.document.update({ where: { id: doc.id }, data: { status: "FAILED", error: String(e) } });
    throw e;
  }
}

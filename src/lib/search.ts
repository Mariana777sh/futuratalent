import { prisma } from "./db";
import { cosine } from "./local";

const STOP_WORDS = new Set([
  "a", "al", "con", "de", "del", "el", "en", "es", "la", "las", "los", "para", "por", "que", "se", "un", "una", "y",
  "and", "for", "from", "has", "have", "in", "is", "of", "on", "or", "the", "to", "with",
]);
const FIELD_ALIASES: Record<string, string> = {
  years_of_experience: "experience years experiencia anos de experiencia trayectoria",
  current_role: "role title position cargo puesto rol actual",
  seniority: "seniority level seniority nivel experiencia",
  current_salary: "salary salario sueldo compensation compensacion actual",
  expected_salary_min: "expected salary salary expectation salario esperado expectativa salarial",
  expected_salary_max: "expected salary salary expectation salario esperado expectativa salarial",
  hours_per_week: "availability time commitment hours hours per week disponibilidad horas por semana",
  hours_per_day: "availability time commitment hours hours per day disponibilidad horas por dia",
  availability_type: "availability availability type work schedule part time full time disponibilidad tipo jornada tiempo parcial tiempo completo",
  immediate_availability: "availability available start immediately available now disponibilidad inmediata disponible ahora",
  notice_period: "notice period availability preaviso tiempo de aviso",
  availability_notes: "availability schedule flexible disponibilidad horario",
  english_level: "english ingles nivel",
  spanish_level: "spanish espanol nivel",
  location: "location ubicacion ciudad pais",
  timezone: "timezone zona horaria",
  leadership_role: "leadership management liderazgo gerencia",
  team_size: "team equipo personas",
};
const SALARY_QUERY_TERMS = new Set(["salary", "salario", "sueldo", "compensation", "compensacion", "remuneracion", "pay"]);

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tokenize = (value: string) => [...new Set(normalize(value).match(/[a-z0-9+#.]+/g) ?? [])]
  .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

type Evidence = { text: string; quote: string; weight: number; kind: string };

function candidateEvidence(candidate: {
  summary: string;
  fields: { key: string; value: string; sourceQuote: string }[];
  skills: { name: string; sourceQuote: string }[];
  companies: { companyName: string; role: string | null; responsibilities: string; sourceQuote: string }[];
  projects: { name: string; description: string; sourceQuote: string }[];
  achievements: { text: string; sourceQuote: string }[];
}) {
  const nameField = candidate.fields.find((field) => field.key === "candidate_name");
  const name = nameField?.value || "";
  const evidence: Evidence[] = [
    ...candidate.fields.filter((field) => field.key !== "candidate_name")
      .map((field) => ({ text: `${field.key} ${FIELD_ALIASES[field.key] ?? ""} ${field.value}`, quote: field.sourceQuote, weight: 2, kind: field.key.replace(/_/g, " ") })),
    ...candidate.skills.map((skill) => ({ text: skill.name, quote: skill.sourceQuote, weight: 4, kind: "skill" })),
    ...candidate.companies.map((company) => ({
      text: `${company.companyName} ${company.role ?? ""} ${JSON.parse(company.responsibilities).join(" ")}`,
      quote: company.sourceQuote, weight: 2, kind: "company experience",
    })),
    ...candidate.projects.map((project) => ({ text: `${project.name} ${project.description}`, quote: project.sourceQuote, weight: 2, kind: "project" })),
    ...candidate.achievements.map((achievement) => ({ text: achievement.text, quote: achievement.sourceQuote, weight: 1, kind: "achievement" })),
    { text: candidate.summary, quote: "", weight: 1, kind: "summary" },
  ];
  if (name) evidence.push({ text: name, quote: nameField?.sourceQuote ?? name, weight: 5, kind: "name" });
  return { name, evidence };
}

/** Deterministic local keyword search across evidenced candidate profile data. */
export async function search(text: string) {
  const terms = tokenize(text);
  const salarySearch = terms.some((term) => SALARY_QUERY_TERMS.has(term));
  const query = await prisma.searchQuery.create({
    data: { text, requirements: JSON.stringify({ terms }) },
  });
  if (terms.length === 0) return { queryId: query.id, parsed: { terms }, results: [] };

  const candidates = await prisma.candidate.findMany({
    include: { fields: true, skills: true, companies: true, projects: true, achievements: true },
  });
  const feedback = await prisma.searchFeedback.groupBy({
    by: ["candidateId"],
    _sum: { rating: true },
  });
  const feedbackByCandidate = new Map(feedback.map((item) => [item.candidateId, item._sum.rating ?? 0]));
  const denominator = terms.length * 5;

  const results = candidates.map((candidate) => {
    const { name, evidence } = candidateEvidence(candidate);
    const matched = terms.flatMap((term) => {
      const found = evidence
        .filter((item) => tokenize(item.text).includes(term))
        .sort((a, b) => b.weight - a.weight)[0];
      return found ? [{
        requirement: term,
        reason: `Matched ${found.kind}`,
        evidence: found.quote ? [{ quote: found.quote }] : [],
        weight: found.weight,
      }] : [];
    });
    const rawScore = matched.reduce((sum, item) => sum + item.weight, 0) / denominator;
    const feedbackAdjustment = 0.03 * Math.sign(feedbackByCandidate.get(candidate.id) ?? 0);
    const score = Math.max(0, Math.min(100, Math.round((rawScore + feedbackAdjustment) * 100)));
    const matchedTerms = new Set(matched.map((item) => item.requirement));
    const allCompanies = candidate.companies.map((company) => ({
      name: company.companyName,
      role: company.role,
      duration: company.duration,
      responsibilities: JSON.parse(company.responsibilities) as string[],
      sourceQuote: company.sourceQuote,
    }));
    const relevantCompanies = allCompanies
      .filter((company) => terms.some((term) => tokenize(`${company.name} ${company.role ?? ""}`).includes(term)))
      .map((company) => company.name);
    const profileFields = candidate.fields.reduce<Record<string, string[]>>((grouped, field) => {
      if (field.key !== "candidate_name") (grouped[field.key] ??= []).push(field.value);
      return grouped;
    }, {});
    const skillCategories = candidate.skills.reduce<Record<string, string[]>>((grouped, skill) => {
      (grouped[skill.category] ??= []).push(skill.name);
      return grouped;
    }, {});
    return {
      candidateDbId: candidate.id,
      candidateId: candidate.candidateId,
      candidateName: name || candidate.candidateId,
      score,
      matched: matched.map(({ weight: _weight, ...item }) => item),
      missing: terms.filter((term) => !matchedTerms.has(term)),
      companies: relevantCompanies,
      experience: {
        years: profileFields.years_of_experience ?? [],
        roles: profileFields.current_role ?? [],
        seniority: profileFields.seniority ?? [],
        leadership: profileFields.leadership_role ?? [],
        companies: allCompanies,
      },
      availability: {
        hoursPerWeek: profileFields.hours_per_week ?? [],
        hoursPerDay: profileFields.hours_per_day ?? [],
        type: profileFields.availability_type ?? [],
        immediate: profileFields.immediate_availability ?? [],
        noticePeriod: profileFields.notice_period ?? [],
        notes: profileFields.availability_notes ?? [],
      },
      compensation: {
        current: profileFields.current_salary ?? [],
        expected: [...(profileFields.expected_salary_min ?? []), ...(profileFields.expected_salary_max ?? [])]
          .filter((value, index, all) => all.indexOf(value) === index),
        currency: profileFields.currency ?? [],
      },
      languages: {
        english: profileFields.english_level ?? [],
        spanish: profileFields.spanish_level ?? [],
      },
      skillCategories,
      projects: candidate.projects.map((project) => ({ name: project.name, description: project.description, quote: project.sourceQuote })),
      achievements: candidate.achievements.map((achievement) => ({ text: achievement.text, quote: achievement.sourceQuote })),
      details: candidate.fields.filter((field) => field.key !== "candidate_name").map((field) => ({
        key: field.key,
        value: field.value,
        quote: field.sourceQuote,
      })),
      budgetOk: null,
      summary: candidate.summary,
    };
  }).filter((candidate) =>
    candidate.matched.length > 0 &&
    (!salarySearch || candidate.compensation.current.length > 0 || candidate.compensation.expected.length > 0),
  );

  results.sort((a, b) => b.score - a.score || a.candidateName.localeCompare(b.candidateName));
  return { queryId: query.id, parsed: { terms }, results };
}

export async function similarTo(candidateDbId: string, limit = 5) {
  const all = await prisma.candidate.findMany({ select: { id: true, candidateId: true, summary: true, embedding: true } });
  const me = all.find((candidate) => candidate.id === candidateDbId);
  if (!me?.embedding) return [];
  const vector = JSON.parse(me.embedding);
  return all.filter((candidate) => candidate.id !== me.id && candidate.embedding)
    .map((candidate) => ({ id: candidate.id, candidateId: candidate.candidateId, summary: candidate.summary, similarity: cosine(vector, JSON.parse(candidate.embedding!)) }))
    .sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

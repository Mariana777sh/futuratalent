import { prisma } from "./db";

export type Locale = "en" | "es-LATAM";

/**
 * Reuse translations already stored locally; uncached text is returned unchanged.
 * Source-quote text is NEVER translated (it is the evidence) - callers should only pass derived content.
 */
export async function translateMap(entityType: string, entityId: string, map: Record<string, string>, locale: Locale): Promise<Record<string, string>> {
  if (locale === "en") return map;
  const keys = Object.keys(map).filter((k) => map[k]?.trim());
  const cached = await prisma.translation.findMany({ where: { entityType, entityId, locale, fieldKey: { in: keys } } });
  const out: Record<string, string> = { ...map };
  const have = new Set<string>();
  for (const c of cached) if (c.original === map[c.fieldKey]) { out[c.fieldKey] = c.translated; have.add(c.fieldKey); }
  return out;
}

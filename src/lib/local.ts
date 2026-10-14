export const PROCESSOR_VERSION = "local-v5";

export function hashEmbed(text: string, dim = 512): number[] {
  const vector = new Array(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
    vector[Math.abs(hash) % dim] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

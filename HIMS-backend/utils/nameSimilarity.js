/**
 * Generic name-similarity matching, extracted from cdacAutoMapper.js so both
 * the CDAC and Care HIMS auto-mappers tune matching behavior in one place
 * instead of silently drifting apart. Zero CDAC/CARE-specific content.
 */

export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(str) {
  return new Set(normalize(str).split(' ').filter(Boolean));
}

export function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/** Best-scoring candidate for `name` among `candidates`, scored 0..1. */
export function bestMatch(name, candidates, getName) {
  const normA = normalize(name);
  if (!normA) return null;

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const normB = normalize(getName(c));
    if (!normB) continue;

    let score;
    if (normA === normB) score = 1;
    else if (normA.includes(normB) || normB.includes(normA)) score = 0.9;
    else score = jaccardSimilarity(name, getName(c));

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? { match: best, score: bestScore } : null;
}

export const AUTO_APPLY_THRESHOLD = 0.98; // effectively exact-match after normalization
export const SUGGEST_THRESHOLD = 0.6;

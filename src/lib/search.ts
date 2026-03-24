import type { SearchEntry } from "./types";

const scoreEntry = (entry: SearchEntry, terms: string[]) => {
  const haystack = [entry.label, entry.description, ...entry.tokens].join(" ").toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (entry.label.toLowerCase().includes(term)) {
      score += 5;
      continue;
    }

    if (haystack.includes(term)) {
      score += 2;
      continue;
    }

    return -1;
  }

  return score;
};

export const searchOffice = (entries: SearchEntry[], query: string) => {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  const terms = normalized.split(/\s+/).filter(Boolean);

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label))
    .slice(0, 8)
    .map((item) => item.entry);
};

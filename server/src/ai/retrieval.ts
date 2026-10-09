import type { AppConfig } from "../config/config";
import type { ClaimInput } from "../validators";
import type { PolicySection } from "./policy";

// Picks the policy clauses most relevant to a claim, using BM25 keyword scoring.
// The policy has ~30 short clauses, so this is fast, deterministic and easy to
// debug; embeddings would add a dependency without a clear benefit at this size.

const STOPWORDS = new Set(
  "a an and are as at be by for from if in is it of on or the to with was were this that per up via".split(" "),
);

// Small, explicit synonym map so everyday claim wording reaches policy wording
// (e.g. "uber" -> "taxi"). Kept short on purpose; extend it when retrieval misses.
const SYNONYMS: Record<string, string[]> = {
  dinner: ["meal"], lunch: ["meal"], breakfast: ["meal"], food: ["meal"], restaurant: ["meal"],
  uber: ["taxi", "ride"], ola: ["taxi", "ride"], cab: ["taxi"], auto: ["taxi"],
  flight: ["travel"], airfare: ["flight"], train: ["travel"], fuel: ["vehicle", "kilometre"],
  hotel: ["lodging"], stay: ["lodging", "hotel"], airbnb: ["lodging", "hotel"],
  license: ["software"], licence: ["software"], saas: ["software", "subscription"],
  course: ["training"], workshop: ["training"], certification: ["training", "course"],
  customer: ["client"],
  stationery: ["supply", "office"], printer: ["supply", "office"], laptop: ["equipment"], monitor: ["equipment"],
  wine: ["alcohol"], beer: ["alcohol"], bar: ["alcohol"],
};

// Lowercase, split on non-letters, drop stopwords, crude plural stemming.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("ies") ? `${t.slice(0, -3)}y` : t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

function expandQuery(tokens: string[]): string[] {
  return tokens.flatMap((t) => [t, ...(SYNONYMS[t] ?? [])]);
}

const K1 = 1.2;
const B = 0.75;
// Added to every clause of the claimed category. Large enough to surface the
// claimed category, small enough that a strong keyword match elsewhere still
// wins when the claimant picked the wrong category.
const CATEGORY_BOOST = 1.5;

export interface ScoredSection extends PolicySection {
  score: number;
  reason: "match" | "always";
}

function bm25Scores(queryTokens: string[], sections: PolicySection[]): number[] {
  const docs = sections.map((s) => tokenize(`${s.title} ${s.text}`));
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);

  const uniqueQuery = [...new Set(queryTokens)];
  return docs.map((doc) => {
    let score = 0;
    for (const term of uniqueQuery) {
      const tf = doc.filter((t) => t === term).length;
      if (tf === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (sections.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLen)));
    }
    return score;
  });
}

// Clauses always sent to the model when they apply: 1.4 (unclear claims go to a
// reviewer) always, and the receipt rules when the receipt is missing.
function mandatoryIds(claim: Pick<ClaimInput, "receiptAvailable">): string[] {
  return claim.receiptAvailable ? ["1.4"] : ["1.4", "9.1", "9.2", "9.3"];
}

export function retrieveSections(
  claim: Pick<ClaimInput, "description" | "category" | "receiptAvailable">,
  sections: PolicySection[],
  config: AppConfig,
  topK = 4,
): ScoredSection[] {
  const categoryLabel = config.categories[claim.category]?.label ?? "";
  const boostedGroup = config.categories[claim.category]?.policySection;
  const query = expandQuery(tokenize(`${claim.description} ${categoryLabel}`));
  const lexical = bm25Scores(query, sections);

  const scored = sections.map((s, i) => ({
    ...s,
    score: lexical[i]! + (s.group === boostedGroup ? CATEGORY_BOOST : 0),
    reason: "match" as ScoredSection["reason"],
  }));

  const top = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const chosen = new Map(top.map((s) => [s.id, s]));
  for (const id of mandatoryIds(claim)) {
    const section = scored.find((s) => s.id === id);
    if (section && !chosen.has(id)) chosen.set(id, { ...section, reason: "always" });
  }

  // Policy order reads better in the prompt and the UI than score order.
  return [...chosen.values()].sort((a, b) => compareIds(a.id, b.id));
}

function compareIds(a: string, b: string): number {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1! - b1! || a2! - b2!;
}

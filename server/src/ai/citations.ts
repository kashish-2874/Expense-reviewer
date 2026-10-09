import type { PolicySection } from "./policy";

// Checks that every citation the model gives points at a real clause and that
// the quote really appears in it. This catches invented sections and invented
// wording, the two ways a model can make advice look better supported than it is.

export interface VerifiedCitation {
  section: string;
  quote: string;
  verified: boolean;
  reason?: string;
}

// Case, whitespace, curly quotes and edge punctuation/ellipses should not make
// a faithful quote fail.
export function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.…]+|[\s"'.…]+$/g, "")
    .trim();
}

export function verifyCitations(
  citations: { section: string; quote: string }[],
  policy: PolicySection[],
): VerifiedCitation[] {
  const byId = new Map(policy.map((s) => [s.id, s]));
  return citations.map(({ section, quote }) => {
    const clause = byId.get(section.trim());
    if (!clause) return { section, quote, verified: false, reason: `Section ${section} does not exist in the policy` };

    const needle = normalizeQuote(quote);
    if (needle === "") return { section, quote, verified: false, reason: "Quote is empty" };
    if (!normalizeQuote(clause.text).includes(needle)) {
      return { section, quote, verified: false, reason: `Quote not found in section ${section}` };
    }
    return { section, quote, verified: true };
  });
}

import { readFileSync } from "node:fs";
import path from "node:path";

// Splits policy.md into numbered clauses ("2.1", "9.3", ...). Each clause keeps
// the title of its "## N. Title" heading so retrieval and the UI have context.

export interface PolicySection {
  id: string; // e.g. "2.1"
  group: string; // top-level section number, e.g. "2"
  title: string; // heading of the group, e.g. "Meals"
  text: string; // clause text without the number
}

const HEADING = /^##\s+(\d+)\.\s+(.+)$/;
const CLAUSE = /^(\d+)\.(\d+)\s+(.+)$/;

export function parsePolicy(markdown: string): PolicySection[] {
  const sections: PolicySection[] = [];
  let group: { id: string; title: string } | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      group = { id: heading[1]!, title: heading[2]!.trim() };
      continue;
    }
    const clause = CLAUSE.exec(line);
    if (clause && group && clause[1] === group.id) {
      sections.push({ id: `${clause[1]}.${clause[2]}`, group: group.id, title: group.title, text: clause[3]!.trim() });
    }
  }
  return sections;
}

export const POLICY_PATH = path.join(__dirname, "..", "policy", "policy.md");

export function loadPolicy(filePath: string = POLICY_PATH): PolicySection[] {
  const sections = parsePolicy(readFileSync(filePath, "utf8"));
  if (sections.length === 0) throw new Error(`No policy sections found in ${filePath}`);
  return sections;
}

// tsc only emits .ts (and imported .json) files. The schema and policy are read
// from disk at runtime, so copy them next to the compiled code.
import { cpSync } from "node:fs";

const assets = ["db/schema.sql", "policy/policy.md", "config/config.json"];
for (const file of assets) {
  cpSync(`src/${file}`, `dist/${file}`);
}
console.log(`Copied ${assets.length} assets to dist/`);

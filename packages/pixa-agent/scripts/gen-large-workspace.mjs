#!/usr/bin/env node
// Generates a synthetic TypeScript workspace for indexing-performance checks (R-010).
//
//   node scripts/gen-large-workspace.mjs <outDir> [fileCount=3000] [linesPerFile=120]
//
// Open <outDir> in the Extension Development Host with
// "pixa.semanticSearch.enabled": true and read the "Initial index complete …
// event-loop lag …" line in the "Pixa Index" output channel.
import * as fs from "node:fs";
import * as path from "node:path";

const [outDir, countArg = "3000", linesArg = "120"] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/gen-large-workspace.mjs <outDir> [fileCount] [linesPerFile]");
  process.exit(1);
}
const fileCount = Number(countArg);
const linesPerFile = Number(linesArg);

/** One synthetic module: a class plus helper functions, ~linesPerFile lines. */
function syntheticModule(i, lines) {
  const out = [`// module ${i}`, `export class Service${i} {`, `  private cache = new Map<string, number>();`];
  let fn = 0;
  while (out.length < lines - 2) {
    out.push(
      `  compute${fn}(input: string): number {`,
      `    const key = \`${i}:${fn}:\${input}\`;`,
      `    if (this.cache.has(key)) return this.cache.get(key)!;`,
      `    const value = input.split("").reduce((a, c) => a + c.charCodeAt(0) * ${fn + 1}, ${i});`,
      `    this.cache.set(key, value);`,
      `    return value;`,
      `  }`
    );
    fn++;
  }
  out.push(`}`, ``);
  return out.join("\n");
}

const perDir = 100;
for (let i = 0; i < fileCount; i++) {
  const dir = path.join(outDir, "src", `pkg${Math.floor(i / perDir)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `service${i}.ts`), syntheticModule(i, linesPerFile));
}
console.log(`Wrote ${fileCount} files (${linesPerFile} lines each) under ${path.resolve(outDir)}`);

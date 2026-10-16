/**
 * R-010 indexing performance harness — NOT part of CI.
 *
 *   PIXA_PERF=1 npx vitest run test/indexing.perf.manual.test.ts
 *
 * Env:
 *   PIXA_PERF_SIZES       comma-separated file counts (default "250,500,1000")
 *   PIXA_PERF_REAL_EMBED  "1" to use the real local embedding model instead of
 *                         a fast fake (isolates pipeline + storage cost)
 *
 * Generates a synthetic workspace with scripts/gen-large-workspace.mjs, runs
 * the real indexWorkspace + VectorStore (vscode mocked: findFiles walks the
 * fixture, no language-server symbols), and prints duration and event-loop lag.
 */
import { describe, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("vscode", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const walk = (dir: string, out: { fsPath: string }[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".pixa") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else out.push({ fsPath: p });
    }
    return out;
  };
  return {
    workspace: {
      findFiles: async (_include: string, _exclude: string, max: number) =>
        walk(state.root, []).slice(0, max),
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    commands: { executeCommand: async () => [] },
    window: {},
    ProgressLocation: { Notification: 15 },
    SymbolKind: {},
  };
});

vi.mock("../src/providers/embeddings", async (importOriginal) => {
  if (process.env.PIXA_PERF_REAL_EMBED === "1") return importOriginal();
  // MiniLM-sized (384-dim) vectors with realistic float lengths, so index.json
  // has the same size on disk as a real index.
  const fakeEmbed = (text: string) => {
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) | 0;
    return Array.from({ length: 384 }, (_, i) => Math.sin(seed + i) / 3);
  };
  return { embed: async (texts: string[]) => texts.map(fakeEmbed) };
});

import { VectorStore } from "../src/indexer/vectorStore";
import { indexWorkspace } from "../src/indexer/indexingPipeline";
import { formatIndexingMetrics } from "../src/indexer/indexingMetrics";

const sizes = (process.env.PIXA_PERF_SIZES ?? "250,500,1000").split(",").map(Number);
const generator = path.join(__dirname, "..", "scripts", "gen-large-workspace.mjs");

describe.skipIf(!process.env.PIXA_PERF)("R-010 indexing performance (manual)", () => {
  for (const n of sizes) {
    it(`indexes ${n} files`, { timeout: 60 * 60 * 1000 }, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `pixa-perf-${n}-`));
      try {
        execFileSync(process.execPath, [generator, root, String(n)]);
        state.root = root;

        const store = new VectorStore(root);
        const first = await indexWorkspace(root, store);
        const indexBytes = fs.statSync(path.join(root, ".pixa", "index", "index.json")).size;
        console.log(
          `[R-010] ${n} files, cold: ${first.filesIndexed} indexed, ${first.chunksIndexed} chunks, ` +
            `index.json ${(indexBytes / 1e6).toFixed(1)}MB; ${formatIndexingMetrics(first.metrics)}`
        );

        const second = await indexWorkspace(root, store);
        console.log(
          `[R-010] ${n} files, warm (nothing changed): ${second.filesSkipped} skipped; ${formatIndexingMetrics(second.metrics)}`
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

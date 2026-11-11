import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * R-013: findFiles follows symlinks, so a link inside the workspace that points
 * outside reaches the indexer. The jail rejects it; the indexer must skip that
 * file rather than abort the whole run.
 */

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("vscode", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const walk = (dir: string, out: { fsPath: string }[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".pixa" || entry.name === ".gitignore") continue;
      const p = path.join(dir, entry.name);
      // Like VS Code's findFiles (search.followSymlinks defaults to true).
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(p).isDirectory());
      if (isDir) walk(p, out);
      else out.push({ fsPath: p });
    }
    return out;
  };
  return {
    workspace: { findFiles: async () => walk(state.root, []) },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    commands: { executeCommand: async () => [] },
    window: {},
    ProgressLocation: { Notification: 15 },
    SymbolKind: {},
  };
});

vi.mock("../src/providers/embeddings", () => ({
  embed: async (texts: string[]) => texts.map((t) => Array.from({ length: 8 }, (_, i) => Math.sin(t.length + i))),
}));

import { VectorStore } from "../src/indexer/vectorStore";
import { indexWorkspace, indexFile } from "../src/indexer/indexingPipeline";

// Junctions need no admin rights on Windows.
const linkDir = (target: string, link: string) =>
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

function writeFiles(count: number): void {
  fs.mkdirSync(path.join(state.root, "src"), { recursive: true });
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(state.root, "src", `f${i}.ts`), `export const v${i} = ${i};\n`);
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(state.root, ".pixa", "index-manifest.json"), "utf8"));
}

let outside: string;

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-pipeline-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-pipeline-outside-"));
});

afterEach(() => {
  fs.rmSync(state.root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("indexing workspace jail: symlinks (R-013)", () => {
  it("skips files behind a link that points outside instead of aborting the run", async () => {
    fs.writeFileSync(path.join(outside, "secret.ts"), "export const SECRET = 1;\n");
    linkDir(outside, path.join(state.root, "link-dir"));
    writeFiles(2);
    const store = new VectorStore(state.root);

    const result = await indexWorkspace(state.root, store);
    await indexFile(state.root, store, "link-dir/secret.ts");

    expect(result.filesIndexed).toBe(2);
    expect(await store.isFileIndexed("link-dir/secret.ts")).toBe(false);
    expect(readManifest()).not.toHaveProperty("link-dir/secret.ts");
  });

  it("drops a file indexed earlier once its folder becomes a link that points outside", async () => {
    writeFiles(2);
    const store = new VectorStore(state.root);
    await indexWorkspace(state.root, store);
    expect(await store.isFileIndexed("src/f0.ts")).toBe(true);

    // Swap src/ for a link to a folder outside holding a file of the same name.
    fs.renameSync(path.join(state.root, "src"), path.join(outside, "src"));
    linkDir(path.join(outside, "src"), path.join(state.root, "src"));
    await indexWorkspace(state.root, store);

    expect(await store.isFileIndexed("src/f0.ts")).toBe(false);
    expect(readManifest()).not.toHaveProperty("src/f0.ts");
  });
});

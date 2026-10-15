import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
import { indexWorkspace, indexFile, createYielder, BATCH_FILES } from "../src/indexer/indexingPipeline";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join("\n");

function writeFiles(count: number, lineCount = 120): void {
  for (let i = 0; i < count; i++) {
    fs.mkdirSync(path.join(state.root, "src"), { recursive: true });
    fs.writeFileSync(path.join(state.root, "src", `f${i}.ts`), lines(lineCount));
  }
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(state.root, ".pixa", "index-manifest.json"), "utf8"));
}

/** Chunk ids stored for a file, straight from the vectra index on disk. */
function chunkIdsOnDisk(relPath: string): string[] {
  const index = JSON.parse(fs.readFileSync(path.join(state.root, ".pixa", "index", "index.json"), "utf8"));
  return index.items.filter((it: any) => it.metadata.filePath === relPath).map((it: any) => it.id);
}

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-pipeline-"));
});

afterEach(() => {
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe("indexWorkspace (R-010)", () => {
  it("commits files in batches instead of one transaction per file", async () => {
    writeFiles(BATCH_FILES * 2 + 5);
    const store = new VectorStore(state.root);
    const spy = vi.spyOn(store, "replaceFilesChunks");

    const result = await indexWorkspace(state.root, store);

    expect(result.filesIndexed).toBe(BATCH_FILES * 2 + 5);
    expect(result.cancelled).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(Object.keys(readManifest())).toHaveLength(BATCH_FILES * 2 + 5);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("drops a changed file's old chunks instead of leaving stale line ranges", async () => {
    writeFiles(1, 120); // 50-line windows at lines 0, 40, 80
    const store = new VectorStore(state.root);
    await indexWorkspace(state.root, store);
    expect(chunkIdsOnDisk("src/f0.ts")).toHaveLength(3);

    fs.writeFileSync(path.join(state.root, "src", "f0.ts"), lines(30)); // 1 window
    await indexWorkspace(state.root, store);

    expect(chunkIdsOnDisk("src/f0.ts")).toHaveLength(1);
  });

  it("removes files that disappeared since the last run", async () => {
    writeFiles(3);
    const store = new VectorStore(state.root);
    await indexWorkspace(state.root, store);

    fs.rmSync(path.join(state.root, "src", "f1.ts"));
    await indexWorkspace(state.root, store);

    expect(await store.isFileIndexed("src/f1.ts")).toBe(false);
    expect(readManifest()).not.toHaveProperty("src/f1.ts");
  });

  it("on cancel, keeps committed work, does not delete unreached files, and resumes incrementally", async () => {
    writeFiles(40);
    const store = new VectorStore(state.root);
    await indexWorkspace(state.root, store);

    // Change every file, then cancel part-way through the re-index.
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(state.root, "src", `f${i}.ts`), lines(60));
    let checks = 0;
    const token = {
      get isCancellationRequested() {
        return ++checks > 10;
      },
    };
    const partial = await indexWorkspace(state.root, store, { token });

    expect(partial.cancelled).toBe(true);
    expect(partial.filesIndexed).toBe(10);
    // Files the cancelled run never reached must still be searchable.
    expect(await store.listIndexedFiles()).toHaveLength(40);

    const resumed = await indexWorkspace(state.root, store);
    expect(resumed.filesSkipped).toBe(10);
    expect(resumed.filesIndexed).toBe(30);
  });

  it("a save-triggered indexFile during a full index does not collide on the vectra update lock", async () => {
    writeFiles(60);
    const store = new VectorStore(state.root);

    await expect(
      Promise.all([
        indexWorkspace(state.root, store),
        indexFile(state.root, store, "src/f3.ts"),
        indexFile(state.root, store, "src/f40.ts"),
      ])
    ).resolves.toBeDefined();
    expect(await store.isFileIndexed("src/f40.ts")).toBe(true);
  });
});

describe("VectorStore write serialization (R-010)", () => {
  it("concurrent upserts and deletes all succeed", async () => {
    const store = new VectorStore(state.root);
    const chunk = (file: string, n: number) => ({
      id: `${file}-${n}`,
      filePath: file,
      startLine: n,
      endLine: n,
      symbolName: null,
      symbolKind: null,
      text: `${file} ${n}`,
    });
    await store.upsertChunks([chunk("a.ts", 0)]);

    await Promise.all([
      store.upsertChunks([chunk("b.ts", 0), chunk("b.ts", 1)]),
      store.deleteChunksForFile("a.ts"),
      store.replaceFilesChunks([{ relPath: "c.ts", chunks: [chunk("c.ts", 0)] }]),
    ]);

    expect(await store.listIndexedFiles()).toEqual(["b.ts", "c.ts"]);
    expect(await store.size()).toBe(3);
  });
});

describe("createYielder", () => {
  it("lets a pending timer run during a long loop of awaited work", async () => {
    const maybeYield = createYielder(5);
    let timerRan = false;
    setTimeout(() => (timerRan = true), 0);
    const end = Date.now() + 60;
    while (Date.now() < end && !timerRan) {
      await maybeYield();
    }
    expect(timerRan).toBe(true);
  });
});

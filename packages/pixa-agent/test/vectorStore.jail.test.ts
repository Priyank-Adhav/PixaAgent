import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * R-013: chunk file paths are read back from .pixa/index/index.json on disk.
 * A cloned repo can ship that file pre-built (and R-009 auto-enables semantic
 * search when .pixa/index/ exists), so its paths are untrusted and must never
 * read anything outside the workspace.
 */

function fakeEmbed(text: string): number[] {
  const dims = 32;
  const vec = new Array(dims).fill(0);
  for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    vec[h % dims] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

vi.mock("../src/providers/embeddings.js", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(fakeEmbed)),
}));

import { VectorStore } from "../src/indexer/vectorStore.js";

const SECRET = "SECRET-TOKEN-do-not-leak";
const ESCAPING_PATH = "src/../../secret.txt";

let outer: string;
let workspace: string;

beforeEach(() => {
  // outer/secret.txt sits next to the workspace folder outer/ws.
  outer = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-jail-"));
  workspace = path.join(outer, "ws");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(outer, "secret.txt"), `${SECRET}\n`);
});

afterEach(() => {
  fs.rmSync(outer, { recursive: true, force: true });
});

describe("VectorStore workspace jail (R-013)", () => {
  it("readTextForChunk never reads a file outside the workspace", async () => {
    const store = new VectorStore(workspace);
    // Called directly, so this checks the reader itself, independent of the
    // isIndexablePath filter in front of it.
    const text = await (store as any).readTextForChunk(ESCAPING_PATH, 0, 0);
    expect(text).toBe("");
    expect(text).not.toContain(SECRET);
  });
});

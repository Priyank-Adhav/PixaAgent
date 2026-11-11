import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * R-013: findFiles follows symlinks, and the project map goes into the system
 * prompt on every request, so a link pointing outside would send the names of
 * outside files to the model provider unless the map is jailed too.
 */

const state = vi.hoisted(() => ({ root: "", extra: [] as string[] }));

vi.mock("vscode", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const walk = (dir: string, out: { fsPath: string }[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      // Like VS Code's findFiles (search.followSymlinks defaults to true).
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(p).isDirectory());
      if (isDir) walk(p, out);
      else out.push({ fsPath: p });
    }
    return out;
  };
  return {
    workspace: { findFiles: async () => [...walk(state.root, []), ...state.extra.map((fsPath) => ({ fsPath }))] },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    commands: { executeCommand: async () => [] },
    SymbolKind: {},
  };
});

import { WorkspaceIndexer } from "../src/indexer/workspaceIndexer";

// Junctions need no admin rights on Windows.
const linkType = process.platform === "win32" ? "junction" : "dir";

let outer: string;

beforeEach(() => {
  outer = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-mapjail-"));
  state.root = path.join(outer, "ws");
  state.extra = [];
  fs.mkdirSync(path.join(state.root, "src"), { recursive: true });
  fs.writeFileSync(path.join(state.root, "src", "app.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(outer, "outside"));
  fs.writeFileSync(path.join(outer, "outside", "secret-name.ts"), "x\n");
});

afterEach(() => {
  fs.rmSync(outer, { recursive: true, force: true });
});

describe("project map workspace jail (R-013)", () => {
  it("leaves out files behind a link that points outside", async () => {
    fs.symlinkSync(path.join(outer, "outside"), path.join(state.root, "link-dir"), linkType);
    const map = await new WorkspaceIndexer(state.root).getProjectMap();
    expect(map).toContain("app.ts");
    expect(map).not.toContain("secret-name.ts");
  });

  it("keeps files behind a link that stays inside the workspace", async () => {
    fs.symlinkSync(path.join(state.root, "src"), path.join(state.root, "inner-link"), linkType);
    const map = await new WorkspaceIndexer(state.root).getProjectMap();
    expect(map).toContain("inner-link");
  });

  it("leaves out hits from another folder of a multi-root window", async () => {
    state.extra = [path.join(outer, "outside", "secret-name.ts")];
    const map = await new WorkspaceIndexer(state.root).getProjectMap();
    expect(map).not.toContain("secret-name.ts");
  });
});

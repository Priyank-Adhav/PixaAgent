import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveInWorkspace, tryResolveInWorkspace } from "../src/tools/paths";

const root = process.platform === "win32" ? "C:\\work\\proj" : "/work/proj";

describe("resolveInWorkspace", () => {
  it("resolves a simple relative path", () => {
    expect(resolveInWorkspace(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
  });

  it("resolves '.' to the root", () => {
    expect(resolveInWorkspace(root, ".")).toBe(path.resolve(root));
  });

  it("rejects parent-directory escapes", () => {
    expect(() => resolveInWorkspace(root, "../secrets.txt")).toThrow(/escapes workspace/);
    expect(() => resolveInWorkspace(root, "src/../../other")).toThrow(/escapes workspace/);
  });

  it("rejects absolute paths outside the workspace", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\system32" : "/etc/passwd";
    expect(() => resolveInWorkspace(root, outside)).toThrow(/escapes workspace/);
  });

  it("accepts absolute paths inside the workspace", () => {
    const inside = path.join(root, "src", "a.ts");
    expect(resolveInWorkspace(root, inside)).toBe(inside);
  });

  it("rejects backslash escapes on windows-style input", () => {
    expect(() => resolveInWorkspace(root, "..\\..\\evil")).toThrow(/escapes workspace/);
  });
});

describe("tryResolveInWorkspace", () => {
  it("returns the absolute path for paths inside the workspace", () => {
    expect(tryResolveInWorkspace(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(tryResolveInWorkspace(root, ".")).toBe(path.resolve(root));
  });

  it("returns null instead of throwing for escapes", () => {
    expect(tryResolveInWorkspace(root, "../secrets.txt")).toBeNull();
    expect(tryResolveInWorkspace(root, "src/../../other")).toBeNull();
    expect(tryResolveInWorkspace(root, "..\\..\\evil")).toBeNull();
    const outside = process.platform === "win32" ? "C:\\Windows\\system32" : "/etc/passwd";
    expect(tryResolveInWorkspace(root, outside)).toBeNull();
  });
});

// Directory links use junctions, which Windows creates without admin rights.
// File symlinks need Developer Mode there, so those cases skip when unavailable.
function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

const canSymlinkFiles = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-symlink-probe-"));
  try {
    fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

describe("resolveInWorkspace: symlinks", () => {
  // outer/secret.txt sits next to the workspace folder outer/ws.
  let outer: string;
  let ws: string;

  beforeEach(() => {
    outer = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-paths-"));
    ws = path.join(outer, "ws");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src", "a.ts"), "export {};\n");
    fs.writeFileSync(path.join(outer, "secret.txt"), "SECRET\n");
  });

  afterEach(() => {
    fs.rmSync(outer, { recursive: true, force: true });
  });

  it("rejects a file reached through a directory link that points outside", () => {
    linkDir(outer, path.join(ws, "link-dir"));
    expect(() => resolveInWorkspace(ws, "link-dir/secret.txt")).toThrow(/escapes workspace/);
    expect(tryResolveInWorkspace(ws, "link-dir/secret.txt")).toBeNull();
  });

  it.skipIf(!canSymlinkFiles)("rejects a file symlink that points outside", () => {
    fs.symlinkSync(path.join(outer, "secret.txt"), path.join(ws, "link-file"), "file");
    expect(() => resolveInWorkspace(ws, "link-file")).toThrow(/escapes workspace/);
  });

  it("rejects a not-yet-created file under a directory link that points outside", () => {
    linkDir(outer, path.join(ws, "link-dir"));
    expect(() => resolveInWorkspace(ws, "link-dir/new.txt")).toThrow(/escapes workspace/);
    expect(() => resolveInWorkspace(ws, "link-dir/deep/new.txt")).toThrow(/escapes workspace/);
  });

  it.skipIf(!canSymlinkFiles)("rejects a dangling symlink, since a write would create its outside target", () => {
    fs.symlinkSync(path.join(outer, "missing.txt"), path.join(ws, "dangling"), "file");
    expect(() => resolveInWorkspace(ws, "dangling")).toThrow(/escapes workspace/);
  });

  it("rejects a write under a directory link whose target was removed", () => {
    const gone = path.join(outer, "gone");
    fs.mkdirSync(gone);
    linkDir(gone, path.join(ws, "dangling-dir"));
    fs.rmSync(gone, { recursive: true });
    expect(() => resolveInWorkspace(ws, "dangling-dir/new.txt")).toThrow(/escapes workspace/);
  });

  it("allows a link that stays inside the workspace and returns the lexical path", () => {
    linkDir(path.join(ws, "src"), path.join(ws, "lib"));
    expect(resolveInWorkspace(ws, "lib/a.ts")).toBe(path.join(ws, "lib", "a.ts"));
  });

  it("allows a workspace that is itself opened through a link", () => {
    const alias = path.join(outer, "alias");
    linkDir(ws, alias);
    expect(resolveInWorkspace(alias, "src/a.ts")).toBe(path.join(alias, "src", "a.ts"));
  });

  it("allows new files in a real workspace", () => {
    expect(resolveInWorkspace(ws, "src/new.ts")).toBe(path.join(ws, "src", "new.ts"));
    expect(resolveInWorkspace(ws, "brand/new/dir/x.ts")).toBe(path.join(ws, "brand", "new", "dir", "x.ts"));
  });
});

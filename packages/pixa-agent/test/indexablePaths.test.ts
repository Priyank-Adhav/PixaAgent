import { describe, it, expect } from "vitest";
import { isIndexablePath } from "../src/indexer/indexablePaths";

describe("isIndexablePath", () => {
  it("accepts ordinary workspace-relative paths", () => {
    for (const p of ["src/a.ts", ".github/workflows/ci.yml", "a..b.ts", "src/app..backup.ts", "src\\win\\a.ts"]) {
      expect(isIndexablePath(p), p).toBe(true);
    }
  });

  it("rejects empty paths and Pixa's own .pixa/ data", () => {
    for (const p of ["", ".pixa", ".pixa/index/index.json", ".pixa\\index-manifest.json"]) {
      expect(isIndexablePath(p), p).toBe(false);
    }
  });

  // Paths in .pixa/index/index.json come from disk, and a cloned repo controls
  // that file. Anything that could resolve outside the workspace is rejected,
  // not only paths that start with "..".
  it("rejects parent-directory segments anywhere in the path", () => {
    for (const p of ["../x.ts", "src/../../secret.txt", "a/b/../../../c", "src\\..\\..\\secret.txt"]) {
      expect(isIndexablePath(p), p).toBe(false);
    }
  });

  it("rejects absolute and drive-letter paths", () => {
    for (const p of ["/etc/passwd", "\\Windows\\system.ini", "C:/Users/me/.ssh/id_rsa", "C:\\Users\\me\\x.txt"]) {
      expect(isIndexablePath(p), p).toBe(false);
    }
  });
});

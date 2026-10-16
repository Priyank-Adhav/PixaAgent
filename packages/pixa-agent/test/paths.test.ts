import { describe, it, expect } from "vitest";
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

import { describe, it, expect } from "vitest";
import { ChangeSet } from "../src/edits/changeSet";

describe("ChangeSet.stageEdit", () => {
  it("stages a unique replacement", () => {
    const cs = new ChangeSet();
    const r = cs.stageEdit("a.ts", "const x = 1;\nconst y = 2;\n", "const y = 2;", "const y = 3;");
    expect(r.ok).toBe(true);
    expect(cs.get("a.ts")?.newContent).toBe("const x = 1;\nconst y = 3;\n");
    expect(cs.get("a.ts")?.status).toBe("pending");
  });

  it("errors when old string is not found", () => {
    const cs = new ChangeSet();
    const r = cs.stageEdit("a.ts", "hello", "missing", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found/i);
    expect(cs.get("a.ts")).toBeUndefined();
  });

  it("errors when old string matches more than once", () => {
    const cs = new ChangeSet();
    const r = cs.stageEdit("a.ts", "dup dup", "dup", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2 times/);
  });

  it("composes sequential edits on the pending content", () => {
    const cs = new ChangeSet();
    cs.stageEdit("a.ts", "one two three", "one", "1");
    const r = cs.stageEdit("a.ts", "one two three", "two", "2");
    expect(r.ok).toBe(true);
    expect(cs.get("a.ts")?.newContent).toBe("1 2 three");
  });
});

describe("ChangeSet writes and lifecycle", () => {
  it("stages a new file (original null)", () => {
    const cs = new ChangeSet();
    cs.stageWrite("new.ts", null, "export {};\n");
    const fc = cs.get("new.ts")!;
    expect(fc.originalContent).toBeNull();
    expect(fc.newContent).toBe("export {};\n");
  });

  it("reverts only applied changes", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "old", "new");
    cs.markReverted("a.ts"); // still pending — no-op
    expect(cs.get("a.ts")?.status).toBe("pending");
    cs.markApplied("a.ts");
    cs.markReverted("a.ts");
    expect(cs.get("a.ts")?.status).toBe("reverted");
    expect(cs.get("a.ts")?.originalContent).toBe("old"); // original retained for the disk restore
  });

  it("lists, applies, rejects, and clears resolved", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "old", "new");
    cs.stageWrite("b.ts", null, "b");
    expect(cs.list().map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    cs.markApplied("a.ts");
    cs.markRejected("b.ts");
    expect(cs.get("a.ts")?.status).toBe("applied");
    expect(cs.get("b.ts")?.status).toBe("rejected");
    cs.clearResolved();
    expect(cs.list()).toHaveLength(0);
  });
});

describe("ChangeSet freshness guards (R-007)", () => {
  it("untouched file is fresh", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "const x = 1;\n", "const x = 2;\n");
    const res = cs.checkFreshness("a.ts", "const x = 1;\n");
    expect(res).toEqual({ fresh: true });
  });

  it("normalizes CRLF and LF line endings so untouched files never report stale", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "line1\nline2\n", "line1\nline2_mod\n");
    // Disk has CRLF, memory has LF
    expect(cs.checkFreshness("a.ts", "line1\r\nline2\r\n")).toEqual({ fresh: true });

    // Reverse: memory has CRLF, disk has LF
    const cs2 = new ChangeSet();
    cs2.stageWrite("b.ts", "line1\r\nline2\r\n", "line1\nline2\n");
    expect(cs2.checkFreshness("b.ts", "line1\nline2\n")).toEqual({ fresh: true });
  });

  it("normalizes leading UTF-8 BOM so untouched files never report stale", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "hello world\n", "hello updated\n");
    // Disk has leading BOM \uFEFF and CRLF
    expect(cs.checkFreshness("a.ts", "\uFEFFhello world\r\n")).toEqual({ fresh: true });

    // Staged has BOM, disk does not
    const cs2 = new ChangeSet();
    cs2.stageWrite("b.ts", "\uFEFFhello\n", "hello2\n");
    expect(cs2.checkFreshness("b.ts", "hello\n")).toEqual({ fresh: true });
  });

  it("returns fresh: true when file exists on disk with content '' and originalContent is '' (empty is not missing)", () => {
    const cs = new ChangeSet();
    cs.stageWrite("empty.txt", "", "new content\n");
    const res = cs.checkFreshness("empty.txt", "");
    expect(res).toEqual({ fresh: true });
  });

  it("detects content modified on disk as stale (reason: changed)", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "const x = 1;\n", "const x = 2;\n");
    const res = cs.checkFreshness("a.ts", "const x = 99;\n");
    expect(res.fresh).toBe(false);
    if (!res.fresh) {
      expect(res.reason).toBe("changed");
      expect(res.message).toMatch(/modified on disk/i);
    }
  });

  it("detects file deleted on disk since staging as stale (reason: missing)", () => {
    const cs = new ChangeSet();
    cs.stageWrite("a.ts", "const x = 1;\n", "const x = 2;\n");
    const res = cs.checkFreshness("a.ts", null);
    expect(res.fresh).toBe(false);
    if (!res.fresh) {
      expect(res.reason).toBe("missing");
      expect(res.message).toMatch(/deleted on disk/i);
    }
  });

  it("new file (create_file) remains fresh when target does not exist on disk", () => {
    const cs = new ChangeSet();
    cs.stageWrite("new.ts", null, "content");
    const res = cs.checkFreshness("new.ts", null);
    expect(res).toEqual({ fresh: true });
  });

  it("new file (create_file) conflicts when target is created on disk (reason: created-conflict)", () => {
    const cs = new ChangeSet();
    cs.stageWrite("new.ts", null, "content");
    const res = cs.checkFreshness("new.ts", "already created content");
    expect(res.fresh).toBe(false);
    if (!res.fresh) {
      expect(res.reason).toBe("created-conflict");
      expect(res.message).toMatch(/created on disk/i);
    }
  });

  it("sequential edits compose and preserve initial originalContent for freshness check", () => {
    const cs = new ChangeSet();
    cs.stageEdit("a.ts", "one two three", "one", "1");
    cs.stageEdit("a.ts", "one two three", "two", "2");
    // intermediate pending content is "1 2 three"
    expect(cs.get("a.ts")?.newContent).toBe("1 2 three");
    // originalContent must still be initial baseline
    expect(cs.get("a.ts")?.originalContent).toBe("one two three");
    // Freshness check must compare against initial baseline, not intermediate
    expect(cs.checkFreshness("a.ts", "one two three")).toEqual({ fresh: true });
    expect(cs.checkFreshness("a.ts", "1 2 three").fresh).toBe(false);
  });

  it("returns missing when checking freshness for an unstaged file", () => {
    const cs = new ChangeSet();
    const res = cs.checkFreshness("unknown.ts", "content");
    expect(res.fresh).toBe(false);
    if (!res.fresh) {
      expect(res.reason).toBe("missing");
    }
  });
});

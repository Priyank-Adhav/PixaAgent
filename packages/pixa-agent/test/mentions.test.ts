import { describe, it, expect } from "vitest";
import {
  parseMentions,
  formatAttachedFiles,
  normalizeMention,
  isTraversalMention,
  pickMentionMatch,
  MAX_AMBIGUOUS_CANDIDATES,
} from "../src/agent/mentions";

describe("parseMentions", () => {
  it("extracts file-like mentions with extensions and paths", () => {
    expect(parseMentions("fix @src/server.js and check @routes/index.js please")).toEqual([
      "src/server.js",
      "routes/index.js",
    ]);
  });

  it("strips trailing punctuation and dedupes", () => {
    expect(parseMentions("look at @a.ts, then @a.ts again.")).toEqual(["a.ts"]);
  });

  it("ignores emails and bare @words", () => {
    expect(parseMentions("mail me at foo@bar and hi @everyone")).toEqual([]);
  });

  it("caps at 5 files", () => {
    const text = "@a.ts @b.ts @c.ts @d.ts @e.ts @f.ts";
    expect(parseMentions(text)).toHaveLength(5);
  });
});

describe("formatAttachedFiles", () => {
  it("returns empty string when nothing to attach", () => {
    expect(formatAttachedFiles([], [])).toBe("");
  });

  it("wraps content in file tags and reports unresolved", () => {
    const out = formatAttachedFiles([{ path: "a.ts", content: "const x = 1;" }], ["ghost.ts"]);
    expect(out).toContain('<file path="a.ts">');
    expect(out).toContain("const x = 1;");
    expect(out).toContain('path="ghost.ts" error="not found in workspace"');
  });

  it("truncates oversized content", () => {
    const out = formatAttachedFiles([{ path: "big.ts", content: "x".repeat(30_000) }], []);
    expect(out).toContain("truncated");
    expect(out.length).toBeLessThan(21_000);
  });
});

describe("formatAttachedFiles — ambiguous mentions", () => {
  it("renders ambiguous mentions with their candidates instead of guessing", () => {
    const out = formatAttachedFiles([], [], [
      { mention: "config.ts", candidates: ["src/a/config.ts", "src/b/config.ts"], truncated: false },
    ]);
    expect(out).toContain('path="config.ts" error="ambiguous"');
    expect(out).toContain('candidates="src/a/config.ts, src/b/config.ts"');
    expect(out).not.toContain("<file path=\"src/a/config.ts\">");
  });

  it("marks a truncated candidate list", () => {
    const out = formatAttachedFiles([], [], [
      { mention: "index.ts", candidates: ["a/index.ts", "b/index.ts"], truncated: true },
    ]);
    expect(out).toContain('candidates="a/index.ts, b/index.ts, …"');
  });
});

describe("normalizeMention", () => {
  it("converts backslashes and strips leading ./ and /", () => {
    expect(normalizeMention("src\\a\\config.ts")).toBe("src/a/config.ts");
    expect(normalizeMention("./src/app.ts")).toBe("src/app.ts");
    expect(normalizeMention("/src/app.ts")).toBe("src/app.ts");
  });
});

describe("isTraversalMention", () => {
  it("flags parent-directory segments", () => {
    expect(isTraversalMention("../secret.txt")).toBe(true);
    expect(isTraversalMention("src/../../secret.txt")).toBe(true);
    expect(isTraversalMention("..\\secret.txt")).toBe(true);
  });

  it("flags drive-letter and home-relative paths", () => {
    expect(isTraversalMention("C:\\Users\\x.txt")).toBe(true);
    expect(isTraversalMention("C:/Users/x.txt")).toBe(true);
    expect(isTraversalMention("~/.ssh/id_rsa.pub")).toBe(true);
  });

  it("allows ordinary workspace paths, including dotfiles and dotted names", () => {
    expect(isTraversalMention("src/config.ts")).toBe(false);
    expect(isTraversalMention(".github/workflows/ci.yml")).toBe(false);
    expect(isTraversalMention("src/app..backup.ts")).toBe(false);
    expect(isTraversalMention("/src/app.ts")).toBe(false); // root-relative, not absolute
  });
});

describe("pickMentionMatch", () => {
  it("returns missing when nothing matches", () => {
    expect(pickMentionMatch("config.ts", [])).toEqual({ kind: "missing" });
  });

  it("returns the single match", () => {
    expect(pickMentionMatch("config.ts", ["src/config.ts"])).toEqual({
      kind: "unique",
      path: "src/config.ts",
    });
  });

  it("reports every match when the filename is duplicated", () => {
    expect(pickMentionMatch("config.ts", ["src/b/config.ts", "src/a/config.ts"])).toEqual({
      kind: "ambiguous",
      candidates: ["src/a/config.ts", "src/b/config.ts"],
      truncated: false,
    });
  });

  it("matches on path-segment boundaries only", () => {
    expect(pickMentionMatch("config.ts", ["src/myconfig.ts", "src/config.ts"])).toEqual({
      kind: "unique",
      path: "src/config.ts",
    });
  });

  it("lets a partial path disambiguate", () => {
    expect(pickMentionMatch("a/config.ts", ["src/a/config.ts", "src/b/config.ts"])).toEqual({
      kind: "unique",
      path: "src/a/config.ts",
    });
  });

  it("prefers an exact root-relative match over deeper duplicates", () => {
    expect(pickMentionMatch("config.ts", ["src/config.ts", "config.ts"])).toEqual({
      kind: "unique",
      path: "config.ts",
    });
  });

  it("normalizes Windows-style mentions and candidates", () => {
    expect(pickMentionMatch("a\\config.ts", ["src\\a\\config.ts", "src/b/config.ts"])).toEqual({
      kind: "unique",
      path: "src/a/config.ts",
    });
  });

  it("sorts candidates shallowest first, then alphabetically", () => {
    const res = pickMentionMatch("index.ts", ["z/y/index.ts", "b/index.ts", "a/index.ts"]);
    expect(res).toEqual({
      kind: "ambiguous",
      candidates: ["a/index.ts", "b/index.ts", "z/y/index.ts"],
      truncated: false,
    });
  });

  it("caps the candidate list and flags truncation", () => {
    const many = Array.from({ length: MAX_AMBIGUOUS_CANDIDATES + 3 }, (_, i) => `d${String(i).padStart(2, "0")}/index.ts`);
    const res = pickMentionMatch("index.ts", many);
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") {
      expect(res.candidates).toHaveLength(MAX_AMBIGUOUS_CANDIDATES);
      expect(res.truncated).toBe(true);
    }
  });

  it("never resolves a traversal mention", () => {
    expect(pickMentionMatch("../secret.txt", ["secret.txt"])).toEqual({ kind: "missing" });
  });
});

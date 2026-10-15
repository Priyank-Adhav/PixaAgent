import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ensureGitignored } from "../src/indexer/vectorStore";

describe("ensureGitignored hygiene", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-hygiene-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // non-fatal
    }
  });

  it("creates .gitignore with .pixa/\\n when missing", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(false);

    const mutated = ensureGitignored(tempDir);
    expect(mutated).toBe(true);
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(".pixa/\n");
  });

  it("appends .pixa/\\n with correct newline handling when present without trailing newline", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules");

    const mutated = ensureGitignored(tempDir);
    expect(mutated).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("node_modules\n.pixa/\n");
  });

  it("appends .pixa/\\n with correct newline handling when present with trailing newline", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\n");

    const mutated = ensureGitignored(tempDir);
    expect(mutated).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("node_modules/\n.pixa/\n");
  });

  it("is a no-op when .pixa/ is already present", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\n.pixa/\n");

    const mutated = ensureGitignored(tempDir);
    expect(mutated).toBe(false);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("node_modules/\n.pixa/\n");
  });

  it("is a no-op when .pixa (without slash) is already present", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\n.pixa\n");

    const mutated = ensureGitignored(tempDir);
    expect(mutated).toBe(false);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("node_modules/\n.pixa\n");
  });

  it("makes no writes when called with the disabled option", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");

    const mutated = ensureGitignored(tempDir, { enabled: false });
    expect(mutated).toBe(false);
    expect(fs.existsSync(gitignorePath)).toBe(false);
  });
});

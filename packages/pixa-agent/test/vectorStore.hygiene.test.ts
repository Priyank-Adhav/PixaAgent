import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ensureGitignored } from "../src/indexer/vectorStore";
import { addNote } from "../src/memory/projectMemory";

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

  it("automatically ignores .pixa/ on first write when a note is saved in an un-indexed repo", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(false);

    // Save a memory note to trigger writing into .pixa/
    addNote(tempDir, "architecture: store auth tokens in httpOnly cookies");

    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(".pixa/\n");
    expect(fs.existsSync(path.join(tempDir, ".pixa", "memory.json"))).toBe(true);
  });
});

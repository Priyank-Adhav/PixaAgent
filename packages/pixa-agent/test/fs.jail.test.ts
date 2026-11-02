import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fsTools } from "../src/tools/fs";
import { ChangeSet } from "../src/edits/changeSet";
import type { ToolContext } from "../src/tools/types";

/**
 * R-013: the fs tools inherit the real-path jail from resolveInWorkspace, so a
 * link inside the repo that points outside can't be read or staged for writing.
 */

const SECRET = "SECRET-TOKEN-do-not-leak";

let outer: string;
let workspace: string;
let ctx: ToolContext;

function tool(name: string) {
  const t = fsTools.find((x) => x.schema.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

beforeEach(() => {
  // outer/secret.txt sits next to the workspace folder outer/ws, which links back out.
  outer = fs.mkdtempSync(path.join(os.tmpdir(), "pixa-fsjail-"));
  workspace = path.join(outer, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(outer, "secret.txt"), `${SECRET}\n`);
  fs.symlinkSync(outer, path.join(workspace, "link-dir"), process.platform === "win32" ? "junction" : "dir");
  ctx = {
    workspaceRoot: workspace,
    changeSet: new ChangeSet(),
    index: {} as ToolContext["index"],
    approvals: { requestApproval: async () => false },
    readWorkspaceFile: async (abs) => {
      try {
        return fs.readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    },
    emit: () => {},
  };
});

afterEach(() => {
  fs.rmSync(outer, { recursive: true, force: true });
});

describe("fs tools workspace jail: symlinks (R-013)", () => {
  it("read_file refuses a file reached through an outward link", async () => {
    const result = tool("read_file").execute({ path: "link-dir/secret.txt" }, ctx);
    await expect(result).rejects.toThrow(/escapes workspace/);
  });

  it("list_directory refuses an outward link", async () => {
    await expect(tool("list_directory").execute({ path: "link-dir" }, ctx)).rejects.toThrow(/escapes workspace/);
  });

  it("create_file stages nothing under an outward link", async () => {
    await expect(tool("create_file").execute({ path: "link-dir/new.txt", content: "x" }, ctx)).rejects.toThrow(
      /escapes workspace/,
    );
    expect(ctx.changeSet.list()).toEqual([]);
  });
});

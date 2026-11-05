import { describe, it, expect } from "vitest";
import { terminalTools, runShell } from "../src/tools/terminal";
import type { ToolContext } from "../src/tools/types";

/**
 * Proves the sandbox policy is actually wired into the registered run_command
 * tool — not just that evaluateCommand works in isolation (sandbox.test.ts
 * covers that). This is the integration that was previously missing: the
 * policy module existed but nothing called it on the live command path.
 */

const runCommand = terminalTools[0];

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    approvals: { requestApproval: async () => true },
    // Unused by run_command, present to satisfy the type.
    changeSet: {} as any,
    index: {} as any,
    readWorkspaceFile: async () => null,
    emit: () => {},
    ...overrides,
  };
}

describe("run_command sandbox wiring", () => {
  it("hard-blocks a denied command and never asks for approval", async () => {
    let approvalAsked = false;
    const result = await runCommand.execute(
      { command: "rm -rf /" },
      ctx({ approvals: { requestApproval: async () => (approvalAsked = true) } })
    );
    expect(result).toMatch(/blocked by Pixa's safety policy/i);
    expect(approvalAsked).toBe(false); // must not even prompt for a denied command
  });

  // "low-risk" is informational only: the policy never upgrades a command to
  // auto-run. Approval is still asked and, because the user declines, nothing runs.
  for (const command of ["git status", "ls -la", "echo hello", "cat package.json", "node --version"]) {
    it(`still requires approval for a low-risk command (no auto-run): ${command}`, async () => {
      let approvalAsked = false;
      const result = await runCommand.execute(
        { command },
        ctx({
          approvals: {
            requestApproval: async () => {
              approvalAsked = true;
              return false; // user declines
            },
          },
        })
      );
      expect(approvalAsked).toBe(true);
      expect(result).toMatch(/declined/i);
    });
  }

  it("runShell resolves < 5s with code 42 when stdin is closed", async () => {
    const start = Date.now();
    const result = await runShell(
      'node -e "process.stdin.on(\'end\',()=>process.exit(42));process.stdin.resume()"',
      process.cwd(),
      3_000
    );
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
    expect(result.code).toBe(42);
  });

  it("annotates tool result with warning when an interactive command is detected", async () => {
    const result = await runCommand.execute(
      { command: "pause" },
      ctx({ approvals: { requestApproval: async () => true } })
    );
    expect(result).toMatch(/Warning: Command appeared interactive/i);
  });
});

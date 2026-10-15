import { describe, it, expect } from "vitest";
import { estimateTokens, pruneHistory } from "../src/agent/contextManager";
import type { ChatMessage } from "../src/providers/types";

describe("estimateTokens", () => {
  it("estimates ceil(chars/4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

function msg(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { role, content, ...extra };
}

describe("pruneHistory", () => {
  it("returns messages unchanged when under budget", () => {
    const history = [msg("user", "hi"), msg("assistant", "hello")];
    expect(pruneHistory(history, 1000)).toEqual(history);
  });

  it("summarizes oldest oversized tool results first", () => {
    const history = [
      msg("user", "task"),
      msg("assistant", "", { toolCalls: [{ id: "1", name: "read_file", arguments: "{}" }] }),
      msg("tool", "x".repeat(4000), { toolCallId: "1", toolName: "read_file" }),
      msg("assistant", "done reading"),
      msg("user", "continue"),
    ];
    const pruned = pruneHistory(history, 500);
    const tool = pruned.find((m) => m.role === "tool")!;
    expect(tool.content).toContain("[tool result summarized: read_file, original 4000 chars]");
    expect(tool.content).toContain("File content compressed due to context budget.");
    expect(tool.content).toContain("Re-read the file if exact content is needed.");
    expect(tool.content).not.toBe("[result truncated]");
    // last user message always survives intact
    expect(pruned[pruned.length - 1].content).toBe("continue");
  });

  it("keeps command error lines when summarizing large command output", () => {
    const output = [
      "exit code: 1",
      ...Array.from({ length: 80 }, (_, i) => `routine output line ${i}`),
      "Traceback: failed to compile src/main.ts",
    ].join("\n");
    const history = [
      msg("user", "run tests"),
      msg("assistant", "", { toolCalls: [{ id: "1", name: "run_command", arguments: "{}" }] }),
      msg("tool", output, { toolCallId: "1", toolName: "run_command" }),
      msg("user", "what failed?"),
    ];

    const pruned = pruneHistory(history, 500);
    const tool = pruned.find((m) => m.role === "tool")!;

    expect(tool.content).toContain("[tool result summarized: run_command");
    expect(tool.content).toContain("exit code: 1");
    expect(tool.content).toContain("Traceback: failed to compile src/main.ts");
    expect(tool.content).toContain("Re-run the command if exact output is needed.");
  });

  it("does not summarize an already summarized tool result again", () => {
    const alreadySummarized = `[tool result summarized: read_file, original 5000 chars]\n${"a".repeat(1300)}`;
    const history = [
      msg("user", "task"),
      msg("assistant", "", { toolCalls: [{ id: "1", name: "read_file", arguments: "{}" }] }),
      msg("tool", alreadySummarized, { toolCallId: "1", toolName: "read_file" }),
      msg("assistant", "", { toolCalls: [{ id: "2", name: "search_workspace", arguments: "{}" }] }),
      msg("tool", "match\n".repeat(1000), { toolCallId: "2", toolName: "search_workspace" }),
      msg("user", "continue"),
    ];

    const pruned = pruneHistory(history, 800);
    const summarizedTool = pruned.find((m) => m.role === "tool" && m.toolCallId === "1")!;

    expect(summarizedTool.content).toBe(alreadySummarized);
  });

  it("drops oldest turns when truncation is not enough", () => {
    const history = [
      msg("user", "a".repeat(2000)),
      msg("assistant", "b".repeat(2000)),
      msg("user", "c".repeat(2000)),
      msg("assistant", "d".repeat(2000)),
      msg("user", "final question"),
    ];
    const pruned = pruneHistory(history, 600);
    expect(pruned[pruned.length - 1].content).toBe("final question");
    expect(pruned.length).toBeLessThan(history.length);
    const total = pruned.reduce((n, m) => n + estimateTokens(m.content), 0);
    expect(total).toBeLessThanOrEqual(600);
  });

  it("always keeps the last user message even if alone", () => {
    const history = [msg("user", "old"), msg("assistant", "old reply"), msg("user", "x".repeat(10000))];
    const pruned = pruneHistory(history, 100);
    expect(pruned[pruned.length - 1].role).toBe("user");
    expect(pruned[pruned.length - 1].content).toContain("x");
  });
});

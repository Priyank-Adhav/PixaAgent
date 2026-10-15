import type { ChatMessage } from "../providers/types";

/** Cheap token estimate: ~4 chars per token. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function historyTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 8, 0);
}

const TOOL_SUMMARY_CAP_CHARS = 1200;
const TOOL_SUMMARY_PREFIX = "[tool result summarized:";

/**
 * Fit history into a token budget. Strategy, in order:
 * 1. Replace oldest large tool results with compact, recoverable summaries.
 * 2. Drop oldest messages entirely (keeping tool-call pairing intact by
 *    dropping from the front), never dropping the final user message.
 */
export function pruneHistory(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  if (historyTokens(messages) <= budgetTokens) return messages;

  const result = messages.map((m) => ({ ...m }));
  const lastUserIdx = findLastUserIndex(result);

  // Pass 1: summarize oldest tool results.
  for (let i = 0; i < result.length && historyTokens(result) > budgetTokens; i++) {
    const m = result[i];
    if (m.role === "tool" && !isSummarizedToolResult(m.content) && m.content.length > TOOL_SUMMARY_CAP_CHARS) {
      m.content = summarizeToolResult(m);
    }
  }
  if (historyTokens(result) <= budgetTokens) return result;

  // Pass 2: drop oldest messages, preserving everything from the last user message on.
  let start = 0;
  while (start < lastUserIdx && historyTokens(result.slice(start)) > budgetTokens) {
    start++;
    // If we dropped an assistant message with tool calls, we must also drop its tool results
    // to avoid sending orphaned tool messages to the API (which causes 400 errors).
    while (start < lastUserIdx && result[start].role === "tool") {
      start++;
    }
  }
  return result.slice(start);
}

function findLastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return messages.length - 1;
}

function isSummarizedToolResult(content: string): boolean {
  return content.startsWith(TOOL_SUMMARY_PREFIX);
}

function summarizeToolResult(message: ChatMessage): string {
  const tool = message.toolName ?? "unknown_tool";
  const originalChars = message.content.length;

  if (tool === "run_command") {
    return formatToolSummary(
      tool,
      originalChars,
      importantCommandLines(message.content),
      "Command output compressed due to context budget. Re-run the command if exact output is needed."
    );
  }

  if (tool === "search_workspace") {
    return formatToolSummary(
      tool,
      originalChars,
      firstLines(message.content, 40),
      "Search results compressed due to context budget. Re-run search_workspace for full results."
    );
  }

  if (tool === "read_file") {
    return formatToolSummary(
      tool,
      originalChars,
      message.content.slice(0, TOOL_SUMMARY_CAP_CHARS),
      "File content compressed due to context budget. Re-read the file if exact content is needed."
    );
  }

  return formatToolSummary(
    tool,
    originalChars,
    message.content.slice(0, TOOL_SUMMARY_CAP_CHARS),
    "Tool output compressed due to context budget."
  );
}

function formatToolSummary(tool: string, originalChars: number, retained: string, recoveryHint: string): string {
  return [
    `${TOOL_SUMMARY_PREFIX} ${tool}, original ${originalChars} chars]`,
    retained,
    "",
    `[${recoveryHint}]`,
  ].join("\n");
}

function firstLines(s: string, maxLines: number): string {
  return s.split("\n").slice(0, maxLines).join("\n");
}

function importantCommandLines(s: string): string {
  const lines = s.split("\n");
  const important = lines.filter((line) => /error|failed|warning|exception|traceback|exit code/i.test(line));
  return [...new Set([...lines.slice(0, 30), ...important])].slice(0, 80).join("\n");
}

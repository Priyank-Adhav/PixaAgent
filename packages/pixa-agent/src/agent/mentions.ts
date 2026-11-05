/** Parsing and formatting for @-file mentions in chat messages. Pure module. */

const MENTION_RE = /@([A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]+|[A-Za-z0-9_\-./\\]*\/[A-Za-z0-9_\-./\\]+)/g;

export const MAX_ATTACHED_FILES = 5;
export const MAX_CHARS_PER_FILE = 20_000;

/** Extract candidate file paths from @-mentions. Deduplicated, order preserved. */
export function parseMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = match[1].replace(/[.,;:]+$/, ""); // strip trailing punctuation
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out.slice(0, MAX_ATTACHED_FILES);
}

/** Most duplicate matches listed for one ambiguous mention. */
export const MAX_AMBIGUOUS_CANDIDATES = 10;

/** Workspace-style form of a mention: forward slashes, no leading "./" or "/". */
export function normalizeMention(mention: string): string {
  return mention.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
}

/**
 * True for mentions that point outside the workspace: any ".." segment, a
 * drive letter, or a home-relative path. A leading "/" is treated as
 * workspace-root-relative, not absolute. This is a pre-filter only —
 * resolveInWorkspace() remains the real guard.
 */
export function isTraversalMention(mention: string): boolean {
  const s = mention.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(s) || s.startsWith("~")) return true;
  return s.split("/").some((seg) => seg === "..");
}

export type MentionResolution =
  | { kind: "unique"; path: string }
  | { kind: "ambiguous"; candidates: string[]; truncated: boolean }
  | { kind: "missing" };

/**
 * Pick the workspace file a mention refers to from search candidates
 * (workspace-relative paths). Matches whole path segments only, so
 * "config.ts" never matches "myconfig.ts". An exact root-relative match wins;
 * otherwise more than one match is reported as ambiguous rather than guessed.
 */
export function pickMentionMatch(mention: string, candidates: string[]): MentionResolution {
  if (isTraversalMention(mention)) return { kind: "missing" };
  const target = normalizeMention(mention).toLowerCase();
  if (!target) return { kind: "missing" };

  const matches = [...new Set(candidates.map(normalizeMention))].filter((c) => {
    const lower = c.toLowerCase();
    return lower === target || lower.endsWith("/" + target);
  });
  if (matches.length === 0) return { kind: "missing" };

  const exact = matches.find((c) => c.toLowerCase() === target);
  if (exact) return { kind: "unique", path: exact };
  if (matches.length === 1) return { kind: "unique", path: matches[0] };

  const depth = (p: string) => p.split("/").length;
  matches.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
  return {
    kind: "ambiguous",
    candidates: matches.slice(0, MAX_AMBIGUOUS_CANDIDATES),
    truncated: matches.length > MAX_AMBIGUOUS_CANDIDATES,
  };
}

export interface AttachedFile {
  path: string;
  content: string;
}

export interface AmbiguousMention {
  mention: string;
  candidates: string[];
  truncated: boolean;
}

/** Render attached files as a block appended to the user message. */
export function formatAttachedFiles(
  files: AttachedFile[],
  unresolved: string[],
  ambiguous: AmbiguousMention[] = []
): string {
  if (files.length === 0 && unresolved.length === 0 && ambiguous.length === 0) return "";
  const parts: string[] = ["\n\n<attached-files>"];
  for (const f of files) {
    const content =
      f.content.length > MAX_CHARS_PER_FILE
        ? f.content.slice(0, MAX_CHARS_PER_FILE) + "\n… (truncated — use read_file for the rest)"
        : f.content;
    parts.push(`<file path="${f.path}">\n${content}\n</file>`);
  }
  for (const miss of unresolved) {
    parts.push(`<file path="${miss}" error="not found in workspace" />`);
  }
  for (const amb of ambiguous) {
    const list = amb.candidates.join(", ") + (amb.truncated ? ", …" : "");
    parts.push(`<file path="${amb.mention}" error="ambiguous" candidates="${list}" />`);
  }
  parts.push("</attached-files>");
  return parts.join("\n");
}

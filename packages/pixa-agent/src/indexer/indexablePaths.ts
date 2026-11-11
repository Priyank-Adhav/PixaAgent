/**
 * Whether a workspace-relative path may be embedded and returned by semantic
 * search. Paths under .pixa/ are local index/benchmark data — never embed them.
 *
 * Paths also arrive from .pixa/index/index.json on disk, which a cloned repo
 * can ship pre-built, so anything that could resolve outside the workspace
 * (a ".." segment, an absolute or drive-letter path) is rejected too.
 */
export function isIndexablePath(relPath: string): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  return normalized !== ".pixa" && !normalized.startsWith(".pixa/");
}

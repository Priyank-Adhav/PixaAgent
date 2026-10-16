import * as path from "node:path";

/**
 * Resolve a path (relative or absolute) against the workspace root and verify
 * it does not escape it. Throws on escape. This is the single choke point for
 * all agent file access.
 */
export function resolveInWorkspace(root: string, p: string): string {
  // Normalize separators so "..\\..\\evil" is caught on every platform.
  const normalizedInput = p.replace(/\\/g, path.sep === "\\" ? "\\" : "/");
  const abs = path.resolve(root, normalizedInput);
  const rel = path.relative(path.resolve(root), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return abs;
}

/**
 * Non-throwing resolveInWorkspace: the absolute path, or null if `p` escapes
 * the workspace. For paths Pixa didn't produce itself — chat @-mentions,
 * on-disk index metadata — where an escape means "treat as not found".
 */
export function tryResolveInWorkspace(root: string, p: string): string | null {
  try {
    return resolveInWorkspace(root, p);
  } catch {
    return null;
  }
}

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve a path (relative or absolute) against the workspace root and verify
 * it does not escape it. Throws on escape. This is the single choke point for
 * all agent file access.
 *
 * Two checks: the path text must stay inside the root, and so must its real
 * location on disk, so a symlink or junction inside the repo that points
 * outside is not followed. Returns the lexical path, not the real one, so
 * callers' keys and labels don't change when a link stays inside.
 */
export function resolveInWorkspace(root: string, p: string): string {
  // Normalize separators so "..\\..\\evil" is caught on every platform.
  const normalizedInput = p.replace(/\\/g, path.sep === "\\" ? "\\" : "/");
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, normalizedInput);
  if (escapes(rootAbs, abs)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  if (escapes(realRootOf(rootAbs, p), realPathOf(abs, p))) {
    throw new Error(`Path escapes workspace (symlink): ${p}`);
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

// realpath is ~80µs on Windows and the indexer calls the jail several times per
// file. The workspace root doesn't move during a session, so resolve it once;
// the target is still resolved on every call.
const realRoots = new Map<string, string>();

function realRootOf(rootAbs: string, p: string): string {
  let real = realRoots.get(rootAbs);
  if (real === undefined) {
    real = realPathOf(rootAbs, p);
    realRoots.set(rootAbs, real);
  }
  return real;
}

function escapes(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel.startsWith("..") || path.isAbsolute(rel);
}

/**
 * Where `abs` really lives once links are followed. Paths that don't exist yet
 * (a new file from a staged edit) resolve through their deepest existing
 * ancestor, so a new file under an outward-pointing link is still caught.
 */
function realPathOf(abs: string, p: string): string {
  const missing: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch {
      // A link that exists but can't be resolved is dangling; writing through
      // it would create its target, wherever that is.
      if (isLink(current)) {
        throw new Error(`Path escapes workspace (unresolvable symlink): ${p}`);
      }
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing.reverse());
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

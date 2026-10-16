import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXCLUDE, MAX_FILES, isIndexablePath } from "./workspaceIndexer";
import { chunkFile, type Chunk } from "./chunker";
import { yieldToEventLoop, type VectorStore } from "./vectorStore";
import { resolveInWorkspace } from "../tools/paths";
import { redactSecrets } from "../security/redact";
import { startIndexingMetrics, type IndexingMetrics } from "./indexingMetrics";

/** Files larger than this are skipped entirely. */
const MAX_FILE_SIZE_BYTES = 500 * 1024;

/** Tracks each file's mtime+size so unchanged files are skipped on the next run. */
const MANIFEST_RELATIVE_PATH = path.join(".pixa", "index-manifest.json");

/**
 * One vector-store transaction (= one full index.json rewrite) per this many
 * files or chunks, whichever comes first. See VectorStore.replaceFilesChunks.
 */
export const BATCH_FILES = 25;
export const BATCH_CHUNKS = 500;
/** Give the extension host a turn after this much uninterrupted work. */
const YIELD_BUDGET_MS = 15;
/** Progress notifications at most this often (was: one per file). */
const PROGRESS_INTERVAL_MS = 100;

interface ManifestEntry {
  mtimeMs: number;
  size: number;
}
type Manifest = Record<string, ManifestEntry>;

async function loadManifest(workspaceRoot: string): Promise<Manifest> {
  const manifestPath = path.join(workspaceRoot, MANIFEST_RELATIVE_PATH);
  try {
    return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch {
    return {};
  }
}

/** Write-then-rename, so a host killed mid-write never leaves a truncated manifest. */
async function saveManifest(workspaceRoot: string, manifest: Manifest): Promise<void> {
  const manifestPath = path.join(workspaceRoot, MANIFEST_RELATIVE_PATH);
  const tmpPath = `${manifestPath}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(tmpPath, JSON.stringify(manifest));
    await fs.promises.rename(tmpPath, manifestPath);
  } catch {
    // Non-fatal — worst case some files are re-indexed next time.
  }
}

async function getSymbolsForFile(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    );
    return symbols ?? [];
  } catch {
    return [];
  }
}

/** Reads and chunks one file. Null if it can't be read. */
async function prepareFile(workspaceRoot: string, relPath: string): Promise<Chunk[] | null> {
  const abs = resolveInWorkspace(workspaceRoot, relPath);

  let content: string;
  try {
    content = await fs.promises.readFile(abs, "utf8");
  } catch {
    return null;
  }

  const symbols = await getSymbolsForFile(vscode.Uri.file(abs));
  return chunkFile(relPath, content, symbols).map((c) => ({
    ...c,
    text: redactSecrets(c.text),
  }));
}

/** Returns a function that yields to the event loop once `budgetMs` of work has passed since the last yield. */
export function createYielder(budgetMs = YIELD_BUDGET_MS): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < budgetMs) return;
    await yieldToEventLoop();
    last = performance.now();
  };
}

export interface IndexWorkspaceOptions {
  onProgress?: (message: string, fraction: number) => void;
  /** Checked between files. On cancel, finished work is committed and the run stops. */
  token?: { readonly isCancellationRequested: boolean };
}

export interface IndexWorkspaceResult {
  filesIndexed: number;
  filesSkipped: number;
  chunksIndexed: number;
  /** True if the run stopped early; the next run resumes from the manifest. */
  cancelled: boolean;
  /** Duration and extension-host event-loop lag for the run (R-010). */
  metrics: IndexingMetrics;
}

export async function indexWorkspace(
  workspaceRoot: string,
  vectorStore: VectorStore,
  options: IndexWorkspaceOptions = {}
): Promise<IndexWorkspaceResult> {
  const recorder = startIndexingMetrics();
  try {
    const counts = await indexWorkspaceInner(workspaceRoot, vectorStore, options);
    return { ...counts, metrics: recorder.stop() };
  } finally {
    recorder.stop();
  }
}

async function indexWorkspaceInner(
  workspaceRoot: string,
  vectorStore: VectorStore,
  { onProgress, token }: IndexWorkspaceOptions
): Promise<Omit<IndexWorkspaceResult, "metrics">> {
  await vectorStore.purgeNonIndexableFiles();

  const uris = await vscode.workspace.findFiles("**/*", EXCLUDE, MAX_FILES);
  const relPaths = uris
    .map((u) => path.relative(workspaceRoot, u.fsPath).split(path.sep).join("/"))
    .filter((p) => isIndexablePath(p));

  const manifest = await loadManifest(workspaceRoot);
  for (const relPath of Object.keys(manifest)) {
    if (!isIndexablePath(relPath)) {
      delete manifest[relPath];
    }
  }
  const seenPaths = new Set<string>();

  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksIndexed = 0;
  let cancelled = false;

  // Files waiting for the next batched transaction, with the stat to record
  // in the manifest once that transaction has committed.
  let pending: { relPath: string; chunks: Chunk[]; stat: fs.Stats }[] = [];
  let pendingChunks = 0;
  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    pendingChunks = 0;
    await vectorStore.replaceFilesChunks(batch);
    for (const f of batch) manifest[f.relPath] = { mtimeMs: f.stat.mtimeMs, size: f.stat.size };
    // Checkpoint after every commit: the manifest never claims files the
    // index doesn't have, and a killed host only redoes the last batch.
    await saveManifest(workspaceRoot, manifest);
  };

  const maybeYield = createYielder();
  let lastProgress = 0;
  const progress = (relPath: string, i: number) => {
    const now = performance.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS && i + 1 < relPaths.length) return;
    lastProgress = now;
    onProgress?.(relPath, (i + 1) / relPaths.length);
  };

  for (let i = 0; i < relPaths.length; i++) {
    if (token?.isCancellationRequested) {
      cancelled = true;
      break;
    }
    await maybeYield();

    const relPath = relPaths[i];
    seenPaths.add(relPath);

    const abs = resolveInWorkspace(workspaceRoot, relPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      progress(relPath, i);
      continue;
    }

    const existing = manifest[relPath];
    const unchanged = existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size;

    if (unchanged) {
      filesSkipped++;
      progress(relPath, i);
      continue;
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      filesIndexed++;
      progress(relPath, i);
      continue;
    }

    const chunks = await prepareFile(workspaceRoot, relPath);
    if (chunks) {
      pending.push({ relPath, chunks, stat });
      pendingChunks += chunks.length;
      chunksIndexed += chunks.length;
    }
    filesIndexed++;
    if (pending.length >= BATCH_FILES || pendingChunks >= BATCH_CHUNKS) await flush();
    progress(relPath, i);
  }

  await flush();

  // Only a complete pass knows which files vanished; a cancelled run must not
  // delete chunks for files it simply didn't reach.
  if (!cancelled) {
    const gone = Object.keys(manifest).filter((p) => !seenPaths.has(p));
    if (gone.length > 0) {
      await vectorStore.replaceFilesChunks(gone.map((relPath) => ({ relPath, chunks: [] })));
      for (const p of gone) delete manifest[p];
    }
    await saveManifest(workspaceRoot, manifest);
  }

  return { filesIndexed, filesSkipped, chunksIndexed, cancelled };
}

export async function indexWorkspaceWithProgress(
  workspaceRoot: string,
  vectorStore: VectorStore
): Promise<IndexWorkspaceResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Pixa: indexing workspace for semantic search",
      cancellable: true,
    },
    async (progress, token) => {
      let lastFraction = 0;
      return indexWorkspace(workspaceRoot, vectorStore, {
        token,
        onProgress: (relPath, fraction) => {
          const increment = (fraction - lastFraction) * 100;
          lastFraction = fraction;
          progress.report({ increment, message: relPath });
        },
      });
    }
  );
}

export async function indexFile(
  workspaceRoot: string,
  vectorStore: VectorStore,
  relPath: string
): Promise<void> {
  const forget = async () => {
    await vectorStore.deleteChunksForFile(relPath);
    const manifest = await loadManifest(workspaceRoot);
    if (manifest[relPath]) {
      delete manifest[relPath];
      await saveManifest(workspaceRoot, manifest);
    }
  };

  if (!isIndexablePath(relPath)) return forget();

  const abs = resolveInWorkspace(workspaceRoot, relPath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return forget();
  }

  const chunks = await prepareFile(workspaceRoot, relPath);
  // One transaction drops the old chunks and writes the new ones.
  await vectorStore.replaceFilesChunks([{ relPath, chunks: chunks ?? [] }]);

  const manifest = await loadManifest(workspaceRoot);
  manifest[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size };
  await saveManifest(workspaceRoot, manifest);
}

export function registerIncrementalIndexing(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  vectorStore: VectorStore
): void {
  const pending = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 1500;

  const disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
    const relPath = path.relative(workspaceRoot, doc.uri.fsPath).split(path.sep).join("/");
    if (!isIndexablePath(relPath)) return;

    const existing = pending.get(relPath);
    if (existing) clearTimeout(existing);

    pending.set(
      relPath,
      setTimeout(() => {
        pending.delete(relPath);
        void indexFile(workspaceRoot, vectorStore, relPath).catch(() => undefined);
      }, DEBOUNCE_MS)
    );
  });

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  watcher.onDidDelete((uri) => {
    const relPath = path.relative(workspaceRoot, uri.fsPath).split(path.sep).join("/");
    if (relPath && !relPath.startsWith("..")) {
      void (async () => {
        await vectorStore.deleteChunksForFile(relPath);
        const manifest = await loadManifest(workspaceRoot);
        if (manifest[relPath]) {
          delete manifest[relPath];
          await saveManifest(workspaceRoot, manifest);
        }
      })().catch(() => undefined);
    }
  });

  context.subscriptions.push(disposable, watcher);
}

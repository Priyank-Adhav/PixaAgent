# PixaAgent Completed Updates Summary

This document records completed remediation branches after they are implemented. Use it for PR descriptions, report writing, and final project traceability. Active planning belongs in `docs/diagnostics/remediation-tracker.md`.

## Entry Template

```markdown
## Branch: `branch-name`

- **ID:** R-000
- **Owner:** Name
- **Target issue:** Short description of the issue.
- **Evidence status:** Confirmed / Code-plausible / Needs proof / UX improvement
- **Files changed:**
  - `path/to/file.ts`
- **Summary of fix:** What changed technically.
- **Validation performed:** Tests or manual checks already completed.
- **Remaining follow-up:** Anything still worth testing, merging, or improving.
```

## Branch: `fix/api-400-tool-messages`

- **ID:** R-001
- **Owner:** Abhinav Mehta
- **Target issue:** The agent could hang or throw an OpenRouter 400 error after several messages when a task involved background tool usage.
- **Evidence status:** Confirmed
- **Files changed:**
  - `packages/pixa-agent/src/agent/contextManager.ts`
- **Summary of fix:** Updated `pruneHistory` so context trimming no longer leaves orphaned tool-result messages without their corresponding assistant tool-call parent.
- **Validation performed:** Branch pushed; manual long-running tool-chat validation still should be recorded after merge.
- **Remaining follow-up:** Superseded structurally by R-006 turn-based pruning, but still an important prerequisite fix.

## Branch: `feat/chat-ui-revamp`

- **ID:** R-002
- **Owner:** Abhinav Mehta
- **Target issue:** The chat UI looked cluttered, and the proposed-changes approval list remained visible after files were applied or rejected.
- **Evidence status:** UX improvement
- **Files changed:**
  - `packages/pixa-agent/src/ui/webview/style.css`
  - `packages/pixa-agent/src/ui/webview/main.js`
- **Summary of fix:** Reworked the chat layout into a cleaner full-width block style, refined spacing and role tags, and filtered the proposed-changes panel to show only pending files.
- **Validation performed:** Branch pushed; visual inspection should be recorded after merge.
- **Remaining follow-up:** Confirm layout across narrow VS Code sidebars and common themes.

## Branch: `fix/chat-provider-resilience`

- **ID:** R-003
- **Owner:** Abhinav Mehta
- **Target issue:** Reloading VS Code or switching chats could hide tool-only assistant activity, and one failed file could break the entire Apply all action.
- **Evidence status:** Code-plausible
- **Files changed:**
  - `packages/pixa-agent/src/ui/chatViewProvider.ts`
- **Summary of fix:** Added transcript placeholders for assistant messages that used tools without readable text, made bulk apply continue after per-file failures, and posted inline status messages for applied/rejected/reverted changes.
- **Validation performed:** Branch pushed; reload/switch-session and bulk-apply failure cases still should be manually checked.
- **Remaining follow-up:** Add focused tests if the UI layer becomes easier to test.

## Branch: `feat/agent-task-state`

- **ID:** R-004
- **Owner:** Abhinav Mehta
- **Target issue:** Complex tasks could stop abruptly at the hard-coded 30-iteration limit.
- **Evidence status:** Code-plausible
- **Files changed:**
  - `packages/pixa-agent/src/agent/systemPrompt.ts`
- **Summary of fix:** Added a system-prompt directive telling the agent to maintain `.pixa/task-state.md` for large tasks and ask the user to continue across task boundaries.
- **Validation performed:** Branch pushed; long-task manual validation still should be recorded.
- **Remaining follow-up:** Consider a code-level continuation mechanism if prompt-only task state is insufficient.

## Branch: `feat/context-tool-result-summaries`

- **ID:** R-005
- **Owner:** Priyank Adhav
- **Target issue:** Under token pressure, old tool outputs were replaced with `[result truncated]`, causing context amnesia about previously read files, searches, or command output.
- **Evidence status:** Code-plausible
- **Files changed:**
  - `packages/pixa-agent/src/providers/types.ts`
  - `packages/pixa-agent/src/agent/loop.ts`
  - `packages/pixa-agent/src/agent/contextManager.ts`
  - `packages/pixa-agent/test/contextManager.test.ts`
- **Summary of fix:** Tool-result messages now retain their originating tool name, and pruning compresses old large tool outputs into structured summaries with tool name, original size, retained useful content, and recovery guidance.
- **Validation performed:** `npm run test -w pixa-agent -- contextManager.test.ts`; `npm run typecheck -w pixa-agent`.
- **Remaining follow-up:** Manually test with a tiny context budget and large `read_file`, `search_workspace`, and `run_command` outputs.

## Branch: `fix/turn-based-context-pruning`

- **ID:** R-006
- **Owner:** Priyank Adhav
- **Target issue:** Context pruning still removed history one message at a time, which could split logical conversation turns even after orphaned tool messages were avoided.
- **Evidence status:** Code-plausible
- **Files changed:**
  - `packages/pixa-agent/src/agent/contextManager.ts`
  - `packages/pixa-agent/test/contextManager.test.ts`
- **Summary of fix:** Replaced message-by-message front trimming with complete user-led turn pruning. Old user requests, assistant replies, tool calls, and tool results are now dropped as coherent units.
- **Validation performed:** `npm run test -w pixa-agent -- contextManager.test.ts`; `npm run typecheck -w pixa-agent`.
- **Remaining follow-up:** Manually validate a long multi-turn tool-using chat after R-001, R-005, and R-006 are merged in order.

## Branch: `fix/stale-diff-apply-guard`

- **ID:** R-007
- **Owner:** Vasun
- **Target issue:** Applying a staged change silently overwrote the file when the user had edited and saved it on disk after the change was staged. `originalContent` was captured at staging time but never checked before write.
- **Evidence status:** Code-plausible (manual VS Code validation pending)
- **Files changed:**
  - `packages/pixa-agent/src/edits/changeSet.ts`
  - `packages/pixa-agent/src/ui/chatViewProvider.ts`
  - `packages/pixa-agent/test/changeSet.test.ts`
- **Summary of fix:** Added a pure `checkChangeFreshness()` function in `changeSet.ts` that compares current disk content against the staged `originalContent`, returning `fresh` / `changed` / `missing` / `created-conflict`. Includes `normalizeForComparison()` to strip UTF-8 BOM and normalize CRLF/LF so untouched Windows files are not false-flagged. `applyChange()` in `chatViewProvider.ts` reads disk first, refuses stale writes, and leaves the change `pending`. Apply-all skips stale files, applies clean ones, and reports a summary.
- **Validation performed:** `npm run typecheck -w pixa-agent`; `npm run test:offline -w pixa-agent` (215 passing, +10 new tests); manual VS Code reproducer still to be recorded.
- **Remaining follow-up:** Manual validation: stage edit → edit file externally → save → Apply → confirm warning + untouched file. "Overwrite anyway / View diff" dialog deliberately deferred. Guard reads disk only; unsaved editor buffer edits are not caught. Overlaps R-003 in `src/ui/chatViewProvider.ts` — merge-order awareness needed.

## Branch: `fix/interactive-command-handling`

- **ID:** R-008
- **Owner:** Vasun
- **Target issue:** A terminal command that reads from stdin (e.g. `pause`, `read -p`, `python -i`) blocked the agent for the full 120s timeout before failing, with no interactive-command detection.
- **Evidence status:** Confirmed (T5 reproduction — `pause` blocked 5s to kill, exited in ~50ms with stdin closed)
- **Files changed:**
  - `packages/pixa-agent/src/security/sandbox.ts`
  - `packages/pixa-agent/src/tools/terminal.ts`
  - `packages/pixa-agent/test/sandbox.test.ts`
  - `packages/pixa-agent/test/terminalSandbox.test.ts`
- **Summary of fix:** Added pure `detectInteractive(command)` in `sandbox.ts` matching `read`/`pause`, `-i`/`--interactive` flags, and unflagged `npm init`. `runShell()` now accepts an optional `timeoutMs` param (default 120 000) and closes stdin via `child.stdin.end()` immediately after `exec` returns, so stdin-blocked commands receive EOF and exit fast. `runCommand.execute` annotates tool output when `detectInteractive` matched, independent of exit code (some interactive commands exit code 0).
- **Validation performed:** Measured reproduction — `pause` blocked until 120s timeout without the fix, exited in ~50ms with it; `python -c "input(...)"` exited in ~120ms with `EOFError`. Unit tests for detection positives/negatives; runtime test using portable `node -e "process.stdin.on('end', …)"` resolves in <5s with code 42. `npm run typecheck`; `npm run test:offline` green.
- **Remaining follow-up:** Detection is quote-blind — `bash -c 'read ...'` is not caught (stdin close still prevents the hang). `git grep -i` / `git log -i` may over-warn — narrow or document. No in-progress cancel button (deferred to a UI-layer PR).

## Branch: `fix/index-activation-mutations`

- **ID:** R-009
- **Owner:** Vasun
- **Target issue:** Opening a folder with Pixa installed mutated the workspace before any user action: `.pixa/` and `.pixa/index/` created unconditionally, `.gitignore` written or appended, `.vscode/settings.json` written by `hidePixaFolderFromExplorer`.
- **Evidence status:** Code-plausible (manual clean-repo validation pending)
- **Files changed:**
  - `packages/pixa-agent/package.json`
  - `packages/pixa-agent/src/extension.ts`
  - `packages/pixa-agent/src/indexer/vectorStore.ts`
  - `packages/pixa-agent/src/tools/search.ts`
  - `packages/pixa-agent/test/Vector.test.ts`
  - `packages/pixa-agent/test/vectorStore.hygiene.test.ts` (new)
  - `packages/pixa-agent/test/semanticSearch.tool.test.ts`
  - `package-lock.json`
- **Summary of fix:** Added setting `pixa.semanticSearch.enabled` (default `false`). `VectorStore`, initial indexing, and incremental indexing are gated behind it. When disabled, `extension.ts` constructs `WorkspaceIndexer` as the `RepoIndex` — same interface, no `VectorStore` touched. Backward compat: if `.pixa/index/` already exists on disk, semantic search is treated as enabled regardless of the setting. Removed `hidePixaFolderFromExplorer` entirely (its `.vscode/settings.json` write was the exact class of mutation R-009 targets). Extracted `ensureGitignored` to a module-level exported pure function returning `boolean` for "did we mutate," and removed its call from `VectorStore.init()`. Opt-in flow: notification offers Reload; enabling writes to `ConfigurationTarget.Global` (not `Workspace`) so the repo is never dirtied. `search.ts` guard returns an actionable message when semantic search is disabled.
- **Validation performed:** `npm run typecheck -w pixa-agent`; `npm run test:offline -w pixa-agent` (212 passing, +7 new tests); `npm test -w pixa-agent` (220 passing, incl. `Vector.test.ts` updated and green). Manual clean-repo validation still to be recorded.
- **Remaining follow-up:** Manual validation: F5 → open clean scratch repo → `git status` must be clean. Disable transition (on→off mid-session) requires reload; not handled. `onDidChangeConfiguration` handler has no dismissal fallback (unlike `promptReloadToEnable`). `ensureGitignored`'s `enabled` param is test-only in production. `ConfigurationTarget.Global` means enabling affects all workspaces — deliberate, keeps the repo clean.

## Branch: `perf/async-indexing-pipeline`

- **ID:** R-010
- **Owner:** Abhishek Abhang
- **Target issue:** The extension host could stall while building the initial semantic index for a large workspace.
- **Evidence status:** Code-plausible, with the root cause confirmed in code. Vectra 0.15's `LocalIndex.endUpdate()` re-serializes the entire `index.json` with a synchronous `JSON.stringify`, and the pipeline ran one transaction per file. A cold index of N files therefore rewrote an ever-growing file N times: quadratic total work, with each rewrite blocking the event loop. A 100-file harness run produced a 3.2 MB index; larger before/after runs are still to be recorded.
- **Files changed:**
  - `packages/pixa-agent/src/indexer/indexingPipeline.ts`
  - `packages/pixa-agent/src/indexer/vectorStore.ts`
  - `packages/pixa-agent/src/indexer/indexingMetrics.ts` (new)
  - `packages/pixa-agent/src/extension.ts`
  - `packages/pixa-agent/scripts/gen-large-workspace.mjs` (new)
  - `packages/pixa-agent/.vscodeignore`
  - `packages/pixa-agent/test/indexingPipeline.test.ts` (new)
  - `packages/pixa-agent/test/indexingMetrics.test.ts` (new)
  - `packages/pixa-agent/test/indexing.perf.manual.test.ts` (new, manual)
- **Summary of fix:**
  - **Batched writes.** `VectorStore.replaceFilesChunks` commits up to 25 files or 500 chunks per transaction instead of one per file. It drops each file's old chunk ids first, which also fixes stale chunks being left in the index when a file's line ranges changed on a full re-index. Vanished files are removed in one transaction.
  - **One writer at a time.** All vectra transactions are serialized. Before, a save during initial indexing, or Rebuild pressed mid-run, could throw "Update already in progress".
  - **Async I/O and yielding.** File reads and stats are async in the pipeline and in `VectorStore` init/query. The pipeline yields to the event loop after 15 ms of work and every 200 upserts inside a transaction. Progress is reported at most every 100 ms.
  - **Safer manifest.** It is written atomically (tmp + rename) and checkpointed after each committed batch.
  - **Cancellable.** The progress notification can be cancelled. Finished work is kept, the vanished-file sweep is skipped (so files not yet reached aren't deleted), and Rebuild resumes from the manifest. Rebuild during a run joins the in-flight run.
  - **Measurement.** `indexingMetrics.ts` measures event-loop lag, and the Pixa Index channel now logs the duration and lag p50/p99/max for each run.
- **Validation performed:** `npm run typecheck -w pixa-agent`; `npm run test:offline -w pixa-agent` (223 passing, including 11 new tests for batching, stale-chunk replacement, vanished files, cancel/resume, concurrent `indexFile`, write serialization, the yielder, and lag metrics); `npm run compile -w pixa-agent`. The perf harness was smoke-run at 100 files on the baseline. `npm test` (which includes `Vector.test.ts` with the real model) has not been run on this branch.
- **Remaining follow-up:**
  - Record before/after numbers: `PIXA_PERF=1 PIXA_PERF_SIZES=250,1000 npx vitest run test/indexing.perf.manual.test.ts` on R-009 (`79729bb`) and on this branch. Then update Evidence status to Confirmed or Not reproduced.
  - Run `npm test -w pixa-agent`.
  - Dev Host checks: index a 1000–5000 file generated workspace, save a file during indexing (no lock error), cancel at about 50% and then Rebuild (it resumes).
  - One sync stringify per batch remains. If lag is still high, a follow-up could switch vectra codecs or move embedding and serialization to a `worker_thread`.
  - If `indexFile` and a full index run at the same time, each may overwrite the other's manifest entry. That is harmless: the file is simply re-indexed next run.

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

## Branch: `fix/terminal-sandbox-policy-semantics`

- **ID:** R-012
- **Owner:** Abhishek Abhang
- **Target issue:** The sandbox policy header said an `allow` verdict "runs without asking", and the security audit log recorded such commands as "auto-allowed". In fact `run_command` asks for approval for every command that isn't denied, which is what CONTRIBUTING's load-bearing rules require. The "safe" list also matched commands that are not read-only, so the label overstated what they do.
- **Evidence status:** Confirmed. New tests run against the R-008 base classified 18 non-read-only commands as `allow`: chaining (`ls && rm -rf src`), redirection (`echo x > src/index.ts`), substitution, `find -delete`/`-exec`, `git branch -D`, `git remote add/remove`, `git diff --output=…`, `rg --pre`, and `npm test`.
- **Files changed:**
  - `packages/pixa-agent/src/security/sandbox.ts`
  - `packages/pixa-agent/src/security/audit.ts`
  - `packages/pixa-agent/src/tools/terminal.ts`
  - `packages/pixa-agent/test/sandbox.test.ts`
  - `packages/pixa-agent/test/terminalSandbox.test.ts`
  - `packages/pixa-agent/test/security.test.ts`
- **Summary of fix:** Decision: keep approval for every non-denied command; no auto-run.
  - The `CommandVerdict` value `"allow"` is renamed to `"low-risk"`, in the audit `outcome` type too. The header doc now says only `deny` changes behaviour and that `low-risk` is informational.
  - Audit reasons now read "Read-only/informational command — still requires user approval." and "Not on the low-risk list — requires user approval."
  - `SAFE_PREFIXES` is renamed to `LOW_RISK_PATTERNS` and tightened. A `NOT_LOW_RISK` guard sends anything with `; & | < >`, a backtick, `$(`, a newline, `--output` or `--pre` to `confirm`. `find` and `npm test`/`npm run test` are removed. `git branch` and `git remote` are low-risk only in their listing forms.
  - `terminal.ts` changes only in a comment. There is no behaviour change: the same commands are blocked and the same commands prompt.
- **Validation performed:** `npm run typecheck -w pixa-agent`; `npm run test:offline -w pixa-agent` (244 passing, +27 vs the R-008 base); `npm run compile -w pixa-agent`. Manual Dev Host validation is not done yet.
- **Remaining follow-up:**
  - Manual check: `git status` and `ls && echo hi` both show the approval card, and the audit channel shows `[LOW-RISK]` / `[CONFIRM]` with no "auto-allowed".
  - Possible follow-up: show the verdict as a "read-only" / "may modify files" badge on the approval card. That needs `ApprovalService.requestApproval`, `events.ts` and `main.js`, and overlaps R-003/R-007.
  - Stacked on R-008. `main`'s three docs commits were cherry-picked onto this branch so the tracker matches `main`. After R-008 merges, run `git rebase --onto origin/main origin/fix/interactive-command-handling` and git will drop them as already applied.
## Branch: `fix/workspace-jail-hardening`

- **ID:** R-013
- **Owner:** Abhishek Abhang
- **Target issue:** Two file reads bypassed the `resolveInWorkspace()` jail, a load-bearing rule in CONTRIBUTING:
  - **(A) @-mentions.** `ChatViewProvider.resolveMentions` built the exact-match path with `path.join`, so `@../secret.txt` read a file outside the workspace and attached it to the model request.
  - **(B) Index metadata.** `VectorStore.readTextForChunk` joined the `filePath` stored in `.pixa/index/index.json` onto the workspace root. A cloned repo can ship that file, and since R-009 an existing `.pixa/index/` auto-enables semantic search. An entry like `src/../../secret.txt` got past `isIndexablePath` (which only rejected paths *starting* with `..`), so `semantic_search` returned the outside file's contents to the model.
- **Evidence status:** Confirmed. A new test on `main` code had `readTextForChunk("src/../../secret.txt")` return the contents of a file next to the workspace, and new `isIndexablePath` tests showed traversal and absolute paths being accepted.
- **Files changed:**
  - `packages/pixa-agent/src/tools/paths.ts`
  - `packages/pixa-agent/src/indexer/indexablePaths.ts`
  - `packages/pixa-agent/src/indexer/vectorStore.ts`
  - `packages/pixa-agent/src/ui/chatViewProvider.ts`
  - `CONTRIBUTING.md`
  - `packages/pixa-agent/test/paths.test.ts`
  - `packages/pixa-agent/test/indexablePaths.test.ts` (new)
  - `packages/pixa-agent/test/vectorStore.jail.test.ts` (new)
- **Summary of fix:**
  - New `tryResolveInWorkspace()`: the same jail as `resolveInWorkspace()`, but it returns `null` instead of throwing.
  - `isIndexablePath` now also rejects any `..` segment, a leading `/` or `\`, and drive letters. Crafted index entries are filtered from `query`, `listIndexedFiles` and `isFileIndexed`, and `purgeNonIndexableFiles` deletes them on the next index run.
  - `readTextForChunk` resolves through the jail; an escaping path reads as empty text.
  - `resolveMentions` strips a leading `/` or `./` (keeping `@/src/x.ts` root-relative), then resolves the exact path through the jail. An escaping mention is reported as not found.
  - Suffix-search hits outside this workspace root (multi-root windows) are skipped.
  - CONTRIBUTING now says that chat mentions, model arguments and on-disk data are untrusted paths.
- **Validation performed:**
  - `npm run typecheck -w pixa-agent`.
  - `npm run test:offline -w pixa-agent`: 246 passing (238 on `main`, so 8 new tests).
  - `npm test -w pixa-agent`: 255 passing, 1 skipped, the same skip as on `main`.
  - `npm run compile -w pixa-agent`.
  - Commits `d6f6184`, `08736db` and `3e171fd` add tests that fail on purpose until the commit after each. Squash them into their fixes if every commit must be green.
  - Manual Dev Host validation is not done yet.
- **Remaining follow-up:**
  - Manual check 1: put `secret.txt` beside the workspace and send `@../secret.txt`. It should be reported as not found and the contents should not be sent.
  - Manual check 2: in a scratch repo, add a crafted `.pixa/index/index.json` with a `src/../../secret.txt` entry (create it with the `vectorStore.jail.test.ts` setup). `semantic_search` must not return the secret, and the entry should be gone after the initial index.
  - Rebase R-011 (`fix/ambiguous-file-mentions`) after this merges. Its commit `76f7312` covers the same mention fix; resolve `resolveMentions` to R-011's flow using `tryResolveInWorkspace`, and `git rebase --skip` if that commit becomes empty.
  - R-010 makes `readTextForChunk` async; whichever branch merges second keeps both the async read and the jail.
  - Out of scope: a symlink inside the workspace that points outside it (an existing gap in `resolveInWorkspace`), and whether a committed `.pixa/index/` should auto-enable semantic search at all. After this fix, such an index can only inject in-repo search results.

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

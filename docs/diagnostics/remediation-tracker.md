# PixaAgent Remediation Tracker

This document coordinates diagnostic fixes across the project team.

## How To Use This Tracker

- Keep one row per issue or remediation branch.
- Use stable IDs (`R-001`, `R-002`, etc.) in PR descriptions, test notes, and the project report.
- Separate evidence from implementation:
  - **Evidence Status** says whether the failure has actually been reproduced or is only code-plausible.
  - **Fix Status** says where the remediation work stands.
- Before starting work, self-assign your name, choose a branch name, and list any prerequisite branches.
- If a row depends on another branch, branch from that prerequisite branch or wait until it is merged.
- When a branch is completed, add a fuller summary to `docs/diagnostics/completed-updates-summary.md`.
- Manual VS Code validation still matters even when unit tests pass; record the exact validation needed in the table.

## Status Legend

**Evidence Status**

- `Confirmed` - reproduced manually or via a reliable test with clear evidence.
- `Code-plausible` - source code strongly suggests the issue can happen, but manual reproduction is still pending.
- `Not reproduced` - tested and did not reproduce under the recorded conditions.
- `Needs proof` - hypothesis exists, but evidence is not strong enough yet.
- `UX improvement` - not necessarily a correctness bug, but improves usability or clarity.

**Fix Status**

- `Not started` - no implementation branch yet.
- `In progress` - assigned and actively being implemented.
- `Pushed` - branch has been pushed and is ready for review/merge.
- `Merged` - merged into the target branch.
- `Deferred` - intentionally postponed.

## Active Remediation Table

| ID | Issue / Change | Evidence Status | Fix Status | Owner | Branch | Base Branch | Dependencies | Files / Area | Validation Needed | Priority | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-001 | Prevent orphaned tool messages during context pruning to avoid OpenRouter 400 errors. | Confirmed | Pushed | Abhinav Mehta | `fix/api-400-tool-messages` | `main` | None | `src/agent/contextManager.ts` | Long tool-using chat should continue after history pruning without provider 400. | High | First context-pruning safety fix. |
| R-002 | Revamp chat UI layout and auto-hide resolved proposed changes. | UX improvement | Pushed | Abhinav Mehta | `feat/chat-ui-revamp` | `main` | None | `src/ui/webview/style.css`, `src/ui/webview/main.js` | Apply/reject files and confirm pending list disappears immediately; visually inspect chat layout. | Medium | User-facing polish and reduced clutter. |
| R-003 | Preserve tool-only transcript entries and make bulk apply resilient to one-file failures. | Code-plausible | Pushed | Abhinav Mehta | `fix/chat-provider-resilience` | `main` | None | `src/ui/chatViewProvider.ts` | Reload/switch sessions after tool use; simulate one failed file in Apply all and confirm remaining files still apply. | High | Improves reload continuity and apply-all robustness. |
| R-004 | Add task-state guidance for tasks that may exceed the 30-iteration loop limit. | Code-plausible | Pushed | Abhinav Mehta | `feat/agent-task-state` | `main` | None | `src/agent/systemPrompt.ts` | Run a long task and confirm the agent creates/uses `.pixa/task-state.md` before asking user to continue. | Medium | Prompt-level mitigation, not a scheduler change. |
| R-005 | Replace complete tool-output truncation with structured tool-result summaries. | Code-plausible | Pushed | Priyank Adhav | `feat/context-tool-result-summaries` | `fix/api-400-tool-messages` | R-001 | `src/providers/types.ts`, `src/agent/loop.ts`, `src/agent/contextManager.ts`, `test/contextManager.test.ts` | Under small context budget, old tool results should summarize with tool name, original size, retained content, and recovery hint. | High | Reduces context amnesia from `[result truncated]`. |
| R-006 | Prune context by complete user-led turns instead of individual messages. | Code-plausible | Pushed | Priyank Adhav | `fix/turn-based-context-pruning` | `feat/context-tool-result-summaries` | R-001, R-005 | `src/agent/contextManager.ts`, `test/contextManager.test.ts` | Long chat should drop old whole turns, never leaving assistant/tool fragments from removed user requests. | High | Structural follow-up to R-001 and R-005. |
| R-007 | Guard applying staged changes against stale disk content. | Code-plausible | Pushed | Vasundhara Dixit | `fix/stale-diff-apply-guard` | `main` | None | `src/edits/changeSet.ts`, `src/ui/chatViewProvider.ts`, `test/changeSet.test.ts` | Stage a file edit, manually edit/save the same file before Apply, and confirm Pixa warns instead of overwriting silently. | High |Prevents clobbering user edits made after proposal. Overlaps R-003 in chatViewProvider.ts — merge-order awareness needed. |
| R-008 | Add proactive interactive-command detection or clearer timeout/cancel behavior. | Confirmed | Pushed | Vasundhara Dixit | `fix/interactive-command-handling` | `main` | None | `src/security/sandbox.ts`, `src/tools/terminal.ts`, `test/sandbox.test.ts`, `test/terminalSandbox.test.ts` |	Run `read -p 'Name: ' name && echo $name`; agent should fail fast, warn, or provide cancelable feedback instead of blocking ~120s. | High | Based on T5 confirmed bounded hang. Detection is quote-blind; git grep -i may over-warn. No cancel button (deferred). |
| R-009 | Avoid surprising repo mutation on extension activation. | Code-plausible | Pushed | Vasundhara Dixit | `fix/index-activation-mutations` | `main` | None | `src/extension.ts`, `src/indexer/vectorStore.ts`, `src/tools/search.ts`, `package.json`, `test/vectorStore.hygiene.test.ts` (new), `test/Vector.test.ts`, `test/semanticSearch.tool.test.ts` | Open a clean git repo and confirm Pixa does not unexpectedly dirty it, or clearly records/asks before `.gitignore` mutation. | Medium | Now opt-in via pixa.semanticSearch.enabled (default false). Backward compat: existing .pixa/index/ treated as enabled. Disable mid-session requires reload. |
| R-010 | Reduce extension-host stalls during large workspace indexing. | Needs proof | Not started | Abhishek Abhang | `perf/async-indexing-pipeline` | `fix/index-activation-mutations` | R-009 | `src/indexer/indexingPipeline.ts`, `src/indexer/vectorStore.ts` | Open a generated 1000-5000 file workspace and record responsiveness during initial indexing before/after changes. | Medium | Several sync filesystem calls exist in indexing path. |
| R-011 | Disambiguate `@file` mentions when duplicate filenames exist. | Code-plausible | In progress | Abhishek Abhang | `fix/ambiguous-file-mentions` | `main` | None | `src/ui/chatViewProvider.ts`, `src/agent/mentions.ts`, tests TBD | Create duplicate `config.ts` files and confirm ambiguous `@config.ts` asks for clarification or surfaces the selected path. | Medium | Current suffix match uses first result only. |
| R-012 | Align terminal sandbox `allow` semantics with actual approval behavior. | Confirmed | In progress | Abhishek Abhang | `fix/terminal-sandbox-policy-semantics` | `fix/interactive-command-handling` | R-008 | `src/security/sandbox.ts`, `src/security/audit.ts`, `src/tools/terminal.ts`, `test/sandbox.test.ts`, `test/terminalSandbox.test.ts`, `test/security.test.ts` | Run `git status` and `ls && echo hi` through the agent: both must show the approval card, and the Pixa Security Audit channel must say `low-risk … still requires user approval` / `confirm`, never `auto-allowed`. | Low | Committed locally, not yet pushed. Decision: no auto-run. The verdict is renamed to `low-risk` (informational only). Confirmed by tests: on the base branch, 18 non-read-only commands (e.g. `ls && rm -rf src`, `echo x > file`, `git branch -D`) were classified `allow`. Stacked on R-008; main's docs commits were cherry-picked, so `rebase --onto` drops them. |

## Recommended Merge Order

1. `fix/api-400-tool-messages`
2. `feat/context-tool-result-summaries`
3. `fix/turn-based-context-pruning`
4. UI/provider branches that touch separate files can merge independently, subject to PR review.
5. New fixes should branch from `main` after the relevant prerequisite branches merge, unless the dependency column says otherwise.
6. R-007 / R-008 / R-009 are independent of R-001–R-006 and of each other. R-007 overlaps R-003 in `src/ui/chatViewProvider.ts` — resolve whichever merges second.

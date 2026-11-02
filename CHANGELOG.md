# Changelog

All notable changes to Pixa Agent are documented here.

## [Unreleased]

### Security
- Workspace path jail (R-013): files outside the open folder could be read
  through `@file` mentions (`@../secret.txt`), through paths stored in a
  semantic index that a cloned repo ships in `.pixa/index/`, or through a
  symlink inside the repo that points outside it. Every file path now goes
  through the jail, which checks the real location on disk, so these are
  refused for reads, staged edits, mentions, indexing and a command's working
  directory. If you link an outside folder into your repo on purpose, Pixa can
  no longer read or edit through that link.

## [0.6.2] — 2026-07-28

### Added
- Thinking-effort picker (Low/Medium/High) for models that support it. Appears
  next to the model dropdown only when the selected model declares support, and
  resets on model switch. Custom providers can opt in with
  `supportsReasoningEffort: true` in `pixa.providers`.
- "Reject all" for staged changes, alongside the existing "Apply all"
- Recovery for tool calls that some local-model runtimes return as text instead
  of the native `tool_calls` field, so smaller local coding models can run agent
  tasks. Only calls naming a real registered tool are executed.

### Fixed
- Thinking-effort picker never appeared, and selecting a level did nothing —
  the capability flag wasn't included in the payload sent to the panel and the
  selection handler was missing. Added a compile-time exhaustiveness check on
  the message handler so an unhandled message is now a build error.
- Effort was silently dropped for custom providers even when explicitly enabled,
  making the picker a dead control on non-OpenRouter endpoints
- Plan checklist never rendered for most models — the parser expected a numbered
  list but the prompt didn't ask for one
- Reviewing a change before applying it was easy to miss; the proposed file name
  is now clickable and opens the diff directly

## [0.6.1] — 2026-07-23

### Added
- In-panel Providers UI: add/delete providers, quick-setup presets (Ollama, LM Studio, vLLM, NVIDIA NIM, OpenRouter), and live model discovery via `/models`
- Command-safety policy: known-destructive commands are blocked before execution, on top of the existing per-command approval gate
- Recovery for tool calls some local-model runtimes return as text instead of the native `tool_calls` field, so smaller local coding models can run agent tasks
- Reasoning-effort picker for models that support it (OpenRouter's `reasoning: { effort }`)
- "Reject all" for staged changes, alongside the existing "Apply all"

### Fixed
- Extension failing to activate after packaging (a dependency wasn't bundled into the `.vsix`)
- Plan checklist not rendering for most models (parser expected a numbered list; the prompt didn't ask for one)
- Diff review being easy to miss — the proposed-file name is now clickable and opens the diff directly

## [0.6.0] and earlier

Pre-launch development. See git history for detail.

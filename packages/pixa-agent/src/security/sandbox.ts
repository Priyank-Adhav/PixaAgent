/**
 * Command execution policy — Phase 1 sandboxing.
 *
 * Deliberately a pure module (no vscode, no IO) so it's fully unit-testable
 * and reusable outside the extension host if needed. Classifies a raw shell
 * command string into one of three verdicts:
 *
 *   - "deny"     matches a known-destructive pattern — never executed, no
 *                approval prompt shown at all.
 *   - "low-risk" a single read-only/informational command with no shell
 *                chaining, redirection or substitution. Informational only:
 *                it is recorded in the audit log but STILL requires approval.
 *   - "confirm"  anything else — requires approval.
 *
 * Only "deny" changes behavior. Every non-denied command goes through the
 * human approval flow (ctx.approvals.requestApproval) — run_command never
 * auto-runs anything, whatever the verdict.
 *
 * This is regex-based classification, not a real shell parser. It catches
 * known-bad patterns and obvious safe commands; it does not guarantee
 * detection of deliberately obfuscated destructive commands (e.g. base64
 * payloads piped through eval). Treat it as a guardrail against careless or
 * accidental destruction, not a hard security boundary against an
 * adversarial model.
 */

export type CommandVerdict = "low-risk" | "deny" | "confirm";

export interface PolicyResult {
    verdict: CommandVerdict;
    reason: string;
    matchedRule?: string;
}

/**
 * Read-only / informational commands, labelled "low-risk" in the audit log.
 * Not an auto-run list — see the header. Checked only AFTER the deny list, so
 * a deny pattern always wins if a command somehow matches both lists.
 */
const LOW_RISK_PATTERNS: { name: string; regex: RegExp }[] = [
    { name: "git-readonly", regex: /^git\s+(status|log|diff|show|blame)\b/i },
    { name: "git-branch-list", regex: /^git\s+branch(\s+(-a|-r|-v|-vv|--all|--remotes|--list))*\s*$/i },
    { name: "git-remote-list", regex: /^git\s+remote(\s+-v)?\s*$/i },
    { name: "fs-readonly", regex: /^(ls|dir|pwd|cat|head|tail|wc|grep|rg)\b/i },
    { name: "npm-readonly", regex: /^npm\s+(list|ls|outdated|view)\b/i },
    { name: "version-probe", regex: /^(node|python3?|npm|git)\s+(--version|-v)$/i },
    { name: "echo", regex: /^echo\b/i },
];

/**
 * Anything that can chain, redirect or substitute turns a read-only prefix
 * into an arbitrary command ("ls && rm -rf src", "echo x > file"), and a few
 * flags make otherwise read-only tools write files or execute programs.
 * Either disqualifies a command from "low-risk".
 */
const NOT_LOW_RISK = /[;&|<>`\r\n]|\$\(|\s--output\b|\s--pre\b/;

/**
 * High-confidence destructive or workspace-escaping patterns. Auto-denied —
 * no approval prompt, no execution, ever.
 */
const DENY_PATTERNS: { name: string; regex: RegExp }[] = [
    { name: "rm-rf-root-or-wide", regex: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(\/|~|\*|\.\.(\/|$))/i },
    { name: "recursive-delete-wide", regex: /\b(rmdir|rd)\s+\/s\b/i },
    { name: "fork-bomb", regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
    { name: "pipe-remote-to-shell", regex: /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|powershell|pwsh)\b/i },
    { name: "sudo-privilege-escalation", regex: /\bsudo\b/i },
    { name: "disk-overwrite", regex: /\bdd\s+if=/i },
    { name: "filesystem-format", regex: /\bmkfs(\.\w+)?\b/i },
    { name: "system-power", regex: /\b(shutdown|reboot|halt|poweroff)\b/i },
    { name: "chmod-world-writable", regex: /\bchmod\s+(-R\s+)?0?777\b/i },
    { name: "overwrite-shell-profile", regex: />\s*(~\/\.(bash|zsh)?(rc|_profile|profile)|\/etc\/)/i },
    { name: "windows-format", regex: /\bformat\s+[a-z]:/i },
    { name: "windows-del-wide", regex: /\bdel\s+\/[sf]\b.*\*/i },
    { name: "git-force-push-protected", regex: /\bgit\s+push\b(?=.*\b(main|master)\b)(?=.*(?:--force(?:-with-lease)?|-f)\b)/i, },
    { name: "env-exfiltration", regex: /\benv\b\s*\|\s*(curl|wget|nc)\b/i },
];

import { securityLogger } from "./audit";

export function evaluateCommand(command: string): PolicyResult {
    const trimmed = command.trim();

    if (!trimmed) {
        const result: PolicyResult = { verdict: "deny", reason: "Empty command." };
        securityLogger.log("evaluateCommand", result.verdict, { command: trimmed, reason: result.reason });
        return result;
    }

    for (const { name, regex } of DENY_PATTERNS) {
        if (regex.test(trimmed)) {
            const result: PolicyResult = {
                verdict: "deny",
                reason: `Blocked: matches a known-destructive pattern ("${name}").`,
                matchedRule: name,
            };
            securityLogger.log("evaluateCommand", result.verdict, { command: trimmed, reason: result.reason, rule: name });
            return result;
        }
    }

    if (!NOT_LOW_RISK.test(trimmed)) {
        for (const { name, regex } of LOW_RISK_PATTERNS) {
            if (regex.test(trimmed)) {
                const result: PolicyResult = {
                    verdict: "low-risk",
                    reason: "Read-only/informational command — still requires user approval.",
                    matchedRule: name,
                };
                securityLogger.log("evaluateCommand", result.verdict, { command: trimmed, reason: result.reason, rule: name });
                return result;
            }
        }
    }

    const result: PolicyResult = { verdict: "confirm", reason: "Not on the low-risk list — requires user approval." };
    securityLogger.log("evaluateCommand", result.verdict, { command: trimmed, reason: result.reason });
    return result;
}

/**
 * Heuristic detection for commands that typically block waiting for stdin.
 * Note: This list is intentionally short and not exhaustive.
 */
const INTERACTIVE_PATTERNS: { name: string; regex: RegExp }[] = [
    { name: "read/pause", regex: /(?:^|[;&|]\s*)\b(read|pause)\b/i },
    { name: "interactive-flag", regex: /(?:^|[;&|]\s*)(?:python[0-9.]*|bash|sh|zsh|git\s+\w+)\s+(?:.*?\s+)?(?:-[a-zA-Z]*i\b|--interactive\b)/i },
    { name: "npm-init", regex: /(?:^|[;&|]\s*)\bnpm\s+init(?!\s+(?:-[a-zA-Z]*y|--yes))\b/i },
];

export function detectInteractive(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed) return null;
    for (const { name, regex } of INTERACTIVE_PATTERNS) {
        if (regex.test(trimmed)) {
            return name;
        }
    }
    return null;
}
/**
 * policy.mjs — role policy tables + the Claude Code tool-call enforcement
 * decision function.
 *
 * Ported from pi-orchestration/shared/paseo-team-policy.ts, adapted to Claude
 * Code's tool model:
 *   - Role is read from PASEO_CLAUDE_ROLE (the Claude pack's equivalent of
 *     PASEO_PI_ROLE).
 *   - Paseo orchestration is CLI-only through the installed, role-gated
 *     `paseo-team` facade. Any injected `mcp__paseo__*` tool is denied.
 *   - Git/Paseo-CLI guards apply to the Bash/PowerShell `command` field, same
 *     regexes as the Pi extension.
 *   - Supervisor shell calls are restricted to a simple role-gated facade
 *     invocation; the facade validates successor-Lead recovery arguments.
 *
 * Fail-closed: any tool this module cannot place on a role's allow surface is
 * denied with a reason. When PASEO_CLAUDE_ROLE is unset the hook stays passive.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import {
	ownedScopeRoots,
	resolveWorkerMode,
	workerGitAuthority,
	REVIEWER_AUTHORITY,
} from "./brief.mjs";

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

/** @typedef {"lead" | "worker" | "reviewer" | "supervisor"} TeamRole */

/** @returns {TeamRole | undefined} */
export function detectRole() {
	const raw = process.env.PASEO_CLAUDE_ROLE?.trim().toLowerCase();
	return raw === "lead" || raw === "worker" || raw === "reviewer" ||
			raw === "supervisor"
		? /** @type {TeamRole} */ (raw)
		: undefined;
}

/** @returns {boolean} */
export function leadWriteEnabled() {
	const raw = process.env.PASEO_TEAM_LEAD_WRITE?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

// ---------------------------------------------------------------------------
// Bash CLI guard — raw Paseo is denied; Lead/Supervisor use the role-gated
// facade. Heuristic only; not an OS-level authorization boundary.
// ---------------------------------------------------------------------------

const PASEO_CLI_RE =
	/\b(paseo|paseo-pi|paseo-claude|pio)(?:\.(?:cmd|exe|ps1|sh))?\s+(?:run|send|ls|agent|workspace|provider|schedule|heartbeat|daemon|status|attach|logs|stop|delete|archive|inspect|wait|import|clone|onboard|start|restart|hub|chat|terminal|script|loop|permit|speech|hooks|help)\b/i;
const PASEO_CLI_ENV_RE =
	/["\']?\$\{?PASEO_CLI\}?["\']?\s+(?:run|send|ls|agent|workspace|provider|schedule|heartbeat|daemon|status|attach|logs|stop|delete|archive|inspect|wait|import|clone|onboard|start|restart|hub|chat|terminal|script|loop|permit|speech|hooks|help)\b/i;

/** @param {string} command @returns {boolean} */
export function callsPaseoCli(command) {
	return PASEO_CLI_RE.test(command) || PASEO_CLI_ENV_RE.test(command);
}

const PASEO_TEAM_CLI_RE = /(?:["\']?\$\{?PASEO_TEAM_CLI\}?["\']?|(?:^|[\\/])paseo-team["\']?)\s+/i;
const SHELL_CONTROL_RE = /(?:\r|\n|&&|\|\||[;|<>`]|\$\()/;

/** @param {string} command @returns {boolean} */
export function callsPaseoTeamCli(command) {
	return PASEO_TEAM_CLI_RE.test(command);
}

/** @param {string} command @returns {boolean} */
export function safeSupervisorCliCommand(command) {
	return callsPaseoTeamCli(command) && !SHELL_CONTROL_RE.test(command);
}

// ---------------------------------------------------------------------------
// Git authority guard (heuristic on bash commands; not an auth boundary)
// ---------------------------------------------------------------------------

const GIT_COMMIT_RE = /\bgit\b[^|;&]*\bcommit\b/i;
const GIT_PUSH_RE = /\bgit\b[^|;&]*\bpush\b/i;
const GIT_MERGE_RE = /\bgit\b[^|;&]*\bmerge\b/i;
const GIT_AMEND_RE = /\bgit\b[^|;&]*\bcommit\b[^|;&]*--amend\b/i;

/** @param {string} command @returns {boolean} */
function detectForcePush(command) {
	for (const segment of command.split(/[|;&]+/)) {
		if (!GIT_PUSH_RE.test(segment)) continue;
		if (/--force(?:-with-lease)?\b/i.test(segment)) return true;
		if (/(?:^|\s)-[a-z]*f[a-z]*(?:\s|$)/i.test(segment)) return true;
		if (/(?:^|\s)\+/i.test(segment)) return true;
	}
	return false;
}

const EXACT_PUSH_RE =
	/^\s*git\s+push\s+-u\s+origin\s+HEAD:refs\/heads\/([A-Za-z0-9][A-Za-z0-9._/-]*)\s*$/;

/**
 * @param {string} command
 * @param {import("./brief.mjs").WorkerGitAuthority} authority
 * @param {string | undefined} taskId
 * @returns {string | null}
 */
export function gitAuthorityBlockReason(command, authority, taskId) {
	if (detectForcePush(command)) {
		return "FORCE_PUSH_AUTHORITY is always denied for Workers/Reviewers (including -f/-uf/-fu, --force*= and +refspec forms). Ask the Lead to update the brief.";
	}
	if (GIT_AMEND_RE.test(command)) {
		return "git commit --amend is always denied: a branch must advance by NEW commits so the SHA chain stays reviewable. Create a new correction commit.";
	}
	if (GIT_PUSH_RE.test(command)) {
		if (!authority.pushTaskBranch) {
			return "PUSH_TASK_BRANCH_AUTHORITY is denied for this task. Report AUTHORITY_MISMATCH to the Lead.";
		}
		const expected = taskId ? `agent/${taskId.trim()}` : null;
		const match = command.match(EXACT_PUSH_RE);
		if (expected === null || !match || match[1] !== expected) {
			return `Push authority is branch-scoped: only "git push -u origin HEAD:refs/heads/${expected ?? "agent/<TASK_ID>"}" is allowed. Other branches/remotes, --all, --tags, --mirror, deletions and chained commands are blocked.`;
		}
	}
	if (GIT_COMMIT_RE.test(command) && !authority.commit) {
		return "COMMIT_AUTHORITY is denied for this task. Report AUTHORITY_MISMATCH to the Lead.";
	}
	if (GIT_MERGE_RE.test(command) && !authority.merge) {
		return "MERGE_AUTHORITY is always denied. Integration belongs to the Lead or Human.";
	}
	return null;
}

// ---------------------------------------------------------------------------
// Claude Code tool-call enforcement
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Artifact"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PASEO_MCP_PREFIX = "mcp__paseo__";

function canonicalPath(pathname) {
	let cursor = path.resolve(pathname);
	const suffix = [];
	while (!existsSync(cursor)) {
		const parent = path.dirname(cursor);
		if (parent === cursor) return path.resolve(pathname);
		suffix.unshift(path.basename(cursor));
		cursor = parent;
	}
	return path.resolve(realpathSync(cursor), ...suffix);
}

function pathIsWithin(root, target) {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function writeTarget(toolName, input) {
	if (typeof input !== "object" || input === null) return null;
	const rec = /** @type {Record<string, unknown>} */ (input);
	const keys = toolName === "NotebookEdit"
		? ["notebook_path", "file_path", "path"]
		: ["file_path", "path", "notebook_path"];
	for (const key of keys) {
		if (typeof rec[key] === "string" && rec[key].trim().length > 0) return rec[key];
	}
	return null;
}

/** Enforce direct file mutations against workspace-relative OWNED_SCOPE roots. */
export function ownedScopeBlockReason(brief, targetPath, cwd) {
	const roots = ownedScopeRoots(brief);
	if (roots === null) {
		return "OWNED_SCOPE is missing or invalid. Use a comma-separated list of workspace-relative path roots (or . for the whole workspace).";
	}
	if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
		return "The write tool did not provide a verifiable file path; refusing outside-scope mutation fail-closed.";
	}
	const workspace = canonicalPath(cwd);
	const target = canonicalPath(path.resolve(cwd, targetPath));
	if (!pathIsWithin(workspace, target)) {
		return `Write target "${targetPath}" resolves outside the assigned workspace.`;
	}
	const allowed = roots.some((root) => {
		const scopeRoot = canonicalPath(path.resolve(cwd, root));
		return pathIsWithin(workspace, scopeRoot) && pathIsWithin(scopeRoot, target);
	});
	return allowed
		? null
		: `Write target "${targetPath}" is outside OWNED_SCOPE (${roots.join(", ")}). Report a REOPEN_REQUEST to the Lead.`;
}

/**
 * Decide whether a Claude Code tool call must be blocked for this role/turn.
 * Returns a denial reason (string) or null to allow.
 *
 * @param {TeamRole} role
 * @param {import("./brief.mjs").ParsedTaskBrief | null} brief
 * @param {string} toolName
 * @param {unknown} toolInput
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function blockReasonForTool(role, brief, toolName, toolInput, cwd = process.cwd()) {
	// Native delegation is disabled for every role. Paseo remains the only
	// control plane, reached through the role-gated CLI facade.
	if (toolName === "Agent" || toolName === "Task") {
		return "Native subagents are disabled for every role. Lead/Supervisor use $PASEO_TEAM_CLI; Workers/Reviewers report a DEPENDENCY_REQUEST.";
	}

	// Write/edit tools — bounded by role + the current-turn brief.
	if (WRITE_TOOLS.has(toolName)) {
		if (role === "reviewer") {
			return "Reviewer is behaviorally read-only. Report findings instead of editing files.";
		}
		if (role === "supervisor") {
			return "Supervisor cannot modify product code. Send an observation to the Lead instead.";
		}
		if (role === "worker") {
			const mode = resolveWorkerMode(brief);
			const edit = workerGitAuthority(brief).edit;
			if (!(mode === "write" && edit)) {
				return mode !== "write"
					? "This Worker session is read-only (no valid V3 brief with MODE: write this turn). Propose the change in your report instead of editing files."
					: "EDIT_AUTHORITY is denied for this task even though MODE is write. Report AUTHORITY_MISMATCH to the Lead.";
			}
			const scopeBlock = ownedScopeBlockReason(brief, writeTarget(toolName, toolInput), cwd);
			if (scopeBlock) return scopeBlock;
		}
		if (role === "lead" && !leadWriteEnabled()) {
			return "Lead write/edit is disabled by default (set PASEO_TEAM_LEAD_WRITE=1 in the protocol to enable).";
		}
	}

	// Shell tools: raw Paseo CLI is always blocked. Lead/Supervisor may use only
	// the role-gated facade; Worker/Reviewer have no orchestration authority.
	if (SHELL_TOOLS.has(toolName)) {
		if (role === "worker" && resolveWorkerMode(brief) !== "write") {
			return "This Worker turn is read-only, so shell execution is disabled. A new valid V3 brief with MODE: write is required for Bash/PowerShell.";
		}
		const command =
			typeof (/** @type {any} */ (toolInput)?.command) === "string"
				? /** @type {any} */ (toolInput).command
				: "";
		if (callsPaseoCli(command)) {
			return `${role} cannot call raw paseo; use the role-gated $PASEO_TEAM_CLI facade when this role has orchestration authority.`;
		}
		if (role === "worker" || role === "reviewer") {
			if (callsPaseoTeamCli(command)) {
				return `${role} has no orchestration authority. Report a DEPENDENCY_REQUEST to the Lead instead.`;
			}
			const authority =
				role === "reviewer" ? REVIEWER_AUTHORITY : workerGitAuthority(brief);
			const taskId =
				role === "reviewer" ? undefined : brief?.fields.get("TASK_ID");
			const gitBlock = gitAuthorityBlockReason(command, authority, taskId);
			if (gitBlock) return gitBlock;
		}
		if (role === "supervisor" && !safeSupervisorCliCommand(command)) {
			return "Supervisor shell access is restricted to one simple $PASEO_TEAM_CLI invocation without shell control operators.";
		}
	}

	// CLI-only invariant: fail closed if a project or daemon injects Paseo MCP.
	if (toolName.startsWith(PASEO_MCP_PREFIX)) {
		return `${role} cannot use Paseo MCP; orchestration is CLI-only through $PASEO_TEAM_CLI.`;
	}

	return null;
}

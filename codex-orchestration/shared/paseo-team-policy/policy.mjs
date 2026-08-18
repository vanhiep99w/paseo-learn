/**
 * policy.mjs — role policy tables + the Codex tool-call enforcement
 * decision function.
 *
 * Ported from pi-orchestration/shared/paseo-team-policy.ts, adapted to Claude
 * Code's tool model:
 *   - Role is read from PASEO_CODEX_ROLE (the Codex pack's equivalent of
 *     PASEO_PI_ROLE).
 *   - Codex has NO `mcp` proxy tool and NO `mcp_script`. Paseo tools are
 *     exposed directly as `mcp__paseo__<tool>` (native MCP). So the pi proxy
 *     classification (classifyMcpInput) is replaced by direct tool-name matching.
 *   - Git/Paseo-CLI guards apply to the Bash/PowerShell `command` field, same
 *     regexes as the Pi extension.
 *   - The supervisor create_agent gate requires a `codex-lead/<...>/<...>`
 *     successor (not pi-lead) and reads the tool args directly (Codex
 *     passes create_agent params as the tool input, not wrapped in {args}).
 *
 * Fail-closed: any tool this module cannot place on a role's allow surface is
 * denied with a reason. When PASEO_CODEX_ROLE is unset the hook stays passive.
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
	const raw = process.env.PASEO_CODEX_ROLE?.trim().toLowerCase();
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
// Paseo MCP tool policy tables (provider-agnostic — these are Paseo tool names)
// ---------------------------------------------------------------------------

export const PASEO_TOOLS = {
	discovery: ["list_profiles", "list_providers", "list_models", "inspect_provider"],
	workspace: ["create_workspace", "list_workspaces", "archive_workspace"],
	monitoring: ["list_agents", "get_agent_status", "get_agent_activity"],
	orchestration: [
		"create_agent",
		"send_agent_prompt",
		"update_agent",
		"cancel_agent",
		"archive_agent",
	],
	permissions: ["list_pending_permissions", "respond_to_permission"],
};

export const ALL_PASEO_TOOLS = [
	...PASEO_TOOLS.discovery,
	...PASEO_TOOLS.workspace,
	...PASEO_TOOLS.monitoring,
	...PASEO_TOOLS.orchestration,
];

export const LEAD_ALLOWED_MCP_TARGETS = [
	...PASEO_TOOLS.discovery,
	...PASEO_TOOLS.workspace,
	...PASEO_TOOLS.monitoring,
	...PASEO_TOOLS.orchestration,
	...PASEO_TOOLS.permissions,
];

// The five-tool monitoring + recovery-gated allowlist. Mirrors the Codex
// launcher and Pi supervisor mcp.json verbatim.
const SUPERVISOR_MONITORING_TARGETS = [
	"list_agents",
	"get_agent_status",
	"get_agent_activity",
	"send_agent_prompt",
];
export const SUPERVISOR_ALLOWED_MCP_TARGETS = [
	...SUPERVISOR_MONITORING_TARGETS,
	"create_agent",
];

/**
 * @param {string} name
 * @param {string[]} known
 * @returns {boolean}
 */
export function matchesPaseoToolName(name, known) {
	return known.includes(name);
}

// ---------------------------------------------------------------------------
// Bash CLI guard — workers/reviewers must not drive Paseo from the shell to
// bypass the tool policy. Heuristic only; not an authorization boundary.
// ---------------------------------------------------------------------------

const PASEO_CLI_RE =
	/\b(paseo|paseo-pi|paseo-claude|pio)(?:\.(?:cmd|exe|ps1|sh))?\s+(?:run|send|ls|agent|workspace|provider|schedule|heartbeat|daemon|status|attach|logs|stop|delete|archive|inspect|wait|import|clone|onboard|start|restart|hub|chat|terminal|script|loop|permit|speech|hooks|help)\b/i;

/** @param {string} command @returns {boolean} */
export function callsPaseoCli(command) {
	return PASEO_CLI_RE.test(command);
}

const GIT_WORKTREE_MUTATION_RE =
	/\bgit\s+worktree\s+(?:add|move|remove|prune|lock|unlock)\b/i;

/** @param {string} command @returns {boolean} */
export function callsGitWorktreeMutation(command) {
	return GIT_WORKTREE_MUTATION_RE.test(command);
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
		if (!authority.push) {
			return "MODE: write is required to push.";
		}
	}
	if (GIT_COMMIT_RE.test(command) && !authority.commit) {
		return "MODE: write is required to commit.";
	}
	if (GIT_MERGE_RE.test(command) && !authority.merge) {
		return "MODE: write is required to merge.";
	}
	return null;
}

// ---------------------------------------------------------------------------
// Supervisor create_agent arg gate (lead-recovery only)
// ---------------------------------------------------------------------------

const SUPERVISOR_RECOVERY_PURPOSES = new Set(["recovery", "bootstrap"]);
const TASK_BRIEF_TITLE_RE = /PASEO_TEAM_TASK_(?:V\d+_)?BEGIN/i;

/** @param {unknown} input @returns {Record<string, unknown> | null} */
function createAgentArgs(input) {
	if (typeof input !== "object" || input === null) return null;
	const rec = /** @type {Record<string, unknown>} */ (input);
	const args =
		(rec.args !== undefined && /** @type {any} */ (rec).args) || rec;
	return typeof args === "object" && args !== null
		? /** @type {Record<string, unknown>} */ (args)
		: null;
}

/** Every Paseo-created agent needs a human-readable title; otherwise the UI
 * falls back to the first V3 marker line in initialPrompt. */
/** @param {unknown} input @returns {string | null} */
export function createAgentTitleBlockReason(input) {
	const args = createAgentArgs(input);
	if (!args) {
		return "create_agent requires an args object with a human-readable title. Refusing fail-closed.";
	}
	const title = args.title;
	if (typeof title !== "string" || title.trim().length === 0) {
		return "create_agent requires a non-empty title. Use a concise title such as \"T-1730 · Worker · Viết retry pattern\", never the V3 brief marker.";
	}
	if (title.length > 160 || /[\r\n]/.test(title) || TASK_BRIEF_TITLE_RE.test(title)) {
		return "create_agent title must be one concise human-readable line (max 160 chars), not a PASEO_TEAM_TASK_V3 marker.";
	}
	return null;
}

/**
 * Codex passes create_agent params as the tool input directly. The Pi
 * proxy wrapped them in { args: {...} }; accept both shapes for safety.
 *
 * @param {unknown} input
 * @returns {string | null}
 */
export function supervisorCreateAgentBlockReason(input) {
	const titleBlock = createAgentTitleBlockReason(input);
	if (titleBlock) return titleBlock;
	if (typeof input !== "object" || input === null) {
		return "Supervisor create_agent requires an args object (provider, labels, settings). Refusing fail-closed.";
	}
	const rec = /** @type {Record<string, unknown>} */ (input);
	// Accept both { args: {...} } (proxy shape) and a direct params object.
	const args =
		(rec.args !== undefined && /** @type {any} */ (rec).args) || rec;
	if (typeof args !== "object" || args === null) {
		return "Supervisor create_agent requires an args object (provider, labels, settings). Refusing fail-closed.";
	}
	const a = /** @type {Record<string, unknown>} */ (args);
	const provider = typeof a.provider === "string" ? a.provider : "";
	if (!/^codex-lead\/[^/]+\/[^/]+/.test(provider)) {
		return `Supervisor create_agent is lead-recovery only: provider must be "codex-lead/<provider>/<model-id>" (got "${provider || "<missing>"}"). Workers/Reviewers and other providers are created by the Lead, never by the Supervisor.`;
	}
	const labels = a.labels;
	if (typeof labels !== "object" || labels === null) {
		return "Supervisor create_agent requires labels to prove this is a gated recovery action.";
	}
	const labelMap = /** @type {Record<string, unknown>} */ (labels);
	const purpose = labelMap.purpose;
	if (typeof purpose !== "string" || !SUPERVISOR_RECOVERY_PURPOSES.has(purpose)) {
		return `Supervisor create_agent labels.purpose must be "recovery" or "bootstrap" (got "${typeof purpose === "string" ? purpose : "<missing>"}").`;
	}
	const recoveryFor = labelMap.recovery_for;
	if (typeof recoveryFor !== "string" || recoveryFor.trim().length === 0) {
		return "Supervisor create_agent labels.recovery_for (project id) is required.";
	}
	const thinking =
		typeof a.settings === "object" && a.settings !== null
			? (/** @type {Record<string, unknown>} */ (a.settings)).thinkingOptionId
			: undefined;
	if (typeof thinking !== "string" || thinking.trim().length === 0) {
		return "Supervisor create_agent requires settings.thinkingOptionId (no daemon-default model — route from the approved Lead route).";
	}
	return null;
}

// ---------------------------------------------------------------------------
// Codex tool-call enforcement
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(["apply_patch", "Edit", "Write", "MultiEdit", "NotebookEdit", "Artifact"]);
const SHELL_TOOLS = new Set(["Bash"]);
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

function writeTargets(toolName, input) {
	if (typeof input !== "object" || input === null) return null;
	const rec = /** @type {Record<string, unknown>} */ (input);
	if (toolName === "apply_patch") {
		if (typeof rec.command !== "string" || !/^\s*\*\*\* Begin Patch\b/.test(rec.command) || !/\*\*\* End Patch\s*$/.test(rec.command)) return null;
		const targets = [...rec.command.matchAll(/^\*\*\* (?:Update|Add|Delete) File: ([^\n]+)$/gm)].map((match) => match[1].trim());
		if (targets.length === 0 || targets.some((target) => target.length === 0)) return null;
		return targets;
	}
	const keys = toolName === "NotebookEdit"
		? ["notebook_path", "file_path", "path"]
		: ["file_path", "path", "notebook_path"];
	for (const key of keys) {
		if (typeof rec[key] === "string" && rec[key].trim().length > 0) return [rec[key]];
	}
	return null;
}

/** Enforce direct file mutations against workspace-relative OWNED_SCOPE roots. */
export function ownedScopeBlockReason(brief, targetPath, cwd) {
	const roots = ownedScopeRoots(brief);
	if (roots === null) return "OWNED_SCOPE is missing or invalid. Use a comma-separated list of workspace-relative path roots (or . for the whole workspace).";
	const targets = Array.isArray(targetPath) ? targetPath : [targetPath];
	if (targets.length === 0 || targets.some((target) => typeof target !== "string" || target.trim().length === 0)) return "The write tool did not provide verifiable file paths; refusing outside-scope mutation fail-closed.";
	const workspace = canonicalPath(cwd);
	for (const targetPath of targets) {
		const target = canonicalPath(path.resolve(cwd, targetPath));
		if (!pathIsWithin(workspace, target)) return `Write target "${targetPath}" resolves outside the assigned workspace.`;
		const allowed = roots.some((root) => {
			const scopeRoot = canonicalPath(path.resolve(cwd, root));
			return pathIsWithin(workspace, scopeRoot) && pathIsWithin(scopeRoot, target);
		});
		if (!allowed) return `Write target "${targetPath}" is outside OWNED_SCOPE (${roots.join(", ")}). Report a REOPEN_REQUEST to the Lead.`;
	}
	return null;
}

/**
 * Decide whether a Codex tool call must be blocked for this role/turn.
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
	// Native delegation: disabled for ALL roles. Paseo is the only control plane;
	// Lead/Supervisor delegate through mcp__paseo__create_agent, never the native
	// Agent tool.
	if (toolName === "Agent" || toolName === "Task") {
		return "Native subagents are disabled for every role. Delegate through the Paseo MCP (mcp__paseo__create_agent), available to Lead/Supervisor only; Workers/Reviewers report a DEPENDENCY_REQUEST.";
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
			if (mode !== "write") {
				return mode !== "write"
					? "This Worker session is read-only (no valid V3 brief with MODE: write this turn). Propose the change in your report instead of editing files."
					: "This Worker session is read-only. A valid V3 brief with MODE: write is required.";
			}
			const scopeBlock = ownedScopeBlockReason(brief, writeTargets(toolName, toolInput), cwd);
			if (scopeBlock) return scopeBlock;
		}
		if (role === "lead" && !leadWriteEnabled()) {
			return "Lead write/edit is disabled by default (set PASEO_TEAM_LEAD_WRITE=1 in the protocol to enable).";
		}
	}

	// Shell tools — supervisor observes via MCP only (no shell, mirrors Pi);
	// worker/reviewer get the git-authority + Paseo-CLI guard.
	if (SHELL_TOOLS.has(toolName)) {
		if (role === "supervisor") {
			return "Supervisor cannot run shell commands. Observe through the Paseo MCP (list_agents, get_agent_status, get_agent_activity) and Read for inspection.";
		}
		if (role === "reviewer") {
			return "Reviewer is behaviorally read-only and cannot run shell commands. Report findings instead.";
		}
		if (role === "worker" && resolveWorkerMode(brief) !== "write") {
			return "This Worker turn is read-only, so shell execution is disabled. A new valid V3 brief with MODE: write is required for Bash/PowerShell.";
		}
		const command =
			typeof (/** @type {any} */ (toolInput)?.command) === "string"
				? /** @type {any} */ (toolInput).command
				: "";
		if (callsGitWorktreeMutation(command)) {
			return "Workspace/worktree mutation is disabled. Every agent works in the current shared workspace.";
		}
		if (role === "worker" || role === "reviewer") {
			if (callsPaseoCli(command)) {
				return `${role} cannot drive the Paseo CLI from a shell (would bypass the tool policy). Report a DEPENDENCY_REQUEST to the Lead instead.`;
			}
			const authority =
				role === "reviewer" ? REVIEWER_AUTHORITY : workerGitAuthority(brief);
			const taskId =
				role === "reviewer" ? undefined : brief?.fields.get("TASK_ID");
			const gitBlock = gitAuthorityBlockReason(command, authority, taskId);
			if (gitBlock) return gitBlock;
		}
	}

	// Paseo MCP tools — mcp__paseo__<target>. Direct tool call (no proxy).
	if (toolName.startsWith(PASEO_MCP_PREFIX)) {
		const target = toolName.slice(PASEO_MCP_PREFIX.length);
		if (role === "worker" || role === "reviewer") {
			return `${role} cannot use Paseo orchestration tools (it would expose the control plane). Report a DEPENDENCY_REQUEST to the Lead instead.`;
		}
		if (role === "lead" && matchesPaseoToolName(target, ["create_agent"])) {
			const titleBlock = createAgentTitleBlockReason(toolInput);
			if (titleBlock) return titleBlock;
		}
		if (role === "supervisor") {
			if (!matchesPaseoToolName(target, SUPERVISOR_ALLOWED_MCP_TARGETS)) {
				return `Supervisor may only call monitoring tools through MCP (list_agents, get_agent_status, get_agent_activity, send_agent_prompt) plus a gated lead-recovery create_agent. "${target}" is blocked — send an observation to the Lead instead.`;
			}
			if (matchesPaseoToolName(target, ["create_agent"])) {
				const argBlock = supervisorCreateAgentBlockReason(toolInput);
				if (argBlock) return argBlock;
			}
		}
		if (role === "lead") {
			if (!matchesPaseoToolName(target, LEAD_ALLOWED_MCP_TARGETS)) {
				return `"${target}" is not in the Lead MCP allowlist.`;
			}
		}
	}

	return null;
}

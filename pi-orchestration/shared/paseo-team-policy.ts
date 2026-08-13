/**
 * paseo-team-policy.ts — role policy extension for the Paseo + Pi role pack
 * (pi-orchestration), 4-role layout.
 *
 * Reads PASEO_PI_ROLE (lead | worker | reviewer | supervisor) and enforces a
 * per-role tool allowlist via setActiveTools() plus a fail-closed backstop in
 * the tool_call event. It is the hard enforcement layer that complements the
 * instruction-level role boundaries in each role's AGENTS.md.
 *
 * The role IDENTITY and instructions are NOT injected here — they come from
 * the role's AGENTS.md context file in its PI_CODING_AGENT_DIR. This extension
 * only restricts tools and gates dangerous operations.
 *
 * Selective Paseo MCP exposure is handled one layer up: only lead/supervisor
 * are launched through pi-role-app-server (which sets PASEO_MCP_URL), and only
 * their mcp.json contains a paseo server entry. Worker/reviewer have no paseo
 * server, so even though this extension lets the `mcp` proxy tool through for
 * lead/supervisor only, the worker/reviewer mcp proxy has no server to reach.
 *
 * Fail-closed invariants:
 *   - Worker write/commit/push authority is derived from the CURRENT prompt's
 *     strict V3 task brief (PASEO_TEAM_TASK_V3_BEGIN/END) on every
 *     before_agent_start. Legacy V1/V2 briefs never grant write or authority.
 *     A turn without a valid V3 brief is read-only — write mode never leaks
 *     across turns.
 *   - Reviewer is always behaviorally read-only (write/edit revoked) and may
 *     never commit/push/merge/amend/force-push.
 *   - Worker git push, when granted, is branch-scoped to agent/<TASK_ID>;
 *     force-push and merge are always denied.
 *   - Supervisor and Lead MCP proxy calls are checked against a fail-closed
 *     target allowlist; the supervisor's single create_agent exception is
 *     argument-gated to a successor-lead recovery shape.
 *
 * When PASEO_PI_ROLE is unset the extension stays passive (no restrictions),
 * so it is safe to load in a non-team Pi. Extra tools per profile can be added
 * via PASEO_TEAM_EXTRA_TOOLS="a,b". Lead gets write/edit only when
 * PASEO_TEAM_LEAD_WRITE=1.
 */

import {
	isToolCallEventType,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path, { join } from "node:path";

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

export type TeamRole = "lead" | "worker" | "reviewer" | "supervisor";
export type WorkerMode = "write" | "read-only";

export function detectRole(): TeamRole | undefined {
	const raw = process.env.PASEO_PI_ROLE?.trim().toLowerCase();
	return raw === "lead" || raw === "worker" || raw === "reviewer" ||
		raw === "supervisor"
		? (raw as TeamRole)
		: undefined;
}

// ---------------------------------------------------------------------------
// Tool policy tables
// ---------------------------------------------------------------------------

export const PASEO_TOOLS = {
	discovery: ["list_providers", "list_models", "inspect_provider"],
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
} as const;

export const ALL_PASEO_TOOLS: string[] = [
	...PASEO_TOOLS.discovery,
	...PASEO_TOOLS.workspace,
	...PASEO_TOOLS.monitoring,
	...PASEO_TOOLS.orchestration,
];

export const LEAD_ALLOWED_MCP_TARGETS: string[] = [
	...PASEO_TOOLS.discovery,
	...PASEO_TOOLS.workspace,
	...PASEO_TOOLS.monitoring,
	...PASEO_TOOLS.orchestration,
	...PASEO_TOOLS.permissions,
];

const PI_LEAD_READ_ONLY = ["read", "bash"];
const PI_STRICT_READ_ONLY = ["read"];
const PI_WRITE = ["read", "write", "edit", "bash"];
const MCP_TOOLS = ["mcp", "mcp_script"];

const SUPERVISOR_MONITORING_TARGETS: string[] = [
	"list_agents",
	"get_agent_status",
	"get_agent_activity",
	"send_agent_prompt",
];
const SUPERVISOR_ALLOWED_MCP_TARGETS: string[] = [
	...SUPERVISOR_MONITORING_TARGETS,
	"create_agent",
];
const SUPERVISOR_MCP_SCRIPT_TARGETS: string[] = SUPERVISOR_MONITORING_TARGETS;

export function matchesPaseoToolName(name: string, known: string[]): boolean {
	return (
		known.includes(name) ||
		known.some((t) => name.endsWith(`_${t}`) || name.endsWith(`:${t}`))
	);
}

export interface Policy {
	allow: string[];
	deny: string[];
}

function leadWriteEnabled(): boolean {
	const raw = process.env.PASEO_TEAM_LEAD_WRITE?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

export function policyFor(
	role: TeamRole,
	workerMode: WorkerMode,
): Policy {
	switch (role) {
		case "lead":
			return {
				allow: [
					...(leadWriteEnabled() ? PI_WRITE : PI_LEAD_READ_ONLY),
					...LEAD_ALLOWED_MCP_TARGETS,
					...MCP_TOOLS,
				],
				deny: [],
			};
		case "worker":
			return workerMode === "write"
				? { allow: [...PI_WRITE], deny: [...ALL_PASEO_TOOLS, ...MCP_TOOLS] }
				: {
						allow: [...PI_STRICT_READ_ONLY],
						deny: [...ALL_PASEO_TOOLS, ...MCP_TOOLS, "write", "edit", "bash"],
					};
		case "reviewer":
			return {
				allow: [...PI_STRICT_READ_ONLY],
				deny: [...ALL_PASEO_TOOLS, ...MCP_TOOLS, "write", "edit", "bash"],
			};
		case "supervisor":
			return {
				allow: ["read", "mcp", ...PASEO_TOOLS.monitoring, "send_agent_prompt"],
				deny: ["write", "edit", "mcp_script", ...ALL_PASEO_TOOLS],
			};
	}
}

/**
 * Effective worker policy for the CURRENT turn. MODE: write grants write/edit
 * only when the brief also grants edit authority: an explicit
 * `EDIT_AUTHORITY: denied` (or a fail-closed V3 brief) strips write/edit even
 * on a write-mode turn.
 */
export function policyWithAuthority(
	role: TeamRole,
	workerMode: WorkerMode,
	brief: ParsedTaskBrief | null,
): Policy {
	const policy = policyFor(role, workerMode);
	if (
		role === "worker" &&
		workerMode === "write" &&
		!workerGitAuthority(brief).edit
	) {
		return {
			allow: policy.allow.filter((t) => t !== "write" && t !== "edit"),
			deny: [...new Set([...policy.deny, "write", "edit"])],
		};
	}
	return policy;
}

export function denyReason(
	role: TeamRole,
	workerMode: WorkerMode,
	toolName: string,
): string {
	if (
		(role === "worker" || role === "reviewer") &&
		(toolName === "mcp" || toolName === "mcp_script")
	) {
		return `${role} cannot use the MCP proxy (it would expose Paseo orchestration tools). Report a DEPENDENCY_REQUEST to the Lead instead.`;
	}
	if (
		(role === "worker" || role === "reviewer") &&
		matchesPaseoToolName(toolName, ALL_PASEO_TOOLS)
	) {
		return `${role} cannot orchestrate agents or manage workspaces. Report a DEPENDENCY_REQUEST to the Lead instead.`;
	}
	if (role === "worker" && workerMode !== "write" &&
		(toolName === "write" || toolName === "edit")) {
		return "This Worker session is read-only (MODE: read-only). Propose the change in your report instead of editing files.";
	}
	if (role === "reviewer" && (toolName === "write" || toolName === "edit")) {
		return "Reviewer is strictly read-only. Report findings instead of editing files.";
	}
	if ((role === "reviewer" || (role === "worker" && workerMode !== "write")) && toolName === "bash") {
		return `${role} has no shell authority on a read-only turn. Use the read tool and report any verification that requires command execution.`;
	}
	if (role === "supervisor" && (toolName === "write" || toolName === "edit")) {
		return "Supervisor cannot modify product code. Send an observation to the Lead instead.";
	}
	if (role === "supervisor" && toolName === "mcp_script") {
		return "Supervisor cannot use mcp_script: dynamic MCP dispatch cannot be verified against the monitoring allowlist. Call monitoring tools individually through the mcp proxy.";
	}
	if (role === "supervisor") {
		return "Supervisor cannot create or manage agents or workspaces. Send an observation to the Lead instead.";
	}
	return `Tool "${toolName}" is blocked by the ${role} role policy.`;
}

// ---------------------------------------------------------------------------
// Bash CLI guard — workers/reviewers must not drive Paseo from the shell to
// bypass the tool policy. Heuristic only; not an authorization boundary.
// ---------------------------------------------------------------------------

const PASEO_CLI_RE =
	/\b(paseo|paseo-pi|pio)(?:\.(?:cmd|exe|ps1|sh))?\s+(?:run|send|ls|agent|workspace|provider|schedule|heartbeat|daemon|status|attach|logs|stop|delete|archive|inspect|wait|import|clone|onboard|start|restart|hub|chat|terminal|script|loop|permit|speech|hooks|help)\b/i;

export function callsPaseoCli(command: string): boolean {
	return PASEO_CLI_RE.test(command);
}

// ---------------------------------------------------------------------------
// MCP proxy target guard — fail-closed on the target name.
// ---------------------------------------------------------------------------

export interface McpInputClassification {
	kind: "meta" | "target" | "unknown";
	target?: string;
	reason?: string;
}

const MCP_META_KEYS = ["connect", "search", "describe", "instructions", "server"];
const MCP_META_ACTIONS = new Set(["ui-messages"]);

export function classifyMcpInput(input: unknown): McpInputClassification {
	if (typeof input !== "object" || input === null) {
		return { kind: "unknown", reason: "mcp input is not an object" };
	}
	const rec = input as Record<string, unknown>;
	if ("tool" in rec) {
		return typeof rec.tool === "string" && rec.tool.trim().length > 0
			? { kind: "target", target: rec.tool }
			: { kind: "unknown", reason: "mcp input has a missing or non-string tool field" };
	}
	if (MCP_META_KEYS.some((k) => k in rec)) return { kind: "meta" };
	if ("action" in rec) {
		return typeof rec.action === "string" && MCP_META_ACTIONS.has(rec.action)
			? { kind: "meta" }
			: { kind: "unknown", reason: `mcp action "${String(rec.action)}" is not a meta operation` };
	}
	if (Object.keys(rec).length === 0) return { kind: "meta" };
	return {
		kind: "unknown",
		reason:
			"mcp input carries no determinable target (expected tool, connect, search, describe, instructions, server, or a known action)",
	};
}

export function isSupervisorAllowedMcpTarget(toolName: string): boolean {
	return matchesPaseoToolName(toolName, SUPERVISOR_ALLOWED_MCP_TARGETS);
}

export function mcpAllowedTargets(role: TeamRole): string[] {
	switch (role) {
		case "supervisor":
			return SUPERVISOR_ALLOWED_MCP_TARGETS;
		case "lead":
			return LEAD_ALLOWED_MCP_TARGETS;
		case "worker":
		case "reviewer":
			return [];
	}
}

function extractCreateAgentArgs(input: unknown): unknown {
	if (typeof input !== "object" || input === null) return null;
	const args = (input as Record<string, unknown>).args;
	if (typeof args === "string") {
		try {
			return JSON.parse(args);
		} catch {
			return null;
		}
	}
	return args ?? null;
}

const SUPERVISOR_RECOVERY_PURPOSES = new Set(["recovery", "bootstrap"]);

export function supervisorCreateAgentBlockReason(input: unknown): string | null {
	const args = extractCreateAgentArgs(input);
	if (typeof args !== "object" || args === null) {
		return "Supervisor create_agent requires an args object (provider, labels, settings). Refusing fail-closed.";
	}
	const rec = args as Record<string, unknown>;
	const provider = typeof rec.provider === "string" ? rec.provider : "";
	if (!/^pi-lead\/[^/]+\/[^/]+/.test(provider)) {
		return `Supervisor create_agent is lead-recovery only: provider must be "pi-lead/<pi-provider>/<model-id>" (got "${provider || "<missing>"}"). Workers/Reviewers and other providers are created by the Lead, never by the Supervisor.`;
	}
	const labels = rec.labels;
	if (typeof labels !== "object" || labels === null) {
		return "Supervisor create_agent requires labels to prove this is a gated recovery action.";
	}
	const labelMap = labels as Record<string, unknown>;
	const purpose = labelMap.purpose;
	if (typeof purpose !== "string" || !SUPERVISOR_RECOVERY_PURPOSES.has(purpose)) {
		return `Supervisor create_agent labels.purpose must be "recovery" or "bootstrap" (got "${typeof purpose === "string" ? purpose : "<missing>"}").`;
	}
	const recoveryFor = labelMap.recovery_for;
	if (typeof recoveryFor !== "string" || recoveryFor.trim().length === 0) {
		return "Supervisor create_agent labels.recovery_for (project id) is required.";
	}
	const thinking =
		typeof rec.settings === "object" && rec.settings !== null
			? (rec.settings as Record<string, unknown>).thinkingOptionId
			: undefined;
	if (typeof thinking !== "string" || thinking.trim().length === 0) {
		return "Supervisor create_agent requires settings.thinkingOptionId (no daemon-default model — route from the approved Lead route).";
	}
	return null;
}

export function mcpBlockReason(role: TeamRole, input: unknown): string | null {
	const classification = classifyMcpInput(input);
	if (classification.kind === "meta") return null;
	if (classification.kind === "unknown") {
		return classification.reason ?? "mcp call could not be classified — blocked fail-closed";
	}
	const target = classification.target ?? "";
	if (!matchesPaseoToolName(target, mcpAllowedTargets(role))) {
		if (role === "supervisor") {
			return `Supervisor may only call monitoring tools through MCP (list_agents, get_agent_status, get_agent_activity, send_agent_prompt) plus a gated lead-recovery create_agent. "${target}" is blocked — send an observation to the Lead instead.`;
		}
		return `"${target}" is not in the ${role} MCP allowlist.`;
	}
	if (role === "supervisor" && matchesPaseoToolName(target, ["create_agent"])) {
		const argBlock = supervisorCreateAgentBlockReason(input);
		if (argBlock) return argBlock;
	}
	return null;
}

const MCP_SCRIPT_DIRECT_CALL_RE =
	/\btools\s*\[\s*["'`]call["'`]\s*\]\s*\(\s*["'`]([^"'`]+)["'`]|\btools\.call\(\s*["'`]([^"'`]+)["'`]|\btools\[["'`]([^"'`]+)["'`]\]\s*\(|\btools\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const MCP_SCRIPT_DYNAMIC_CALL_RE =
	/\btools\s*\.\s*call\s*\(\s*(?!["'`])|\btools\s*\[\s*["'`]call["'`]\s*\]\s*\(\s*(?!["'`])|\btools\s*\[\s*(?![\s"'`\]])/g;

export function mcpScriptBlockReason(role: TeamRole, code: string): string | null {
	const allowed =
		role === "supervisor" ? SUPERVISOR_MCP_SCRIPT_TARGETS : mcpAllowedTargets(role);
	for (const _match of code.matchAll(MCP_SCRIPT_DYNAMIC_CALL_RE)) {
		return `mcp_script invokes an MCP tool through a non-literal target (variable, expression or computed key) — the ${role} allowlist cannot verify it, so the call is blocked fail-closed. Use a literal tool name.`;
	}
	for (const match of code.matchAll(MCP_SCRIPT_DIRECT_CALL_RE)) {
		const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
		if (["call", "describe", "search", "emit"].includes(name)) continue;
		if (!matchesPaseoToolName(name, allowed)) {
			return `Tool "${name}" referenced in mcp_script is not in the ${role} MCP allowlist.`;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Strict task brief (V3 marker block; V1/V2 legacy header for diagnostics)
// ---------------------------------------------------------------------------

export type BriefVersion = 1 | 2 | 3;

export interface ParsedTaskBrief {
	version: BriefVersion;
	mode: WorkerMode | null;
	malformed: string[];
	fields: Map<string, string>;
}

const BRIEF_HEADER_RE = /^PASEO_TEAM_TASK_V([12])$/;
const V3_BEGIN = "PASEO_TEAM_TASK_V3_BEGIN";
const V3_END = "PASEO_TEAM_TASK_V3_END";
const BRIEF_FIELD_RE = /^([A-Z][A-Z0-9_]*):\s*(.*)$/;
const AUTHORITY_FIELDS = [
	"EDIT_AUTHORITY",
	"COMMIT_AUTHORITY",
	"PUSH_TASK_BRANCH_AUTHORITY",
	"FORCE_PUSH_AUTHORITY",
	"MERGE_AUTHORITY",
	"DEPLOY_AUTHORITY",
] as const;

const V3_ALLOWED_FIELDS = new Set([
	"TASK_ID",
	"PROJECT_ID",
	"DISPOSITION",
	"MODE",
	"ASSIGNED_HOST_ID",
	"ASSIGNED_PASEO_PROVIDER",
	"ASSIGNED_MODEL",
	"ASSIGNED_THINKING",
	"WORKSPACE_REF",
	"AGENT_REF",
	"EXPECTED_BASE_SHA",
	"ASSIGNED_CANDIDATE_SHA",
	"OWNED_SCOPE",
	"EXCLUDED_SCOPE",
	"VERIFICATION_PROFILE",
	"RETURN_CHANNEL",
	...AUTHORITY_FIELDS,
]);

function normalizeOwnedScope(raw: string | undefined): string[] | null {
	if (raw === undefined || raw.trim().length === 0) return null;
	const roots = raw.split(",").map((item) => item.trim());
	if (roots.some((item) => item.length === 0)) return null;
	const normalized: string[] = [];
	for (const root of roots) {
		if (root.includes("\0") || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(root)) return null;
		const parts = root.replaceAll("\\", "/").split("/").filter(
			(part) => part !== "" && part !== ".",
		);
		if (parts.includes("..")) return null;
		const value = parts.length === 0 ? "." : parts.join("/");
		if (!normalized.includes(value)) normalized.push(value);
	}
	return normalized;
}

function parseV3Brief(lines: string[]): ParsedTaskBrief {
	const malformed: string[] = [];
	const fields = new Map<string, string>();
	let begin = -1;
	for (let i = 0; i < lines.length; i++) {
		if ((lines[i]?.trim() ?? "").length > 0) {
			begin = i;
			break;
		}
	}
	let end = -1;
	for (let i = begin + 1; i < lines.length; i++) {
		if ((lines[i] ?? "").trim() === V3_END) {
			end = i;
			break;
		}
	}
	if (end < 0) {
		malformed.push("V3 brief has no closing PASEO_TEAM_TASK_V3_END marker");
	} else {
		for (let i = begin + 1; i < end; i++) {
			const line = (lines[i] ?? "").trim();
			if (line.length === 0) continue;
			const match = line.match(BRIEF_FIELD_RE);
			if (!match || match[1] === undefined || match[2] === undefined) {
				malformed.push(`unparseable line in V3 brief: "${line}"`);
				continue;
			}
			const key = match[1];
			if (!V3_ALLOWED_FIELDS.has(key)) {
				malformed.push(`unknown V3 brief field "${key}"`);
				continue;
			}
			if (fields.has(key)) {
				malformed.push(
					AUTHORITY_FIELDS.includes(key as never)
						? `duplicate authority field "${key}"`
						: `duplicate field "${key}"`,
				);
				continue;
			}
			fields.set(key, match[2].trim());
		}
	}

	const failClosed = (): ParsedTaskBrief => ({
		version: 3,
		mode: null,
		malformed,
		fields: new Map(),
	});

	let mode: WorkerMode | null = null;
	const rawMode = fields.get("MODE");
	if (rawMode === undefined) {
		malformed.push("missing MODE field");
	} else {
		const normalized = rawMode.toLowerCase();
		if (normalized === "write" || normalized === "read-only") {
			mode = normalized;
		} else {
			malformed.push(`invalid MODE value "${rawMode}"`);
		}
	}
	for (const field of AUTHORITY_FIELDS) {
		const value = fields.get(field);
		if (value !== undefined) {
			const normalized = value.toLowerCase();
			if (normalized !== "allowed" && normalized !== "denied") {
				malformed.push(`invalid ${field} value "${value}"`);
			}
		}
	}
	if (mode === "write" && normalizeOwnedScope(fields.get("OWNED_SCOPE")) === null) {
		malformed.push("MODE: write requires a valid workspace-relative OWNED_SCOPE");
	}
	if (malformed.length > 0) return failClosed();
	return { version: 3, mode, malformed, fields };
}

export function isLegacyBrief(brief: ParsedTaskBrief): boolean {
	return brief.version < 3;
}

export function parseTaskBrief(prompt: string): ParsedTaskBrief | null {
	const lines = prompt.split(/\r?\n/);
	const firstNonEmpty = lines.map((l) => l.trim()).find((l) => l.length > 0);
	if (!firstNonEmpty) return null;
	if (firstNonEmpty === V3_BEGIN) return parseV3Brief(lines);
	const headerMatch = firstNonEmpty.match(BRIEF_HEADER_RE);
	if (!headerMatch || !headerMatch[1]) return null;
	const version: BriefVersion = headerMatch[1] === "2" ? 2 : 1;

	const fields = new Map<string, string>();
	for (const line of lines) {
		const fieldMatch = line.match(BRIEF_FIELD_RE);
		const key = fieldMatch?.[1];
		if (key !== undefined && fieldMatch?.[2] !== undefined && !fields.has(key)) {
			fields.set(key, fieldMatch[2].trim());
		}
	}

	const malformed: string[] = [];
	let mode: WorkerMode | null = null;
	const rawMode = fields.get("MODE");
	if (rawMode === undefined) {
		malformed.push("missing MODE field");
	} else {
		const normalized = rawMode.toLowerCase();
		if (normalized === "write" || normalized === "read-only") {
			mode = normalized;
		} else {
			malformed.push(`invalid MODE value "${rawMode}"`);
		}
	}
	if (mode === "write" || AUTHORITY_FIELDS.some((f) => fields.has(f))) {
		malformed.push(
			`legacy V${version} brief: MODE and *_AUTHORITY fields are ignored — only a V3 marker block can grant write/authority`,
		);
	}
	return { version, mode, malformed, fields };
}

export function resolveWorkerMode(brief: ParsedTaskBrief | null): WorkerMode {
	if (brief === null) return "read-only";
	if (isLegacyBrief(brief)) return "read-only";
	return brief.mode ?? "read-only";
}

export interface WorkerGitAuthority {
	edit: boolean;
	commit: boolean;
	pushTaskBranch: boolean;
	forcePush: boolean;
	merge: boolean;
	deploy: boolean;
}

function authorityField(
	brief: ParsedTaskBrief | null,
	field: string,
): boolean | undefined {
	const raw = brief?.fields.get(field);
	if (raw === undefined) return undefined;
	return raw.toLowerCase() === "allowed";
}

export function workerGitAuthority(
	brief: ParsedTaskBrief | null,
): WorkerGitAuthority {
	if (brief === null || isLegacyBrief(brief)) {
		return { edit: false, commit: false, pushTaskBranch: false, forcePush: false, merge: false, deploy: false };
	}
	const mode = resolveWorkerMode(brief);
	return {
		edit: authorityField(brief, "EDIT_AUTHORITY") ?? mode === "write",
		commit: authorityField(brief, "COMMIT_AUTHORITY") ?? false,
		pushTaskBranch: authorityField(brief, "PUSH_TASK_BRANCH_AUTHORITY") ?? false,
		forcePush: false,
		merge: false,
		deploy: false,
	};
}

/**
 * Parse OWNED_SCOPE as comma-separated workspace-relative path roots. `.` means
 * the whole workspace. Invalid or ambiguous scope fails closed.
 */
export function ownedScopeRoots(
	brief: ParsedTaskBrief | null,
): string[] | null {
	if (brief === null || isLegacyBrief(brief) || brief.malformed.length > 0) return null;
	return normalizeOwnedScope(brief.fields.get("OWNED_SCOPE"));
}

function canonicalPath(pathname: string): string {
	let cursor = path.resolve(pathname);
	const suffix: string[] = [];
	while (!existsSync(cursor)) {
		const parent = path.dirname(cursor);
		if (parent === cursor) return path.resolve(pathname);
		suffix.unshift(path.basename(cursor));
		cursor = parent;
	}
	return path.resolve(realpathSync(cursor), ...suffix);
}

function pathIsWithin(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" ||
		(!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Enforce direct write/edit calls against canonical OWNED_SCOPE roots. */
export function ownedScopeBlockReason(
	brief: ParsedTaskBrief | null,
	targetPath: string | undefined,
	cwd: string,
): string | null {
	const roots = ownedScopeRoots(brief);
	if (roots === null) {
		return "OWNED_SCOPE is missing or invalid. Use comma-separated workspace-relative path roots (or . for the whole workspace).";
	}
	if (!targetPath?.trim()) {
		return "The write/edit call did not provide a verifiable path; refusing outside-scope mutation fail-closed.";
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

// ---------------------------------------------------------------------------
// Git authority guard (heuristic on bash commands; not an auth boundary)
// ---------------------------------------------------------------------------

const GIT_COMMIT_RE = /\bgit\b[^|;&]*\bcommit\b/i;
const GIT_PUSH_RE = /\bgit\b[^|;&]*\bpush\b/i;
const GIT_MERGE_RE = /\bgit\b[^|;&]*\bmerge\b/i;
const GIT_AMEND_RE = /\bgit\b[^|;&]*\bcommit\b[^|;&]*--amend\b/i;

function detectForcePush(command: string): boolean {
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

export function expectedTaskBranch(taskId: string | undefined): string | null {
	const id = taskId?.trim();
	if (!id || /\s/.test(id)) return null;
	return `agent/${id}`;
}

/** Reviewer is always all-false: never commit/push/merge/amend/force-push. */
const REVIEWER_AUTHORITY: WorkerGitAuthority = {
	edit: false,
	commit: false,
	pushTaskBranch: false,
	forcePush: false,
	merge: false,
	deploy: false,
};

export function gitAuthorityBlockReason(
	command: string,
	authority: WorkerGitAuthority,
	taskId?: string,
): string | null {
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
		const expected = expectedTaskBranch(taskId);
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
// Per-turn worker state — recomputed from the current prompt every
// before_agent_start. Never sticky across turns.
// ---------------------------------------------------------------------------

let currentBrief: ParsedTaskBrief | null = null;

function currentWorkerMode(): WorkerMode {
	return resolveWorkerMode(currentBrief);
}

// ---------------------------------------------------------------------------
// Policy application
// ---------------------------------------------------------------------------

function extraTools(): string[] {
	return (process.env.PASEO_TEAM_EXTRA_TOOLS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function currentPolicy(r: TeamRole): Policy {
	return policyWithAuthority(r, currentWorkerMode(), currentBrief);
}

function applyPolicy(pi: ExtensionAPI, r: TeamRole): Policy {
	const registered = new Set(pi.getAllTools().map((t) => t.name));
	const policy = currentPolicy(r);
	const allowed = [...new Set([...policy.allow, ...extraTools()])].filter(
		(name) => registered.has(name),
	);
	pi.setActiveTools(allowed);
	return policy;
}

function describePolicy(p: Policy): string {
	return `allow=[${p.allow.join(", ")}] deny=[${p.deny.join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Debug commands
// ---------------------------------------------------------------------------

function registerDebugCommands(pi: ExtensionAPI, r: TeamRole | undefined) {
	pi.registerCommand("team-role", {
		description: "Show the active Paseo team role and its tool policy",
		handler: async (_args, ctx) => {
			if (!r) {
				ctx.ui.notify(
					"PASEO_PI_ROLE is unset — extension is passive (no restrictions).",
					"warning",
				);
				return;
			}
			const briefInfo = currentBrief
				? `brief=V${currentBrief.version} mode=${currentBrief.mode ?? "invalid"}${
						currentBrief.malformed.length
							? ` malformed=[${currentBrief.malformed.join("; ")}]`
							: ""
					}`
				: "brief=none";
			ctx.ui.notify(
				`role=${r} workerMode=${currentWorkerMode()} ${briefInfo}\n${describePolicy(currentPolicy(r))}`,
				"info",
			);
		},
	});

	pi.registerCommand("team-tools", {
		description: "List all registered tools with source and active state",
		handler: async (_args, ctx) => {
			const all = pi.getAllTools();
			const active = new Set(pi.getActiveTools());
			const rows = all.map((t) => {
				const state = active.has(t.name) ? "active  " : "inactive";
				const source = t.sourceInfo?.source ?? "unknown";
				return `${state} ${t.name.padEnd(32)} source=${source}`;
			});
			const text = [
				`role: ${r ?? "none"}`,
				`workerMode: ${currentWorkerMode()}`,
				`tools: ${all.length} registered, ${active.size} active`,
				...rows,
			].join("\n");
			console.log(`[paseo-team] /team-tools\n${text}`);
			const dumpPath = join(homedir(), ".pi", "team-tools.txt");
			writeFileSync(dumpPath, `${text}\n`, "utf8");
			ctx.ui.notify(`team-tools: ${all.length} tools -> ${dumpPath}`, "info");
		},
	});
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const activeRole = detectRole();
	if (!activeRole) {
		console.log("[paseo-team] PASEO_PI_ROLE unset — extension passive");
		registerDebugCommands(pi, undefined);
		return;
	}
	const r: TeamRole = activeRole;

	console.log(
		`[paseo-team] role=${r} workerMode=${currentWorkerMode()} policy=${describePolicy(currentPolicy(r))}`,
	);

	pi.on("session_start", () => {
		currentBrief = null;
		applyPolicy(pi, r);
	});

	pi.on("before_agent_start", async (event) => {
		if (r === "worker") {
			// Recompute authority from THIS prompt — never inherit from an
			// earlier turn. Missing/malformed brief → read-only.
			currentBrief = parseTaskBrief(event.prompt);
			if (currentBrief?.malformed.length) {
				console.warn(
					`[paseo-team] malformed task brief → read-only: ${currentBrief.malformed.join("; ")}`,
				);
			}
		}
		applyPolicy(pi, r);
		// Role identity/instructions come from the role AGENTS.md context file;
		// this extension does not mutate the system prompt.
	});

	pi.on("tool_call", async (event, ctx) => {
		const workerMode = currentWorkerMode();
		const policy = currentPolicy(r);
		if (policy.deny.includes(event.toolName)) {
			if (
				r === "worker" &&
				workerMode === "write" &&
				(event.toolName === "write" || event.toolName === "edit")
			) {
				return {
					block: true,
					reason:
						"EDIT_AUTHORITY is denied for this task even though MODE is write. Report AUTHORITY_MISMATCH to the Lead.",
				};
			}
			return { block: true, reason: denyReason(r, workerMode, event.toolName) };
		}
		if (
			r === "worker" &&
			(isToolCallEventType("write", event) || isToolCallEventType("edit", event))
		) {
			const scopeBlock = ownedScopeBlockReason(currentBrief, event.input.path, ctx.cwd);
			if (scopeBlock) return { block: true, reason: scopeBlock };
		}
		if (isToolCallEventType("mcp", event)) {
			if (r === "worker" || r === "reviewer") {
				return {
					block: true,
					reason: `${r} cannot use the MCP proxy (it would expose Paseo orchestration tools). Report a DEPENDENCY_REQUEST to the Lead instead.`,
				};
			}
			if (r === "supervisor" || r === "lead") {
				const blockReason = mcpBlockReason(r, event.input);
				if (blockReason) return { block: true, reason: blockReason };
			}
		}
		if (
			(r === "lead" || r === "supervisor") &&
			isToolCallEventType("mcp_script", event)
		) {
			const code = typeof event.input.code === "string" ? event.input.code : "";
			const blockReason = mcpScriptBlockReason(r, code);
			if (blockReason) return { block: true, reason: blockReason };
		}
		if (
			(r === "worker" || r === "reviewer") &&
			isToolCallEventType("bash", event)
		) {
			const command = event.input.command ?? "";
			if (callsPaseoCli(command)) {
				return {
					block: true,
					reason: `${r} cannot drive the Paseo CLI from bash (would bypass the tool policy). Report a DEPENDENCY_REQUEST to the Lead instead.`,
				};
			}
			const authority =
				r === "reviewer"
					? REVIEWER_AUTHORITY
					: workerGitAuthority(currentBrief);
			const taskId = r === "reviewer" ? undefined : currentBrief?.fields.get("TASK_ID");
			const gitBlockReason = gitAuthorityBlockReason(command, authority, taskId);
			if (gitBlockReason) return { block: true, reason: gitBlockReason };
		}
	});

	registerDebugCommands(pi, r);
}

/**
 * brief.mjs — strict V3 Task Brief parser + worker git-authority derivation.
 *
 * Ported verbatim (logic + regexes) from
 * pi-orchestration/shared/paseo-team-policy.ts so the Claude Code pack enforces
 * the SAME fail-closed authority contract as the Pi pack. Pure, no Claude Code
 * API, no filesystem — unit-testable and shared by both hook entry scripts.
 *
 * Fail-closed invariants (identical to the Pi extension):
 *   - Only a strict V3 marker block (PASEO_TEAM_TASK_V3_BEGIN/END) can grant
 *     write/authority. Legacy V1/V2 headers ALWAYS resolve read-only.
 *   - A field outside the allowlist, a duplicate field, a bad value, or a
 *     missing closing marker invalidates the WHOLE brief → read-only.
 *   - Write mode never carries over across turns (the brief is re-parsed every
 *     user prompt by the UserPromptSubmit hook).
 */

/** @typedef {"write" | "read-only"} WorkerMode */

export const AUTHORITY_FIELDS = [
	"EDIT_AUTHORITY",
	"COMMIT_AUTHORITY",
	"PUSH_AUTHORITY",
	"FORCE_PUSH_AUTHORITY",
	"MERGE_AUTHORITY",
	"DEPLOY_AUTHORITY",
];

const BRIEF_HEADER_RE = /^PASEO_TEAM_TASK_V([12])$/;
const V3_BEGIN = "PASEO_TEAM_TASK_V3_BEGIN";
const V3_END = "PASEO_TEAM_TASK_V3_END";
const BRIEF_FIELD_RE = /^([A-Z][A-Z0-9_]*):\s*(.*)$/;

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

function normalizeOwnedScope(raw) {
	if (typeof raw !== "string" || raw.trim().length === 0) return null;
	const roots = raw.split(",").map((item) => item.trim());
	if (roots.some((item) => item.length === 0)) return null;
	const normalized = [];
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

/**
 * @typedef {Object} ParsedTaskBrief
 * @property {1|2|3} version
 * @property {WorkerMode | null} mode
 * @property {string[]} malformed
 * @property {Map<string, string>} fields
 */

/**
 * @param {string[]} lines
 * @returns {ParsedTaskBrief}
 */
function parseV3Brief(lines) {
	const malformed = [];
	const fields = new Map();
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
					AUTHORITY_FIELDS.includes(key)
						? `duplicate authority field "${key}"`
						: `duplicate field "${key}"`,
				);
				continue;
			}
			fields.set(key, match[2].trim());
		}
	}

	/** @returns {ParsedTaskBrief} */
	const failClosed = () => ({ version: 3, mode: null, malformed, fields: new Map() });

	/** @type {WorkerMode | null} */
	let mode = null;
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

/**
 * @param {ParsedTaskBrief} brief
 * @returns {boolean}
 */
export function isLegacyBrief(brief) {
	return brief.version < 3;
}

/**
 * @param {string} prompt
 * @returns {ParsedTaskBrief | null}
 */
export function parseTaskBrief(prompt) {
	const lines = prompt.split(/\r?\n/);
	const firstNonEmpty = lines.map((l) => l.trim()).find((l) => l.length > 0);
	if (!firstNonEmpty) return null;
	if (firstNonEmpty === V3_BEGIN) return parseV3Brief(lines);
	const headerMatch = firstNonEmpty.match(BRIEF_HEADER_RE);
	if (!headerMatch || !headerMatch[1]) return null;
	const version = /** @type {1|2} */ (headerMatch[1] === "2" ? 2 : 1);

	const fields = new Map();
	for (const line of lines) {
		const fieldMatch = line.match(BRIEF_FIELD_RE);
		const key = fieldMatch?.[1];
		if (key !== undefined && fieldMatch?.[2] !== undefined && !fields.has(key)) {
			fields.set(key, fieldMatch[2].trim());
		}
	}

	const malformed = [];
	/** @type {WorkerMode | null} */
	let mode = null;
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

/**
 * @param {ParsedTaskBrief | null} brief
 * @returns {WorkerMode}
 */
export function resolveWorkerMode(brief) {
	if (brief === null) return "read-only";
	if (isLegacyBrief(brief)) return "read-only";
	return brief.mode ?? "read-only";
}

/**
 * @typedef {Object} WorkerGitAuthority
 * @property {boolean} edit
 * @property {boolean} commit
 * @property {boolean} push
 * @property {boolean} forcePush
 * @property {boolean} merge
 * @property {boolean} deploy
 */

/**
 * @param {ParsedTaskBrief | null} brief
 * @param {string} field
 * @returns {boolean | undefined}
 */
function authorityField(brief, field) {
	const raw = brief?.fields.get(field);
	if (raw === undefined) return undefined;
	return raw.toLowerCase() === "allowed";
}

/**
 * @param {ParsedTaskBrief | null} brief
 * @returns {WorkerGitAuthority}
 */
export function workerGitAuthority(brief) {
	if (brief === null || isLegacyBrief(brief)) {
		return { edit: false, commit: false, push: false, forcePush: false, merge: false, deploy: false };
	}
	const mode = resolveWorkerMode(brief);
	if (mode !== "write") {
		return { edit: false, commit: false, push: false, forcePush: false, merge: false, deploy: false };
	}
	return {
		edit: true,
		commit: true,
		push: true,
		forcePush: false,
		merge: true,
		deploy: false,
	};
}

/**
 * Parse OWNED_SCOPE as a comma-separated list of workspace-relative path roots.
 * `.` means the whole workspace. Absolute paths, parent traversal, empty items,
 * and NUL bytes are invalid and fail closed.
 *
 * @param {ParsedTaskBrief | null} brief
 * @returns {string[] | null}
 */
export function ownedScopeRoots(brief) {
	if (brief === null || isLegacyBrief(brief) || brief.malformed.length > 0) return null;
	return normalizeOwnedScope(brief.fields.get("OWNED_SCOPE"));
}

/** Reviewer is always all-false: never commit/push/merge/amend/force-push. */
export const REVIEWER_AUTHORITY = /** @type {const} */ ({
	edit: false,
	commit: false,
	push: false,
	forcePush: false,
	merge: false,
	deploy: false,
});

/**
 * @param {string | undefined} taskId
 * @returns {string | null}
 */

/**
 * Serialize a parsed brief for cross-process state (UserPromptSubmit writes it,
 * PreToolUse reads it). Map → entries so JSON.stringify round-trips.
 *
 * @param {ParsedTaskBrief | null} brief
 * @returns {object}
 */
export function serializeBrief(brief) {
	if (!brief) return { version: 0, mode: null, malformed: [], fields: [] };
	return {
		version: brief.version,
		mode: brief.mode,
		malformed: brief.malformed,
		fields: [...brief.fields.entries()],
	};
}

/**
 * @param {object} data
 * @returns {ParsedTaskBrief | null}
 */
export function deserializeBrief(data) {
	if (!data || data.version === 0 || data.version === undefined) return null;
	return {
		version: /** @type {1|2|3} */ (data.version),
		mode: data.mode ?? null,
		malformed: Array.isArray(data.malformed) ? data.malformed : [],
		fields: new Map(Array.isArray(data.fields) ? data.fields : []),
	};
}

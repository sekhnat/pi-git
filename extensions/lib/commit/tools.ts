/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * The commit agent's private tool set (upstream: agentic/tools/*).
 * analyze_files (omp's parallel subagent analysis) is not ported.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ToolError } from "../errors.ts";
import * as git from "../git/repo.ts";
import { parseDiffHunks, parseNumstat } from "../git/diff.ts";
import { validateHunkSelections } from "../git/stage.ts";
import { DEFAULT_CONVENTIONAL_GENERATION_CONFIG } from "./config.ts";
import { EXCLUDED_LOCK_FILES } from "./lock-files.ts";
import { computeDependencyOrder } from "./topo-sort.ts";
import { extractScopeCandidates } from "./scope.ts";
import {
	capDetails,
	MAX_DETAIL_ITEMS,
	normalizeSummary,
	SUMMARY_MAX_CHARS,
	validateAnalysis,
	validateScope,
	validateSummaryRules,
	validateTypeConsistency,
} from "./validation.ts";
import type { CommitAgentState, ConventionalAnalysis, ConventionalDetail, CommitType, FileChange, SplitCommitGroup } from "./types.ts";

const commitTypeSchema = StringEnum([
	"feat",
	"fix",
	"refactor",
	"perf",
	"docs",
	"test",
	"build",
	"ci",
	"chore",
	"style",
	"revert",
] as const);

const detailSchema = Type.Object({
	text: Type.String(),
	user_visible: Type.Optional(Type.Boolean()),
});

function isExcludedFile(path: string): boolean {
	const basename = path.split("/").pop() ?? path;
	return EXCLUDED_LOCK_FILES.has(basename);
}

function filterExcludedFiles(files: string[]): { filtered: string[]; excluded: string[] } {
	const filtered: string[] = [];
	const excluded: string[] = [];
	for (const file of files) {
		if (isExcludedFile(file)) excluded.push(file);
		else filtered.push(file);
	}
	return { filtered, excluded };
}

function renderStat(entries: Array<{ path: string; added: number | null; removed: number | null }>): string {
	if (entries.length === 0) return "";
	let insertions = 0;
	let deletions = 0;
	const lines = entries.map(entry => {
		const added = entry.added ?? 0;
		const removed = entry.removed ?? 0;
		insertions += added;
		deletions += removed;
		return ` ${entry.path} | ${added + removed} ${"+".repeat(Math.min(added, 40))}${"-".repeat(Math.min(removed, 40))}`;
	});
	lines.push(
		` ${entries.length} file${entries.length === 1 ? "" : "s"} changed, ${insertions} insertion${insertions === 1 ? "" : "s"}(+), ${deletions} deletion${deletions === 1 ? "" : "s"}(-)`,
	);
	return `${lines.join("\n")}\n`;
}

export function createGitOverviewTool(cwd: string, state: CommitAgentState) {
	return defineTool({
		name: "git_overview",
		label: "Git Overview",
		description: "Return staged files, diff stat summary, and numstat entries.",
		parameters: Type.Object({
			staged: Type.Optional(Type.Boolean({ description: "use staged changes (default true)" })),
			include_untracked: Type.Optional(Type.Boolean({ description: "include untracked when unstaged" })),
		}),
		async execute(_toolCallId, params, signal) {
			const staged = params.staged ?? true;
			const allFiles = await git.changedFiles(cwd, staged, signal);
			const { filtered: files, excluded } = filterExcludedFiles(allFiles);
			const allNumstat = await git.numstat(cwd, staged, signal);
			const stat = renderStat(allNumstat);
			const numstat = allNumstat
				.filter(entry => !isExcludedFile(entry.path))
				.map(entry => {
					const parsed = parseNumstat(`${entry.added ?? 0}\t${entry.removed ?? 0}\t${entry.path}`)[0]!;
					return { path: parsed.path, additions: parsed.additions, deletions: parsed.deletions };
			});
			const scopeResult = extractScopeCandidates(numstat, DEFAULT_CONVENTIONAL_GENERATION_CONFIG);
			const untrackedFiles = !staged && params.include_untracked ? await git.untrackedFiles(cwd, signal) : undefined;
			const snapshot = {
				files,
				stat,
				numstat,
				scopeCandidates: scopeResult.scopeCandidates,
				isWideScope: scopeResult.isWide,
				untrackedFiles,
				excludedFiles: excluded.length > 0 ? excluded : undefined,
			};
			state.overview = snapshot;
			return {
				content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
				details: snapshot,
			};
		},
	});
}

const TARGET_TOKENS = 30000;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const TRUNCATE_THRESHOLD_LINES = 30;
const KEEP_HEAD_LINES = 15;
const KEEP_TAIL_LINES = 10;

const HIGH_PRIORITY_EXTENSIONS = new Set([".rs", ".go", ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".c", ".cpp", ".h", ".hpp"]);
const SHELL_SQL_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".sql"]);
const MANIFEST_FILES = new Set(["Cargo.toml", "package.json", "go.mod", "pyproject.toml", "requirements.txt", "Gemfile", "build.gradle", "pom.xml"]);
const LOW_PRIORITY_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml", ".csv"]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib"]);
const TEST_PATTERNS = ["/test/", "/tests/", "/__tests__/", "_test.", ".test.", ".spec.", "_spec."];

export function getFilePriority(filename: string): number {
	const basename = filename.split("/").pop() ?? filename;
	const ext = basename.includes(".") ? `.${basename.split(".").pop()}` : "";

	if (BINARY_EXTENSIONS.has(ext)) return -100;

	const lowerPath = filename.toLowerCase();
	for (const pattern of TEST_PATTERNS) {
		if (lowerPath.includes(pattern)) return 10;
	}

	if (LOW_PRIORITY_EXTENSIONS.has(ext) && !MANIFEST_FILES.has(basename)) return 20;
	if (MANIFEST_FILES.has(basename)) return 70;
	if (SHELL_SQL_EXTENSIONS.has(ext)) return 80;
	if (HIGH_PRIORITY_EXTENSIONS.has(ext)) return 100;

	return 50;
}

function truncateDiffContent(diff: string): { content: string; truncated: boolean } {
	const lines = diff.split("\n");
	if (lines.length <= TRUNCATE_THRESHOLD_LINES) {
		return { content: diff, truncated: false };
	}
	const head = lines.slice(0, KEEP_HEAD_LINES);
	const tail = lines.slice(-KEEP_TAIL_LINES);
	const truncatedCount = lines.length - KEEP_HEAD_LINES - KEEP_TAIL_LINES;
	return {
		content: [...head, `\n[…${truncatedCount}ln elided…]\n`, ...tail].join("\n"),
		truncated: true,
	};
}

function processDiffs(files: string[], diffs: Map<string, string>): { result: string; truncatedFiles: string[] } {
	const sortedFiles = [...files].sort((a, b) => getFilePriority(b) - getFilePriority(a));

	const truncatedFiles: string[] = [];
	const parts: string[] = [];
	let totalChars = 0;

	for (const file of sortedFiles) {
		const diff = diffs.get(file);
		if (!diff) continue;

		const remaining = MAX_CHARS - totalChars;
		if (remaining <= 0) {
			truncatedFiles.push(file);
			continue;
		}

		let content = diff;
		if (content.length > remaining || content.split("\n").length > TRUNCATE_THRESHOLD_LINES) {
			const { content: truncated, truncated: wasTruncated } = truncateDiffContent(content);
			if (wasTruncated) truncatedFiles.push(file);
			content = truncated;
			if (content.length > remaining) {
				content = `${content.slice(0, remaining)}\n[…${content.length - remaining}ch elided…]`;
				if (!truncatedFiles.includes(file)) truncatedFiles.push(file);
			}
		}

		parts.push(`=== ${file} ===\n${content}`);
		totalChars += content.length;
	}

	return { result: parts.join("\n\n"), truncatedFiles };
}

export function createGitFileDiffTool(cwd: string, state: CommitAgentState) {
	return defineTool({
		name: "git_file_diff",
		label: "Git File Diff",
		description: "Return the diff for specific files.",
		parameters: Type.Object({
			files: Type.Array(Type.String({ description: "file to diff" }), { minItems: 1, maxItems: 10 }),
			staged: Type.Optional(Type.Boolean({ description: "use staged changes (default true)" })),
		}),
		async execute(_toolCallId, params, signal) {
			const staged = params.staged ?? true;
			const cacheKey = (file: string) => `${file}:${staged}`;
			if (!state.diffCache) state.diffCache = new Map();

			const diffs = new Map<string, string>();
			const uncachedFiles: string[] = [];
			for (const file of params.files) {
				const cached = state.diffCache.get(cacheKey(file));
				if (cached !== undefined) diffs.set(file, cached);
				else uncachedFiles.push(file);
			}

			if (uncachedFiles.length > 0) {
				for (const file of uncachedFiles) {
					const diff = await git.diffText(cwd, { cached: staged, files: [file] }, signal);
					if (diff) {
						diffs.set(file, diff);
					state.diffCache.set(cacheKey(file), diff);
					} else {
						state.diffCache.set(cacheKey(file), "");
					}
			}
		}

			const { result, truncatedFiles } = processDiffs(params.files, diffs);
			const output = result || "(no diff)";
			return {
				content: [{ type: "text", text: output }],
				details: {
					files: params.files,
					staged,
					truncatedFiles: truncatedFiles.length > 0 ? truncatedFiles : undefined,
					cacheHits: params.files.length - uncachedFiles.length,
				},
			};
		},
	});
}

export function createGitHunkTool(cwd: string) {
	return defineTool({
		name: "git_hunk",
		label: "Git Hunk",
		description: "Return specific hunks from a file diff.",
		parameters: Type.Object({
			file: Type.String({ description: "file path" }),
			hunks: Type.Optional(Type.Array(Type.Number({ description: "1-based hunk index" }), { minItems: 1 })),
			staged: Type.Optional(Type.Boolean({ description: "use staged changes (default true)" })),
		}),
		async execute(_toolCallId, params, signal) {
			const staged = params.staged ?? true;
			const diff = await git.diffText(cwd, { cached: staged, files: [params.file] }, signal);
			const hunks = parseDiffHunks(diff);
			const fileHunks = hunks.find(entry => entry.filename === params.file) ?? {
				filename: params.file,
				isBinary: false,
				hunks: [],
			};
			if (fileHunks.isBinary) {
				return {
					content: [{ type: "text", text: "Binary file diff; no hunks available." }],
					details: { file: params.file, staged, hunks: [] },
			};
			}
			let selected = fileHunks.hunks;
			if (params.hunks && params.hunks.length > 0) {
				const wanted = new Set(params.hunks.map(value => Math.max(1, Math.floor(value))));
				selected = fileHunks.hunks.filter((hunk, index) => wanted.has(index + 1));
			}
			const text = selected.length ? selected.map(hunk => hunk.content).join("\n\n") : "(no matching hunks)";
			return {
				content: [{ type: "text", text }],
				details: { file: params.file, staged, hunks: selected },
			};
		},
	});
}

export function createRecentCommitsTool(cwd: string) {
	return defineTool({
		name: "recent_commits",
		label: "Recent Commits",
		description: "Return recent commit subjects with style statistics.",
		parameters: Type.Object({
			count: Type.Optional(Type.Number({ description: "commit count (1-50)" })),
		}),
		async execute(_toolCallId, params, signal) {
			const count = Math.min(Math.max(params.count ?? 8, 1), 50);
			const commits = await git.logSubjects(cwd, count, signal);
			const verbs: Record<string, number> = {};
			const scopes: Record<string, number> = {};
			const lengths: number[] = [];
			let scopeCount = 0;
			let lowercaseCount = 0;

			for (const subject of commits) {
				const match = subject.match(/^[a-z]+(?:\(([^)]+)\))?:\s+(.*)$/i);
				const summary = match?.[2]?.trim() ?? subject.trim();
				const scope = subject.match(/^[a-z]+\(([^)]+)\):/i)?.[1]?.trim() ?? null;
				if (scope) {
					scopeCount += 1;
					scopes[scope] = (scopes[scope] ?? 0) + 1;
				}
				if (summary[0] && summary[0] === summary[0].toLowerCase()) lowercaseCount += 1;
				const firstWord = summary.split(/\s+/)[0]?.toLowerCase();
				if (firstWord) verbs[firstWord] = (verbs[firstWord] ?? 0) + 1;
				lengths.push(summary.length);
			}

			const min = lengths.length > 0 ? Math.min(...lengths) : 0;
			const max = lengths.length > 0 ? Math.max(...lengths) : 0;
			const average = lengths.length > 0 ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
			const payload = {
				commits,
				stats: {
					scopeUsagePercent: commits.length > 0 ? Math.round((scopeCount / commits.length) * 100) : 0,
				commonVerbs: verbs,
				summaryLength: { min, max, average: Number(average.toFixed(1)) },
				lowercaseSummaryPercent: commits.length > 0 ? Math.round((lowercaseCount / commits.length) * 100) : 0,
				topScopes: scopes,
			},
			};
			return {
				content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
				details: payload,
			};
		},
	});
}

function normalizeDetails(details: Array<{ text: string; user_visible?: boolean }>): ConventionalDetail[] {
	return details.map(detail => ({
		text: detail.text.trim(),
		userVisible: detail.user_visible ?? false,
	}));
}

export function createProposeCommitTool(cwd: string, state: CommitAgentState) {
	return defineTool({
		name: "propose_commit",
		label: "Propose Commit",
		description: "Submit the final conventional commit proposal.",
		parameters: Type.Object({
			type: commitTypeSchema,
			scope: Type.Union([Type.String(), Type.Null()]),
			summary: Type.String(),
			details: Type.Array(detailSchema),
			issue_refs: Type.Array(Type.String()),
		}),
		async execute(_toolCallId, params, signal) {
			const scope = params.scope?.trim() || null;
			const summary = normalizeSummary(params.summary, params.type, scope);
			const details = normalizeDetails(params.details);
			const { details: cappedDetails, warnings: detailWarnings } = capDetails(details);
			const analysis: ConventionalAnalysis = {
				type: params.type,
				scope,
				details: cappedDetails,
				issueRefs: params.issue_refs ?? [],
			};

			const summaryValidation = validateSummaryRules(summary);
			const analysisValidation = validateAnalysis(analysis);
			const stagedFiles = state.overview?.files ?? (await git.changedFiles(cwd, true, signal));
			const diffText = state.diffText ?? (await git.diffText(cwd, { cached: true }, signal));
			const typeValidation = validateTypeConsistency(params.type, stagedFiles, {
				diffText,
				summary,
				details: cappedDetails,
			});

			const errors = [...summaryValidation.errors, ...analysisValidation.errors, ...typeValidation.errors];
			const warnings = [...summaryValidation.warnings, ...detailWarnings, ...typeValidation.warnings];

			const response: Record<string, unknown> = {
				valid: errors.length === 0,
				errors,
				warnings,
			};

			if (errors.length === 0) {
				state.proposal = { analysis, summary, warnings };
				response.proposal = { type: analysis.type, scope: analysis.scope, summary };
			}

			const text = JSON.stringify(
				{
					...response,
					constraints: { maxSummaryChars: SUMMARY_MAX_CHARS, maxDetailItems: MAX_DETAIL_ITEMS },
				},
				null,
			2,
			);
			return { content: [{ type: "text", text }], details: response };
		},
	});
}

const fileChangeSchema = Type.Union([
	Type.Object({ path: Type.String(), kind: Type.Literal("all") }),
	Type.Object({ path: Type.String(), kind: Type.Literal("indices"), indices: Type.Array(Type.Number()) }),
	Type.Object({ path: Type.String(), kind: Type.Literal("lines"), start: Type.Number(), end: Type.Number() }),
]);

export function createSplitCommitTool(cwd: string, state: CommitAgentState) {
	return defineTool({
		name: "split_commit",
		label: "Split Commit",
		description: "Propose multiple atomic commits for unrelated changes.",
		parameters: Type.Object({
			commits: Type.Array(
				Type.Object({
					changes: Type.Array(fileChangeSchema),
					type: commitTypeSchema,
					scope: Type.Union([Type.String(), Type.Null()]),
					summary: Type.String(),
					details: Type.Optional(Type.Array(detailSchema)),
					issue_refs: Type.Optional(Type.Array(Type.String())),
					rationale: Type.Optional(Type.String()),
					dependencies: Type.Optional(Type.Array(Type.Number())),
				}),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const stagedFiles = state.overview?.files ?? (await git.changedFiles(cwd, true, signal));
			const stagedSet = new Set(stagedFiles);
			const usedFiles = new Set<string>();
			const errors: string[] = [];
			const warnings: string[] = [];
			const diffText = await git.diffText(cwd, { cached: true }, signal);

			const commits: SplitCommitGroup[] = params.commits.map((commit, index) => {
				const scope = commit.scope?.trim() || null;
				const summary = normalizeSummary(commit.summary, commit.type, scope);
				const detailInput = normalizeDetails(commit.details ?? []);
				const detailResult = capDetails(detailInput);
				warnings.push(...detailResult.warnings.map(warning => `Commit ${index + 1}: ${warning}`));
				const issueRefs = commit.issue_refs ?? [];
				const dependencies = (commit.dependencies ?? []).map(dep => Math.floor(dep));
				const changes: FileChange[] = commit.changes.map(change => {
					if (change.kind === "indices") return { path: change.path, kind: "indices" as const, indices: change.indices };
					if (change.kind === "lines") return { path: change.path, kind: "lines" as const, start: change.start, end: change.end };
					return { path: change.path, kind: "all" as const };
				});
				const files = changes.map(change => change.path);

				const summaryValidation = validateSummaryRules(summary);
				const scopeValidation = validateScope(scope);
				const typeValidation = validateTypeConsistency(commit.type, files, {
						diffText,
						summary,
						details: detailResult.details,
					});

				if (summaryValidation.errors.length > 0) {
					errors.push(...summaryValidation.errors.map(error => `Commit ${index + 1}: ${error}`));
				}
				if (!scopeValidation.valid) {
					errors.push(...scopeValidation.errors.map(error => `Commit ${index + 1}: ${error}`));
				}
				if (typeValidation.errors.length > 0) {
					errors.push(...typeValidation.errors.map(error => `Commit ${index + 1}: ${error}`));
				}
				warnings.push(...summaryValidation.warnings.map(warning => `Commit ${index + 1}: ${warning}`));
				warnings.push(...typeValidation.warnings.map(warning => `Commit ${index + 1}: ${warning}`));
				const hunkValidation = validateHunkSelectors(index, changes, diffText);
				warnings.push(...hunkValidation.warnings);
				errors.push(...hunkValidation.errors);
				errors.push(...validateDependencies(index, dependencies, params.commits.length));

				return {
					changes,
					type: commit.type,
					scope,
					summary,
					details: detailResult.details,
					issueRefs,
					rationale: commit.rationale?.trim() || undefined,
					dependencies,
				};
			});

			for (const commit of commits) {
				const seen = new Set<string>();
				for (const change of commit.changes) {
					const file = change.path;
					if (!stagedSet.has(file)) {
						errors.push(`File not staged: ${file}`);
						continue;
				}
					if (seen.has(file)) {
						errors.push(`File listed multiple times in commit ${commit.summary}: ${file}`);
						continue;
				}
					if (usedFiles.has(file)) {
					errors.push(`File appears in multiple commits: ${file}`);
						continue;
				}
					seen.add(file);
					usedFiles.add(file);
				}
			}

			for (const file of stagedFiles) {
				if (!usedFiles.has(file)) {
					errors.push(`Staged file missing from split plan: ${file}`);
			}
			}

			const dependencyCheck = computeDependencyOrder(commits);
			if ("error" in dependencyCheck) {
				errors.push(dependencyCheck.error);
			}

			const response: Record<string, unknown> = {
				valid: errors.length === 0,
				errors,
				warnings,
			};

			if (errors.length === 0) {
				state.splitProposal = { commits, warnings };
				response.proposal = { commits: commits.length };
			}

			const text = JSON.stringify(
				{
					...response,
					constraints: { maxSummaryChars: SUMMARY_MAX_CHARS, maxDetailItems: MAX_DETAIL_ITEMS },
				},
				null,
			2,
			);
			return { content: [{ type: "text", text }], details: response };
		},
	});
}

function validateHunkSelectors(
	commitIndex: number,
	changes: FileChange[],
	rawDiff: string,
): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const prefix = `Commit ${commitIndex + 1}`;
	const files = changes.map(change => change.path);
	if (files.length === 0) {
		errors.push(`${prefix}: no files specified`);
		return { errors, warnings };
	}
	for (const change of changes) {
		if (change.kind === "indices") {
			const invalid = change.indices.filter(value => !Number.isFinite(value) || Math.floor(value) !== value || value < 1);
			if (invalid.length > 0) {
				errors.push(`${prefix}: invalid hunk indices for ${change.path}`);
			}
			continue;
		}
		if (change.kind === "lines") {
			const { start, end } = change;
			if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
				errors.push(`${prefix}: invalid line range for ${change.path}`);
				continue;
			}
			if (Math.floor(start) !== start || Math.floor(end) !== end || start < 1 || end < start) {
				errors.push(`${prefix}: invalid line range for ${change.path}`);
			}
		}
	}
	if (errors.length === 0) {
		for (const error of validateHunkSelections(rawDiff, changes)) {
			errors.push(`${prefix}: ${error.message}`);
		}
	}
	return { errors, warnings };
}

function validateDependencies(commitIndex: number, dependencies: number[], totalCommits: number): string[] {
	const errors: string[] = [];
	const prefix = `Commit ${commitIndex + 1}`;
	for (const dependency of dependencies) {
		if (!Number.isFinite(dependency) || Math.floor(dependency) !== dependency) {
			errors.push(`${prefix}: dependency index must be an integer`);
			continue;
		}
		if (dependency === commitIndex) {
			errors.push(`${prefix}: cannot depend on itself`);
			continue;
		}
		if (dependency < 0 || dependency >= totalCommits) {
			errors.push(`${prefix}: dependency index out of range (${dependency})`);
		}
	}
	return errors;
}

export function createCommitTools(cwd: string, state: CommitAgentState) {
	return [
		createGitOverviewTool(cwd, state),
		createGitFileDiffTool(cwd, state),
		createGitHunkTool(cwd),
		createRecentCommitsTool(cwd),
		createProposeCommitTool(cwd, state),
		createSplitCommitTool(cwd, state),
	];
}

/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** Conventional commit classifications accepted by commit generation. */
export type CommitType =
	| "feat"
	| "fix"
	| "refactor"
	| "perf"
	| "docs"
	| "test"
	| "build"
	| "ci"
	| "chore"
	| "style"
	| "revert";

/** One parsed `git diff --numstat` row. */
export interface NumstatEntry {
	path: string;
	additions: number;
	deletions: number;
}

/** One material change identified during commit analysis. */
export interface ConventionalDetail {
	text: string;
	userVisible: boolean;
}

/** Structured classification produced before commit-message formatting. */
export interface ConventionalAnalysis {
	type: CommitType;
	scope: string | null;
	summary?: string;
	details: ConventionalDetail[];
	issueRefs: string[];
}

/** One hunk-level file selection inside a split commit plan. */
export type FileChange =
	| { path: string; kind: "all" }
	| { path: string; kind: "indices"; indices: number[] }
	| { path: string; kind: "lines"; start: number; end: number };

/** The git_overview snapshot shared with the commit agent. */
export interface GitOverviewSnapshot {
	files: string[];
	stat: string;
	numstat: NumstatEntry[];
	scopeCandidates: string;
	isWideScope: boolean;
	untrackedFiles?: string[];
	excludedFiles?: string[];
}

export interface CommitProposal {
	analysis: ConventionalAnalysis;
	summary: string;
	warnings: string[];
}

export interface SplitCommitGroup {
	changes: FileChange[];
	type: CommitType;
	scope: string | null;
	summary: string;
	details: ConventionalDetail[];
	issueRefs: string[];
	rationale?: string;
	dependencies: number[];
}

export interface SplitCommitPlan {
	commits: SplitCommitGroup[];
	warnings: string[];
}

/** Mutable state threaded through the commit agent's tools. */
export interface CommitAgentState {
	overview?: GitOverviewSnapshot;
	proposal?: CommitProposal;
	splitProposal?: SplitCommitPlan;
	diffCache?: Map<string, string>;
	diffText?: string;
}

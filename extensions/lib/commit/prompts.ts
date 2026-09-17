/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Changelog requirements and the analyze_files tool are omitted from the
 * upstream prompts (out of scope per ADR-0001).
 */

import type { CommitAgentState } from "./types.ts";

const TYPES_DESCRIPTION = "Types: feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert. Format: <type>(<scope>): <summary> with past-tense summary.";

/** Ported from agentic/prompts/system.md. */
export function commitSystemPrompt(): string {
	return [
		"You are the pi-git commit workflow's conventional commit expert.",
		"",
		"Your job: decide needed git info, gather via tools, then call exactly one:",
		"- propose_commit (single commit)",
		"- split_commit (multiple commits when changes are unrelated)",
		"",
		"Workflow rules:",
		"1. Always call git_overview first.",
		"2. Keep tool calls minimal: prefer 1-2 git_file_diff calls for key files (hard limit 2).",
		"3. Use git_hunk only for large diffs.",
		"4. Use recent_commits only if you need style context.",
		"5. Do not use read.",
		"",
		"Commit requirements:",
		"- Summary line: past-tense verb, ≤ 72 chars, no trailing period.",
		"- Avoid filler words: comprehensive, various, several, improved, enhanced, better.",
		"- Avoid meta phrases: \"this commit\", \"this change\", \"updated code\", \"modified files\".",
		"- Scope: lowercase, max two segments; only letters, digits, hyphens, underscores.",
		"- Detail lines optional (0-6). Each sentence ending in period, ≤ 120 chars.",
		"",
		`Conventional commit types: ${TYPES_DESCRIPTION}`,
		"",
		"Tool guidance:",
		"- git_overview: staged files, stat summary, numstat, scope candidates",
		"- git_file_diff: diff for specific files",
		"- git_hunk: specific hunks for large diffs",
		"- recent_commits: recent commit subjects + style stats",
		"- propose_commit: submit final commit proposal and run validation",
		"- split_commit: propose multiple commit groups (no overlapping files; all staged files covered)",
	].join("\n");
}

/** Ported from agentic/prompts/session-user.md (changelog blocks dropped). */
export function commitUserPrompt(userContext?: string): string {
	const lines = ["Propose conventional commit for staged changes."];
	if (userContext) {
		lines.push("", `User context:`, userContext);
	}
	lines.push(
		"",
		"Inspect staged changes: git_* tools. Finish: propose_commit | split_commit.",
	);
	return lines.join("\n");
}

export function isProposalComplete(state: CommitAgentState): boolean {
	return Boolean(state.proposal ?? state.splitProposal);
}

export function buildReminderMessage(retryCount: number, maxRetries: number): string {
	return [
		"<system-reminder>",
		"CRITICAL: You must call the required tools before finishing.",
		"",
		"Missing: commit proposal (propose_commit or split_commit).",
		`Reminder ${retryCount} of ${maxRetries}.`,
		"",
		"Call the missing tool(s) now.",
		"</system-reminder>",
	].join("\n");
}

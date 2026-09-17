/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { isPastTenseFirstWord } from "./tense.ts";
import type { CommitType, ConventionalDetail } from "./types.ts";

export const SUMMARY_MAX_CHARS = 72;
export const MAX_DETAIL_ITEMS = 6;

const fillerWords = ["comprehensive", "various", "several", "improved", "enhanced", "better"];
const metaPhrases = ["this commit", "this change", "updated code", "modified files"];

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

export function validateSummary(summary: string, maxChars: number): ValidationResult {
	const errors: string[] = [];
	if (!summary.trim()) errors.push("Summary is empty");
	if (summary.length > maxChars) errors.push(`Summary exceeds ${maxChars} characters`);
	if (summary.trimEnd().endsWith(".")) errors.push("Summary must not end with a period");
	if (summary.includes("\n")) errors.push("Summary must be a single line");
	return { valid: errors.length === 0, errors };
}

export function validateScope(scope: string | null): ValidationResult {
	if (!scope) return { valid: true, errors: [] };
	const errors: string[] = [];
	const segments = scope.split("/");
	if (segments.length > 2) errors.push("Scope may contain at most two segments");
	for (const segment of segments) {
		if (!segment) {
			errors.push("Scope segments cannot be empty");
			continue;
		}
		if (segment !== segment.toLowerCase()) errors.push("Scope must be lowercase");
		if (!/^[a-z0-9][a-z0-9-_]*$/.test(segment)) errors.push(`Scope segment has invalid characters: ${segment}`);
	}
	return { valid: errors.length === 0, errors };
}

export function validateAnalysis(analysis: { scope: string | null; details: ConventionalDetail[] }): ValidationResult {
	const errors: string[] = [];
	const scopeResult = validateScope(analysis.scope);
	if (!scopeResult.valid) errors.push(...scopeResult.errors);
	for (const detail of analysis.details) {
		if (!detail.text.trim()) {
			errors.push("Detail text is empty");
			continue;
		}
		if (!detail.text.trim().endsWith(".")) errors.push(`Detail must end with a period: ${detail.text}`);
		if (detail.text.length > 120) errors.push(`Detail exceeds 120 characters: ${detail.text}`);
	}
	return { valid: errors.length === 0, errors };
}

/** Strip a redundant `type(scope): ` prefix the model may have added. */
export function stripTypePrefix(text: string, commitType: string, scope?: string | null): string {
	const trimmed = text.trim();
	const prefixes = scope ? [`${commitType}(${scope}): `, `${commitType}: `] : [`${commitType}: `];
	for (const prefix of prefixes) {
		if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed.slice(prefix.length).trim();
	}
	const parsed = trimmed.match(/^([a-z][a-z0-9-]*)(?:\(([^)]*)\))?:\s+(.*)$/i);
	return parsed?.[1]?.toLowerCase() === commitType.toLowerCase() ? (parsed[3]?.trim() ?? "") : trimmed;
}

export function normalizeSummary(summary: string, commitType: CommitType, scope: string | null): string {
	const stripped = stripTypePrefix(summary, commitType, scope);
	return stripped.replace(/\s+/g, " ").trim();
}

export function validateSummaryRules(summary: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const basic = validateSummary(summary, SUMMARY_MAX_CHARS);
	if (!basic.valid) errors.push(...basic.errors);

	const words = summary.trim().split(/\s+/);
	const firstWord = words[0]?.toLowerCase() ?? "";
	const hasPastTense = isPastTenseFirstWord(firstWord);
	if (!hasPastTense) errors.push("Summary must start with a past-tense verb");

	const lowerSummary = summary.toLowerCase();
	for (const word of fillerWords) {
		if (lowerSummary.includes(word)) warnings.push(`Avoid filler word: ${word}`);
	}
	for (const phrase of metaPhrases) {
		if (lowerSummary.includes(phrase)) warnings.push(`Avoid meta phrase: ${phrase}`);
	}

	return { errors, warnings };
}

export function capDetails(details: ConventionalDetail[]): { details: ConventionalDetail[]; warnings: string[] } {
	if (details.length <= MAX_DETAIL_ITEMS) {
		return { details, warnings: [] };
	}

	const scored = details.map((detail, index) => ({ detail, index, score: scoreDetail(detail.text) }));
	scored.sort((a, b) => b.score - a.score || a.index - b.index);
	const keep = new Set(scored.slice(0, MAX_DETAIL_ITEMS).map(entry => entry.index));
	const kept = details.filter((_detail, index) => keep.has(index));
	return { details: kept, warnings: [`Capped detail list to ${MAX_DETAIL_ITEMS} items based on priority scoring.`] };
}

function scoreDetail(text: string): number {
	const lower = text.toLowerCase();
	let score = 0;
	if (/(security|vulnerability|exploit|cve)/.test(lower)) score += 100;
	if (/(breaking|incompatible)/.test(lower)) score += 90;
	if (/(performance|optimization|optimiz|latency|throughput)/.test(lower)) score += 80;
	if (/(bug|fix|crash|panic|regression|failure)/.test(lower)) score += 70;
	if (/(api|interface|public|export)/.test(lower)) score += 50;
	if (/(user|client|customer)/.test(lower)) score += 40;
	if (/(deprecated|removed|delete)/.test(lower)) score += 35;
	return score;
}

export function validateTypeConsistency(
	type: CommitType,
	files: string[],
	options: { diffText?: string; summary?: string; details?: ConventionalDetail[] } = {},
): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const lowerFiles = files.map(file => file.toLowerCase());
	const hasDocs = lowerFiles.some(file => /\.(md|mdx|adoc|rst)$/.test(file));
	const hasTests = lowerFiles.some(
		file => /(^|\/)(test|tests|__tests__)(\/|$)/.test(file) || /(^|\/).*(_test|\.test|\.spec)\./.test(file),
	);
	const hasCI = lowerFiles.some(file => file.startsWith(".github/workflows/") || file.startsWith(".gitlab-ci"));
	const hasBuild = lowerFiles.some(file =>
		["cargo.toml", "package.json", "makefile"].some(candidate => file.endsWith(candidate)),
	);
	const hasPerfEvidence = lowerFiles.some(file => /(bench|benchmark|perf)/.test(file));
	const summary = options.summary?.toLowerCase() ?? "";
	const detailText = options.details?.map(detail => detail.text.toLowerCase()).join(" ") ?? "";
	const hasPerfKeywords = /(performance|optimiz|latency|throughput|benchmark)/.test(`${summary} ${detailText}`);

	switch (type) {
		case "docs":
			if (!hasDocs) errors.push("Docs commit should include documentation file changes");
			break;
		case "test":
			if (!hasTests) errors.push("Test commit should include test file changes");
			break;
		case "ci":
			if (!hasCI) errors.push("CI commit should include CI configuration changes");
			break;
		case "build":
			if (!hasBuild) errors.push("Build commit should include build-related files");
			break;
		case "refactor": {
			const hasNewFiles = options.diffText ? /\nnew file mode\s/m.test(options.diffText) : false;
			if (hasNewFiles) warnings.push("Refactor commit adds new files; consider feat if new functionality");
			break;
		}
		case "perf":
			if (!hasPerfEvidence && !hasPerfKeywords) {
				warnings.push("Perf commit lacks benchmark or performance keywords");
			}
			break;
		default:
			break;
	}

	return { errors, warnings };
}

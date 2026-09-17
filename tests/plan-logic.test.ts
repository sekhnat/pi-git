/**
 * pi-git tests — commit plan logic (topo order, lock files, trivial, fallback, validation).
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { computeDependencyOrder } from "../extensions/lib/commit/topo-sort.ts";
import { assignLockFilesToPlan, EXCLUDED_LOCK_FILES } from "../extensions/lib/commit/lock-files.ts";
import { detectTrivialChange } from "../extensions/lib/commit/trivial.ts";
import { generateFallbackProposal } from "../extensions/lib/commit/fallback.ts";
import { capDetails, normalizeSummary, validateAnalysis, validateScope, validateSummaryRules, validateTypeConsistency } from "../extensions/lib/commit/validation.ts";
import { extractScopeCandidates } from "../extensions/lib/commit/scope.ts";
import { DEFAULT_CONVENTIONAL_GENERATION_CONFIG } from "../extensions/lib/commit/config.ts";
import type { SplitCommitGroup } from "../extensions/lib/commit/types.ts";

function group(overrides: Partial<SplitCommitGroup>): SplitCommitGroup {
	return {
		changes: [],
		type: "feat",
		scope: null,
		summary: "added feature",
		details: [],
		issueRefs: [],
		dependencies: [],
		...overrides,
	};
}

test("computeDependencyOrder orders by dependencies", () => {
	const groups = [
		group({ dependencies: [1] }),
		group({ dependencies: [] }),
	];
	const order = computeDependencyOrder(groups);
	assert.deepEqual(order, [1, 0]);
});

test("computeDependencyOrder rejects cycles", () => {
	const groups = [
		group({ dependencies: [1] }),
		group({ dependencies: [0] }),
	];
	const order = computeDependencyOrder(groups);
	assert.ok("error" in order);
});

test("computeDependencyOrder rejects out-of-range dependencies", () => {
	const groups = [group({ dependencies: [5] })];
	const order = computeDependencyOrder(groups);
	assert.ok("error" in order);
});

test("assignLockFilesToPlan places lock files with their manifest's commit", () => {
	const plan = {
		commits: [
			group({ summary: "added docs", changes: [{ path: "README.md", kind: "all" as const }] }),
			group({ summary: "added deps", changes: [{ path: "package.json", kind: "all" as const }] }),
		],
		warnings: [],
	};
	assignLockFilesToPlan(plan, ["README.md", "package.json", "package-lock.json"]);
	assert.deepEqual(plan.commits[1]!.changes.map(c => c.path), ["package.json", "package-lock.json"]);
});

test("assignLockFilesToPlan falls back to the last commit", () => {
	const plan = {
		commits: [group({ summary: "a", changes: [{ path: "src/a.ts", kind: "all" as const }] })],
		warnings: [],
	};
	assignLockFilesToPlan(plan, ["src/a.ts", "Cargo.lock"]);
	assert.deepEqual(plan.commits[0]!.changes.map(c => c.path), ["src/a.ts", "Cargo.lock"]);
});

test("EXCLUDED_LOCK_FILES contains the common lock files", () => {
	assert.ok(EXCLUDED_LOCK_FILES.has("package-lock.json"));
	assert.ok(EXCLUDED_LOCK_FILES.has("Cargo.lock"));
	assert.ok(!EXCLUDED_LOCK_FILES.has("package.json"));
});

test("detectTrivialChange flags whitespace-only diffs as style", () => {
	const result = detectTrivialChange("+\n-  \n+ \t\n");
	assert.ok(result?.isTrivial);
	assert.equal(result.type, "style");
});

test("detectTrivialChange returns null for real changes", () => {
	const result = detectTrivialChange("+ added real content\n");
	assert.equal(result, null);
});

test("generateFallbackProposal infers type from files", () => {
	const proposal = generateFallbackProposal([{ path: "docs/guide.md", additions: 5, deletions: 0 }]);
	assert.equal(proposal.analysis.type, "docs");
	assert.ok(proposal.summary.length > 0);
});

test("validateSummaryRules enforces past-tense and length", () => {
	assert.equal(validateSummaryRules("added login flow").errors.length, 0);
	const present = validateSummaryRules("add login flow that is very long and goes past the limit of chars");
	assert.ok(present.errors.some(e => e.includes("past-tense")));
	const long = validateSummaryRules("x".repeat(80));
	assert.ok(long.errors.some(e => e.includes("exceeds")));
});

test("normalizeSummary strips redundant type prefix", () => {
	assert.equal(normalizeSummary("feat(api): added endpoint", "feat", "api"), "added endpoint");
	assert.equal(normalizeSummary("added endpoint", "feat", null), "added endpoint");
});

test("validateScope enforces lowercase two-segment scopes", () => {
	assert.ok(validateScope("api").valid);
	assert.ok(validateScope("api/v2").valid);
	assert.ok(!validateScope("API").valid);
	assert.ok(!validateScope("a/b/c").valid);
	assert.ok(!validateScope("bad scope").valid);
});

test("validateAnalysis enforces detail punctuation and length", () => {
	const ok = validateAnalysis({ scope: null, details: [{ text: "Ended the flaky retry.", userVisible: false }] });
	assert.ok(ok.valid);
	const bad = validateAnalysis({ scope: null, details: [{ text: "no period at end of this detail line", userVisible: false }] });
	assert.ok(!bad.valid);
});

test("capDetails caps to 6 items keeping high-scores", () => {
	const details = Array.from({ length: 9 }, (_, index) => ({
		text: index === 0 ? "Fixed security vulnerability in parser." : `Detail ${index}.`,
		userVisible: false,
	}));
	const capped = capDetails(details);
	assert.equal(capped.details.length, 6);
	assert.ok(capped.details.some(d => d.text.includes("security")));
});

test("validateTypeConsistency flags docs commit without doc files", () => {
	const result = validateTypeConsistency("docs", ["src/app.ts"], {});
	assert.ok(result.errors.some(e => e.includes("documentation")));
	const okResult = validateTypeConsistency("docs", ["README.md"], {});
	assert.equal(okResult.errors.length, 0);
});

test("extractScopeCandidates reports high-confidence scopes", () => {
	const result = extractScopeCandidates(
		[
			{ path: "src/api/routes.ts", additions: 40, deletions: 2 },
			{ path: "src/api/handlers.ts", additions: 20, deletions: 0 },
		],
		DEFAULT_CONVENTIONAL_GENERATION_CONFIG,
	);
	assert.ok(result.scopeCandidates.includes("api"));
});

test("extractScopeCandidates detects wide cross-cutting changes", () => {
	const result = extractScopeCandidates(
		[
			{ path: "a/one.ts", additions: 10, deletions: 0 },
			{ path: "b/two.ts", additions: 10, deletions: 0 },
			{ path: "c/three.ts", additions: 10, deletions: 0 },
			{ path: "d/four.ts", additions: 10, deletions: 0 },
		],
		DEFAULT_CONVENTIONAL_GENERATION_CONFIG,
	);
	assert.ok(result.isWide);
});

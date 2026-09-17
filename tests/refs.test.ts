/**
 * pi-git tests — repo ref parsing, search query composition, run references.
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	defaultGhHost,
	githubRepoSlugEquals,
	parseIssueUrl,
	parsePullRequestUrl,
	parsePositiveDecimalInt,
	parseRepoRef,
	repoFromUrl,
} from "../extensions/lib/gh/refs.ts";
import {
	buildSearchDateQualifier,
	composeSearchQuery,
	parseSearchDateBound,
	resolveSearchDateField,
	resolveSearchLimit,
} from "../extensions/lib/gh/ops/search.ts";
import { parseRunReference, resolveTailLimit } from "../extensions/lib/gh/ops/run-watch.ts";
import { ToolError } from "../extensions/lib/errors.ts";

test("parseRepoRef splits [host/]owner/repo", () => {
	assert.deepEqual(parseRepoRef("cli/cli"), { slug: "cli/cli" });
	assert.deepEqual(parseRepoRef("ghe.example.com/cli/cli"), { host: "ghe.example.com", slug: "cli/cli" });
	// More than two slashes is taken as a slug, not a ref.
	assert.deepEqual(parseRepoRef("a/b/c/d"), { slug: "a/b/c/d" });
});

test("repoFromUrl keeps the host when gh would not assume it", () => {
	assert.equal(repoFromUrl("https://github.com/cli/cli"), "cli/cli");
	assert.equal(repoFromUrl("https://ghe.example.com/cli/cli"), "ghe.example.com/cli/cli");
	assert.equal(repoFromUrl("not a url"), undefined);
});

test("repoFromUrl respects GH_HOST", () => {
	const previous = process.env.GH_HOST;
	process.env.GH_HOST = "ghe.example.com";
	try {
		assert.equal(repoFromUrl("https://github.com/cli/cli"), "github.com/cli/cli");
		// GH_HOST-folded: the ghe URL IS the default host now, so it collapses to a bare slug.
		assert.equal(repoFromUrl("https://ghe.example.com/cli/cli"), "cli/cli");
		assert.equal(defaultGhHost(), "ghe.example.com");
	} finally {
		if (previous === undefined) delete process.env.GH_HOST;
		else process.env.GH_HOST = previous;
	}
});

test("githubRepoSlugEquals compares hosts case-insensitively", () => {
	assert.ok(githubRepoSlugEquals("CLI/cli", "cli/CLI"));
	assert.ok(!githubRepoSlugEquals("ghe.example.com/cli/cli", "cli/cli"));
	assert.ok(!githubRepoSlugEquals(undefined, "cli/cli"));
});

test("parsePullRequestUrl extracts repo and number", () => {
	assert.deepEqual(parsePullRequestUrl("https://github.com/cli/cli/pull/123"), { repo: "github.com/cli/cli", prNumber: 123 });
	assert.deepEqual(parsePullRequestUrl("https://github.com/cli/cli/pull/123/files"), { repo: "github.com/cli/cli", prNumber: 123 });
	assert.deepEqual(parsePullRequestUrl("123"), {});
});

test("parseIssueUrl extracts repo and number", () => {
	assert.deepEqual(parseIssueUrl("https://github.com/cli/cli/issues/42"), { repo: "github.com/cli/cli", issueNumber: 42 });
});

test("parsePositiveDecimalInt rejects non-decimal shapes", () => {
	assert.equal(parsePositiveDecimalInt("12"), 12);
	assert.equal(parsePositiveDecimalInt("1e2"), undefined);
	assert.equal(parsePositiveDecimalInt("0x10"), undefined);
	assert.equal(parsePositiveDecimalInt("0"), undefined);
	assert.equal(parsePositiveDecimalInt("-3"), undefined);
});

test("parseSearchDateBound resolves relative durations, ISO dates, datetimes", () => {
	const now = new Date("2026-01-15T12:00:00.000Z");
	assert.equal(parseSearchDateBound("3d", now), "2026-01-12");
	assert.equal(parseSearchDateBound("2w", now), "2026-01-01");
	assert.equal(parseSearchDateBound("2026-01-01", now), "2026-01-01");
	assert.equal(parseSearchDateBound("2026-01-01T10:30:00Z", now), "2026-01-01T10:30:00Z");
	assert.throws(() => parseSearchDateBound("garbage", now), ToolError);
});

test("buildSearchDateQualifier composes created ranges", () => {
	const now = new Date("2026-01-15T00:00:00.000Z");
	assert.equal(buildSearchDateQualifier("created", "3d", undefined, now), "created:>=2026-01-12");
	assert.equal(buildSearchDateQualifier("created", "3d", "1d", now), "created:2026-01-12..2026-01-14");
	assert.equal(buildSearchDateQualifier("created", undefined, undefined, now), undefined);
});

test("resolveSearchDateField maps commands onto GitHub qualifiers", () => {
	assert.equal(resolveSearchDateField("issues", undefined), "created");
	assert.equal(resolveSearchDateField("issues", "updated"), "updated");
	assert.equal(resolveSearchDateField("commits", undefined), "committer-date");
	assert.equal(resolveSearchDateField("repos", "updated"), "pushed");
});

test("composeSearchQuery requires at least one part", () => {
	assert.equal(composeSearchQuery(["a", undefined, "b"]), "a b");
	assert.throws(() => composeSearchQuery([undefined, ""]), ToolError);
});

test("resolveSearchLimit caps at 50 and rejects non-positive", () => {
	assert.equal(resolveSearchLimit(undefined), 10);
	assert.equal(resolveSearchLimit(100), 50);
	assert.throws(() => resolveSearchLimit(0), ToolError);
	assert.throws(() => resolveSearchLimit(-1), ToolError);
});

test("parseRunReference accepts ids and URLs", () => {
	assert.deepEqual(parseRunReference("12345"), { runId: 12345 });
	// Upstream always host-qualifies run URLs (formatRepoRef without GH_HOST folding).
	assert.deepEqual(parseRunReference("https://github.com/cli/cli/actions/runs/99"), { repo: "github.com/cli/cli", runId: 99 });
	assert.throws(() => parseRunReference("abc"), ToolError);
});

test("resolveTailLimit caps at 200", () => {
	assert.equal(resolveTailLimit(undefined), 15);
	assert.equal(resolveTailLimit(500), 200);
	assert.throws(() => resolveTailLimit(0), ToolError);
});

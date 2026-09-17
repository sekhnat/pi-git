/**
 * pi-git tests — github tool json-mode envelope and payload builders (pure, no gh).
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildJsonResult,
	fileReadJsonPayload,
	prCheckoutJsonPayload,
	prCreateJsonPayload,
	prPushJsonPayload,
	repoViewJsonPayload,
	searchJsonPayload,
	runWatchJsonPayload,
} from "../extensions/lib/gh/json.ts";
import type { GhPrCheckoutSummary } from "../extensions/lib/gh/format.ts";
import type { GhRepoViewData } from "../extensions/lib/gh/types.ts";

test("buildJsonResult emits a compact { op, repo?, data } envelope", () => {
	const result = buildJsonResult("repo_view", { repo: "owner/repo", data: { name: "x" } });
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0]!.type, "text");
	const parsed = JSON.parse(result.content[0]!.text);
	assert.deepEqual(parsed, { op: "repo_view", repo: "owner/repo", data: { name: "x" } });
	// Compact serialization: no whitespace between tokens.
	assert.ok(!result.content[0]!.text.includes(": "));
	assert.ok(!result.content[0]!.text.includes(", "));
});

test("buildJsonResult omits repo when unknown and keeps the details channel", () => {
	const result = buildJsonResult("search_repos", { data: { items: [] }, details: { branch: "main" } });
	const parsed = JSON.parse(result.content[0]!.text);
	assert.equal("repo" in parsed, false);
	assert.deepEqual(parsed, { op: "search_repos", data: { items: [] } });
	assert.deepEqual(result.details, { branch: "main", sourceUrl: undefined });
});

test("repoViewJsonPayload falls back to nameWithOwner for the envelope repo", () => {
	const data: GhRepoViewData = { nameWithOwner: "can1357/oh-my-pi", url: "https://github.com/can1357/oh-my-pi" };
	const payload = repoViewJsonPayload(data);
	assert.equal(payload.repo, "can1357/oh-my-pi");
	assert.equal(payload.data, data);
	assert.deepEqual(repoViewJsonPayload({}).repo, undefined);
});

test("fileReadJsonPayload carries repo/branch/path/content and omits branch when unset", () => {
	const withBranch = fileReadJsonPayload({ repo: "o/r", branch: "dev", path: "src/a.ts", content: "hello" });
	assert.deepEqual(withBranch, { repo: "o/r", branch: "dev", path: "src/a.ts", content: "hello" });
	const withoutBranch = fileReadJsonPayload({ repo: "o/r", path: "src/a.ts", content: "hello" });
	assert.equal("branch" in withoutBranch, false);
	assert.deepEqual(withoutBranch, { repo: "o/r", path: "src/a.ts", content: "hello" });
});

test("searchJsonPayload mirrors the search API envelope and defaults missing totals", () => {
	const items = [{ number: 1 }, { number: 2 }];
	const full = searchJsonPayload({ totalCount: 97, incompleteResults: true, items });
	assert.deepEqual(full, { total_count: 97, incomplete_results: true, items });
	const defaulted = searchJsonPayload({ items });
	assert.deepEqual(defaulted, { total_count: 2, incomplete_results: false, items });
});

test("prCreateJsonPayload prefers view data and falls back to inputs", () => {
	const view = {
		number: 9,
		state: "OPEN",
		isDraft: false,
		baseRefName: "main",
		headRefName: "feature",
		url: "https://github.com/o/r/pull/9",
	};
	const fromView = prCreateJsonPayload({ url: view.url, prNumber: 9, data: view });
	assert.deepEqual(fromView, {
		number: 9,
		url: "https://github.com/o/r/pull/9",
		state: "OPEN",
		isDraft: false,
		baseRefName: "main",
		headRefName: "feature",
	});
	// Post-create view unavailable: input-derived fallbacks.
	const fromInputs = prCreateJsonPayload({ url: "https://github.com/o/r/pull/12", prNumber: 12, base: "main", head: "feat", draft: true });
	assert.deepEqual(fromInputs, {
		number: 12,
		url: "https://github.com/o/r/pull/12",
		state: undefined,
		isDraft: true,
		baseRefName: "main",
		headRefName: "feat",
	});
});

test("prCheckoutJsonPayload reuses the details checkout summaries", () => {
	const checkouts: GhPrCheckoutSummary[] = [
		{ prNumber: 9, url: "https://github.com/o/r/pull/9", branch: "pr-9", worktreePath: "/wt/9", remote: "origin", remoteBranch: "feat", reused: false },
		{ branch: "pr-10", worktreePath: "/wt/10", remote: "fork", remoteBranch: "main", reused: true },
	];
	const payload = prCheckoutJsonPayload(checkouts);
	assert.deepEqual(payload, { checkouts });
	assert.equal(payload.checkouts[0]!.worktreePath, "/wt/9");
	assert.equal(payload.checkouts[1]!.reused, true);
});

test("prPushJsonPayload wraps a single push target with the pushed headSha", () => {
	const payload = prPushJsonPayload({
		remote: "origin",
		remoteBranch: "feat",
		remoteUrl: "git@github.com:o/r.git",
		prUrl: "https://github.com/o/r/pull/9",
		maintainerCanModify: true,
		isCrossRepository: false,
		headSha: "abc123def",
	});
	assert.deepEqual(payload, {
		pushed: [
			{
				remote: "origin",
				remoteBranch: "feat",
				remoteUrl: "git@github.com:o/r.git",
				prUrl: "https://github.com/o/r/pull/9",
				maintainerCanModify: true,
				isCrossRepository: false,
			},
		],
		headSha: "abc123def",
	});
});

test("runWatchJsonPayload groups failed jobs and log files per run, without log tails", () => {
	const runs = [
		{
			id: 1,
			status: "completed",
			conclusion: "failure",
			url: "https://github.com/o/r/actions/runs/1",
			jobs: [
				{ id: 11, name: "build", conclusion: "failure" },
				{ id: 12, name: "test", conclusion: "success" },
			],
		},
		{
			id: 2,
			status: "completed",
			conclusion: "success",
			url: "https://github.com/o/r/actions/runs/2",
			jobs: [],
		},
	];
	const logFilesByRun = new Map([[1, ["/tmp/pi-git/run-1-build.log"]]]);
	const payload = runWatchJsonPayload({ runs, logFilesByRun, branch: "main", headSha: "deadbeef" });
	assert.deepEqual(payload, {
		runs: [
			{
				runId: 1,
				url: "https://github.com/o/r/actions/runs/1",
				status: "completed",
				conclusion: "failure",
				failedJobs: ["build"],
				logFiles: ["/tmp/pi-git/run-1-build.log"],
			},
			{
				runId: 2,
				url: "https://github.com/o/r/actions/runs/2",
				status: "completed",
				conclusion: "success",
				failedJobs: [],
				logFiles: [],
			},
		],
		branch: "main",
		headSha: "deadbeef",
	});
	// Meta omitted when unknown.
	const bare = runWatchJsonPayload({ runs: [], logFilesByRun: new Map() });
	assert.deepEqual(bare, { runs: [] });
});

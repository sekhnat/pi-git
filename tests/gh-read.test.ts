/**
 * pi-git tests — live read-only gh operations against public repositories.
 * Skips when the gh CLI is unavailable or not authenticated.
 */

import * as assert from "node:assert/strict";
import { before, skip, test } from "node:test";
import { executeRepoView } from "../extensions/lib/gh/ops/repo-view.ts";
import { executeFileRead } from "../extensions/lib/gh/ops/file-read.ts";
import { executeSearchRepos, executeSearchIssues } from "../extensions/lib/gh/ops/search.ts";
import { ghAvailable } from "../extensions/lib/gh/runner.ts";
import { spawnCapture } from "../extensions/lib/spawn.ts";

async function ghAuthenticated(): Promise<boolean> {
	if (!ghAvailable()) return false;
	const result = await spawnCapture("gh", ["auth", "status"], { cwd: process.cwd(), timeoutMs: 10_000 });
	return result.exitCode === 0;
}

let live = false;

before(async () => {
	live = await ghAuthenticated();
	if (!live) {
		skip("gh not available or not authenticated");
	}
});

test("repo_view renders the oh-my-pi repository", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeRepoView(process.cwd(), { op: "repo_view", repo: "can1357/oh-my-pi" }, undefined);
	const text = result.content[0]!.type === "text" ? result.content[0].text : "";
	assert.ok(text.includes("# can1357/oh-my-pi"), text.slice(0, 200));
	assert.ok(text.includes("URL: https://github.com/can1357/oh-my-pi"));
	assert.ok(result.details.sourceUrl);
});

test("file_read fetches a text file from a public repo", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeFileRead(
		process.cwd(),
		{ op: "file_read", repo: "can1357/oh-my-pi", path: "LICENSE" },
		undefined,
	);
	assert.ok(result.details.sourceUrl?.includes("oh-my-pi/blob"));
	const text = result.content[0]!.type === "text" ? result.content[0].text : "";
	assert.ok(text.includes("MIT License"));
});

test("search_repos finds oh-my-pi", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeSearchRepos(process.cwd(), { op: "search_repos", query: "oh-my-pi", limit: 5 }, undefined);
	const text = result.content[0]!.type === "text" ? result.content[0].text : "";
	assert.ok(text.includes("can1357/oh-my-pi"), text.slice(0, 200));
});

test("search_issues scopes by repo and date filter", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeSearchIssues(
		process.cwd(),
		{ op: "search_issues", repo: "can1357/oh-my-pi", query: "", since: "1y", limit: 5 },
		undefined,
	);
	const text = result.content[0]!.type === "text" ? result.content[0].text : "";
	assert.ok(text.includes("# GitHub issues search"));
});

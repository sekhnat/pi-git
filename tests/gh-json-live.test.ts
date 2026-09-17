/**
 * pi-git tests — live json-mode github operations against public repositories.
 * Skips when the gh CLI is unavailable or not authenticated.
 */

import * as assert from "node:assert/strict";
import { before, skip, test } from "node:test";
import { executeFileRead } from "../extensions/lib/gh/ops/file-read.ts";
import { executeRepoView } from "../extensions/lib/gh/ops/repo-view.ts";
import { executeSearchIssues, executeSearchPrs } from "../extensions/lib/gh/ops/search.ts";
import { ghAvailable } from "../extensions/lib/gh/runner.ts";
import { spawnCapture } from "../extensions/lib/spawn.ts";
import type { GithubJsonEnvelope } from "../extensions/lib/gh/json.ts";

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

function envelopeText(result: { content: Array<{ type: string; text?: string }> }): string {
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0]!.type, "text");
	return result.content[0]!.text!;
}

test("repo_view json envelope carries op, repo, and the repository payload", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeRepoView(process.cwd(), { op: "repo_view", repo: "can1357/oh-my-pi", format: "json" }, undefined);
	const envelope = JSON.parse(envelopeText(result)) as GithubJsonEnvelope<Record<string, unknown>>;
	assert.equal(envelope.op, "repo_view");
	assert.equal(envelope.repo, "can1357/oh-my-pi");
	assert.equal(envelope.data.nameWithOwner, "can1357/oh-my-pi");
	assert.equal(envelope.data.url, "https://github.com/can1357/oh-my-pi");
	// Details channel stays populated as in text mode.
	assert.equal(result.details.repo, "can1357/oh-my-pi");
	assert.ok(result.details.sourceUrl);
});

test("search_issues json payload mirrors the search envelope", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeSearchIssues(
		process.cwd(),
		{ op: "search_issues", repo: "can1357/oh-my-pi", query: "", since: "1y", limit: 5, format: "json" },
		undefined,
	);
	const envelope = JSON.parse(envelopeText(result)) as GithubJsonEnvelope<Record<string, unknown>>;
	assert.equal(envelope.op, "search_issues");
	assert.equal(envelope.repo, "can1357/oh-my-pi");
	assert.equal(typeof envelope.data.total_count, "number");
	assert.equal(typeof envelope.data.incomplete_results, "boolean");
	assert.ok(Array.isArray(envelope.data.items));
});

test("search_prs json payload carries normalized items", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeSearchPrs(
		process.cwd(),
		{ op: "search_prs", repo: "can1357/oh-my-pi", query: "", since: "3y", limit: 5, format: "json" },
		undefined,
	);
	const envelope = JSON.parse(envelopeText(result)) as GithubJsonEnvelope<Record<string, unknown>>;
	assert.equal(envelope.op, "search_prs");
	assert.ok(Array.isArray(envelope.data.items));
	const item = envelope.data.items[0] as Record<string, unknown> | undefined;
	if (item) {
		assert.ok("number" in item && "title" in item && "url" in item);
	}
});

test("file_read json returns decoded UTF-8 content for a text file", async (t) => {
	if (!live) return t.skip("gh unavailable");
	const result = await executeFileRead(
		process.cwd(),
		{ op: "file_read", repo: "can1357/oh-my-pi", path: "LICENSE", format: "json" },
		undefined,
	);
	const envelope = JSON.parse(envelopeText(result)) as GithubJsonEnvelope<Record<string, unknown>>;
	assert.equal(envelope.op, "file_read");
	assert.equal(envelope.repo, "can1357/oh-my-pi");
	assert.equal(envelope.data.path, "LICENSE");
	assert.ok(String(envelope.data.content).includes("MIT License"));
});

test("file_read json rejects images with a clear error pointing to text mode", async (t) => {
	if (!live) return t.skip("gh unavailable");
	await assert.rejects(
		executeFileRead(
			process.cwd(),
			{ op: "file_read", repo: "github/explore", path: "collections/clipboard-managers/clipboard-managers.png", format: "json" },
			undefined,
		),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /clipboard-managers\.png/);
			assert.match(error.message, /json mode cannot return image content/);
			assert.match(error.message, /format: "json"/);
			return true;
		},
	);
});

test("file_read json rejects non-UTF-8 binaries with a clear error", async (t) => {
	if (!live) return t.skip("gh unavailable");
	await assert.rejects(
		executeFileRead(
			process.cwd(),
			{ op: "file_read", repo: "google/fonts", path: "ofl/lato/Lato-Bold.ttf", format: "json" },
			undefined,
		),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /Lato-Bold\.ttf/);
			assert.match(error.message, /not valid UTF-8 text/);
			return true;
		},
	);
});

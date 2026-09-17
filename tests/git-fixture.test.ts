/**
 * pi-git tests — end-to-end commit machinery against a temp git repo:
 * staged-diff hunk splitting reproduces exactly the staged state, in topo order.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import * as git from "../extensions/lib/git/repo.ts";
import { executeCommitPlan, renderPlan } from "../extensions/lib/commit/plan.ts";
import { formatCommitMessage } from "../extensions/lib/commit/message.ts";
import type { CommitAgentState } from "../extensions/lib/commit/types.ts";

let repo = "";

before(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), "pi-git-fixture-"));
	await git.gitText(repo, ["init", "--initial-branch=main"]);
	await git.gitText(repo, ["config", "user.email", "test@example.com"]);
	await git.gitText(repo, ["config", "user.name", "Test"]);
	await fs.writeFile(
		path.join(repo, "app.ts"),
		Array.from({ length: 24 }, (_, i) => `line${i + 1}\n`).join(""),
	);
	await fs.writeFile(path.join(repo, "docs.md"), "# Docs\nold content\n");
	await git.stageAll(repo);
	await git.commitCreate(repo, "init: added initial files");

	// Two edits at opposite ends of the file land in SEPARATE hunks (>= 7 lines apart).
	const appLines = Array.from({ length: 24 }, (_, i) => `line${i + 1}\n`);
	appLines[0] = "line1-changed\n";
	appLines[23] = "line24-new\n";
	await fs.writeFile(path.join(repo, "app.ts"), appLines.join(""));
	await fs.writeFile(path.join(repo, "docs.md"), "# Docs\nnew content\n");
	await fs.writeFile(path.join(repo, "util.ts"), "export const util = 1;\n");
	await git.stageAll(repo);
});

after(async () => {
	await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
});

test("changedFiles/numstat/diffText see the staged state", async () => {
	const files = await git.changedFiles(repo, true);
	assert.deepEqual(files.sort(), ["app.ts", "docs.md", "util.ts"]);
	const statText = await git.numstatText(repo);
	assert.ok(statText.includes("app.ts"));
	const diff = await git.diffText(repo, { cached: true });
	assert.ok(diff.includes("diff --git a/app.ts b/app.ts"));
});

test("executeCommitPlan writes a topo-ordered split series", async () => {
	const analysisBase = { details: [], issueRefs: [] };
	const state: CommitAgentState = {
		splitProposal: {
			commits: [
				{
					// Depends on commit 1 (util.ts must exist first).
					changes: [{ path: "app.ts", kind: "lines", start: 1, end: 1 }],
					type: "fix",
					scope: null,
					summary: "fixed first line of app",
					...analysisBase,
					dependencies: [1],
				},
				{
					changes: [
						{ path: "util.ts", kind: "all" },
						{ path: "app.ts", kind: "lines", start: 24, end: 24 },
					],
					type: "feat",
					scope: null,
					summary: "added util helper",
					...analysisBase,
					dependencies: [],
				},
				{
					changes: [{ path: "docs.md", kind: "all" }],
					type: "docs",
					scope: null,
					summary: "updated documentation",
					...analysisBase,
					dependencies: [],
				},
			],
			warnings: [],
		},
	};

	const planText = renderPlan(state);
	assert.ok(planText.includes("Split plan — 3 commits:"));
	assert.ok(planText.includes("depends on 2"));
	const outcome = await executeCommitPlan(repo, state, { push: false });
	assert.equal(outcome.createdCommits, 3);

	const subjects = await git.logSubjects(repo, 4);
	// Topo order [feat(1), docs(2), fix(0)]; log is newest-first → fix, docs, feat.
	assert.equal(subjects[0], "fix: fixed first line of app");
	assert.equal(subjects[1], "docs: updated documentation");
	assert.equal(subjects[2], "feat: added util helper");
});

test("the working tree ends up exactly as staged (both app.ts hunks landed)", async () => {
	const appContent = await fs.readFile(path.join(repo, "app.ts"), "utf8");
	assert.ok(appContent.includes("line1-changed"));
	assert.ok(appContent.includes("line24-new"));
	// Everything committed; nothing left staged.
	const staged = await git.changedFiles(repo, true);
	assert.equal(staged.length, 0);
	const status = await git.gitText(repo, ["status", "--porcelain"]);
	assert.equal(status.trim().length, 0);
});

test("formatCommitMessage renders header and bullet body", () => {
	const message = formatCommitMessage(
		{ type: "feat", scope: "api", details: [{ text: "Added the endpoint.", userVisible: false }], issueRefs: [] },
		"added endpoint",
	);
	assert.equal(message, "feat(api): added endpoint\n\n- Added the endpoint.");
});

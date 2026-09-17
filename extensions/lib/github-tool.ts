/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderGithubCallSummary, type GhToolDetails } from "./gh/format.ts";
import { ghAvailable } from "./gh/runner.ts";
import { githubSchema } from "./gh/schema.ts";
import type { GithubInput } from "./gh/types.ts";
import { executeFileRead } from "./gh/ops/file-read.ts";
import { executeRepoView } from "./gh/ops/repo-view.ts";
import {
	executeSearchCode,
	executeSearchCommits,
	executeSearchIssues,
	executeSearchPrs,
	executeSearchRepos,
} from "./gh/ops/search.ts";
import { executePrCreate } from "./gh/ops/pr-create.ts";
import { executePrCheckout } from "./gh/ops/pr-checkout.ts";
import { executePrPush } from "./gh/ops/pr-push.ts";
import { executeRunWatch, type RunWatchContext } from "./gh/ops/run-watch.ts";

/**
 * The `github` tool description, ported from oh-my-pi's prompts/tools/github.md.
 * omp's issue:// and pr:// URI conventions (a TUI protocol feature) are omitted;
 * everything else is verbatim.
 */
const GITHUB_TOOL_DESCRIPTION = [
	"`gh` op wrapper: repos/files, PRs, search, checkout, push, Actions watch.",
	"",
	"<instruction>",
	"Select via `op`.",
	"- `repo`: `[host/]owner/repo`; qualify the host for a repo outside the checkout's own GitHub instance.",
	"- `repo_view`: omit `repo` → current checkout.",
	"- `file_read`: read `path` from `repo`; omit `repo` → current checkout, `branch` → default branch.",
	"- `pr_create`: `head` defaults current branch.",
	"- `pr_checkout`: PR(s) → dedicated git worktrees, never working tree; array `pr` batches multiple in one call.",
	"- `pr_push`: requires prior `op: pr_checkout`.",
	"- `search_issues`/`search_prs`/`search_commits`/`search_repos`: `query` optional with `since`/`until`; omit for date-only filter. `search_code`: `query` required; rejects `since`/`until`.",
	"- `search_*`: `repo` defaults current checkout's `owner/repo`; search elsewhere with `repo:`/`org:`/`user:` in `query`. `search_repos`: ignores `repo`; scope via `org:`/`language:` in `query`.",
	"- Boolean `AND`/`OR`/`NOT` combine text terms, not qualifiers; never place them between qualifiers.",
	"- `since`/`until`: relative `<n>` + `m`/`h`/`d`/`w`/`mo`/`y` (e.g. `3d`, `2w`), ISO date `YYYY-MM-DD`, or ISO datetime. `dateField: \"updated\"`: update time (issues/PRs), push time (repos), never creation.",
	"- `run_watch`: omit `run` → every run for current HEAD; `branch` defaults current. Fast-fails first job failure.",
	"</instruction>",
	"",
	"<output>",
	"Concise summary per op. `run_watch` failures save full logs to a temp file and report its path.",
	"`format: \"json\"` returns a machine-readable `{ op, repo?, data }` envelope instead of the rendered text.",
	"</output>",
	"",
	"<critical>",
	"GitHub-hosted repository file: MUST use `file_read`; NEVER `curl`/`wget`.",
	"</critical>",
].join("\n");

/** Register the single `github` tool on the main session (when gh is on PATH). */
export function registerGithubTool(pi: ExtensionAPI): boolean {
	if (!ghAvailable()) return false;

	pi.registerTool({
		name: "github",
		label: "GitHub",
		description: GITHUB_TOOL_DESCRIPTION,
		promptSnippet: "GitHub CLI ops — repo view, file read, PRs, search, Actions watch (gh wrapper)",
		promptGuidelines: [
			"Use github (not bash gh/git remote commands) for GitHub repository views, hosted file reads, PR operations, GitHub search, and Actions watching.",
		],
		parameters: githubSchema,

		// Executors consume the flat normalized input; the union schema is the
		// validation/check-time surface (Static<typeof githubSchema> is assignable
		// to it, and the exhaustive switch keeps narrowing params.op to never).
		async execute(_toolCallId, params: GithubInput, signal, onUpdate, ctx) {
			const runWatchContext: RunWatchContext = {
				cwd: ctx.cwd,
				onUpdate: update => {
						onUpdate?.({
						content: update.content as Array<{ type: "text"; text: string }>,
						details: update.details,
					});
				},
			};

			switch (params.op) {
				case "repo_view":
					return await executeRepoView(ctx.cwd, params, signal);
				case "file_read":
					return await executeFileRead(ctx.cwd, params, signal);
				case "pr_create":
					return await executePrCreate(ctx.cwd, params, signal);
				case "pr_checkout":
					return await executePrCheckout(ctx.cwd, params, signal);
				case "pr_push":
					return await executePrPush(ctx.cwd, params, signal);
				case "search_issues":
					return await executeSearchIssues(ctx.cwd, params, signal);
				case "search_prs":
					return await executeSearchPrs(ctx.cwd, params, signal);
				case "search_code":
					return await executeSearchCode(ctx.cwd, params, signal);
				case "search_commits":
					return await executeSearchCommits(ctx.cwd, params, signal);
				case "search_repos":
					return await executeSearchRepos(ctx.cwd, params, signal);
				case "run_watch":
					return await executeRunWatch(runWatchContext, params, signal);
				default: {
					const never: never = params.op;
					throw new Error(`unknown github op: ${String(never)}`);
				}
			}
		},

		renderCall(args) {
			const summary = args ? renderGithubCallSummary(args as Record<string, unknown>) : "";
			return new Text(`${(args as { op?: string } | undefined)?.op ?? "github"}${summary ? ` · ${summary}` : ""}`);
		},
	});
	return true;
}

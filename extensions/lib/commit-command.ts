/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * ADR-0005: the plan is confirmed before commits are written; headless runs
 * require --yes and otherwise degrade to a dry run.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as git from "./git/repo.ts";
import { runCommitAgentSession } from "./commit/agent.ts";
import { generateFallbackProposal } from "./commit/fallback.ts";
import { detectTrivialChange } from "./commit/trivial.ts";
import { renderPlan, executeCommitPlan } from "./commit/plan.ts";
import { parseNumstat } from "./git/diff.ts";
import type { CommitAgentState, CommitProposal } from "./commit/types.ts";

interface CommitArgs {
	push: boolean;
	dryRun: boolean;
	context?: string;
	model?: string;
	yes: boolean;
}

export function parseCommitArgs(raw: string): CommitArgs {
	const tokens = raw.split(/\s+/).filter(Boolean);
	const result: CommitArgs = { push: false, dryRun: false, yes: false };
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		switch (token) {
			case "--push":
				result.push = true;
				break;
			case "--dry-run":
				result.dryRun = true;
				break;
			case "--yes":
			case "-y":
				result.yes = true;
				break;
			case "--context": {
				const value = tokens[i + 1];
				if (value) {
					result.context = value;
					i += 1;
			}
				break;
			}
			case "--model": {
				const value = tokens[i + 1];
				if (value) {
					result.model = value;
					i += 1;
				}
				break;
			}
			default:
				break;
		}
	}
	return result;
}

async function resolveModel(ctx: ExtensionCommandContext, modelArg: string | undefined) {
	if (!modelArg) return { model: ctx.model, thinkingLevel: ctx.thinkingLevel };
	const [providerId, ...rest] = modelArg.split("/");
	const modelId = rest.length > 0 ? rest.join("/") : modelArg;
	for (const candidate of ctx.modelRegistry.getAvailable()) {
		if (candidate.id === modelId && (!providerId || candidate.provider === providerId || rest.length === 0)) {
				return { model: candidate, thinkingLevel: ctx.thinkingLevel };
		}
	}
	throw new Error(`model not found: ${modelArg}`);
}

export function registerCommitCommand(pi: ExtensionAPI): void {
	pi.registerCommand("commit", {
		description: "Analyze staged changes into atomic conventional commits (use --dry-run, --push, --context, --model, --yes)",
		getArgumentCompletions: (prefix: string) => {
			const flags = ["--dry-run", "--push", "--yes", "--context", "--model"];
			const items = flags.map(f => ({ value: f, label: f }));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseCommitArgs(args ?? "");
		const notify = (message: string) => ctx.ui.notify(message, "info");
		const fail = (message: string) => ctx.ui.notify(message, "error");

			if (!(await git.isGitRepo(ctx.cwd))) {
				fail("Not a git repository.");
			return;
		}

			// Stage everything when nothing is staged yet (upstream behavior).
			let staged = await git.changedFiles(ctx.cwd, true);
			if (staged.length === 0) {
				notify("No staged changes detected, staging all changes…");
			await git.stageAll(ctx.cwd);
			staged = await git.changedFiles(ctx.cwd, true);
		}
			if (staged.length === 0) {
				if (parsed.push) {
				notify("No changes to commit; pushing existing commits…");
				await git.pushUpstream(ctx.cwd).catch((error: Error) => fail(error.message));
				return;
			}
			fail("No changes to commit.");
			return;
		}

			const numstat = parseNumstat(await git.numstatText(ctx.cwd));
		const diff = await git.diffText(ctx.cwd, { cached: true });

			// Trivial fast path (whitespace/import-only changes).
			const trivial = detectTrivialChange(diff);
			let state: CommitAgentState;
			if (trivial) {
				notify(`Detected trivial change: ${trivial.summary}`);
				const proposal: CommitProposal = {
					analysis: { type: trivial.type, scope: null, details: [], issueRefs: [] },
					summary: trivial.summary,
					warnings: [],
				};
				state = { proposal, diffText: diff };
			} else {
				let model: import("@earendil-works/pi-ai").Model<any> | undefined;
			let thinkingLevel: import("@earendil-works/pi-agent-core").ThinkingLevel | undefined;
				try {
					({ model, thinkingLevel } = await resolveModel(ctx, parsed.model));
				} catch (error) {
					fail(error instanceof Error ? error.message : String(error));
					return;
				}
				if (!model) {
					fail("No model available for the commit agent.");
					return;
				}

				notify("Starting commit agent…");
				try {
					state = await runCommitAgentSession({
						cwd: ctx.cwd,
						model,
						thinkingLevel,
						userContext: parsed.context,
						diffText: diff,
						onProgress: message => ctx.ui.setStatus("pi-git", `commit: ${message}`),
						signal: ctx.signal,
					});
				} catch (error) {
					if (process.env.PI_COMMIT_NO_FALLBACK?.toLowerCase() === "true") {
						fail(`Agent error: ${error instanceof Error ? error.message : String(error)}`);
						return;
					}
					notify(`Agent error, using fallback commit generation…`);
					state = { proposal: generateFallbackProposal(numstat), diffText: diff };
				}
			}

			if (!state.proposal && !state.splitProposal) {
				notify("Agent did not provide proposal, using fallback…");
				state.proposal = generateFallbackProposal(numstat);
			}

			const planText = renderPlan(state);
			pi.appendEntry("pi-git-commit-plan", { text: planText, dryRun: parsed.dryRun });

			if (parsed.dryRun) {
				notify("Dry run — no commits written.");
				return;
			}

			// ADR-0005: confirm before writing history; headless needs --yes.
			if (ctx.hasUI) {
				const commitCount = state.splitProposal ? state.splitProposal.commits.length : 1;
				const confirmed = await ctx.ui.confirm(
					`Create ${commitCount} commit${commitCount === 1 ? "" : "s"}?`,
					"The plan above will be committed to the current branch.",
				);
				if (!confirmed) {
					notify("Commit aborted by user.");
					return;
				}
			} else if (!parsed.yes) {
				fail("Refusing to commit without a UI. Pass --yes to execute, or use --dry-run.");
				return;
			}

			try {
				const outcome = await executeCommitPlan(ctx.cwd, state, { push: parsed.push });
			notify(outcome.message);
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
		}
		},
	});
}

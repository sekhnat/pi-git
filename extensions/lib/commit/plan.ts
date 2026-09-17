/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Plan rendering and execution (upstream: agentic/index.ts runSingleCommit /
 * runSplitCommit). The saved staged diff is re-applied to the index per commit
 * in topo order, so hunk-level splits reproduce exactly the staged state even
 * when the working tree has further unstaged edits.
 */

import { ToolError } from "../errors.ts";
import * as git from "../git/repo.ts";
import { stageHunks } from "../git/stage.ts";
import { assignLockFilesToPlan } from "./lock-files.ts";
import { formatCommitMessage } from "./message.ts";
import { computeDependencyOrder } from "./topo-sort.ts";
import type { CommitAgentState, ConventionalAnalysis, FileChange, SplitCommitPlan } from "./types.ts";

function formatFileChangeSummary(change: FileChange): string {
	if (change.kind === "all") return `${change.path} (all)`;
	if (change.kind === "indices") return `${change.path} (hunks ${change.indices.join(", ")})`;
	return `${change.path} (lines ${change.start}-${change.end})`;
}

/** Render the agent's proposal as a displayable plan. */
export function renderPlan(state: CommitAgentState): string {
	if (state.proposal) {
		const { proposal } = state;
		const warningBlock =
			proposal.warnings.length > 0
				? `\nWarnings:\n${proposal.warnings.map(w => `- ${w}`).join("\n")}`
				: "";
		return `Commit 1:\n${formatCommitMessage(proposal.analysis, proposal.summary)}${warningBlock}`;
	}
	const plan = state.splitProposal;
	if (!plan) return "(no proposal)";
	const warningBlock =
		plan.warnings.length > 0 ? `\nWarnings:\n${plan.warnings.map(w => `- ${w}`).join("\n")}` : "";
	const sections = plan.commits.map((commit, index) => {
		const analysis: ConventionalAnalysis = {
			type: commit.type,
			scope: commit.scope,
			details: commit.details,
			issueRefs: commit.issueRefs,
		};
		const message = formatCommitMessage(analysis, commit.summary);
		const changeSummary = commit.changes.map(change => formatFileChangeSummary(change)).join(", ");
		const deps = commit.dependencies.length > 0 ? ` (depends on ${commit.dependencies.map(d => d + 1).join(", ")})` : "";
		return `Commit ${index + 1}:${deps}\n${message}\nChanges: ${changeSummary}`;
	});
	return `Split plan — ${plan.commits.length} commits:\n\n${sections.join("\n\n")}${warningBlock}`;
}

export interface CommitPlanOutcome {
	message: string;
	createdCommits: number;
}

/** Execute the agent's proposal: one commit, or a topo-ordered split series. */
export async function executeCommitPlan(
	cwd: string,
	state: CommitAgentState,
	options: { push: boolean },
): Promise<CommitPlanOutcome> {
	if (state.proposal) {
		const { proposal } = state;
		if (proposal.warnings.length > 0) {
			// Warnings were already displayed with the plan.
		}
		const message = formatCommitMessage(proposal.analysis, proposal.summary);
		try {
			await git.commitCreate(cwd, message);
		} catch (error) {
			throw new ToolError((error as Error).message);
		}
		if (options.push) await git.pushUpstream(cwd);
		return {
			message: options.push ? "Commit created and pushed." : `Commit created: ${proposal.summary}`,
			createdCommits: 1,
		};
	}

	const plan = state.splitProposal;
	if (!plan) throw new ToolError("Commit agent did not provide a proposal.");
	const created = await runSplitCommit(cwd, plan);
	if (options.push) await git.pushUpstream(cwd);
	return {
		message: options.push
			? `Created ${created} split commits and pushed.`
			: `Created ${created} split commits.`,
		createdCommits: created,
	};
}

async function runSplitCommit(cwd: string, plan: SplitCommitPlan): Promise<number> {
	const stagedFiles = await git.changedFiles(cwd, true);
	assignLockFilesToPlan(plan, stagedFiles);
	const plannedFiles = new Set(plan.commits.flatMap(commit => commit.changes.map(change => change.path)));
	const missingFiles = stagedFiles.filter(file => !plannedFiles.has(file));
	if (missingFiles.length > 0) {
		throw new ToolError(`Split commit plan missing staged files: ${missingFiles.join(", ")}`);
	}

	const order = computeDependencyOrder(plan.commits);
	if ("error" in order) {
		throw new ToolError(order.error);
	}

	const stagedDiff = await git.diffText(cwd, { cached: true, binary: true });
	await git.unstageAll(cwd);
	let created = 0;
	try {
		for (const commitIndex of order) {
			const commit = plan.commits[commitIndex]!;
			await stageHunks(cwd, commit.changes, stagedDiff);
			const analysis: ConventionalAnalysis = {
				type: commit.type,
				scope: commit.scope,
				details: commit.details,
				issueRefs: commit.issueRefs,
			};
			const message = formatCommitMessage(analysis, commit.summary);
			try {
				await git.commitCreate(cwd, message);
			} catch (error) {
				const stagedNow = await git.changedFiles(cwd, true);
				throw new ToolError(
					`${(error as Error).message}\n  ${created} of ${order.length} commits created; ${stagedNow.length} file(s) remain staged. No changes were lost.`,
				);
			}
			created += 1;
			await git.unstageAll(cwd);
		}
	} finally {
		// Leave nothing half-staged on any exit path.
		await git.unstageAll(cwd).catch(() => {});
	}
	return created;
}

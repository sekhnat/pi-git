/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { ToolError } from "../../errors.ts";
import { configGet, currentBranch, push, refExists, remoteUrl, resolveRef } from "../../git/repo.ts";
import { buildTextResult, pushLine, type GhToolDetails } from "../format.ts";
import { buildJsonResult, prPushJsonPayload } from "../json.ts";
import { normalizeOptionalString, requireCurrentGitBranch } from "../refs.ts";
import { requireGitRepoRoot, toLocalBranchRef } from "./pr-checkout.ts";
import type { GithubInput } from "../types.ts";

export interface PrBranchPushTarget {
	remoteName: string;
	remoteBranch: string;
	remoteUrl?: string;
	prUrl?: string;
	maintainerCanModify?: boolean;
	isCrossRepository: boolean;
}

export async function resolvePrBranchPushTarget(
	repoRoot: string,
	localBranch: string,
	signal?: AbortSignal,
): Promise<PrBranchPushTarget> {
	const configPrefix = `branch.${localBranch}.`;
	const [headRef, pushRemote, remote, prUrl, maintainerCanModifyValue, isCrossRepositoryValue] = await Promise.all([
		configGet(repoRoot, `${configPrefix}pigPrHeadRef`, signal),
		configGet(repoRoot, `${configPrefix}pushRemote`, signal),
		configGet(repoRoot, `${configPrefix}remote`, signal),
		configGet(repoRoot, `${configPrefix}pigPrUrl`, signal),
		configGet(repoRoot, `${configPrefix}pigPrMaintainerCanModify`, signal),
		configGet(repoRoot, `${configPrefix}pigPrIsCrossRepository`, signal),
	]);
	if (!headRef) {
		throw new ToolError(`branch ${localBranch} has no PR push metadata; check it out via op: pr_checkout first`);
	}

	const remoteName = pushRemote ?? remote;
	if (!remoteName) {
		throw new ToolError(`branch ${localBranch} has no configured push remote`);
	}

	return {
		remoteName,
		remoteBranch: headRef,
		prUrl: prUrl ?? undefined,
		maintainerCanModify:
			maintainerCanModifyValue == null
				? undefined
				: ["1", "true", "yes", "on"].includes(maintainerCanModifyValue.toLowerCase()),
		isCrossRepository: ["1", "true", "yes", "on"].includes((isCrossRepositoryValue ?? "").toLowerCase()),
	};
}

export function formatPrPushResult(options: {
	localBranch: string;
	remoteName: string;
	remoteBranch: string;
	remoteUrl?: string;
	prUrl?: string;
	forceWithLease: boolean;
}): string {
	const lines: string[] = ["# Pushed Pull Request Branch", ""];
	pushLine(lines, "Local branch", options.localBranch);
	pushLine(lines, "Remote", options.remoteName);
	pushLine(lines, "Remote branch", options.remoteBranch);
	pushLine(lines, "Remote URL", options.remoteUrl);
	pushLine(lines, "PR", options.prUrl);
	pushLine(lines, "Force with lease", options.forceWithLease);
	lines.push("");
	lines.push(`Pushed ${options.localBranch} to ${options.remoteName}:${options.remoteBranch}.`);
	return lines.join("\n").trim();
}

export async function executePrPush(
	cwd: string,
	params: GithubInput,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: GhToolDetails }> {
	const repoRoot = await requireGitRepoRoot(cwd, signal);
	const localBranch = normalizeOptionalString(params.branch) ?? (await requireCurrentGitBranch(repoRoot, signal));
	const refExistsValue = await refExists(repoRoot, toLocalBranchRef(localBranch), signal);
	if (!refExistsValue) {
		throw new ToolError(`local branch ${localBranch} does not exist`);
	}

	const target = await resolvePrBranchPushTarget(repoRoot, localBranch, signal);
	const branchNow = await currentBranch(repoRoot, signal);
	const sourceRef = branchNow === localBranch ? "HEAD" : toLocalBranchRef(localBranch);
	const refspec = `${sourceRef}:refs/heads/${target.remoteBranch}`;
	await push(repoRoot, { refspec, remote: target.remoteName, forceWithLease: params.forceWithLease }, signal);

	const resolvedRemoteUrl = (await remoteUrl(repoRoot, target.remoteName, signal)) ?? undefined;
	if (params.format === "json") {
		// Post-push resolution: the pushed local branch now points at the pushed SHA.
		const headSha = (await resolveRef(repoRoot, toLocalBranchRef(localBranch), signal)) ?? undefined;
		return buildJsonResult("pr_push", {
			data: prPushJsonPayload({
				remote: target.remoteName,
				remoteBranch: target.remoteBranch,
				remoteUrl: resolvedRemoteUrl,
				prUrl: target.prUrl,
				maintainerCanModify: target.maintainerCanModify,
				isCrossRepository: target.isCrossRepository,
				headSha,
			}),
			details: { branch: localBranch, remote: target.remoteName, remoteBranch: target.remoteBranch },
			sourceUrl: target.prUrl,
		});
	}
	return buildTextResult(
		formatPrPushResult({
			localBranch,
			remoteName: target.remoteName,
			remoteBranch: target.remoteBranch,
			remoteUrl: resolvedRemoteUrl,
			prUrl: target.prUrl,
			forceWithLease: params.forceWithLease ?? false,
		}),
		target.prUrl,
		{ branch: localBranch, remote: target.remoteName, remoteBranch: target.remoteBranch },
	);
}

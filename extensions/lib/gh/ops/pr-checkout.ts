/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * PR checkouts land in dedicated git worktrees — never the working tree.
 * Worktrees live under ~/.cache/pi-git/worktrees (omp uses its own data dir).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ToolError, throwIfAborted } from "../../errors.ts";
import {
	createBranch,
	configGet,
	configSet,
	createBranch as gitCreateBranch,
	fetchRef,
	primaryRepoRoot,
	refExists,
	remoteAdd,
	remoteList,
	remoteUrl,
	repoRoot,
	resolveRef,
	worktreeAdd,
	worktreeList,
} from "../../git/repo.ts";
import { formatShortSha, pushLine, type GhPrCheckoutSummary, type GhToolDetails } from "../format.ts";
import {
	appendRepoFlag,
	formatRepoRef,
	normalizeOptionalString,
	normalizePrIdentifierList,
	normalizeText,
	parsePullRequestUrl,
	parseRepoRef,
	requireNonEmpty,
} from "../refs.ts";
import { ghJson } from "../runner.ts";
import type { GhPrViewData, GhRepoViewData, GithubInput } from "../types.ts";
import { buildTextResult } from "../format.ts";

export const GH_PR_CHECKOUT_FIELDS = [
	"baseRefName",
	"headRefName",
	"headRefOid",
	"headRepository",
	"headRepositoryOwner",
	"isCrossRepository",
	"maintainerCanModify",
	"number",
	"title",
	"url",
];
const GH_REPO_CLONE_FIELDS = ["nameWithOwner", "sshUrl", "url"];
const PR_FETCH_TIMEOUT_MS = 30 * 60 * 1000;

/** Per-repo in-process lock: worktrees of one primary repo share .git state. */
const repoLocks = new Map<string, Promise<unknown>>();
async function withRepoLock<T>(repoRootPath: string, fn: () => Promise<T>): Promise<T> {
	const previous = repoLocks.get(repoRootPath) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(fn);
	repoLocks.set(repoRootPath, run.catch(() => {}));
	return run;
}

export function sanitizeRemoteName(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/g, "")
		.replace(/-+$/g, "");
	return sanitized.length > 0 ? `fork-${sanitized}` : "fork";
}

export const WORKTREE_PATH_MAX_SUFFIX = 100;

export function toLocalBranchRef(value: string): string {
	return `refs/heads/${value}`;
}

export async function requireGitRepoRoot(cwd: string, signal?: AbortSignal): Promise<string> {
	throwIfAborted(signal);
	const root = await repoRoot(cwd, signal);
	if (!root) throw new ToolError("Current git repository is unavailable.");
	return root;
}

export function worktreesDir(): string {
	const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
	return path.join(base, "pi-git", "worktrees");
}

function hashPath(value: string): string {
	return crypto.createHash("sha1").update(value).digest("hex").slice(0, 7);
}

export function prWorktreePath(prNumber: number, primaryRoot: string): string {
	return path.join(worktreesDir(), `${prNumber}-${hashPath(primaryRoot)}`);
}

export async function resolveAvailableWorktreePath(
	basePath: string,
	existingWorktrees: Array<{ path: string; branch: string | null }>,
): Promise<string> {
	const registered = new Set(existingWorktrees.map(entry => path.resolve(entry.path)));
	for (let attempt = 0; attempt < WORKTREE_PATH_MAX_SUFFIX; attempt += 1) {
		const candidate = attempt === 0 ? basePath : `${basePath}-${attempt + 1}`;
		const normalized = path.resolve(candidate);
		if (registered.has(normalized)) continue;
		try {
			await fs.stat(normalized);
		} catch (error) {
			if ((error as { code?: string }).code === "ENOENT") return candidate;
			throw error;
		}
	}
	throw new ToolError(`could not find an unused worktree path under ${basePath} (tried ${WORKTREE_PATH_MAX_SUFFIX} suffixes)`);
}

export function selectPrCloneUrl(originUrl: string | undefined, repo: Pick<GhRepoViewData, "url" | "sshUrl">): string {
	if (originUrl?.startsWith("http://") || originUrl?.startsWith("https://")) {
		return normalizeOptionalString(repo.url) ?? normalizeOptionalString(repo.sshUrl) ?? "";
	}
	return normalizeOptionalString(repo.sshUrl) ?? normalizeOptionalString(repo.url) ?? "";
}

async function ensurePrRemote(
	repoRootPath: string,
	data: GhPrViewData,
	signal?: AbortSignal,
): Promise<{ name: string; url: string }> {
	if (!data.isCrossRepository) {
		const originUrl = await remoteUrl(repoRootPath, "origin", signal);
		if (!originUrl) throw new ToolError("origin remote is unavailable for this repository.");
		return { name: "origin", url: originUrl };
	}

	const headRepository = requireNonEmpty(data.headRepository?.nameWithOwner, "head repository");
	const pullRepo = parsePullRequestUrl(data.url).repo;
	const pullHost = pullRepo ? parseRepoRef(pullRepo).host : undefined;
	const repoSummary = await ghJson<GhRepoViewData>(
		repoRootPath,
		["repo", "view", formatRepoRef(pullHost, headRepository), "--json", GH_REPO_CLONE_FIELDS.join(",")],
		signal,
		{ repoProvided: true },
	);
	const originUrl = await remoteUrl(repoRootPath, "origin", signal);
	const remoteUrlValue = selectPrCloneUrl(originUrl ?? undefined, repoSummary);
	if (!remoteUrlValue) throw new ToolError(`Could not determine a clone URL for ${headRepository}.`);

	const remotes = new Map<string, string>();
	for (const remoteName of await remoteList(repoRootPath, signal)) {
		const url = await remoteUrl(repoRootPath, remoteName, signal);
		if (url) remotes.set(remoteName, url);
	}
	for (const [remoteName, url] of remotes) {
		if (url === remoteUrlValue) return { name: remoteName, url };
	}

	const preferredRemoteName = sanitizeRemoteName(data.headRepositoryOwner?.login ?? headRepository.split("/")[0] ?? "fork");
	let remoteName = preferredRemoteName;
	let suffix = 2;
	while (remotes.has(remoteName)) {
		remoteName = `${preferredRemoteName}-${suffix}`;
		suffix += 1;
	}

	await remoteAdd(repoRootPath, remoteName, remoteUrlValue, signal);
	return { name: remoteName, url: remoteUrlValue };
}

export interface PrCheckoutOptions {
	prRef: string | undefined;
	repo: string | undefined;
	force: boolean;
}

export interface PrCheckoutOutcome {
	data: GhPrViewData;
	localBranch: string;
	worktreePath: string;
	remoteName: string;
	remoteUrl: string;
	headRefName: string;
	reused: boolean;
}

export function formatPrCheckoutResult(outcome: PrCheckoutOutcome): string {
	const { data, localBranch, worktreePath, remoteName, remoteUrl, reused } = outcome;
	const lines: string[] = [
		reused ? `# Pull Request #${data.number ?? "?"} Worktree` : `# Checked Out Pull Request #${data.number ?? "?"}`,
		"",
	];
	pushLine(lines, "Title", data.title ?? undefined);
	pushLine(lines, "URL", data.url);
	pushLine(lines, "Base", data.baseRefName);
	pushLine(lines, "Head", data.headRefName);
	pushLine(lines, "Local branch", localBranch);
	pushLine(lines, "Worktree", worktreePath);
	pushLine(lines, "Remote", remoteName);
	pushLine(lines, "Remote URL", remoteUrl);
	pushLine(lines, "Cross repository", data.isCrossRepository);
	pushLine(lines, "Maintainer can modify", data.maintainerCanModify);
	lines.push("");
	lines.push(
		reused
			? "Reused the existing PR worktree."
			: "Created a dedicated worktree for this PR and configured the local branch to push back to the PR head branch.",
	);
	return lines.join("\n").trim();
}

export async function checkoutPullRequest(
	cwd: string,
	signal: AbortSignal | undefined,
	options: PrCheckoutOptions,
): Promise<PrCheckoutOutcome> {
	const { prRef, repo, force } = options;
	if (prRef?.startsWith("-")) {
		throw new ToolError(`invalid PR identifier: ${prRef}. Pass a PR number, URL, or branch name.`);
	}
	const args = ["pr", "view"];
	if (prRef) args.push(prRef);
	appendRepoFlag(args, repo, prRef);
	args.push("--json", GH_PR_CHECKOUT_FIELDS.join(","));

	const data = await ghJson<GhPrViewData>(cwd, args, signal, {
		repoProvided: Boolean(repo),
	});
	const prNumber = data.number;
	if (typeof prNumber !== "number") {
		throw new ToolError("GitHub CLI did not return a pull request number.");
	}

	const headRefName = requireNonEmpty(data.headRefName, "head branch");
	const headRefOid = requireNonEmpty(data.headRefOid, "head commit");
	const repoRootPath = await requireGitRepoRoot(cwd, signal);
	const primaryRoot = await primaryRepoRoot(repoRootPath, signal);
	const localBranch = `pr-${prNumber}`;
	const worktreePath = prWorktreePath(prNumber, primaryRoot);

	// Every git mutation against repoRoot from here on runs under the per-repo
	// lock: worktrees of the same primary repo share .git/config and metadata,
	// and concurrent callers would lose git's own lock races.
	return withRepoLock(repoRootPath, async () => {
		const existingWorktrees = await worktreeList(repoRootPath, signal);
		const existingWorktree = existingWorktrees.find(entry => entry.branch === toLocalBranchRef(localBranch));

		const remote = await ensurePrRemote(repoRootPath, data, signal);
		await fetchRef(repoRootPath, remote.name, headRefName, PR_FETCH_TIMEOUT_MS, signal);

		if (!existingWorktree) {
			const localBranchRef = toLocalBranchRef(localBranch);
			const localBranchExists = await refExists(repoRootPath, localBranchRef, signal);
			if (localBranchExists) {
				const existingOid = await resolveRef(repoRootPath, localBranchRef, signal);
				if (existingOid !== headRefOid) {
					if (!force) {
						throw new ToolError(
							`local branch ${localBranch} already exists at ${formatShortSha(existingOid ?? undefined) ?? existingOid ?? "unknown commit"}; pass force=true to reset it`,
						);
					}
					await gitCreateBranch(repoRootPath, localBranch, `refs/remotes/${remote.name}/${headRefName}`, true, signal);
				}
			} else {
				await gitCreateBranch(repoRootPath, localBranch, `refs/remotes/${remote.name}/${headRefName}`, false, signal);
			}
		}

		const configPrefix = `branch.${localBranch}.`;
		await configSet(repoRootPath, `${configPrefix}remote`, remote.name, signal);
		await configSet(repoRootPath, `${configPrefix}merge`, `refs/heads/${headRefName}`, signal);
		await configSet(repoRootPath, `${configPrefix}pushRemote`, remote.name, signal);
		// pi-git metadata for op: pr_push
		await configSet(repoRootPath, `${configPrefix}pigPrHeadRef`, headRefName, signal);
		await configSet(repoRootPath, `${configPrefix}pigPrUrl`, data.url ?? "", signal);
		await configSet(repoRootPath, `${configPrefix}pigPrIsCrossRepository`, String(Boolean(data.isCrossRepository)), signal);
		await configSet(repoRootPath, `${configPrefix}pigPrMaintainerCanModify`, String(Boolean(data.maintainerCanModify)), signal);

		let finalWorktreePath = existingWorktree?.path ?? worktreePath;
		if (!existingWorktree) {
			finalWorktreePath = await resolveAvailableWorktreePath(worktreePath, existingWorktrees);
			await fs.mkdir(path.dirname(finalWorktreePath), { recursive: true });
			await worktreeAdd(repoRootPath, finalWorktreePath, localBranch, signal);
		}
		const resolvedWorktreePath = await fs.realpath(finalWorktreePath);

		return {
			data,
			localBranch,
			worktreePath: resolvedWorktreePath,
			remoteName: remote.name,
			remoteUrl: remote.url,
			headRefName,
			reused: Boolean(existingWorktree),
		};
	});
}

export function outcomeToSummary(outcome: PrCheckoutOutcome): GhPrCheckoutSummary {
	return {
		prNumber: typeof outcome.data.number === "number" ? outcome.data.number : undefined,
		url: outcome.data.url ?? undefined,
		branch: outcome.localBranch,
		worktreePath: outcome.worktreePath,
		remote: outcome.remoteName,
		remoteBranch: outcome.headRefName,
		reused: outcome.reused,
	};
}

export function joinSections(sections: string[]): string[] {
	return sections.flatMap((section, idx) => (idx === 0 ? [section] : ["", "---", "", section]));
}

export async function executePrCheckout(
	cwd: string,
	params: GithubInput,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: GhToolDetails }> {
	const repo = normalizeOptionalString(params.repo);
	const force = params.force ?? false;
	const prList = normalizePrIdentifierList(params.pr);
	const prRefs = prList.length > 0 ? prList : [undefined];
	const isMulti = prRefs.length > 1;

	const settled = await Promise.allSettled(
		prRefs.map(prRef => checkoutPullRequest(cwd, signal, { prRef, repo, force })),
	);
	const outcomes: PrCheckoutOutcome[] = [];
	const failures: Array<{ prRef: string | undefined; reason: unknown }> = [];
	for (let i = 0; i < settled.length; i++) {
		const entry = settled[i];
		if (entry.status === "fulfilled") outcomes.push(entry.value);
		else failures.push({ prRef: prRefs[i], reason: entry.reason });
	}
	if (failures.length > 0) {
		throwIfAborted(signal);
		const failureLines = failures.map(
			f => `- ${f.prRef ?? "(current branch)"}: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`,
		);
		if (outcomes.length === 0) {
			if (failures.length === 1) throw failures[0]!.reason;
			throw new ToolError(`all ${failures.length} PR checkouts failed:\n${failureLines.join("\n")}`);
		}
		// Partial success: report the worktrees that did get created.
		const sections = outcomes.map(formatPrCheckoutResult);
		const header = `# ${outcomes.length}/${settled.length} Pull Request Worktrees checked out (${failures.length} failed)`;
		const text = [header, "", ...joinSections(sections), "", "## Failed", ...failureLines].join("\n").trim();
		return buildTextResult(text, undefined, {
			repo,
			checkouts: outcomes.map(outcomeToSummary),
		});
	}

	if (!isMulti) {
		const [outcome] = outcomes;
		return buildTextResult(formatPrCheckoutResult(outcome), outcome.data.url, {
			repo: repo ?? outcome.data.headRepository?.nameWithOwner,
			branch: outcome.localBranch,
			worktreePath: outcome.worktreePath,
			remote: outcome.remoteName,
			remoteBranch: outcome.headRefName,
			checkouts: [outcomeToSummary(outcome)],
		});
	}

	const sections = outcomes.map(formatPrCheckoutResult);
	const reusedCount = outcomes.reduce((acc, o) => acc + (o.reused ? 1 : 0), 0);
	const newCount = outcomes.length - reusedCount;
	const headerParts: string[] = [];
	if (newCount > 0) headerParts.push(`${newCount} checked out`);
	if (reusedCount > 0) headerParts.push(`${reusedCount} reused`);
	const header = `# ${outcomes.length} Pull Request Worktrees (${headerParts.join(", ")})`;
	const text = [header, "", ...joinSections(sections)].join("\n").trim();

	return buildTextResult(text, undefined, {
		repo,
		checkouts: outcomes.map(outcomeToSummary),
	});
}

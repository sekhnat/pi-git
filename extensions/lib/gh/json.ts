/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * JSON output mode (opt-in via `format: "json"`): a stable per-op envelope on
 * the content channel for machine consumers (fabric programs). Payloads reuse
 * the exact internal shapes the text renderers consume — see design D1–D3 of
 * the fabric-compat change. Text mode is untouched; failures are never
 * enveloped and keep the existing error channel.
 */

import type { GhPrCheckoutSummary, GhToolDetails } from "./format.ts";
import { isFailedJob, type GhRunSnapshot } from "./ops/snapshots.ts";
import type { GhPrViewData, GhRepoViewData, GithubInput } from "./types.ts";

/** The github tool's op discriminator. */
export type GithubOp = GithubInput["op"];

/** The json-mode envelope carried on the content channel. */
export interface GithubJsonEnvelope<T> {
	op: GithubOp;
	/** The explicit or op-resolved `owner/repo`, omitted when unknown. */
	repo?: string;
	data: T;
}

/** Result shape shared with the text path (details stay populated in both modes). */
export interface GithubJsonResult {
	content: Array<{ type: "text"; text: string }>;
	details: GhToolDetails;
}

/** Serialize one op result as a compact json envelope on the content channel. */
export function buildJsonResult<T>(
	op: GithubOp,
	options: { data: T; repo?: string; details?: GhToolDetails; sourceUrl?: string },
): GithubJsonResult {
	const envelope: GithubJsonEnvelope<T> = { op, data: options.data };
	if (options.repo !== undefined) envelope.repo = options.repo;
	return {
		// Compact stringify: this is the machine channel; token economy beats
		// transcript prettiness.
		content: [{ type: "text", text: JSON.stringify(envelope) }],
		details: { ...options.details, sourceUrl: options.sourceUrl },
	};
}

// --- repo_view ---------------------------------------------------------------

/** repo_view payload: the repository metadata exactly as the renderer consumes it. */
export function repoViewJsonPayload(data: GhRepoViewData): { data: GhRepoViewData; repo?: string } {
	// The envelope repo falls back to the resolved owner/repo.
	return { data, repo: data.nameWithOwner ?? undefined };
}

// --- file_read ---------------------------------------------------------------

export interface GhFileReadPayload {
	repo: string;
	branch?: string;
	path: string;
	content: string;
}

/** file_read payload: decoded UTF-8 content (text files only in json mode). */
export function fileReadJsonPayload(options: { repo: string; branch?: string; path: string; content: string }): GhFileReadPayload {
	return {
		repo: options.repo,
		...(options.branch !== undefined ? { branch: options.branch } : {}),
		path: options.path,
		content: options.content,
	};
}

// --- search_* ----------------------------------------------------------------

/** Mirrors the /search/<endpoint> API envelope with the normalized item shapes. */
export interface GhSearchPayload<T> {
	total_count: number;
	incomplete_results: boolean;
	items: T[];
}

/** search payload: API totals (when present) plus the normalized items. */
export function searchJsonPayload<T>(options: {
	totalCount?: number;
	incompleteResults?: boolean;
	items: T[];
}): GhSearchPayload<T> {
	return {
		total_count: options.totalCount ?? options.items.length,
		incomplete_results: options.incompleteResults ?? false,
		items: options.items,
	};
}
// --- pr_create ---------------------------------------------------------------

export interface GhPrCreatePayload {
	number?: number;
	url: string;
	state?: string;
	isDraft?: boolean;
	baseRefName?: string;
	headRefName?: string;
}

/** pr_create payload: PR identity, falling back to input values when the post-create view lookup is unavailable. */
export function prCreateJsonPayload(options: {
	url: string;
	prNumber?: number;
	data?: GhPrViewData;
	base?: string;
	head?: string;
	draft?: boolean;
}): GhPrCreatePayload {
	return {
		number: options.prNumber ?? options.data?.number,
		url: options.url || options.data?.url || "",
		state: options.data?.state,
		isDraft: options.data?.isDraft ?? Boolean(options.draft),
		baseRefName: options.data?.baseRefName ?? options.base,
		headRefName: options.data?.headRefName ?? options.head,
	};
}

// --- pr_checkout -------------------------------------------------------------

export interface GhPrCheckoutPayload {
	checkouts: GhPrCheckoutSummary[];
}

/** pr_checkout payload: the same per-PR summaries the details channel carries. */
export function prCheckoutJsonPayload(checkouts: GhPrCheckoutSummary[]): GhPrCheckoutPayload {
	return { checkouts };
}

// --- pr_push -----------------------------------------------------------------

export interface GhPrPushTargetPayload {
	remote: string;
	remoteBranch: string;
	remoteUrl?: string;
	prUrl?: string;
	maintainerCanModify?: boolean;
	isCrossRepository: boolean;
}

export interface GhPrPushPayload {
	pushed: GhPrPushTargetPayload[];
	headSha?: string;
}

/** pr_push payload: one push target (single-element `pushed`) plus the pushed head SHA. */
export function prPushJsonPayload(options: {
	remote: string;
	remoteBranch: string;
	remoteUrl?: string;
	prUrl?: string;
	maintainerCanModify?: boolean;
	isCrossRepository: boolean;
	headSha?: string;
}): GhPrPushPayload {
	return {
		pushed: [
			{
				remote: options.remote,
				remoteBranch: options.remoteBranch,
				remoteUrl: options.remoteUrl,
				prUrl: options.prUrl,
				maintainerCanModify: options.maintainerCanModify,
				isCrossRepository: options.isCrossRepository,
			},
		],
		headSha: options.headSha,
	};
}

// --- run_watch ---------------------------------------------------------------

export interface GhRunWatchRunPayload {
	runId: number;
	url?: string;
	status?: string;
	conclusion?: string;
	/** Names of the run's failed jobs. */
	failedJobs: string[];
	/** Full-log files saved under the OS temp dir; tails never embed in the JSON. */
	logFiles: string[];
}

export interface GhRunWatchPayload {
	runs: GhRunWatchRunPayload[];
	branch?: string;
	headSha?: string;
}

/** run_watch payload: one entry per run, with log-file paths grouped per run. */
export function runWatchJsonPayload(options: {
	runs: GhRunSnapshot[];
	logFilesByRun: ReadonlyMap<number, string[]>;
	branch?: string;
	headSha?: string;
}): GhRunWatchPayload {
	return {
		runs: options.runs.map(run => ({
			runId: run.id,
			url: run.url,
			status: run.status,
			conclusion: run.conclusion,
			failedJobs: run.jobs.filter(isFailedJob).map(job => job.name),
			logFiles: options.logFilesByRun.get(run.id) ?? [],
		})),
		...(options.branch !== undefined ? { branch: options.branch } : {}),
		...(options.headSha !== undefined ? { headSha: options.headSha } : {}),
	};
}

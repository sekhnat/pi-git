/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Deviation: upstream saves full failed-job logs to an omp session artifact;
 * pi-git writes them under the OS temp dir and reports the file paths.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { scheduler } from "node:timers/promises";
import { ToolError, throwIfAborted } from "../../errors.ts";
import { buildTextResult, formatShortSha, pushLine, type GhToolDetails } from "../format.ts";
import { buildJsonResult, runWatchJsonPayload } from "../json.ts";
import {
	formatRepoRef,
	ghApiHostArgs,
	githubRepoSlugEquals,
	normalizeBlock,
	normalizeOptionalString,
	parseRepoRef,
	requireCurrentGitBranch,
	requireCurrentGitHead,
	requireNonEmpty,
	resolveGitHubRepo,
	tryResolveCurrentRepoFresh,
} from "../refs.ts";
import { ghJson, ghRun } from "../runner.ts";
import type {
	GhActionsJobApi,
	GhActionsJobsResponse,
	GhActionsRunApi,
	GhActionsRunListResponse,
	GhBranchApiResponse,
	GhRunReference,
	GithubInput,
} from "../types.ts";
import {
	getRunCollectionOutcome,
	getRunCollectionSignature,
	getRunSnapshotOutcome,
	isFailedJob,
	type GhFailedJobLog,
	type GhRunJobSnapshot,
	type GhRunSnapshot,
} from "./snapshots.ts";
import { renderFailedJobLogs, renderJobsSection, renderRunSection } from "./render.ts";

export const RUN_WATCH_INTERVAL_DEFAULT = 3;
export const RUN_WATCH_INTERVAL_SLOW = 15;
export const RUN_WATCH_FAST_WINDOW_MS = 60_000;
export const RUN_WATCH_NO_RUNS_GIVE_UP_MS = 90_000;
export const RUN_WATCH_MAX_POLL_FAILURES = 5;
export const RUN_WATCH_GRACE_DEFAULT = 5;
export const RUN_WATCH_TAIL_DEFAULT = 15;
export const RUN_WATCH_TAIL_MAX = 200;

export const RUN_JOBS_PAGE_SIZE = 100;

export function resolveTailLimit(value: number | undefined): number {
	if (value === undefined) return RUN_WATCH_TAIL_DEFAULT;
	if (!Number.isFinite(value) || value <= 0) {
		throw new ToolError("tail must be a positive number");
	}
	return Math.min(Math.floor(value), RUN_WATCH_TAIL_MAX);
}

export const RUN_URL_PATTERN = /^https:\/\/([^\/]+)\/([^\/]+\/[^\/]+)\/actions\/runs\/(\d+)(?:\/.*)?$/;

export function parseRunReference(value: string | undefined): GhRunReference {
	const run = normalizeOptionalString(value);
	if (!run) return {};

	if (/^\d+$/.test(run)) return { runId: Number(run) };

	const match = run.match(RUN_URL_PATTERN);
	if (!match) {
		throw new ToolError("run must be a numeric workflow run ID or a full GitHub Actions run URL");
	}

	return { repo: formatRepoRef(match[1], match[2]), runId: Number(match[3]) };
}

export function normalizeRunJob(job: GhActionsJobApi): GhRunJobSnapshot | null {
	if (typeof job.id !== "number") return null;
	return {
		id: job.id,
		name: normalizeOptionalString(job.name) ?? `job-${job.id}`,
		status: normalizeOptionalString(job.status),
		conclusion: normalizeOptionalString(job.conclusion),
		startedAt: normalizeOptionalString(job.started_at),
		completedAt: normalizeOptionalString(job.completed_at),
		url: normalizeOptionalString(job.html_url),
	};
}

export function normalizeRunSnapshot(run: GhActionsRunApi, jobs: GhRunJobSnapshot[]): GhRunSnapshot {
	if (typeof run.id !== "number") {
		throw new ToolError("GitHub Actions run response did not include a run ID.");
	}
	return {
		id: run.id,
		workflowName: normalizeOptionalString(run.name),
		displayTitle: normalizeOptionalString(run.display_title),
		status: normalizeOptionalString(run.status),
		conclusion: normalizeOptionalString(run.conclusion),
		branch: normalizeOptionalString(run.head_branch),
		headSha: normalizeOptionalString(run.head_sha),
		createdAt: normalizeOptionalString(run.created_at),
		updatedAt: normalizeOptionalString(run.updated_at),
		url: normalizeOptionalString(run.html_url),
		jobs,
	};
}

/** Rate-limit / secondary-limit gh failures are transient; the poll loop backs off and retries. */
export const GH_RATE_LIMIT_ERROR_PATTERN = /rate limit|HTTP 429|abuse detection/i;

export function isRateLimitedGhError(err: unknown): boolean {
	return err instanceof ToolError && GH_RATE_LIMIT_ERROR_PATTERN.test(err.message);
}

export function tailLogLines(log: string, tail: number): string | undefined {
	const normalized = normalizeBlock(log);
	if (!normalized) return undefined;
	const lines = normalized.split("\n");
	return lines.slice(-tail).join("\n").trimEnd();
}

export async function resolveGitHubBranchHead(cwd: string, repo: string, branch: string, signal?: AbortSignal): Promise<string> {
	const ref = parseRepoRef(repo);
	const response = await ghJson<GhBranchApiResponse>(
		cwd,
		["api", ...ghApiHostArgs(ref), "--method", "GET", `/repos/${ref.slug}/branches/${encodeURIComponent(branch)}`],
		signal,
		{ repoProvided: true },
	);
	return requireNonEmpty(response.commit?.sha, `head SHA for branch ${branch}`);
}

export async function fetchRunJobs(cwd: string, repo: string, runId: number, signal?: AbortSignal): Promise<GhRunJobSnapshot[]> {
	const ref = parseRepoRef(repo);
	const jobs: GhRunJobSnapshot[] = [];
	let page = 1;

	while (true) {
		const response = await ghJson<GhActionsJobsResponse>(
			cwd,
			[
				"api",
				...ghApiHostArgs(ref),
				"--method",
				"GET",
				`/repos/${ref.slug}/actions/runs/${runId}/jobs`,
				"-F",
				`per_page=${RUN_JOBS_PAGE_SIZE}`,
				"-F",
				`page=${page}`,
			],
			signal,
			{ repoProvided: true },
		);
		const rawPage = response.jobs ?? [];
		const pageJobs = rawPage.map(job => normalizeRunJob(job)).filter((job): job is GhRunJobSnapshot => job !== null);
		jobs.push(...pageJobs);

		// Compare the raw page length: normalizeRunJob drops malformed items, and
		// a post-filter short page must not end pagination early.
		if (rawPage.length < RUN_JOBS_PAGE_SIZE) break;
		if ((response.total_count ?? 0) <= jobs.length) break;
		page += 1;
	}
	return jobs;
}

export async function fetchRunSnapshot(cwd: string, repo: string, runId: number, signal?: AbortSignal): Promise<GhRunSnapshot> {
	const ref = parseRepoRef(repo);
	const [run, jobs] = await Promise.all([
		ghJson<GhActionsRunApi>(
			cwd,
			["api", ...ghApiHostArgs(ref), "--method", "GET", `/repos/${ref.slug}/actions/runs/${runId}`],
			signal,
			{ repoProvided: true },
		),
		fetchRunJobs(cwd, repo, runId, signal),
	]);
	return normalizeRunSnapshot(run, jobs);
}

export async function fetchRunsForCommit(
	cwd: string,
	repo: string,
	headSha: string,
	signal?: AbortSignal,
	completedRunJobsCache?: Map<number, GhRunJobSnapshot[]>,
): Promise<GhRunSnapshot[]> {
	// Filter only by head_sha: adding a branch filter would wrongly exclude
	// tag-push or PR-triggered runs whose head_branch is not the local branch.
	const ref = parseRepoRef(repo);
	const response = await ghJson<GhActionsRunListResponse>(
		cwd,
		[
			"api",
			...ghApiHostArgs(ref),
			"--method",
			"GET",
			`/repos/${ref.slug}/actions/runs`,
			"-F",
			`head_sha=${headSha}`,
			"-F",
			`per_page=${RUN_JOBS_PAGE_SIZE}`,
		],
		signal,
		{ repoProvided: true },
	);

	return Promise.all(
		(response.workflow_runs ?? [])
			.filter((run): run is GhActionsRunApi & { id: number } => typeof run.id === "number")
			.map(async run => {
				// Completed runs' job lists are stable; reuse them across watch polls.
				// A run observed non-completed evicts its entry (a re-run would
				// otherwise serve the first attempt's jobs forever).
				const completed = run.status === "completed";
				if (!completed) completedRunJobsCache?.delete(run.id);
				let jobs = completed ? completedRunJobsCache?.get(run.id) : undefined;
				if (!jobs) {
					jobs = await fetchRunJobs(cwd, repo, run.id, signal);
					if (completed) completedRunJobsCache?.set(run.id, jobs);
				}
				return normalizeRunSnapshot(run, jobs);
			}),
	);
}

export async function fetchFailedJobLogs(
	cwd: string,
	repo: string,
	failedJobs: Array<{ run: GhRunSnapshot; job: GhRunJobSnapshot }>,
	tail: number,
	signal?: AbortSignal,
): Promise<GhFailedJobLog[]> {
	const ref = parseRepoRef(repo);
	return Promise.all(
		failedJobs.map(async entry => {
			const result = await ghRun(
				cwd,
				["api", ...ghApiHostArgs(ref), `/repos/${ref.slug}/actions/jobs/${entry.job.id}/logs`],
				signal,
			);
			const fullLog = result.exitCode === 0 ? normalizeBlock(result.stdout) : undefined;
			const logTail = fullLog ? tailLogLines(fullLog, tail) : undefined;
			return {
				run: entry.run,
				job: entry.job,
				full: fullLog,
				tail: logTail,
				available: Boolean(fullLog),
			};
		}),
	);
}

/** Write full failed-job logs to a file under the OS temp dir; returns the path. */
export async function saveFailedJobLogsFile(
	log: string,
	context: { runId: number | string; jobName: string },
): Promise<string | undefined> {
	if (!log.trim()) return undefined;
	const dir = path.join(os.tmpdir(), "pi-git");
	await fs.mkdir(dir, { recursive: true });
	const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 60);
	const file = path.join(dir, `run-${context.runId}-${sanitize(context.jobName)}.log`);
	await fs.writeFile(file, log, "utf8");
	return file;
}

export function formatRunWatchSnapshot(
	repo: string,
	run: GhRunSnapshot,
	pollCount: number,
	note?: string,
	includeOutcome = false,
): string {
	const failedJobs = run.jobs.filter(isFailedJob);
	const lines: string[] = [`# Watching GitHub Actions Run #${run.id}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Workflow", run.workflowName ?? undefined);
	pushLine(lines, "Title", run.displayTitle ?? undefined);
	pushLine(lines, "Branch", run.branch ?? undefined);
	pushLine(lines, "Status", run.status);
	pushLine(lines, "Conclusion", run.conclusion ?? undefined);
	pushLine(lines, "Created", run.createdAt);
	pushLine(lines, "Updated", run.updatedAt);
	pushLine(lines, "URL", run.url);
	pushLine(lines, "Poll", pollCount);
	pushLine(lines, "Failed jobs", failedJobs.length || undefined);

	if (note) {
		lines.push("");
		lines.push(`Note: ${note}`);
	}

	lines.push("");
	lines.push(...renderJobsSection(run.jobs));

	if (includeOutcome) {
		lines.push("");
		lines.push(failedJobs.length > 0 ? "Failures detected." : "All jobs passed.");
	}

	return lines.join("\n").trim();
}

export function formatRunWatchResult(
	repo: string,
	run: GhRunSnapshot,
	failedJobLogs: GhFailedJobLog[],
	tail: number,
	options?: { mode?: "tail" | "full" },
): string {
	const failedJobs = run.jobs.filter(isFailedJob);
	const lines: string[] = [`# GitHub Actions Run #${run.id}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Workflow", run.workflowName ?? undefined);
	pushLine(lines, "Title", run.displayTitle ?? undefined);
	pushLine(lines, "Branch", run.branch ?? undefined);
	pushLine(lines, "Status", run.status);
	pushLine(lines, "Conclusion", run.conclusion ?? undefined);
	pushLine(lines, "Created", run.createdAt);
	pushLine(lines, "Updated", run.updatedAt);
	pushLine(lines, "URL", run.url);
	lines.push("");
	lines.push(...renderJobsSection(run.jobs));

	if (failedJobs.length > 0) {
		lines.push("");
		lines.push(
			...renderFailedJobLogs(failedJobLogs, options?.mode === "full" ? { mode: "full" } : { mode: "tail", tail }),
		);
		lines.push("Run failed.");
	} else if (getRunSnapshotOutcome(run) === "success") {
		lines.push("");
		lines.push("All jobs passed.");
	} else {
		lines.push("");
		lines.push("Run completed without successful jobs, but no failed job logs were available.");
	}

	return lines.join("\n").trim();
}

export function formatCommitRunWatchSnapshot(
	repo: string,
	headSha: string,
	branch: string | undefined,
	runs: GhRunSnapshot[],
	pollCount: number,
	note?: string,
): string {
	const failedJobs = runs.flatMap(run => run.jobs.filter(isFailedJob));
	const completedRuns = runs.filter(run => run.status === "completed").length;
	const lines: string[] = [`# Watching GitHub Actions for ${formatShortSha(headSha) ?? headSha}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Branch", branch);
	pushLine(lines, "Commit", headSha);
	pushLine(lines, "Poll", pollCount);
	pushLine(lines, "Runs", runs.length);
	pushLine(lines, "Completed runs", `${completedRuns}/${runs.length}`);
	pushLine(lines, "Failed jobs", failedJobs.length || undefined);

	if (note) {
		lines.push("");
		lines.push(`Note: ${note}`);
	}

	if (runs.length === 0) {
		lines.push("");
		lines.push("Waiting for workflow runs for this commit.");
		return lines.join("\n").trim();
	}

	for (const run of runs) {
		lines.push("");
		lines.push(...renderRunSection(run));
	}

	return lines.join("\n").trim();
}

export function formatCommitRunWatchResult(
	repo: string,
	headSha: string,
	branch: string | undefined,
	runs: GhRunSnapshot[],
	failedJobLogs: GhFailedJobLog[],
	tail: number,
	options?: { mode?: "tail" | "full" },
): string {
	const outcome = getRunCollectionOutcome(runs);
	const lines: string[] = [`# GitHub Actions for ${formatShortSha(headSha) ?? headSha}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Branch", branch);
	pushLine(lines, "Commit", headSha);
	pushLine(lines, "Runs", runs.length);

	for (const run of runs) {
		lines.push("");
		lines.push(...renderRunSection(run));
	}

	if (failedJobLogs.length > 0) {
		lines.push("");
		lines.push(
			...renderFailedJobLogs(failedJobLogs, options?.mode === "full" ? { mode: "full" } : { mode: "tail", tail }),
		);
		lines.push("Workflow runs for this commit failed.");
	} else if (outcome === "success") {
		lines.push("");
		lines.push("All workflow runs for this commit passed.");
	} else {
		lines.push("");
		lines.push("Workflow runs for this commit did not complete successfully.");
	}

	return lines.join("\n").trim();
}

export interface RunWatchContext {
	cwd: string;
	onUpdate?: (update: { content: Array<{ type: "text"; text: string }>; details: GhToolDetails }) => void;
}

export async function executeRunWatch(
	ctx: RunWatchContext,
	params: GithubInput,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: GhToolDetails }> {
	const cwd = ctx.cwd;
	const branchInput = normalizeOptionalString(params.branch);
	const explicitRepo = normalizeOptionalString(params.repo);
	const runReference = parseRunReference(params.run);
	const repo = await resolveGitHubRepo(cwd, explicitRepo, runReference.repo, signal);
	const graceSeconds = RUN_WATCH_GRACE_DEFAULT;
	const tail = resolveTailLimit(params.tail);
	const watchStartMs = Date.now();
	// Fast polls for the first minute, then back off — every commit-watch poll
	// is one runs-list call plus one jobs call per non-completed run, and long
	// builds must not burn the shared authenticated REST quota.
	const currentIntervalSeconds = () =>
		Date.now() - watchStartMs < RUN_WATCH_FAST_WINDOW_MS ? RUN_WATCH_INTERVAL_DEFAULT : RUN_WATCH_INTERVAL_SLOW;
	let consecutivePollFailures = 0;
	const handlePollError = async (err: unknown): Promise<void> => {
		if (signal?.aborted) throw err;
		consecutivePollFailures += 1;
		if (!isRateLimitedGhError(err) || consecutivePollFailures > RUN_WATCH_MAX_POLL_FAILURES) throw err;
		await scheduler.wait(RUN_WATCH_INTERVAL_SLOW * 1000, { signal });
	};

	if (runReference.runId !== undefined) {
		const runId = runReference.runId;
		let pollCount = 0;

		while (true) {
			throwIfAborted(signal);
			pollCount += 1;

			let run: GhRunSnapshot;
			try {
				run = await fetchRunSnapshot(cwd, repo, runId, signal);
			} catch (err) {
				await handlePollError(err);
				continue;
			}
			consecutivePollFailures = 0;
			ctx.onUpdate?.({
				content: [{ type: "text", text: formatRunWatchSnapshot(repo, run, pollCount) }],
				details: { repo, runIds: [run.id], status: run.status, conclusion: run.conclusion },
			});

			let failedJobs = run.jobs.filter(isFailedJob);
			const runCompleted = run.status === "completed";

			if (failedJobs.length > 0) {
				if (!runCompleted && graceSeconds > 0) {
					const note = `Failure detected. Waiting ${graceSeconds}s to capture concurrent failures before fetching logs.`;
					ctx.onUpdate?.({
						content: [{ type: "text", text: formatRunWatchSnapshot(repo, run, pollCount, note) }],
						details: { repo, runIds: [run.id], status: run.status, conclusion: run.conclusion },
					});
					await scheduler.wait(graceSeconds * 1000, { signal });
					try {
						const refetched = await fetchRunSnapshot(cwd, repo, runId, signal);
						const refetchedFailed = refetched.jobs.filter(isFailedJob);
						// An auto-retry can reset job conclusions between detection and
						// refetch; keep the originally-detected failure list so the watch
						// never ends with a failure result and zero logs.
						if (refetchedFailed.length > 0) {
							run = refetched;
							failedJobs = refetchedFailed;
						}
					} catch (err) {
						if (signal?.aborted) throw err;
						// Refetch failure: report from the original snapshot.
					}
				}

				const failedJobLogs = await fetchFailedJobLogs(
					cwd,
					repo,
					failedJobs.map(job => ({ run, job })),
					tail,
					signal,
				);
				const logFiles: string[] = [];
				const logFilesByRun = new Map<number, string[]>();
				for (const entry of failedJobLogs) {
					if (entry.full) {
						const file = await saveFailedJobLogsFile(entry.full, { runId: run.id, jobName: entry.job.name });
						if (file) logFiles.push(file);
					}
				}
				logFilesByRun.set(run.id, logFiles);
				let text = formatRunWatchResult(repo, run, failedJobLogs, tail);
				if (logFiles.length > 0) {
					text += `\n\nFull failed-job logs: ${logFiles.join(", ")}`;
				}
				if (params.format === "json") {
					return buildJsonResult("run_watch", {
						data: runWatchJsonPayload({ runs: [run], logFilesByRun }),
						repo,
						details: {
							repo,
							runId: run.id,
							runIds: [run.id],
							status: run.status,
							conclusion: run.conclusion,
							failedJobs: run.jobs.filter(isFailedJob).map(job => job.name),
							logFiles,
						},
						sourceUrl: run.url,
					});
				}
				return buildTextResult(text, run.url, {
					repo,
					runId: run.id,
				runIds: [run.id],
					status: run.status,
					conclusion: run.conclusion,
					failedJobs: run.jobs.filter(isFailedJob).map(job => job.name),
					logFiles,
				});
			}

			if (runCompleted) {
				if (params.format === "json") {
					return buildJsonResult("run_watch", {
						data: runWatchJsonPayload({ runs: [run], logFilesByRun: new Map() }),
						repo,
						details: { repo, runId: run.id, runIds: [run.id], status: run.status, conclusion: run.conclusion },
						sourceUrl: run.url,
					});
				}
				return buildTextResult(formatRunWatchResult(repo, run, [], tail), run.url, {
					repo,
					runId: run.id,
					runIds: [run.id],
					status: run.status,
						conclusion: run.conclusion,
					});
			}

			await scheduler.wait(currentIntervalSeconds() * 1000, { signal });
		}
	}

	let branch: string;
	let headSha: string;
	if (branchInput) {
		branch = branchInput;
		headSha = await resolveGitHubBranchHead(cwd, repo, branch, signal);
	} else {
		// No branch/run selector — derive the commit from the current checkout,
		// but only when cwd actually points at repo (issue #1949 upstream).
		const cwdRepo = await tryResolveCurrentRepoFresh(cwd, signal);
		if (!githubRepoSlugEquals(cwdRepo, repo)) {
			throw new ToolError(
				`Cannot infer the watched commit for ${repo}: current checkout is ${cwdRepo ?? "not a GitHub repository"}. Pass \`branch\` or \`run\` to scope the watch.`,
			);
		}
		branch = await requireCurrentGitBranch(cwd, signal);
		headSha = await requireCurrentGitHead(cwd, signal);
	}
	let pollCount = 0;
	let settledSuccessSignature: string | undefined;
	let everSawRuns = false;
	const completedRunJobsCache = new Map<number, GhRunJobSnapshot[]>();

	while (true) {
		throwIfAborted(signal);
		pollCount += 1;

		let runs: GhRunSnapshot[];
		try {
			runs = await fetchRunsForCommit(cwd, repo, headSha, signal, completedRunJobsCache);
		} catch (err) {
			await handlePollError(err);
			continue;
		}
		consecutivePollFailures = 0;
		if (runs.length > 0) everSawRuns = true;
		ctx.onUpdate?.({
			content: [{ type: "text", text: formatCommitRunWatchSnapshot(repo, headSha, branch, runs, pollCount) }],
			details: {
				repo,
				branch,
				headSha,
				runIds: runs.map(run => run.id),
				status: runs.length > 0 && runs.every(run => run.status === "completed") ? "completed" : "in_progress",
			},
		});

		const outcome = getRunCollectionOutcome(runs);
		if (outcome === "failure") {
			let failedPairs = runs.flatMap(run => run.jobs.filter(isFailedJob).map(job => ({ run, job })));
			if (graceSeconds > 0) {
				const note = `Failure detected. Waiting ${graceSeconds}s to capture concurrent failures before fetching logs.`;
				ctx.onUpdate?.({
					content: [{ type: "text", text: formatCommitRunWatchSnapshot(repo, headSha, branch, runs, pollCount, note) }],
					details: { repo, branch, headSha },
				});
				await scheduler.wait(graceSeconds * 1000, { signal });
				try {
					const refetched = await fetchRunsForCommit(cwd, repo, headSha, signal, completedRunJobsCache);
					const refetchedPairs = refetched.flatMap(run => run.jobs.filter(isFailedJob).map(job => ({ run, job })));
					// Keep the originally-detected failure list when an auto-retry
					// reset the conclusions during the grace window.
					if (refetchedPairs.length > 0) {
						runs = refetched;
						failedPairs = refetchedPairs;
					}
				} catch (err) {
					if (signal?.aborted) throw err;
					// Refetch failure: report from the original snapshots.
				}
			}

			const failedJobLogs = await fetchFailedJobLogs(cwd, repo, failedPairs, tail, signal);
			const logFiles: string[] = [];
			const logFilesByRun = new Map<number, string[]>();
			for (const entry of failedJobLogs) {
				if (entry.full) {
					const file = await saveFailedJobLogsFile(entry.full, { runId: entry.run.id, jobName: entry.job.name });
					if (file) {
						logFiles.push(file);
						const perRun = logFilesByRun.get(entry.run.id);
						if (perRun) perRun.push(file);
						else logFilesByRun.set(entry.run.id, [file]);
					}
				}
			}
			let text = formatCommitRunWatchResult(repo, headSha, branch, runs, failedJobLogs, tail);
			if (logFiles.length > 0) {
				text += `\n\nFull failed-job logs: ${logFiles.join(", ")}`;
			}
			if (params.format === "json") {
				return buildJsonResult("run_watch", {
					data: runWatchJsonPayload({ runs, logFilesByRun, branch, headSha }),
					repo,
					details: {
						repo,
						branch,
						headSha,
						runIds: runs.map(run => run.id),
						status: "completed",
						conclusion: "failure",
						failedJobs: failedPairs.map(entry => `${entry.run.workflowName ?? `run ${entry.run.id}`}: ${entry.job.name}`),
						logFiles,
					},
				});
			}
			return buildTextResult(text, undefined, {
				repo,
				branch,
				headSha,
				runIds: runs.map(run => run.id),
				status: "completed",
				conclusion: "failure",
				failedJobs: failedPairs.map(entry => `${entry.run.workflowName ?? `run ${entry.run.id}`}: ${entry.job.name}`),
				logFiles,
			});
		}

		if (outcome === "success") {
			const signature = getRunCollectionSignature(runs);
			if (signature === settledSuccessSignature) {
				if (params.format === "json") {
					return buildJsonResult("run_watch", {
						data: runWatchJsonPayload({ runs, logFilesByRun: new Map(), branch, headSha }),
						repo,
						details: {
						repo,
						branch,
						headSha,
						runIds: runs.map(run => run.id),
						status: "completed",
						conclusion: "success",
					},
					});
				}
				return buildTextResult(formatCommitRunWatchResult(repo, headSha, branch, runs, [], tail), undefined, {
					repo,
					branch,
					headSha,
					runIds: runs.map(run => run.id),
					status: "completed",
					conclusion: "success",
				});
			}

			settledSuccessSignature = signature;
			const confirmWaitSeconds = currentIntervalSeconds();
			const note = `All known workflow runs completed successfully. Waiting ${confirmWaitSeconds}s to ensure no additional runs appear for this commit.`;
			ctx.onUpdate?.({
				content: [{ type: "text", text: formatCommitRunWatchSnapshot(repo, headSha, branch, runs, pollCount, note) }],
					details: { repo, branch, headSha, status: "in_progress" },
			});
			await scheduler.wait(confirmWaitSeconds * 1000, { signal });
			continue;
		}

		settledSuccessSignature = undefined;
		if (!everSawRuns && Date.now() - watchStartMs >= RUN_WATCH_NO_RUNS_GIVE_UP_MS) {
			// A repo with no Actions configured never produces a run; give up
			// with a clear message instead of polling forever.
			const elapsedSec = Math.round((Date.now() - watchStartMs) / 1000);
			if (params.format === "json") {
				return buildJsonResult("run_watch", {
					data: runWatchJsonPayload({ runs: [], logFilesByRun: new Map(), branch, headSha }),
					repo,
					details: { repo, branch, headSha, status: "completed" },
				});
			}
			return buildTextResult(
				`No workflow runs found for ${repo}@${formatShortSha(headSha) ?? headSha} after ${elapsedSec}s (${pollCount} polls). The commit may not trigger any GitHub Actions workflows, or Actions may be disabled for this repository. Pass \`run\` to watch a specific run.`,
				undefined,
				{ repo, branch, headSha, status: "completed" },
			);
		}
		await scheduler.wait(currentIntervalSeconds() * 1000, { signal });
	}
}

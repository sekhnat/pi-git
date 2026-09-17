/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** Normalized workflow job snapshot. */
export interface GhRunJobSnapshot {
	id: number;
	name: string;
	status?: string;
	conclusion?: string;
	startedAt?: string;
	completedAt?: string;
	url?: string;
}

/** Normalized workflow run snapshot with its jobs. */
export interface GhRunSnapshot {
	id: number;
	workflowName?: string;
	displayTitle?: string;
	status?: string;
	conclusion?: string;
	branch?: string;
	headSha?: string;
	createdAt?: string;
	updatedAt?: string;
	url?: string;
	jobs: GhRunJobSnapshot[];
}

/** A failed job with its captured log. */
export interface GhFailedJobLog {
	run: GhRunSnapshot;
	job: GhRunJobSnapshot;
	full: string | undefined;
	tail: string | undefined;
	available: boolean;
}

export const RUN_SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
export const RUN_FAILURE_CONCLUSIONS = new Set([
	"failure",
	"timed_out",
	"cancelled",
	"action_required",
	"startup_failure",
]);
export const JOB_FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required"]);

export function isFailedJob(job: GhRunJobSnapshot): boolean {
	return job.conclusion !== undefined && JOB_FAILURE_CONCLUSIONS.has(job.conclusion);
}

export function getRunOutcome(value: string | undefined): "success" | "failure" | "pending" {
	if (!value) return "pending";
	if (RUN_SUCCESS_CONCLUSIONS.has(value)) return "success";
	if (RUN_FAILURE_CONCLUSIONS.has(value)) return "failure";
	return "pending";
}

export function getRunSnapshotOutcome(run: GhRunSnapshot): "success" | "failure" | "pending" {
	if (run.status !== "completed") return "pending";
	return getRunOutcome(run.conclusion);
}

export function getRunCollectionOutcome(runs: GhRunSnapshot[]): "success" | "failure" | "pending" {
	if (runs.length === 0) return "pending";
	let pending = false;
	for (const run of runs) {
		if (run.jobs.some(isFailedJob)) return "failure";
		const outcome = getRunSnapshotOutcome(run);
		if (outcome === "failure") return "failure";
		if (outcome === "pending") pending = true;
	}
	return pending ? "pending" : "success";
}

export function getRunCollectionSignature(runs: GhRunSnapshot[]): string {
	return runs.map(run => run.id).sort((left, right) => left - right).join(",");
}

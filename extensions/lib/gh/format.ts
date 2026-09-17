/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** Structured details attached to github tool results. */
export interface GhPrCheckoutSummary {
	prNumber?: number;
	url?: string;
	branch: string;
	worktreePath: string;
	remote: string;
	remoteBranch: string;
	reused: boolean;
}

export interface GhToolDetails {
	sourceUrl?: string;
	repo?: string;
	branch?: string;
	worktreePath?: string;
	remote?: string;
	remoteBranch?: string;
	headSha?: string;
	runId?: number;
	runIds?: number[];
	status?: string;
	conclusion?: string;
	failedJobs?: string[];
	checkouts?: GhPrCheckoutSummary[];
	/** Full failed-job logs written under the OS temp dir (run_watch). */
	logFiles?: string[];
}

/** Append a labeled Markdown metadata value when present. */
export function pushLine(lines: string[], label: string, value: string | number | boolean | undefined): void {
	if (value === undefined || value === "") return;
	lines.push(`${label}: ${value}`);
}

/** First 12 hex characters of a commit SHA, or undefined when missing. */
export function formatShortSha(value: string | undefined): string | undefined {
	return value ? value.slice(0, 12) : undefined;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KiB", "MiB", "GiB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

/** Build a plain text tool result with optional source URL in details. */
export function buildTextResult(
	text: string,
	sourceUrl?: string,
	details?: GhToolDetails,
): { content: Array<{ type: "text"; text: string }>; details: GhToolDetails } {
	return {
		content: [{ type: "text", text }],
		details: { ...details, sourceUrl },
	};
}

/** Render the github tool's Markdown output compactly for tool-call display. */
export function renderGithubCallSummary(args: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value)) {
			if (value.length > 0) parts.push(`${key}=${value.join(",")}`);
			continue;
		}
		parts.push(`${key}=${String(value)}`);
	}
	return parts.join(" ");
}

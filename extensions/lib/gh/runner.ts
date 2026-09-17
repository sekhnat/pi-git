/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * The sanctioned `gh` CLI runner: non-interactive env, bounded capture, deadline.
 */

import { nonInteractiveEnv, spawnCapture, TRUNCATED_MARKER, whichSync } from "../spawn.ts";
import { ToolAbortError, ToolError, throwIfAborted } from "../errors.ts";

/** Deadline for `gh` subprocesses. */
export const GH_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Options shaping `gh` failure messages and output handling. */
export interface GhCommandOptions {
	/** Caller passed an explicit repo; suppresses "run inside a checkout" hints. */
	repoProvided?: boolean;
	/** Trim captured output (default true). */
	trimOutput?: boolean;
}

export interface GhCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Check if the `gh` CLI is installed. */
export function ghAvailable(): boolean {
	return Boolean(whichSync("gh"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function formatGhFailure(args: readonly string[], stdout: string, stderr: string, options?: GhCommandOptions): string {
	const message = (stderr || stdout).trim();
	if (message.includes("gh auth login") || message.includes("not logged into any GitHub hosts")) {
		return "GitHub CLI is not authenticated. Run `gh auth login`.";
	}
	if (
		!options?.repoProvided &&
		(message.includes("not a git repository") ||
			message.includes("no git remotes found") ||
			message.includes("unable to determine current repository"))
	) {
		return "GitHub repository context is unavailable. Pass `repo` explicitly or run the tool inside a GitHub checkout.";
	}
	if (message) return message;
	return `GitHub CLI command failed: gh ${args.join(" ")}`;
}

function describeGitHubApiError(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (!isRecord(value)) return undefined;
	if (typeof value.message === "string") return value.message.trim() || undefined;

	const resource = typeof value.resource === "string" ? value.resource.trim() : "";
	const field = typeof value.field === "string" ? value.field.trim() : "";
	const target = [resource, field].filter(Boolean).join(".");
	const code = typeof value.code === "string" ? value.code.trim() : "";
	if (target && code) return `${target}: ${code}`;
	return target || code || undefined;
}

function parseGitHubApiErrorMessages(stdout: string): string[] {
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return [];
	}
	if (!isRecord(payload)) return [];

	const messages = new Set<string>();
	const summary = describeGitHubApiError(payload.message);
	if (summary) messages.add(summary);
	if (Array.isArray(payload.errors)) {
		for (const error of payload.errors) {
			const message = describeGitHubApiError(error);
			if (message) messages.add(message);
		}
	}
	return [...messages];
}

function formatGhJsonFailure(args: readonly string[], stdout: string, stderr: string, options?: GhCommandOptions): string {
	const rawMessage = (stderr || stdout).trim();
	const fallback = formatGhFailure(args, stdout, stderr, options);
	if (fallback !== rawMessage) return fallback;
	const details = parseGitHubApiErrorMessages(stdout).filter(message => !fallback.includes(message));
	if (details.length === 0) return fallback;
	return `${fallback}\nGitHub details:\n${details.map(message => `- ${message}`).join("\n")}`;
}

async function ghRun(cwd: string, args: string[], signal?: AbortSignal, options?: GhCommandOptions): Promise<GhCommandResult> {
	throwIfAborted(signal);
	if (!ghAvailable()) {
		throw new ToolError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/.");
	}
	const result = await spawnCapture("gh", args, {
		cwd,
		env: nonInteractiveEnv(),
		signal,
		timeoutMs: GH_COMMAND_TIMEOUT_MS,
	});
	throwIfAborted(signal);
	const trim = options?.trimOutput !== false;
	const stdout = result.truncated ? `${result.stdout}${TRUNCATED_MARKER}` : result.stdout;
	return {
		exitCode: result.exitCode,
		stdout: trim ? stdout.trim() : stdout,
		stderr: trim ? result.stderr.trim() : result.stderr,
	};
}

/** Run `gh` and parse stdout as JSON. Throws on non-zero exit or invalid JSON. */
export async function ghJson<T>(cwd: string, args: string[], signal?: AbortSignal, options?: GhCommandOptions): Promise<T> {
	const result = await ghRun(cwd, args, signal, options);
	if (result.exitCode !== 0) {
		throw new ToolError(formatGhJsonFailure(args, result.stdout, result.stderr, options));
	}
	if (!result.stdout) throw new ToolError("GitHub CLI returned empty output.");
	try {
		return JSON.parse(result.stdout) as T;
	} catch {
		throw new ToolError("GitHub CLI returned invalid JSON output.");
	}
}

/** Run `gh` and return stdout as text. Throws on non-zero exit. */
export async function ghText(cwd: string, args: string[], signal?: AbortSignal, options?: GhCommandOptions): Promise<string> {
	const result = await ghRun(cwd, args, signal, options);
	if (result.exitCode !== 0) throw new ToolError(formatGhFailure(args, result.stdout, result.stderr, options));
	return result.stdout;
}

export { ghRun };

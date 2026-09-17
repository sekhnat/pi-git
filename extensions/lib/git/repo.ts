/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Git operations shelled out to the `git` CLI (oh-my-pi uses its Rust pi-vcs
 * crate; the CLI equivalents preserve the same behavior).
 */

import { nonInteractiveEnv, spawnCapture } from "../spawn.ts";
import { ToolError, throwIfAborted } from "../errors.ts";

export interface GitCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export function gitRun(cwd: string, args: string[], signal?: AbortSignal): Promise<GitCommandResult> {
	return spawnCapture("git", args, {
		cwd,
		env: nonInteractiveEnv(),
		signal,
		timeoutMs: 10 * 60 * 1000,
	});
}

/** Run git expecting success; throws a ToolError with stderr on failure. */
export async function gitText(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	throwIfAborted(signal);
	const result = await gitRun(cwd, args, signal);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")}`;
		throw new ToolError(`git ${args[0]} failed: ${detail}`);
	}
	return result.stdout;
}

export async function gitLines(cwd: string, args: string[], signal?: AbortSignal): Promise<string[]> {
	const text = await gitText(cwd, args, signal);
	return text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
}

/** Whether the cwd (or an ancestor) is a git repository. */
export async function isGitRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
	const result = await spawnCapture("git", ["rev-parse", "--git-dir"], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0;
}

/** The repository root containing cwd, or null outside a repository. */
export async function repoRoot(cwd: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["rev-parse", "--show-toplevel"], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

/** The primary worktree's root (the checkout the .git dir belongs to). */
export async function primaryRepoRoot(cwd: string, signal?: AbortSignal): Promise<string> {
	const root = await repoRoot(cwd, signal);
	if (!root) throw new ToolError("Current git repository is unavailable.");
	const common = await gitText(cwd, ["rev-parse", "--git-common-dir"], signal).catch(() => "");
	const mainRoot = await repoRoot(common.trim(), signal).catch(() => null);
	return mainRoot ?? root;
}

/** List staged (cached) or unstaged changed file paths. */
export async function changedFiles(cwd: string, cached: boolean, signal?: AbortSignal): Promise<string[]> {
	const args = ["diff", ...(cached ? ["--cached"] : []), "--name-only", "-M"];
	return gitLines(cwd, args, signal);
}

/** Unified diff text. `binary: true` includes binary patch payloads. */
export async function diffText(
	cwd: string,
	options: { cached?: boolean; binary?: boolean; files?: string[] },
	signal?: AbortSignal,
): Promise<string> {
	const args = ["diff"];
	if (options.cached) args.push("--cached");
	if (options.binary) args.push("--binary");
	if (options.files?.length) {
		args.push("--");
		args.push(...options.files);
	}
	return gitText(cwd, args, signal);
}

export async function numstat(cwd: string, cached: boolean, signal?: AbortSignal): Promise<Array<{ path: string; added: number | null; removed: number | null }>> {
	const text = await gitText(cwd, ["diff", ...(cached ? ["--cached"] : []), "--numstat"], signal);
	const entries: Array<{ path: string; added: number | null; removed: number | null }> = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const [addedRaw, deletedRaw, pathRaw] = parts;
		entries.push({
			path: pathRaw ?? "",
			added: addedRaw === "-" ? null : Number.parseInt(addedRaw ?? "0", 10),
			removed: deletedRaw === "-" ? null : Number.parseInt(deletedRaw ?? "0", 10),
		});
	}
	return entries;
}

/** List untracked files (omp's lsFiles(others=true, excludeStandard=true)). */
export async function untrackedFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
	return gitLines(cwd, ["ls-files", "--others", "--exclude-standard"], signal);
}

/** Raw git diff --cached --numstat output. */
export async function numstatText(cwd: string, signal?: AbortSignal): Promise<string> {
	return gitText(cwd, ["diff", "--cached", "--numstat"], signal);
}

/** Stage all changes (empty list mirrors omp's stageFiles([]) → add -A). */
export async function stageAll(cwd: string, signal?: AbortSignal): Promise<void> {
	await gitText(cwd, ["add", "-A"], signal);
}

/** Unstage everything (mixed reset; mirrors omp's unstage([])). */
export async function unstageAll(cwd: string, signal?: AbortSignal): Promise<void> {
	await gitText(cwd, ["reset"], signal);
}

/** Commit the current index with the given message. Hooks run normally. */
export async function commitCreate(cwd: string, message: string, signal?: AbortSignal): Promise<void> {
	const result = await gitRun(cwd, ["commit", "-m", message], signal);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || result.stderr;
		throw new ToolError(`Commit failed:\n${detail.split("\n").map(line => `    ${line}`).join("\n")}`);
	}
}

/** Push the current branch to its upstream. */
export async function pushUpstream(cwd: string, signal?: AbortSignal): Promise<void> {
	const result = await gitRun(cwd, ["push"], signal);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new ToolError(`Push failed:\n${detail.split("\n").map(line => `    ${line}`).join("\n")}`);
	}
}

export async function currentBranch(cwd: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function headSha(cwd: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["rev-parse", "HEAD"], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function logSubjects(cwd: string, count: number, signal?: AbortSignal): Promise<string[]> {
	const text = await gitText(cwd, ["log", `-n`, String(count), "--format=%s"], signal).catch(() => "");
	return text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
}

export async function refExists(cwd: string, ref: string, signal?: AbortSignal): Promise<boolean> {
	const result = await spawnCapture("git", ["show-ref", "--verify", "--quiet", ref], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0;
}

export async function resolveRef(cwd: string, ref: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["rev-parse", "--verify", ref], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function configGet(cwd: string, key: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["config", "--get", key], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function configSet(cwd: string, key: string, value: string, signal?: AbortSignal): Promise<void> {
	await gitText(cwd, ["config", key, value], signal);
}

export async function remoteUrl(cwd: string, name: string, signal?: AbortSignal): Promise<string | null> {
	const result = await spawnCapture("git", ["remote", "get-url", name], { cwd, env: nonInteractiveEnv(), signal, timeoutMs: 10_000 });
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function remoteList(cwd: string, signal?: AbortSignal): Promise<string[]> {
	return gitLines(cwd, ["remote"], signal).catch(() => []);
}

export async function remoteAdd(cwd: string, name: string, url: string, signal?: AbortSignal): Promise<void> {
	await gitText(cwd, ["remote", "add", name, url], signal);
}

export async function fetchRef(
	cwd: string,
	remote: string,
	headRef: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	const result = await spawnCapture("git", ["fetch", remote, `+refs/heads/${headRef}:refs/remotes/${remote}/${headRef}`], {
		cwd,
		env: nonInteractiveEnv(),
		signal,
		timeoutMs,
	});
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new ToolError(`git fetch failed for ${remote}/${headRef}: ${detail}`);
	}
}

export async function createBranch(cwd: string, name: string, at: string, force: boolean, signal?: AbortSignal): Promise<void> {
	const args = ["branch", ...(force ? ["--force"] : []), name, at];
	await gitText(cwd, args, signal);
}

export async function push(
	cwd: string,
	options: { remote: string; refspec: string; forceWithLease?: boolean },
	signal?: AbortSignal,
): Promise<void> {
	const args = ["push", ...(options.forceWithLease ? ["--force-with-lease"] : []), options.remote, options.refspec];
	const result = await gitRun(cwd, args, signal);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new ToolError(`git push failed:\n${detail.split("\n").map(line => `    ${line}`).join("\n")}`);
	}
}

export async function worktreeList(cwd: string, signal?: AbortSignal): Promise<Array<{ path: string; branch: string | null }>> {
	const text = await gitText(cwd, ["worktree", "list", "--porcelain"], signal).catch(() => "");
	const worktrees: Array<{ path: string; branch: string | null }> = [];
	let current: { path: string; branch: string | null } | null = null;
	for (const line of text.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current) worktrees.push(current);
			current = { path: line.slice("worktree ".length).trim(), branch: null };
		} else if (line.startsWith("branch ") && current) {
			current.branch = line.slice("branch ".length).trim();
		}
	}
	if (current) worktrees.push(current);
	return worktrees;
}

export async function worktreeAdd(cwd: string, path: string, branch: string, signal?: AbortSignal): Promise<void> {
	const result = await gitRun(cwd, ["worktree", "add", path, branch], signal);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new ToolError(`git worktree add failed:\n${detail.split("\n").map(line => `    ${line}`).join("\n")}`);
	}
}

/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import * as path from "node:path";
import { ToolError, untilAborted } from "../errors.ts";
import { gitText } from "../git/repo.ts";
import { ghText } from "./runner.ts";

export function formatAuthor(author: { login?: string; name?: string | null } | null | undefined): string | undefined {
	if (!author) return undefined;
	if (author.login) return `@${author.login}`;
	if (author.name) return author.name;
	return undefined;
}

export function formatLabels(labels: Array<{ name?: string }> | undefined): string | undefined {
	const names = labels?.map(label => label.name).filter((value): value is string => Boolean(value)) ?? [];
	if (names.length === 0) return undefined;
	return names.join(", ");
}

export function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trim();
}

export function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trimEnd();
}

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

export function normalizePrIdentifierList(value: string | string[] | undefined): string[] {
	if (value === undefined) return [];
	const raw = typeof value === "string" ? [value] : value;
	const cleaned: string[] = [];
	for (const entry of raw) {
		const trimmed = entry?.trim();
		if (trimmed) cleaned.push(trimmed);
	}
	return cleaned;
}

export function requireNonEmpty(value: string | null | undefined, label: string): string {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		throw new ToolError(`${label} must not be empty`);
	}
	return normalized;
}

export function appendRepoFlag(args: string[], repo: string | undefined, identifier?: string): void {
	// A full URL identifier already names host, repo, and number; `gh` derives
	// all three from it and rejects a competing `--repo`.
	if (!repo || identifier?.startsWith("https://")) {
		return;
	}
	args.push("--repo", repo);
}

/** The host `gh` assumes when a ref names none and `GH_HOST` is unset. */
export const GITHUB_HOST = "github.com";

/** A repository in the GitHub CLI's `[HOST/]OWNER/REPO` form. */
export interface GhRepoRef {
	host?: string;
	/** `OWNER/REPO`, never host-qualified. */
	slug: string;
}

/** Split `[HOST/]OWNER/REPO`; anything with another shape is taken as a slug. */
export function parseRepoRef(repo: string): GhRepoRef {
	const firstSlash = repo.indexOf("/");
	if (firstSlash < 0) return { slug: repo };
	const secondSlash = repo.indexOf("/", firstSlash + 1);
	if (secondSlash < 0 || repo.includes("/", secondSlash + 1)) return { slug: repo };
	return { host: repo.slice(0, firstSlash), slug: repo.slice(firstSlash + 1) };
}

/** Join a known host and `OWNER/REPO` into the form `--repo` accepts. */
export function formatRepoRef(host: string | undefined, slug: string): string {
	return host ? `${host}/${slug}` : slug;
}

/** `gh api` endpoint paths carry no host, so a ref has to name its host with a flag instead. */
export function ghApiHostArgs(ref: GhRepoRef): string[] {
	return ref.host ? ["--hostname", ref.host] : [];
}

const REPO_URL_PATTERN = /^https?:\/\/([^\/]+)\/([^\/]+)\/([^\/?#]+)/;

/** `https://HOST/OWNER/REPO` → the repository's identity, keeping the host when `gh` would not have assumed it. */
export function repoFromUrl(value: string | undefined): string | undefined {
	const match = REPO_URL_PATTERN.exec(value?.trim() ?? "");
	if (!match) return undefined;
	const host = match[1]!.toLowerCase();
	const slug = `${match[2]}/${match[3]}`;
	return host === defaultGhHost() ? slug : formatRepoRef(host, slug);
}

export const PR_URL_PATTERN = /^https:\/\/([^\/]+)\/([^\/]+\/[^\/]+)\/pull\/(\d+)(?:\/.*)?$/;
export const ISSUE_URL_PATTERN = /^https:\/\/([^\/]+)\/([^\/]+\/[^\/]+)\/issues\/(\d+)(?:\/.*)?$/;

export function parsePullRequestUrl(value: string | undefined): { repo?: string; prNumber?: number } {
	const normalized = normalizeOptionalString(value);
	if (!normalized) return {};
	const match = normalized.match(PR_URL_PATTERN);
	if (!match) return {};
	return { repo: formatRepoRef(match[1], match[2]), prNumber: Number(match[3]) };
}

export function parseIssueUrl(value: string | undefined): { repo?: string; issueNumber?: number } {
	const normalized = normalizeOptionalString(value);
	if (!normalized) return {};
	const match = normalized.match(ISSUE_URL_PATTERN);
	if (!match) return {};
	return { repo: formatRepoRef(match[1], match[2]), issueNumber: Number(match[3]) };
}

/** Parse a digit-only decimal positive integer or return undefined. */
export function parsePositiveDecimalInt(value: string | undefined): number | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const num = Number(value);
	if (!Number.isSafeInteger(num) || num <= 0) return undefined;
	return num;
}

/** The host `gh` falls back to for any ref that names none. */
export function defaultGhHost(): string {
	return (process.env.GH_HOST || GITHUB_HOST).toLowerCase();
}

function effectiveHost(ref: GhRepoRef): string {
	return ref.host?.toLowerCase() ?? defaultGhHost();
}

/** Case-insensitive repo comparison over the instance each ref actually resolves to. */
export function githubRepoSlugEquals(left: string | undefined, right: string): boolean {
	if (left === undefined) return false;
	const leftRef = parseRepoRef(left);
	const rightRef = parseRepoRef(right);
	if (effectiveHost(leftRef) !== effectiveHost(rightRef)) return false;
	return leftRef.slug.toLowerCase() === rightRef.slug.toLowerCase();
}

export async function requireCurrentGitBranch(cwd: string, signal?: AbortSignal): Promise<string> {
	const branch = await gitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], signal).catch(() => null);
	if (!branch) {
		throw new ToolError("Current git branch is unavailable. Pass `branch` or `run` explicitly.");
	}
	return branch;
}

export async function requireCurrentGitHead(cwd: string, signal?: AbortSignal): Promise<string> {
	const headSha = await gitText(cwd, ["rev-parse", "HEAD"], signal).catch(() => null);
	if (!headSha) {
		throw new ToolError("Current git HEAD is unavailable. Pass `run` explicitly.");
	}
	return headSha;
}

/** Ask `gh` which repository the checkout points at, as `[HOST/]OWNER/REPO`. */
async function resolveRepoFromCwd(cwd: string, signal?: AbortSignal): Promise<string> {
	const url = requireNonEmpty(await ghText(cwd, ["repo", "view", "--json", "url", "-q", ".url"], signal), "repo");
	const repo = repoFromUrl(url);
	if (!repo) {
		throw new ToolError(`GitHub CLI returned an unrecognized repository URL: ${url}`);
	}
	return repo;
}

export async function resolveGitHubRepo(
	cwd: string,
	repo: string | undefined,
	runRepo: string | undefined,
	signal?: AbortSignal,
): Promise<string> {
	if (repo && runRepo && !githubRepoSlugEquals(repo, runRepo)) {
		throw new ToolError("run URL repository does not match the provided repo");
	}
	if (repo) return repo;
	if (runRepo) return runRepo;
	return resolveRepoFromCwd(cwd, signal);
}

/** Process-lifetime cache of `gh repo view` lookups keyed by absolute cwd. */
const DEFAULT_REPO_RESOLVED = new Map<string, string>();
const DEFAULT_REPO_INFLIGHT = new Map<string, Promise<string>>();

export async function resolveDefaultRepoMemoized(cwd: string, signal?: AbortSignal): Promise<string> {
	const key = path.resolve(cwd);
	const ready = DEFAULT_REPO_RESOLVED.get(key);
	if (ready) return ready;
	let pending = DEFAULT_REPO_INFLIGHT.get(key);
	if (!pending) {
		pending = (async () => {
			const value = await resolveRepoFromCwd(cwd);
			DEFAULT_REPO_RESOLVED.set(key, value);
			return value;
		})();
		void pending.then(
			() => DEFAULT_REPO_INFLIGHT.delete(key),
			() => DEFAULT_REPO_INFLIGHT.delete(key),
		);
		DEFAULT_REPO_INFLIGHT.set(key, pending);
	}
	return untilAborted(signal, pending);
}

/** Best-effort cwd → `owner/repo` resolution that swallows failure into undefined. */
export async function tryResolveCurrentRepo(cwd: string, signal: AbortSignal | undefined): Promise<string | undefined> {
	try {
		return await resolveDefaultRepoMemoized(cwd, signal);
	} catch {
		return undefined;
	}
}

/** Best-effort fresh cwd → `owner/repo` resolution, bypassing the process-lifetime cache. */
export async function tryResolveCurrentRepoFresh(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	try {
		return await resolveGitHubRepo(cwd, undefined, undefined, signal);
	} catch {
		return undefined;
	}
}

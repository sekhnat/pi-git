/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * The commit agent hides these machine-generated files from analysis so the
 * model does not waste tokens on them and does not treat them as evidence for
 * commit boundaries. Deterministic post-plan placement then attaches them so
 * the split validator does not reject the plan (see upstream issue #4632).
 */

import type { SplitCommitPlan } from "./types.ts";

/** Lock file basename -> ordered sibling manifests. */
export const LOCK_FILE_MANIFESTS: Readonly<Record<string, readonly string[]>> = {
	"Cargo.lock": ["Cargo.toml"],
	"package-lock.json": ["package.json"],
	"yarn.lock": ["package.json"],
	"pnpm-lock.yaml": ["package.json"],
	"bun.lock": ["package.json"],
	"bun.lockb": ["package.json"],
	"go.sum": ["go.mod"],
	"poetry.lock": ["pyproject.toml"],
	"Pipfile.lock": ["Pipfile"],
	"uv.lock": ["pyproject.toml"],
	"composer.lock": ["composer.json"],
	"Gemfile.lock": ["Gemfile"],
	"flake.lock": ["flake.nix"],
	"pubspec.lock": ["pubspec.yaml"],
	"Podfile.lock": ["Podfile"],
	"mix.lock": ["mix.exs"],
	"gradle.lockfile": ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
};

export const EXCLUDED_LOCK_FILES: ReadonlySet<string> = new Set(Object.keys(LOCK_FILE_MANIFESTS));

/**
 * Attach staged lock files the model never saw to the split plan.
 *
 * Placement precedence per lock file:
 *   1. commit group that touches a sibling manifest (same directory)
 *   2. commit group that touches a manifest in any directory
 *   3. last commit group (fallback)
 */
export function assignLockFilesToPlan(plan: SplitCommitPlan, stagedFiles: readonly string[]): void {
	if (plan.commits.length === 0) return;

	const planned = new Set(plan.commits.flatMap(commit => commit.changes.map(change => change.path)));
	const orphanedLockFiles: string[] = [];
	for (const file of stagedFiles) {
		if (planned.has(file)) continue;
		const parts = file.split("/");
		const basename = parts[parts.length - 1] ?? file;
		if (EXCLUDED_LOCK_FILES.has(basename)) orphanedLockFiles.push(file);
	}
	if (orphanedLockFiles.length === 0) return;

	for (const lockFile of orphanedLockFiles) {
		const parts = lockFile.split("/");
		const basename = parts[parts.length - 1] ?? lockFile;
		const dir = parts.slice(0, -1).join("/");
		const manifests = LOCK_FILE_MANIFESTS[basename] ?? [];
		const targetIndex = findManifestCommitIndex(plan, dir, manifests);
		plan.commits[targetIndex]!.changes.push({ path: lockFile, kind: "all" });
		planned.add(lockFile);
	}
}

function findManifestCommitIndex(plan: SplitCommitPlan, lockDir: string, manifests: readonly string[]): number {
	// Prefer a manifest in the same directory as the lock file — the strongest
	// semantic signal (e.g. workspace-crate Cargo.toml next to Cargo.lock).
	for (const manifestName of manifests) {
		for (let i = 0; i < plan.commits.length; i++) {
			for (const change of plan.commits[i]!.changes) {
				const parts = change.path.split("/");
			const basename = parts[parts.length - 1] ?? change.path;
			const dir = parts.slice(0, -1).join("/");
			if (basename === manifestName && dir === lockDir) return i;
		}
		}
	}
	// Fall back to any matching manifest — a monorepo may lock at repo root
	// while the manifest sits under a subpath.
	for (const manifestName of manifests) {
		for (let i = 0; i < plan.commits.length; i++) {
			for (const change of plan.commits[i]!.changes) {
				const parts = change.path.split("/");
				if ((parts[parts.length - 1] ?? "") === manifestName) return i;
			}
		}
	}
	// Nothing matched: attach to the last commit so the file still ships.
	return plan.commits.length - 1;
}

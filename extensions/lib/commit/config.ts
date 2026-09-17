/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** Runtime thresholds copied from llm-git's standard commit workflow (upstream). */
export interface ConventionalGenerationConfig {
	readonly summaryGuideline: number;
	readonly summarySoftLimit: number;
	readonly summaryHardLimit: number;
	readonly maxDiffLength: number;
	readonly maxDiffTokens: number;
	readonly wideChangeThreshold: number;
	readonly excludedFiles: readonly string[];
	readonly lowPriorityExtensions: readonly string[];
	readonly wideChangeAbstract: boolean;
}

const EXCLUDED_FILES: readonly string[] = [
	"Cargo.lock",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"shrinkwrap.yaml",
	"bun.lock",
	"bun.lockb",
	"deno.lock",
	"composer.lock",
	"Gemfile.lock",
	"poetry.lock",
	"Pipfile.lock",
	"pdm.lock",
	"uv.lock",
	"go.sum",
	"flake.lock",
	"pubspec.lock",
	"Podfile.lock",
	"Packages.resolved",
	"mix.lock",
	"packages.lock.json",
	"gradle.lockfile",
];

const LOW_PRIORITY_EXTENSIONS: readonly string[] = [
	".lock",
	".snap",
	".sum",
	".toml",
	".yaml",
	".yml",
	".json",
	".md",
	".txt",
	".log",
	".tmp",
	".bak",
];

export const DEFAULT_CONVENTIONAL_GENERATION_CONFIG: ConventionalGenerationConfig = {
	summaryGuideline: 72,
	summarySoftLimit: 96,
	summaryHardLimit: 128,
	maxDiffLength: 100_000,
	maxDiffTokens: 25_000,
	wideChangeThreshold: 0.5,
	excludedFiles: EXCLUDED_FILES,
	lowPriorityExtensions: LOW_PRIORITY_EXTENSIONS,
	wideChangeAbstract: true,
};

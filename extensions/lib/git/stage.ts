/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Ported from pi-vcs's Rust stage_hunks/validate_hunk_selections: builds a
 * patch of only the selected hunks from a saved diff and applies it to the
 * index via `git apply --cached` (oh-my-pi applies it through gix directly).
 */

import { ToolError } from "../errors.ts";
import { nonInteractiveEnv, spawnCapture } from "../spawn.ts";
import { parseFileDiffs, parseFileHunks, type FileDiff, type FileHunks } from "./diff.ts";
import type { FileChange } from "../commit/types.ts";

/** Select the hunks a change spec refers to, 1-based like the model sees. */
function selectHunks(fileHunks: FileHunks, change: FileChange): typeof fileHunks.hunks {
	if (change.kind === "all") return fileHunks.hunks;
	if (change.kind === "indices") {
		const wanted = new Set(change.indices.map(value => Math.max(1, Math.floor(value))));
		return fileHunks.hunks.filter((hunk, index) => wanted.has(index + 1));
	}
	const start = change.start;
	const end = change.end;
	return fileHunks.hunks.filter(hunk => {
		const first = hunk.newStart;
		const last = first + hunk.newLines - 1;
		return first <= end && last >= start;
	});
}

/** Everything from the file header down to (not including) the first @@ hunk. */
function extractFileHeader(content: string): string {
	const lines = content.split("\n");
	const firstHunk = lines.findIndex(line => line.startsWith("@@"));
	const headerLines = firstHunk < 0 ? lines : lines.slice(0, firstHunk);
	return headerLines.join("\n");
}

export function buildSelectedPatch(diff: string, selections: FileChange[]): string {
	const files = parseFileDiffs(diff);
	const byPath = new Map<string, FileDiff>();
	for (const file of files) {
		// Prefer the new path; fall back to the old one for deletions.
		const match = file.content.match(/diff --git a\/(.+?) b\/(.+)$/m);
		const newPath = match?.[2];
		const oldPath = match?.[1];
		if (newPath) byPath.set(newPath, file);
		if (oldPath && !byPath.has(oldPath)) byPath.set(oldPath, file);
	}

	const parts: string[] = [];
	for (const selection of selections) {
		const file = byPath.get(selection.path);
		if (!file) {
			throw new ToolError(`No diff found for ${selection.path}`);
		}
		if (file.isBinary) {
			if (selection.kind !== "all") {
				throw new ToolError(`Cannot select hunks for binary file ${selection.path}`);
			}
			parts.push(file.content);
			continue;
		}
		if (selection.kind === "all") {
			parts.push(file.content);
			continue;
		}
		const fileHunks = parseFileHunks(file);
		const selected = selectHunks(fileHunks, selection);
		if (selected.length === 0) {
			throw new ToolError(`No hunks selected for ${selection.path}`);
		}
		let part = extractFileHeader(file.content);
		for (const hunk of selected) {
			if (!part.endsWith("\n")) part += "\n";
			part += hunk.content;
		}
		parts.push(part);
	}
	return parts.map(part => (part.endsWith("\n") ? part : `${part}\n`)).join("");
}

/** Apply a patch to the index (git apply --cached). */
export async function applyPatchToIndex(cwd: string, patch: string, signal?: AbortSignal): Promise<void> {
	if (!patch.trim()) return;
	const result = await spawnCapture("git", ["apply", "--cached", "-"], {
		cwd,
		env: nonInteractiveEnv(),
		signal,
		timeoutMs: 60_000,
		input: patch,
	});
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || "patch did not apply";
		throw new ToolError(`git apply --cached failed: ${detail}`);
	}
}

/** Stage the selected hunks of a saved staged diff back into the index. */
export async function stageHunks(cwd: string, selections: FileChange[], stagedDiff: string, signal?: AbortSignal): Promise<void> {
	if (selections.length === 0) return;
	const patch = buildSelectedPatch(stagedDiff, selections);
	await applyPatchToIndex(cwd, patch, signal);
}

export interface HunkSelectionError {
	path: string;
	message: string;
}

/** Check the model's hunk selectors against the diff (ported from validate_hunk_selections). */
export function validateHunkSelections(rawDiff: string, selections: FileChange[]): HunkSelectionError[] {
	let files: FileDiff[];
	try {
		files = parseFileDiffs(rawDiff);
	} catch {
		return [];
	}
	const byPath = new Map<string, FileDiff>();
	for (const file of files) {
		const match = file.content.match(/diff --git a\/(.+?) b\/(.+)$/m);
		if (match?.[2]) byPath.set(match[2], file);
		if (match?.[1] && !byPath.has(match[1])) byPath.set(match[1], file);
	}
	const errors: HunkSelectionError[] = [];
	for (const selection of selections) {
		const file = byPath.get(selection.path);
		if (!file) continue;
		if (selection.kind === "all") continue;
		if (file.isBinary) {
			errors.push({
				path: selection.path,
				message: `Cannot select hunks for binary file ${selection.path}`,
			});
			continue;
		}
		const fileHunks = parseFileHunks(file);
		if (selectHunks(fileHunks, selection).length === 0) {
			errors.push({
				path: selection.path,
				message: `No hunks selected for ${selection.path}`,
			});
		}
	}
	return errors;
}

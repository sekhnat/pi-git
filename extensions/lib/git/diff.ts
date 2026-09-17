/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** One parsed unified-diff hunk. */
export interface DiffHunk {
	index: number;
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	content: string;
}

/** Parsed file section used by hunk selection. */
export interface FileDiff {
	filename: string;
	content: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
}

/** Parsed hunks for one changed file. */
export interface FileHunks {
	filename: string;
	isBinary: boolean;
	hunks: DiffHunk[];
}

/** One parsed `git diff --numstat` row. */
export interface NumstatEntry {
	path: string;
	additions: number;
	deletions: number;
}

export function parseNumstat(output: string): NumstatEntry[] {
	const entries: NumstatEntry[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const [addedRaw, deletedRaw, pathRaw] = parts;
		const additions = Number.parseInt(addedRaw ?? "0", 10);
		const deletions = Number.parseInt(deletedRaw ?? "0", 10);
		entries.push({
			path: extractPathFromRename(pathRaw ?? ""),
			additions: Number.isNaN(additions) ? 0 : additions,
			deletions: Number.isNaN(deletions) ? 0 : deletions,
		});
	}
	return entries;
}

export function parseFileDiffs(diff: string): FileDiff[] {
	const sections: FileDiff[] = [];
	// Split on a line-start lookahead so each block keeps its terminating
	// newline(s) verbatim — consuming the delimiter would corrupt binary diffs.
	const parts = diff.split(/^(?=diff --git )/m);
	for (const part of parts) {
		if (!part.trim()) continue;
		const lines = part.split("\n");
		const header = lines[0] ?? "";
		const match = header.match(/diff --git a\/(.+?) b\/(.+)$/);
		if (!match) continue;
		const filename = match[2]!;
		const isBinary = lines.some(line => line.startsWith("Binary files "));
		let additions = 0;
		let deletions = 0;
		for (const line of lines) {
			if (line.startsWith("+++") || line.startsWith("---")) continue;
			if (line.startsWith("+")) additions += 1;
			else if (line.startsWith("-")) deletions += 1;
		}
		sections.push({ filename, content: part, additions, deletions, isBinary });
	}
	return sections;
}

export function parseDiffHunks(diff: string): FileHunks[] {
	return parseFileDiffs(diff).map(file => parseFileHunks(file));
}

export function parseFileHunks(fileDiff: FileDiff): FileHunks {
	if (fileDiff.isBinary) {
		return { filename: fileDiff.filename, isBinary: true, hunks: [] };
	}

	const lines = fileDiff.content.split("\n");
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let buffer: string[] = [];
	let index = 0;

	for (const line of lines) {
		if (line.startsWith("@@")) {
			if (current) {
				current.content = buffer.join("\n");
				hunks.push(current);
			}
			const headerData = parseHunkHeader(line);
			current = {
				index,
				header: line,
				oldStart: headerData.oldStart,
				oldLines: headerData.oldLines,
				newStart: headerData.newStart,
				newLines: headerData.newLines,
				content: "",
			};
			buffer = [line];
			index += 1;
			continue;
		}
		if (current) buffer.push(line);
	}

	if (current) {
		current.content = buffer.join("\n");
		hunks.push(current);
	}

	return { filename: fileDiff.filename, isBinary: fileDiff.isBinary, hunks };
}

function parseHunkHeader(line: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } {
	const match = line.match(/@@\s-([0-9]+)(?:,([0-9]+))?\s\+([0-9]+)(?:,([0-9]+))?\s@@/);
	if (!match) return { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0 };
	const oldStart = Number.parseInt(match[1] ?? "0", 10);
	const oldLines = Number.parseInt(match[2] ?? "1", 10);
	const newStart = Number.parseInt(match[3] ?? "0", 10);
	const newLines = Number.parseInt(match[4] ?? "1", 10);
	return {
		oldStart: Number.isNaN(oldStart) ? 0 : oldStart,
		oldLines: Number.isNaN(oldLines) ? 0 : oldLines,
		newStart: Number.isNaN(newStart) ? 0 : newStart,
		newLines: Number.isNaN(newLines) ? 0 : newLines,
	};
}

/** Extract a rename destination from git's brace or arrow numstat syntax. */
export function extractPathFromRename(pathPart: string): string {
	const value = pathPart.trim();
	const braceStart = value.indexOf("{");
	if (braceStart >= 0) {
		const arrow = value.indexOf(" => ", braceStart);
		if (arrow >= 0) {
			const braceEnd = value.indexOf("}", arrow);
		if (braceEnd >= 0) {
				return `${value.slice(0, braceStart)}${value.slice(arrow + 4, braceEnd).trim()}${value.slice(braceEnd + 1)}`.trim();
			}
		}
		return value;
	}
	const arrow = value.indexOf(" => ");
	return arrow >= 0 ? value.slice(arrow + 4).trim() : value;
}

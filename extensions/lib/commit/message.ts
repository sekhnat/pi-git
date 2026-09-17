/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import type { ConventionalAnalysis } from "./types.ts";

export function formatCommitMessage(analysis: ConventionalAnalysis, summary: string): string {
	const scopePart = analysis.scope ? `(${analysis.scope})` : "";
	const header = `${analysis.type}${scopePart}: ${summary}`;
	const bodyLines = analysis.details.map(detail => `- ${detail.text.trim()}`);
	if (bodyLines.length === 0) return header;
	return `${header}\n\n${bodyLines.join("\n")}`;
}

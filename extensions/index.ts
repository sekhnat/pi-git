/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Registers:
 * - `github` tool (all ops through `gh`) — only when the gh CLI is on PATH
 * - `/commit` command — agentic atomic commit analysis
 * - `pi-git-commit-plan` entry renderer — TUI-only transcript display
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { registerGithubTool } from "./lib/github-tool.ts";
import { registerCommitCommand } from "./lib/commit-command.ts";

export default function (pi: ExtensionAPI) {
	const githubRegistered = registerGithubTool(pi);
	registerCommitCommand(pi);

	pi.registerEntryRenderer("pi-git-commit-plan", (entry, _options, theme) => {
		const data = entry.data as { text: string; dryRun?: boolean };
		const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("dim", data.dryRun ? "pi-git commit plan (dry run)" : "pi-git commit plan")));
		for (const line of data.text.split("\n")) {
			box.addChild(new Text(line));
		}
		return box;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!githubRegistered) return;
		ctx.ui.notify("pi-git: github tool active (gh CLI). Use /commit for atomic commits.", "info");
	});
}

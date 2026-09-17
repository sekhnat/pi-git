/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * ADR-0004: the commit analysis runs in a nested, isolated SDK agent session
 * (in-memory, no extension/skill/template discovery) with the commit tools as
 * its only tools.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createCommitTools } from "./tools.ts";
import { buildReminderMessage, commitSystemPrompt, commitUserPrompt, isProposalComplete } from "./prompts.ts";
import type { CommitAgentState } from "./types.ts";

export interface CommitAgentInput {
	cwd: string;
	model: Model<any>;
	thinkingLevel?: ThinkingLevel;
	userContext?: string;
	diffText?: string;
	/** Progress reporter (e.g. ctx.ui.setStatus). */
	onProgress?: (message: string) => void;
	/** Outer abort signal, honored between prompts. */
	signal?: AbortSignal;
}

const MAX_RETRIES = 3;

export async function runCommitAgentSession(input: CommitAgentInput): Promise<CommitAgentState> {
	const state: CommitAgentState = { diffText: input.diffText };
	const tools = createCommitTools(input.cwd, state);

	const loader = new DefaultResourceLoader({
		cwd: input.cwd,
		agentDir: getAgentDir(),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		systemPrompt: commitSystemPrompt(),
	});
	await loader.reload();

	const { session } = await createAgentSession({
		cwd: input.cwd,
		sessionManager: SessionManager.inMemory(input.cwd),
		resourceLoader: loader,
		model: input.model,
		thinkingLevel: input.thinkingLevel,
		customTools: tools,
		tools: tools.map(tool => tool.name),
	});

	let lastTool: string | null = null;
	const unsubscribe = session.subscribe(event => {
		if (event.type === "tool_execution_start") {
			lastTool = event.toolName;
			input.onProgress?.(`${event.toolName}…`);
		} else if (event.type === "agent_end") {
			input.onProgress?.(lastTool ? `finishing after ${lastTool}` : "analysis complete");
		}
	});

	try {
		await session.prompt(commitUserPrompt(input.userContext));

		let retryCount = 0;
		while (retryCount < MAX_RETRIES && !isProposalComplete(state)) {
			retryCount += 1;
			input.onProgress?.(`reminder ${retryCount}/${MAX_RETRIES}…`);
			await session.prompt(buildReminderMessage(retryCount, MAX_RETRIES));
		}

		return state;
	} finally {
		unsubscribe();
		session.dispose();
	}
}

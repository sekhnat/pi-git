import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import * as git from "/home/caan9/openspec/pi-extensions/pi-git/extensions/lib/git/repo.ts";
import { createCommitTools } from "/home/caan9/openspec/pi-extensions/pi-git/extensions/lib/commit/tools.ts";
import { commitSystemPrompt, commitUserPrompt } from "/home/caan9/openspec/pi-extensions/pi-git/extensions/lib/commit/prompts.ts";
import type { CommitAgentState } from "/home/caan9/openspec/pi-extensions/pi-git/extensions/lib/commit/types.ts";

const repo = await fs.mkdtemp(path.join(os.tmpdir(), "pi-git-debug-"));
await git.gitText(repo, ["init", "--initial-branch=main"]);
await git.gitText(repo, ["config", "user.email", "smoke@test"]);
await git.gitText(repo, ["config", "user.name", "smoke"]);
await fs.writeFile(path.join(repo, "math.ts"), "export function add(a, b) { return a + b; }\n");
await git.stageAll(repo);
await git.commitCreate(repo, "feat: added math helper");
await fs.writeFile(path.join(repo, "math.ts"), "export function add(a, b) { return a + b; }\nexport function mul(a, b) { return a * b; }\n");
await git.stageAll(repo);

const state: CommitAgentState = {};
const tools = createCommitTools(repo, state);
const loader = new DefaultResourceLoader({
	cwd: repo,
	agentDir: getAgentDir(),
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	systemPrompt: commitSystemPrompt(),
});
await loader.reload();
const modelSpec = process.env.PI_GIT_SMOKE_MODEL;
let model: import("@earendil-works/pi-ai").Model<any> | undefined;
if (modelSpec) {
	const rt = await ModelRuntime.create();
	const [providerId, ...rest] = modelSpec.split("/");
	const modelId = rest.join("/");
	model = rt.getAvailableSnapshot().find(m => m.provider === providerId && m.id === modelId) ?? undefined;
	if (!model) throw new Error("smoke model not found: " + modelSpec);
} else {
	const { session: outer } = await createAgentSession();
	model = outer.model;
	outer.dispose();
}
if (!model) throw new Error("no model resolved");

console.log("model:", model.provider, model.id);

const { session } = await createAgentSession({
	cwd: repo,
	sessionManager: SessionManager.inMemory(repo),
	resourceLoader: loader,
	model,
	thinkingLevel: "medium",
	customTools: tools,
	tools: tools.map(t => t.name),
});
console.log("agent tools:", session.agent.state.tools.map(t => t.name).join(", "));
console.log("system prompt head:", JSON.stringify(session.agent.state.systemPrompt.slice(0, 140)));

session.subscribe(event => {
	if (event.type === "message_end" && event.message.role === "assistant") {
		const text = event.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
		const calls = event.message.content.filter((c: any) => c.type === "toolCall").map((c: any) => c.name);
		console.log("[assistant] calls:", calls.join(",") || "(none)", "text:", text.slice(0, 120));
		console.log("[assistant raw]", JSON.stringify(event.message, null, 1).slice(0, 1500));
	}
	if (event.type === "tool_execution_end") console.log("[tool done]", event.toolName, event.isError ? "ERROR" : "ok");
	if (event.type === "agent_end") console.log("[agent_end]");
});

try {
	await session.prompt(commitUserPrompt());
	console.log("proposal after prompt:", JSON.stringify(state.proposal?.summary ?? state.splitProposal?.commits.length ?? null));
} catch (error) {
	console.log("PROMPT THREW:", error instanceof Error ? error.message : String(error));
}
session.dispose();
await fs.rm(repo, { recursive: true, force: true }).catch(() => {});

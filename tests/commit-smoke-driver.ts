/**
 * Manual smoke driver: invokes the /commit command handler directly against a
 * scratch repo with a real model — the full nested-agent dry run.
 * Run: node tests/commit-smoke-driver.ts
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import * as git from "../extensions/lib/git/repo.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CapturedCommand {
	name: string;
	options: { handler: (args: string, ctx: unknown) => Promise<void> };
}

export default async function main(): Promise<void> {
	// Scratch repo with two unrelated logical changes.
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), "pi-git-commit-smoke-"));
	await git.gitText(repo, ["init", "--initial-branch=main"]);
	await git.gitText(repo, ["config", "user.email", "smoke@test"]);
	await git.gitText(repo, ["config", "user.name", "smoke"]);
	await fs.writeFile(path.join(repo, "math.ts"), "export function add(a, b) { return a + b; }\n");
	await fs.writeFile(path.join(repo, "README.md"), "# smoke\n");
	await git.stageAll(repo);
	await git.commitCreate(repo, "feat: added math helper");
	await fs.writeFile(path.join(repo, "math.ts"), "export function add(a, b) { return a + b; }\nexport function mul(a, b) { return a * b; }\n");
	await fs.writeFile(path.join(repo, "README.md"), "# smoke\n\nA tiny math playground.\n");
	await git.stageAll(repo);
	console.log("scratch repo:", repo);

	// Register the extension against a stub and capture /commit.
	const commands: CapturedCommand[] = [];
	const stubPi = {
		registerTool: () => {},
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.push({ name, options });
		},
		registerEntryRenderer: () => {},
		appendEntry: (_type: string, data: unknown) => {
			console.log("\n--- PLAN ENTRY ---");
			console.log((data as { text: string }).text);
		},
		on: () => {},
	} as unknown as ExtensionAPI;

	const { default: factory } = await import("../extensions/index.ts");
	factory(stubPi);
	const commitCommand = commands.find(c => c.name === "commit");
	if (!commitCommand) throw new Error("/commit command was not registered");

	// Use the session-resolved default model (the same one /commit sees as ctx.model).
	const modelSpec = process.env.PI_GIT_SMOKE_MODEL;
	let model: any;
	if (modelSpec) {
		const rt = await ModelRuntime.create();
		const [providerId, ...rest] = modelSpec.split("/");
		const modelId = rest.join("/");
		model = rt.getAvailableSnapshot().find((m: any) => m.provider === providerId && m.id === modelId);
		if (!model) throw new Error("smoke model not found: " + modelSpec);
	} else {
		const { session: outerSession } = await createAgentSession();
		model = outerSession.model;
		outerSession.dispose();
		if (!model) throw new Error("no default model available");
	}
	console.log("using model:", String(model.provider) + "/" + String(model.id));

	const notices: string[] = []
	const ctx = {
		cwd: repo,
		hasUI: false,
		model,
		thinkingLevel: "medium" as const,
		signal: undefined,
		ui: {
			notify: (message: string) => notices.push(message),
			setStatus: () => {},
			confirm: async () => false,
		},
	};

	await commitCommand.options.handler("--dry-run", ctx);

	console.log("\nnotices:", JSON.stringify(notices, null, 2));
	const head = await git.headSha(repo);
	const subjects = await git.logSubjects(repo, 5);
	console.log("\nHEAD subjects (must NOT include a new commit):", subjects);
	const staged = await git.changedFiles(repo, true);
	console.log("still staged (dry run keeps the index):", staged);
	if (subjects.length !== 1) throw new Error("dry run must not create commits");
	console.log("\nSMOKE OK");
	await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
}

await main();

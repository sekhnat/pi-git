// fabric-compat union spike v2 — slim-union sizing + real leg (c) check-time probe.
import { validateToolArguments } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const repo = "/home/caan9/openspec/pi-extensions/pi-git";
const outDir = path.join(repo, ".scratch/fabric-compat/spike");

const { Type } = await import("typebox");
const { StringEnum } = await import("@earendil-works/pi-ai");

// --- slim union: descriptions only where they earn their bytes (op + the three
// tightened requireds); everything else is documented in the tool description. ---
const fmt = () => Type.Optional(StringEnum(["text", "json"]));
const s = () => Type.Optional(Type.String());
const b = () => Type.Optional(Type.Boolean());
const n = () => Type.Optional(Type.Number());
const strArr = () => Type.Optional(Type.Array(Type.String()));
const dates = () => ({ since: s(), until: s(), dateField: Type.Optional(StringEnum(["created", "updated"])), limit: n(), format: fmt() });

const slimUnion = Type.Union([
	Type.Object({ op: Type.Literal("repo_view"), repo: s(), branch: s(), format: fmt() }),
	Type.Object({ op: Type.Literal("file_read"), repo: s(), branch: s(), path: Type.String({ description: "repository-relative file path (required)" }), format: fmt() }),
	Type.Object({ op: Type.Literal("pr_create"), repo: s(), title: s(), body: s(), base: s(), head: s(), draft: b(), fill: b(), reviewer: strArr(), assignee: strArr(), label: strArr(), format: fmt() }),
	Type.Object({ op: Type.Literal("pr_checkout"), repo: s(), pr: Type.Union([Type.String(), Type.Array(Type.String())], { description: "pr number, url, or branch (required)" }), force: b(), format: fmt() }),
	Type.Object({ op: Type.Literal("pr_push"), repo: s(), branch: s(), forceWithLease: b(), format: fmt() }),
	Type.Object({ op: Type.Literal("search_issues"), repo: s(), query: s(), ...dates() }),
	Type.Object({ op: Type.Literal("search_prs"), repo: s(), query: s(), ...dates() }),
	Type.Object({ op: Type.Literal("search_code"), repo: s(), query: Type.String({ description: "search query (required)" }), limit: n(), format: fmt() }),
	Type.Object({ op: Type.Literal("search_commits"), repo: s(), query: s(), ...dates() }),
	Type.Object({ op: Type.Literal("search_repos"), query: s(), ...dates() }),
	Type.Object({ op: Type.Literal("run_watch"), repo: s(), branch: s(), run: s(), tail: n(), format: fmt() }),
], { description: "github operation" });

const flatJson = JSON.stringify((await import(path.join(repo, "extensions/lib/gh/schema.ts"))).githubSchema);
const slimJson = JSON.stringify(slimUnion);
const report = { leg_d: { flat_schema_json_chars: flatJson.length, slim_union_schema_json_chars: slimJson.length, within_4096_cap: slimJson.length <= 4096 } };

// leg (a) re-check on the slim union (requiredness must survive the trim)
const tool = { name: "github", parameters: slimUnion };
const tryArgs = (args) => {
	try { validateToolArguments(tool, { name: "github", arguments: args }); return { ok: true }; }
	catch (error) { return { ok: false, message: String(error.message).split("\n")[1]?.trim() }; }
};
report.leg_a_slim = {
	valid_pr_checkout: tryArgs({ op: "pr_checkout", pr: 27 }),
	missing_required_pr: tryArgs({ op: "pr_checkout" }),
	missing_required_path: tryArgs({ op: "file_read" }),
	missing_required_query: tryArgs({ op: "search_code" }),
	unknown_op: tryArgs({ op: "nonsense" }),
};

// legs (b)+(c): fabric's generator on the slim union
const { buildDynamicGuestDeclarations } = await import("/home/caan9/.pi/agent/npm/node_modules/pi-fabric/dist/chunks/chunk-KYXZJNV6.js");
const unionDecl = buildDynamicGuestDeclarations({ extensionTools: [{ name: "github", inputSchema: JSON.parse(slimJson) }] }).extensions;
fs.writeFileSync(path.join(outDir, "guest-union-slim.d.ts"), unionDecl);
report.leg_b_slim = {
	declaration_chars: unionDecl.length,
	renders_real_ts_union: unionDecl.includes('") | { op: "') || (unionDecl.match(/op: "/g) || []).length >= 11,
	member_count: (unionDecl.match(/op: "/g) || []).length,
};

// leg (c): tsc probe with proper ambient stubs
fs.writeFileSync(path.join(outDir, "fabric-stub.d.ts"), "type FabricCapturedToolResult = { content: Array<{ type: string; text?: string }>; details?: unknown };\n");
fs.writeFileSync(path.join(outDir, "probe-union-slim.ts"), [
	'/// <reference path="./fabric-stub.d.ts" />',
	'/// <reference path="./guest-union-slim.d.ts" />',
	"// (1) valid calls — must compile:",
	'extensions.github({ op: "pr_checkout", pr: 27 });',
	'extensions.github({ op: "file_read", path: "LICENSE", format: "json" });',
	'extensions.github({ op: "search_code", query: "hello" });',
	"// (2) missing required args — must FAIL type-check:",
	'extensions.github({ op: "pr_checkout" });',
	'extensions.github({ op: "file_read", repo: "o/r" });',
	'extensions.github({ op: "search_code", repo: "o/r" });',
	"export {};",
].join("\n"));
try {
	execSync(`npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler ${JSON.stringify(path.join(outDir, "probe-union-slim.ts"))}`, { cwd: repo, stdio: "pipe" });
	report.leg_c_slim = { check_time_failure: false, note: "compiled clean — requiredness NOT tightened (unexpected)" };
} catch (error) {
	const out = String(error.stdout || "") + String(error.stderr || "");
	const errLines = out.split("\n").filter(l => /error TS/.test(l));
	report.leg_c_slim = {
		check_time_failure: errLines.length > 0,
		error_count: errLines.length,
		errors: errLines.slice(0, 8),
		note: "errors should sit on the three missing-required lines (8-10 of probe-union-slim.ts), not the valid lines (4-6)",
	};
}

fs.writeFileSync(path.join(outDir, "spike-evidence-v2.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

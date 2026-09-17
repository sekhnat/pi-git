// fabric-compat union spike — legs (a), (b), (c), (d).
// Uses the EXACT code paths: pi's validateToolArguments (@earendil-works/pi-ai)
// and fabric's buildDynamicGuestDeclarations (pi-fabric dist chunk).
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const repo = "/home/caan9/openspec/pi-extensions/pi-git";
const outDir = path.join(repo, ".scratch/fabric-compat/spike");
fs.mkdirSync(outDir, { recursive: true });

// --- the real flat schema (current landed state) ---
const { githubSchema } = await import(path.join(repo, "extensions/lib/gh/schema.ts"));

// --- the 11-variant discriminated union exactly as task 5.1 would land it ---
const { Type } = await import("typebox");
const { StringEnum } = await import("@earendil-works/pi-ai");

const format = () => Type.Optional(StringEnum(["text", "json"], { description: "output format: text (default) or json envelope" }));
const repoParam = () => Type.Optional(Type.String({ description: "[host/]owner/repo" }));
const branchParam = () => Type.Optional(Type.String({ description: "branch" }));
const dateParams = () => ({
	since: Type.Optional(Type.String({ description: "lower-bound date filter" })),
	until: Type.Optional(Type.String({ description: "upper-bound date filter" })),
	dateField: Type.Optional(StringEnum(["created", "updated"], { description: "date field" })),
	limit: Type.Optional(Type.Number({ description: "max results" })),
});
const searchCommon = () => ({
	...dateParams(),
	format: format(),
});

const githubUnionSchema = Type.Union([
	Type.Object({ op: Type.Literal("repo_view", { description: "github operation" }), repo: repoParam(), branch: branchParam(), format: format() }),
	Type.Object({ op: Type.Literal("file_read"), repo: repoParam(), branch: branchParam(), path: Type.String({ description: "repository-relative file path" }), format: format() }, { required: ["op", "path"] }),
	Type.Object({
		op: Type.Literal("pr_create"), repo: repoParam(),
		title: Type.Optional(Type.String({ description: "pr title" })),
		body: Type.Optional(Type.String({ description: "pr body markdown" })),
		base: Type.Optional(Type.String({ description: "pr base branch" })),
		head: Type.Optional(Type.String({ description: "pr head branch" })),
		draft: Type.Optional(Type.Boolean({ description: "open pr as draft" })),
		fill: Type.Optional(Type.Boolean({ description: "auto-fill pr title/body from commits" })),
		reviewer: Type.Optional(Type.Array(Type.String(), { description: "reviewers" })),
		assignee: Type.Optional(Type.Array(Type.String(), { description: "assignees" })),
		label: Type.Optional(Type.Array(Type.String(), { description: "labels" })),
		format: format(),
	}),
	Type.Object({ op: Type.Literal("pr_checkout"), repo: repoParam(), pr: Type.Union([Type.String(), Type.Array(Type.String())], { description: "pr number, url, or branch" }), force: Type.Optional(Type.Boolean({ description: "reset existing local branch" })), format: format() }, { required: ["op", "pr"] }),
	Type.Object({ op: Type.Literal("pr_push"), repo: repoParam(), branch: branchParam(), forceWithLease: Type.Optional(Type.Boolean({ description: "force-with-lease push" })), format: format() }),
	Type.Object({ op: Type.Literal("search_issues"), repo: repoParam(), query: Type.Optional(Type.String({ description: "search query" })), ...searchCommon() }),
	Type.Object({ op: Type.Literal("search_prs"), repo: repoParam(), query: Type.Optional(Type.String({ description: "search query" })), ...searchCommon() }),
	Type.Object({ op: Type.Literal("search_code"), repo: repoParam(), query: Type.String({ description: "search query" }), limit: Type.Optional(Type.Number({ description: "max results" })), format: format() }, { required: ["op", "query"] }),
	Type.Object({ op: Type.Literal("search_commits"), repo: repoParam(), query: Type.Optional(Type.String({ description: "search query" })), ...searchCommon() }),
	Type.Object({ op: Type.Literal("search_repos"), query: Type.Optional(Type.String({ description: "search query" })), ...searchCommon() }),
	Type.Object({ op: Type.Literal("run_watch"), repo: repoParam(), branch: branchParam(), run: Type.Optional(Type.String({ description: "actions run id or url" })), tail: Type.Optional(Type.Number({ description: "log lines per failed job" })), format: format() }),
], { description: "github operation" });

const report = {};

// ---------- leg (d): sizes ----------
const flatJson = JSON.stringify(githubSchema);
const unionJson = JSON.stringify(githubUnionSchema);
report.leg_d = {
	flat_schema_json_chars: flatJson.length,
	union_schema_json_chars: unionJson.length,
	delta_chars: unionJson.length - flatJson.length,
	union_within_4096_captured_source_cap: unionJson.length <= 4096,
	flat_within_4096_captured_source_cap: flatJson.length <= 4096,
};

// ---------- leg (a): pi's exact argument validation ----------
const tool = { name: "github", parameters: githubUnionSchema };
const tryArgs = (name, args) => {
	try {
		validateToolArguments(tool, { name, arguments: args });
		return { ok: true };
	} catch (error) {
		return { ok: false, message: String(error.message).split("\n").slice(0, 3).join(" | ") };
	}
};
report.leg_a = {
	valid_pr_checkout: tryArgs("github", { op: "pr_checkout", pr: 27 }),
	missing_required_pr: tryArgs("github", { op: "pr_checkout" }),
	missing_required_path: tryArgs("github", { op: "file_read" }),
	missing_required_query: tryArgs("github", { op: "search_code", repo: "o/r" }),
	unknown_op_rejected: tryArgs("github", { op: "nonsense" }),
	op_params_ignored_not_enforced_flatstyle: tryArgs("github", { op: "repo_view", tail: 5 }),
};

// ---------- legs (b)+(c): fabric's exact captured-type generator ----------
const { buildDynamicGuestDeclarations } = await import("/home/caan9/.pi/agent/npm/node_modules/pi-fabric/dist/chunks/chunk-KYXZJNV6.js");
const flatSources = { extensionTools: [{ name: "github", inputSchema: JSON.parse(flatJson) }] };
const unionSources = { extensionTools: [{ name: "github", inputSchema: JSON.parse(unionJson) }] };
const flatDecl = buildDynamicGuestDeclarations(flatSources).extensions;
const unionDecl = buildDynamicGuestDeclarations(unionSources).extensions;
fs.writeFileSync(path.join(outDir, "guest-flat.d.ts"), flatDecl);
fs.writeFileSync(path.join(outDir, "guest-union.d.ts"), unionDecl);
report.leg_b = {
	flat_declaration_chars: flatDecl.length,
	union_declaration_chars: unionDecl.length,
	union_renders_real_ts_union: /\bop: "repo_view"\b/.test(unionDecl) && unionDecl.includes(" | "),
	union_decl_snippet: unionDecl.split("\n").filter(l => l.includes("op:")).length + " union members with op literals",
};

// ---------- leg (c): tsc check-time probe against the RENDERED declaration ----------
const probe = [
	"/// <reference path='./guest-union.d.ts' />",
	"// Valid call: compiles.",
	"extensions.github({ op: 'pr_checkout', pr: 27 });",
	"// Missing required `pr`: must FAIL type-check.",
	"extensions.github({ op: 'pr_checkout' });",
	"export {};",
].join("\n");
fs.writeFileSync(path.join(outDir, "probe-union.ts"), probe);
const { execSync } = await import("node:child_process");
let probeResult;
try {
	execSync(`npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler ${JSON.stringify(path.join(outDir, "probe-union.ts"))}`, { cwd: repo, stdio: "pipe" });
	probeResult = { check_time_failure: false, note: "compiled clean — union does NOT tighten requiredness" };
} catch (error) {
	probeResult = { check_time_failure: true, output: String(error.stderr).slice(0, 800) };
}
report.leg_c = probeResult;

fs.writeFileSync(path.join(outDir, "spike-evidence.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

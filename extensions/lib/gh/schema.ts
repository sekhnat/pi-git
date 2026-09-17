/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

// The discriminated per-op union tightens requiredness (file_read.path,
// pr_checkout.pr, search_code.query) so fabric full-code programs fail at
// check time, not dispatch. Helper shorthands keep the serialized schema under
// fabric's 4096-char captured-source cap — beyond it the captured-type channel
// silently falls back to an untyped declaration (measured in
// .scratch/fabric-compat/spike-report.md). Per-parameter descriptions live in
// the tool description, which is the single source of per-op guidance; only
// the tightened requireds carry schema text.
const optString = () => Type.Optional(Type.String());
const optBool = () => Type.Optional(Type.Boolean());
const optNumber = () => Type.Optional(Type.Number());
const optStringArray = () => Type.Optional(Type.Array(Type.String()));
const format = () => Type.Optional(StringEnum(["text", "json"] as const));
const dateParams = () => ({
	since: optString(),
	until: optString(),
	dateField: Type.Optional(StringEnum(["created", "updated"] as const)),
	limit: optNumber(),
});
const searchParams = () => ({ ...dateParams(), format: format() });

export const githubSchema = Type.Union(
	[
		Type.Object({ op: Type.Literal("repo_view"), repo: optString(), branch: optString(), format: format() }),
		Type.Object({
			op: Type.Literal("file_read"),
			repo: optString(),
			branch: optString(),
			path: Type.String({ description: "repository-relative file path (required)" }),
			format: format(),
		}),
		Type.Object({
			op: Type.Literal("pr_create"),
			repo: optString(),
			title: optString(),
			body: optString(),
			base: optString(),
			head: optString(),
			draft: optBool(),
			fill: optBool(),
			reviewer: optStringArray(),
			assignee: optStringArray(),
			label: optStringArray(),
			format: format(),
		}),
		Type.Object({
			op: Type.Literal("pr_checkout"),
			repo: optString(),
			pr: Type.Union([Type.String(), Type.Array(Type.String())], { description: "pr number, url, or branch (required)" }),
			force: optBool(),
			format: format(),
		}),
		Type.Object({ op: Type.Literal("pr_push"), repo: optString(), branch: optString(), forceWithLease: optBool(), format: format() }),
		Type.Object({ op: Type.Literal("search_issues"), repo: optString(), query: optString(), ...searchParams() }),
		Type.Object({ op: Type.Literal("search_prs"), repo: optString(), query: optString(), ...searchParams() }),
		Type.Object({
			op: Type.Literal("search_code"),
			repo: optString(),
			query: Type.String({ description: "search query (required)" }),
			limit: optNumber(),
			format: format(),
		}),
		Type.Object({ op: Type.Literal("search_commits"), repo: optString(), query: optString(), ...searchParams() }),
		Type.Object({ op: Type.Literal("search_repos"), query: optString(), ...searchParams() }),
		Type.Object({ op: Type.Literal("run_watch"), repo: optString(), branch: optString(), run: optString(), tail: optNumber(), format: format() }),
	],
	{ description: "github operation" },
);

export type GithubToolInput = Static<typeof githubSchema>;

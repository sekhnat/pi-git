/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export const githubSchema = Type.Object({
	op: StringEnum([
		"repo_view",
		"file_read",
		"pr_create",
		"pr_checkout",
		"pr_push",
		"search_issues",
		"search_prs",
		"search_code",
		"search_commits",
		"search_repos",
		"run_watch",
	] as const, { description: "github operation" }),
	repo: Type.Optional(Type.String({ description: "[host/]owner/repo" })),
	branch: Type.Optional(Type.String({ description: "branch" })),
	path: Type.Optional(Type.String({ description: "repository-relative file path" })),
	pr: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "pr number, url, or branch" })),
	force: Type.Optional(Type.Boolean({ description: "reset existing local branch" })),
	forceWithLease: Type.Optional(Type.Boolean({ description: "force-with-lease push" })),
	title: Type.Optional(Type.String({ description: "pr title" })),
	body: Type.Optional(Type.String({ description: "pr body markdown" })),
	base: Type.Optional(Type.String({ description: "pr base branch" })),
	head: Type.Optional(Type.String({ description: "pr head branch" })),
	draft: Type.Optional(Type.Boolean({ description: "open pr as draft" })),
	fill: Type.Optional(Type.Boolean({ description: "auto-fill pr title/body from commits" })),
	reviewer: Type.Optional(Type.Array(Type.String(), { description: "reviewers" })),
	assignee: Type.Optional(Type.Array(Type.String(), { description: "assignees" })),
	label: Type.Optional(Type.Array(Type.String(), { description: "labels" })),
	query: Type.Optional(Type.String({ description: "search query" })),
	since: Type.Optional(Type.String({ description: "lower-bound date filter" })),
	until: Type.Optional(Type.String({ description: "upper-bound date filter" })),
	dateField: Type.Optional(StringEnum(["created", "updated"] as const, { description: "date field" })),
	limit: Type.Optional(Type.Number({ description: "max results" })),
	run: Type.Optional(Type.String({ description: "actions run id or url" })),
	tail: Type.Optional(Type.Number({ description: "log lines per failed job" })),
});

export type GithubToolInput = Static<typeof githubSchema>;

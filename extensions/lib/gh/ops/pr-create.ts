/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ToolError } from "../../errors.ts";
import { buildTextResult, pushLine, type GhToolDetails } from "../format.ts";
import {
	appendRepoFlag,
	formatAuthor,
	formatLabels,
	normalizeOptionalString,
	normalizePrIdentifierList,
	normalizeText,
	parsePullRequestUrl,
} from "../refs.ts";
import { ghJson, ghText } from "../runner.ts";
import type { GhPrViewData, GithubInput } from "../types.ts";

const GH_PR_FIELDS_NO_COMMENTS = [
	"author",
	"baseRefName",
	"body",
	"createdAt",
	"headRefName",
	"isDraft",
	"labels",
	"mergeStateStatus",
	"number",
	"reviewDecision",
	"state",
	"title",
	"updatedAt",
	"url",
];

export async function executePrCreate(
	cwd: string,
	params: GithubInput,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: GhToolDetails }> {
	const repo = normalizeOptionalString(params.repo);
	const title = normalizeOptionalString(params.title);
	const body = params.body;
	const base = normalizeOptionalString(params.base);
	const head = normalizeOptionalString(params.head);
	const draft = params.draft ?? false;
	const fill = params.fill ?? false;
	const reviewers = normalizePrIdentifierList(params.reviewer);
	const assignees = normalizePrIdentifierList(params.assignee);
	const labels = normalizePrIdentifierList(params.label);

	if (!fill && !title) {
		throw new ToolError("title is required unless fill is true");
	}
	if (fill && (title || body !== undefined)) {
		throw new ToolError("fill is mutually exclusive with title and body");
	}

	const args = ["pr", "create"];
	appendRepoFlag(args, repo);
	if (title) args.push("--title", title);
	if (base) args.push("--base", base);
	if (head) args.push("--head", head);
	if (draft) args.push("--draft");
	if (fill) args.push("--fill");
	for (const reviewer of reviewers) args.push("--reviewer", reviewer);
	for (const assignee of assignees) args.push("--assignee", assignee);
	for (const label of labels) args.push("--label", label);

	let bodyDir: string | undefined;
	try {
		if (!fill) {
			if (body !== undefined && body.length > 0) {
				// Route through a temp file so multi-KB bodies stay clear of argv limits.
				bodyDir = await fs.mkdtemp(path.join(os.tmpdir(), "gh-pr-body-"));
				const bodyFile = path.join(bodyDir, "body.md");
				await fs.writeFile(bodyFile, body, "utf8");
				args.push("--body-file", bodyFile);
			} else {
				// Avoid gh dropping into an interactive editor when no body is given.
				args.push("--body", "");
			}
		}

		const output = await ghText(cwd, args, signal, { repoProvided: Boolean(repo) });
		const url =
			output
				.split("\n")
				.map(line => line.trim())
				.find(line => line.startsWith("https://")) ?? output.trim();
		const parsed = parsePullRequestUrl(url);
		const resolvedRepo = repo ?? parsed.repo;

		let prView: GhPrViewData | undefined;
		if (resolvedRepo && parsed.prNumber !== undefined) {
			try {
				prView = await ghJson<GhPrViewData>(
					cwd,
					["pr", "view", String(parsed.prNumber), "--repo", resolvedRepo, "--json", GH_PR_FIELDS_NO_COMMENTS.join(",")],
					signal,
					{ repoProvided: true },
				);
			} catch {
				// Best-effort summary; PR creation already succeeded.
			}
		}

		const text = formatPrCreateResult({ url, prNumber: parsed.prNumber, data: prView, title, base, head, draft });
		return buildTextResult(text, url || prView?.url, { repo: resolvedRepo });
	} finally {
		if (bodyDir) {
			await fs.rm(bodyDir, { recursive: true, force: true }).catch(() => {});
		}
	}
}

export function formatPrCreateResult(options: {
	url: string;
	prNumber?: number;
	data?: GhPrViewData;
	title?: string;
	base?: string;
	head?: string;
	draft?: boolean;
}): string {
	const number = options.prNumber ?? options.data?.number;
	const headerTitle = options.data?.title ?? options.title ?? "Untitled";
	const header =
		number !== undefined
			? `# Created Pull Request #${number}: ${headerTitle}`
			: `# Created Pull Request: ${headerTitle}`;
	const lines: string[] = [header, ""];
	pushLine(lines, "URL", options.url || options.data?.url);
	pushLine(lines, "State", options.data?.state);
	pushLine(lines, "Draft", options.data?.isDraft ?? options.draft);
	pushLine(lines, "Base", options.data?.baseRefName ?? options.base);
	pushLine(lines, "Head", options.data?.headRefName ?? options.head);
	pushLine(lines, "Author", formatAuthor(options.data?.author));
	pushLine(lines, "Created", options.data?.createdAt);
	pushLine(lines, "Labels", formatLabels(options.data?.labels));

	const bodyText = normalizeText(options.data?.body);
	if (bodyText) {
		lines.push("");
		lines.push("## Body");
		lines.push("");
		lines.push(bodyText);
	}

	return lines.join("\n").trim();
}

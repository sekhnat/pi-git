/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { ToolError } from "../../errors.ts";
import { formatBytes } from "../format.ts";
import { parseImageMetadata } from "../image.ts";
import {
	defaultGhHost,
	ghApiHostArgs,
	normalizeOptionalString,
	parseRepoRef,
	requireNonEmpty,
	resolveGitHubRepo,
} from "../refs.ts";
import { buildTextResult, type GhToolDetails } from "../format.ts";
import { ghJson } from "../runner.ts";
import type { GithubInput } from "../types.ts";

interface GitHubContentsFile {
	type?: string;
	encoding?: string;
	size?: number;
	content?: string;
	html_url?: string | null;
}

type GitHubContentsResponse = GitHubContentsFile | GitHubContentsFile[];

function isGitHubContentsFile(response: GitHubContentsResponse): response is GitHubContentsFile {
	return !Array.isArray(response) && response.type === "file";
}

/** Bytes of a file head used to sniff binary content. */
const BINARY_SNIFF_BYTES = 8000;

function isProbablyBinaryHeader(bytes: Uint8Array): boolean {
	let controlChars = 0;
	const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
	for (let index = 0; index < limit; index += 1) {
		const byte = bytes[index]!;
		if (byte === 0) return true;
		if (byte < 7 || (byte > 13 && byte < 32)) controlChars += 1;
	}
	return limit > 0 && controlChars / limit > 0.3;
}

function buildBinaryFileReadResult(
	filePath: string,
	size: number,
	sourceUrl: string,
	repo: string,
	branch: string | undefined,
): ReturnType<typeof buildTextResult> {
	return buildTextResult(
		`[Cannot read binary file '${filePath}' (${formatBytes(size)}); not valid UTF-8 text. Open ${sourceUrl} to view it.]`,
		sourceUrl,
		{ repo, branch },
	);
}

export async function executeFileRead(
	cwd: string,
	params: GithubInput,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; details: GhToolDetails }> {
	const repo = await resolveGitHubRepo(cwd, normalizeOptionalString(params.repo), undefined, signal);
	const filePath = requireNonEmpty(normalizeOptionalString(params.path), "path");
	if (filePath.startsWith("/")) {
		throw new ToolError("path must be repository-relative");
	}
	const branch = normalizeOptionalString(params.branch);
	const endpointPath = filePath
		.split("/")
		.map(segment => encodeURIComponent(segment))
		.join("/");
	const ref = parseRepoRef(repo);
	const args = [
		"api",
		...ghApiHostArgs(ref),
		`/repos/${ref.slug}/contents/${endpointPath}`,
		"--method",
		"GET",
		"-H",
		"Accept: application/vnd.github+json",
		"-H",
		"Accept-Encoding: identity",
	];
	if (branch) {
		args.push("-f", `ref=${branch}`);
	}
	let response: GitHubContentsResponse;
	try {
		response = await ghJson<GitHubContentsResponse>(cwd, args, signal, {
			repoProvided: true,
			trimOutput: false,
		});
	} catch (error) {
		if (!(error instanceof ToolError)) throw error;
		// Contents API 404s conflate repository, revision, path, and access failures.
		const revision = branch ?? "HEAD";
		throw new ToolError(
			`GitHub file read failed for '${repo}@${revision}:${filePath}': ${error.message}`,
		);
	}
	if (!isGitHubContentsFile(response)) {
		throw new ToolError(`GitHub path '${filePath}' is not a file.`);
	}

	// A host-less ref went to gh's default host, so the link has to match it.
	const fallbackHost = ref.host ?? defaultGhHost();
	const fallbackSourceUrl = `https://${fallbackHost}/${ref.slug}/blob/${encodeURIComponent(branch ?? "HEAD")}/${endpointPath}`;
	const sourceUrl = response.html_url || fallbackSourceUrl;
	if (response.encoding !== "base64" || typeof response.content !== "string") {
		const size =
			typeof response.size === "number" && response.size >= 0 ? formatBytes(response.size) : "unknown size";
		return buildTextResult(
			`[GitHub did not return file bytes for '${filePath}' (${size}). Open ${sourceUrl} to view it.]`,
			sourceUrl,
			{ repo, branch },
		);
	}

	const encoded = response.content.replaceAll(/\s/g, "");
	const bytes = Buffer.from(encoded, "base64");
	const imageMetadata = parseImageMetadata(bytes);
	if (imageMetadata) {
		const dimensions =
			imageMetadata.width !== undefined && imageMetadata.height !== undefined
				? `\nDimensions: ${imageMetadata.width}x${imageMetadata.height}`
				: "";
		return {
			content: [
				{
					type: "text",
					text: `Image file: ${filePath}\nMIME: ${imageMetadata.mimeType}\nSize: ${formatBytes(bytes.byteLength)}${dimensions}`,
				},
				{ type: "image", data: encoded, mimeType: imageMetadata.mimeType },
			],
			details: { repo, branch, sourceUrl },
		};
	}

	if (isProbablyBinaryHeader(bytes.subarray(0, BINARY_SNIFF_BYTES))) {
		return buildBinaryFileReadResult(filePath, bytes.byteLength, sourceUrl, repo, branch);
	}
	try {
		return buildTextResult(new TextDecoder("utf-8", { fatal: true }).decode(bytes), sourceUrl, { repo, branch });
	} catch {
		return buildBinaryFileReadResult(filePath, bytes.byteLength, sourceUrl, repo, branch);
	}
}

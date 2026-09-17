// Generated from the captured extension tool catalog for this execution,
// with the same advisory semantics as the generated mcp surface above.
interface FabricExtensionsApiDynamic {
  github(args: { assignee?: Array<string>; base?: string; body?: string; branch?: string; dateField?: "created" | "updated"; draft?: boolean; fill?: boolean; force?: boolean; forceWithLease?: boolean; format?: "text" | "json"; head?: string; label?: Array<string>; limit?: number; op: "repo_view" | "file_read" | "pr_create" | "pr_checkout" | "pr_push" | "search_issues" | "search_prs" | "search_code" | "search_commits" | "search_repos" | "run_watch"; path?: string; pr?: string | Array<string>; query?: string; repo?: string; reviewer?: Array<string>; run?: string; since?: string; title?: string; until?: string; [key: string]: unknown }): Promise<FabricCapturedToolResult>;
}
declare const extensions: FabricExtensionsApiDynamic;

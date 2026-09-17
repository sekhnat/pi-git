## 1. Agent skill (ticket `.scratch/fabric-compat/issues/01-skill.md`)

- [x] 1.1 Author `skills/pi-git/SKILL.md` — frontmatter (`name: pi-git`, task-matching description) plus workflow-level body (PR flow, search qualifier pointer, `run_watch` semantics, worktree expectations, `/commit` flags block, fabric-exec section) — verify no verbatim op-table duplication against the `github` tool description and body ≤ ~150 lines
- [x] 1.2 Smoke via `pi -e .`: skill listed with valid frontmatter; if the conventional `skills/` dir is not discovered, add `pi.skills` to `package.json` and record the deviation — verify the smoke output shows the skill listed
- [x] 1.3 Record ADR-0006 (skill complements the tool description; op tables single-sourced) — verify `docs/adr/0006-*.md` exists and matches what landed

## 2. json mode — schema + read ops (ticket `02-json-read-ops.md`)

- [x] 2.1 Add `format: Type.Optional(StringEnum(["text", "json"]))` to `extensions/lib/gh/schema.ts` and `GithubInput` — verify `npm run typecheck` green and every existing test passes unmodified
- [x] 2.2 Create `extensions/lib/gh/json.ts`: envelope type, `buildJsonResult`, payload builders for `repo_view` / `file_read` / `search_*` — verify unit tests for the builders pass
- [x] 2.3 Wire early-exit json branches in the repo-view / file-read / search executors; `file_read` rejects image and non-UTF-8 files with a clear `ToolError` in json mode — verify unit tests plus live json tests (`repo_view`, `search_issues`, `search_prs`; skip without gh auth) pass

## 3. json mode — write/watch ops (ticket `03-json-write-ops.md`)

- [x] 3.1 Payload builders + json wiring for `pr_create` (input fallbacks), `pr_checkout` (reuse `GhPrCheckoutSummary[]`), `pr_push` (post-push `headSha` via `resolveRef`, single-element `pushed`), `run_watch` (per-run entries with failed-job names and grouped log-file paths, no log tails) — verify unit tests with synthetic internal values pass
- [x] 3.2 Byte-identity gate: `npm run typecheck` + `npm test` green with zero modifications to existing tests — verify both commands pass
- [x] 3.3 Record ADR-0007 (opt-in json; rejected alternatives: separate json tool, always-json, details-only channel) — verify `docs/adr/0007-*.md` exists and matches what landed

## 4. Union spike — blocking (ticket `04-union-spike.md`)

- [x] 4.1 Run the spike legs (a)–(d) from design D7 with a throwaway anyOf-schema scratch extension: `registerTool` validation, fabric schema surfacing, captured-type check-time failure, prompt-bloat measurement — verify evidence is captured for each leg
- [x] 4.2 Write `.scratch/fabric-compat/spike-report.md` with per-leg evidence and an explicit go/no-go; on any failed leg include the upstream pi-fabric issue draft — verify the report is committed and the decision is unambiguous

## 5. Union — gated on the spike (ticket `05-union-impl.md`)

- [x] 5.1 On GO: replace the flat schema with the 11-variant discriminated union (op literal + per-op params, `file_read.path` / `pr_checkout.pr` / `search_code.query` required, `format` on every variant) and keep dispatch exhaustive — verify `tsc --noEmit` green and a fabric_exec full-code program omitting `pr` on `pr_checkout` fails at check time (record the demo)
- [x] 5.2 On NO-GO: keep the flat schema, confirm runtime requiredness tests cover `path` / `pr` / `query` — verify the spike report's findings and upstream draft stand as the record *(branch not taken — spike verdict GO; the report records the dispatch-vs-check-time enforcement nuance and the upstream draft instead)*
- [x] 5.3 Either way: record ADR-0008 (union or fallback, citing the spike report) and sanity-check prompt bloat against the spike numbers — verify `docs/adr/0008-*.md` matches the landed state

## 6. Docs + tracker hygiene (ticket `06-docs.md`)

- [x] 6.1 README: document the skill (loading convention, what it steers) and add a fabric interop section (`extensions.github(...)`, `format: "json"`, `tools.list`); correct ADR-0003's "twelve operations" count to 11 in passing — verify claims match the implementation
- [x] 6.2 Verify ADR-0006..0008 all exist and match landed reality (each lands with its workstream; this is the completeness check) — verify `ls docs/adr/` shows 0006–0008
- [x] 6.3 Keep `.scratch/fabric-compat/issues/01..06` Status lines current as work lands; on completion each ticket records its outcome — verify every ticket's Status line matches its outcome

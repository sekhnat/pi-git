# pi-fabric compatibility: agent skill, JSON output, discriminated schema

**Status**: proposed

pi-fabric (https://github.com/monotykamary/pi-fabric) captures pi-git's `github` tool as `extensions.github` and, in full-code mode, statically type-checks calls against the tool's JSON schema. The interop works today but is text-shaped and flat: results are formatted prose that fabric programs must string-scrape, the schema makes every param optional for every op, and no skill steers agents to the tool over `pi.bash` + `gh`. This spec closes those three gaps. Out of scope: npm publishing/package.json parity and an MCP server wrapper (tracked separately if wanted).

## Workstream 1 — agent skill (ADR-0006, record on landing)

Ship `skills/pi-git/SKILL.md` — a package `skills/` directory (pi loads skills from packages per docs/skills.md; declare `pi.skills` in package.json only if the conventional dir is not picked up).

- **Complements, never duplicates** the tool description: op tables and per-op param rules live in the tool description; the skill carries workflow-level guidance — PR flow (`pr_checkout` → work → `pr_push` / `pr_create` with `fill`), search qualifier syntax pointer, `run_watch` polling semantics, worktree expectations.
- Frontmatter: `name: pi-git`, task-matching description (GitHub repos/PRs/searches/Actions runs and atomic commits from pi sessions).
- One fabric-exec section: captured name `extensions.github(...)`, prefer it over `pi.bash` + `gh`, `tools.list` for the schema, `file_read` over `curl`/`wget` for hosted files.
- `/commit` flags in one block.
- Progressive disclosure: description always in context; body loads on demand; body target ≤ ~150 lines.

## Workstream 2 — `format: "json"` opt-in (ADR-0007)

Add `format: Type.Optional(StringEnum(["text", "json"]))` to the schema; omitted = text. The default path must stay byte-identical — all existing tests pass unmodified.

In json mode the content channel carries a JSON envelope; `details` stays populated in both modes (renderers unchanged):

```
{ "op": "...", "repo": "owner/repo"?, "data": <per-op payload> }
```

| op | `data` payload (reuse existing internal shapes) |
|---|---|
| `repo_view` | `GhRepoViewData` — the `gh repo view --json` object |
| `file_read` | `{ repo, branch, path, content }` — text files only; image read + json → clear error |
| `search_*` | `{ total_count, incomplete_results, items }` with the existing normalized item shapes |
| `pr_create` | `GhPrViewData` subset: number, url, state, isDraft, baseRefName, headRefName |
| `pr_checkout` | `{ checkouts: GhPrCheckoutSummary[] }` |
| `pr_push` | `{ pushed: PrBranchPushTarget[], headSha }` |
| `run_watch` | `{ runs: [{ runId, url, status, conclusion, failedJobs, logFiles }], branch?, headSha? }` — log tails stay a text-mode presentation; json carries job names + log paths |

Rejected alternatives: a separate json tool (violates ADR-0003's single-tool shape); always-json (breaks omp-parity text output for the model); details-only channel (fabric programs read `content`, not `details`).

## Workstream 3 — discriminated per-op schema union (ADR-0008, gated)

Replace the flat object with `Type.Union` of 11 per-op objects, each an `op` literal plus exactly its params, requiredness tightened:

- `file_read`: `path` required. `pr_checkout`: `pr` required. `search_code`: `query` required. All others keep current optionality.

Why: fabric full-code type-checks `extensions.github(args)` from the captured schema; per-op variants turn missing-`pr`/`path` from runtime failures into check-time errors inside fabric programs, and tsc exhaustiveness keeps the internal dispatch honest.

**Spike first (blocking)**: verify (a) pi's `registerTool` accepts a top-level `anyOf` schema and validates args against it; (b) fabric `tools.list` surfaces the union intact; (c) fabric's captured-type generation maps `anyOf` to a real TS union — a full-code program omitting `pr` on `pr_checkout` fails at check time. Spike report lands in this directory.

**Fallback if (a)–(c) fail anywhere**: keep the flat schema, keep runtime requiredness, record findings here and draft an upstream pi-fabric issue; the union lands only when support exists. Also sanity-check model-facing rendering: if the union bloats the tool listing badly in the system prompt, that alone is fallback grounds.

## Acceptance ledger

- [ ] `pi -e .` smoke: `pi-git` skill listed with valid frontmatter; body ≤ ~150 lines; no verbatim duplication of the tool description's op tables
- [ ] README documents the skill and a fabric interop section
- [ ] `format` param added; all existing tests pass unmodified (default = text)
- [ ] json envelope per contract: live tests for `repo_view` / `search_issues` / `search_prs`; unit tests for the `pr_create` / `pr_checkout` / `pr_push` / `run_watch` envelope builders; `file_read` image + json → clear error
- [ ] spike report committed (validator + capture + type-gen evidence); union decision resolved from it
- [ ] union landed (or fallback documented): `tsc --noEmit` green with exhaustive dispatch; check-time failure demonstrated in a fabric_exec program; prompt bloat sanity-checked
- [ ] `npm run typecheck` + `npm test` green

## Proposed issues

`.scratch/fabric-compat/issues/` (per issue-tracker.md, one file per ticket, `Status:` triage line):

- `01-skill.md` — author + smoke the SKILL.md (workstream 1)
- `02-json-read-ops.md` — `format` param, envelope builder, read-op tests (workstream 2)
- `03-json-write-ops.md` — write/watch-op json payloads (workstream 2)
- `04-union-spike.md` — validator/capture/type-gen spike + report (workstream 3, blocking)
- `05-union-impl.md` — union schema, gated on 04 (workstream 3)
- `06-docs.md` — README updates + ADR-0006..0008 records

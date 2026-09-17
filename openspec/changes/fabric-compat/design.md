## Context

See proposal.md — Why. Current state that shapes the approach:

- The `github` tool (`extensions/lib/github-tool.ts`) registers one flat typebox schema (`extensions/lib/gh/schema.ts`): 11 ops, ~23 parameters, every parameter optional for every op. Dispatch is an exhaustive `switch` with a `never` default, so `tsc` keeps the op set honest.
- Every op executor in `extensions/lib/gh/ops/` returns `{ content, details }`: content is rendered Markdown text (or image + caption for `file_read` on images); details is a `GhToolDetails` record (`format.ts`) consumed by the TUI renderer — fabric programs read `content`, not `details`.
- Every payload the json contract needs already exists inside the executors at render time: `GhRepoViewData` (repo-view), decoded bytes + repo/branch/path (file-read), `{ total_count, incomplete_results }` plus normalized items via `apiXToSearchResult` (search), parsed PR URL/number plus a best-effort `GhPrViewData` (pr-create), `GhPrCheckoutSummary[]` via `outcomeToSummary` (pr-checkout — already computed for details), `PrBranchPushTarget` (pr-push), `GhRunSnapshot[]` / `GhFailedJobLog[]` (run-watch).
- No `skills/` directory exists yet. Pi loads package skills from a conventional `skills/` directory; the `pi.skills` field in `package.json` is only the explicit form (pi `docs/skills.md`).
- Tests are `node --test`; live `gh` tests skip without auth; `npm run typecheck` is `tsc --noEmit`.
- Minor observed discrepancy: ADR-0003 says "twelve GitHub operations" but the op enum holds 11; the docs ticket may correct the count in passing.

## Goals / Non-Goals

**Goals:**

- Machine-readable, opt-in json output whose payloads reuse the exact internal shapes the text renderers consume — zero text-mode drift.
- Check-time argument validation for fabric full-code programs via a per-op schema union — adopted only on verified pi + pi-fabric support.
- A packaged skill that routes agents (interactive and fabric) to the captured `github` tool and `/commit`.
- Each workstream decision recorded as an ADR (0006 skill, 0007 json, 0008 union-or-fallback).

**Non-Goals:**

- npm publishing / `package.json` parity and an MCP server wrapper (excluded by the feature spec).
- Always-json output or replacing the text mode (omp-parity for the model is preserved).
- A second tool (single-tool shape stays, ADR-0003).
- Moving payloads into the details channel only (fabric programs read `content`).

## Decisions

### D1 — json seam: early-exit per executor, builders in one new module

Each executor gains an early exit after its internals are computed and before the text render, keyed on `params.format`. Payload construction lives in a new module `extensions/lib/gh/json.ts`: an envelope type, a `buildJsonResult(op, repo, data)` helper, and one pure, exported payload builder per op (unit-testable without `gh`). The text path receives no changes beyond the guard, which is what makes byte-identity cheap to hold. Alternative rejected: refactoring executors to outcome objects feeding a shared formatter — cleaner in principle but a large blast radius measured against the byte-identity requirement.

### D2 — envelope contract

`{ "op": <op>, "repo": "<owner/repo>", "data": <payload> }` on the content channel as a single text block containing compact `JSON.stringify` output (machine channel; token economy over transcript prettiness). `repo` = the explicit `repo` param when given, else the op-resolved owner/repo (e.g. `nameWithOwner` for `repo_view`, the resolved PR repo for `pr_create`), omitted when unknown. `details` stays populated exactly as in text mode; renderers untouched. Failures keep the existing error channel — never enveloped.

### D3 — payload mapping (reuse, don't re-derive)

| op | payload source | notes |
|---|---|---|
| `repo_view` | `GhRepoViewData` from `ghJson` | envelope `repo` falls back to `data.nameWithOwner` |
| `file_read` | decoded UTF-8 bytes + repo/branch/path | json mode rejects images **and** non-UTF-8 binaries with a `ToolError` naming the file (binary rejection extends the input spec's explicit image case, for a consistent text-only contract; text-mode behavior unchanged) |
| `search_*` | `{ total_count, incomplete_results, items }` + the existing normalized item shapes | mirrors the search-API envelope the op already parses |
| `pr_create` | parsed URL/number + best-effort `GhPrViewData` | falls back to input `title`/`base`/`head`/`draft` values when the post-create view lookup fails |
| `pr_checkout` | `GhPrCheckoutSummary[]` (`outcomeToSummary`) | already computed for `details` — same objects |
| `pr_push` | `PrBranchPushTarget` + head SHA resolved via `resolveRef` after the push | `headSha` is newly resolved; `pushed` is a single-element array per the contract |
| `run_watch` | `GhRunSnapshot[]` + `GhFailedJobLog[]` | per-run entries `{ runId, url, status, conclusion, failedJobs (names), logFiles (paths) }`; `logFiles` grouped per run; log tails stay text-mode-only |

### D4 — `format` parameter

`Type.Optional(StringEnum(["text", "json"]))` on the schema (and on every union variant if the union lands). Omitted = text, identical to today.

### D5 — skill shape

`skills/pi-git/SKILL.md` with frontmatter `name: pi-git` and a task-matching description. Body: workflow guidance only — PR flow (`pr_checkout` → work in the worktree → `pr_push`, or `pr_create` with `fill`), search qualifier syntax pointer, `run_watch` polling semantics, PR worktree expectations, `/commit` flags in one block, and a fabric-exec section (`extensions.github(...)` over `pi.bash` + `gh`, `tools.list` for the schema, `file_read` over `curl`/`wget`). Op tables and per-op parameter rules live only in the tool description. Target ≤ ~150 lines. `package.json` untouched unless the `pi -e .` smoke misses the conventional directory — then add `pi.skills` and record the deviation.

### D6 — union shape and fallback

`Type.Union` of 11 per-op `Type.Object`s: an `op` literal each, plus exactly that op's parameters (partition derived from the tool description and runtime reads; drafted in the union ticket, validated by `tsc`). Requiredness tightened: `file_read.path`, `pr_checkout.pr`, `search_code.query` — matching the existing runtime checks. `GithubToolInput` becomes the union `Static`; the dispatch `switch` stays exhaustive via the `never` default. Fallback (any failed spike leg): flat schema + runtime requiredness stays, findings recorded, upstream pi-fabric issue drafted, ADR-0008 documents the outcome either way.

### D7 — spike method (blocking, ticket 04)

A throwaway scratch extension registering a dummy tool with a top-level `anyOf` schema, then:

(a) register + call with valid and invalid args in a pi session — registration/validation evidence;
(b) capture it in fabric and inspect `tools.list`/`tools.describe` — schema surfaced intact?
(c) a full-code fabric program calling the captured tool with a missing required parameter — check-time failure evidence;
(d) measure the model-facing tool listing size, flat vs union — prompt bloat.

Report lands at `.scratch/fabric-compat/spike-report.md` with per-leg evidence and a go/no-go decision. The union ticket is blocked until this exists.

### D8 — test strategy

Live json tests for `repo_view` / `search_issues` / `search_prs` extend the skip-without-auth pattern; unit tests feed synthetic internal values to the write/watch payload builders; an image + json live test hits a known public image; the union's check-time failure demo is recorded evidence; **all existing suites must pass unmodified** — that is the byte-identity gate, not a courtesy.

## Risks / Trade-offs

- [Union bloats the system-prompt tool listing] → spike leg (d) measures it; unacceptable bloat alone is fallback grounds (spec'd).
- [`registerTool` doesn't validate a top-level `anyOf`] → spike leg (a); fallback keeps flat schema with runtime requiredness (already enforced via `requireNonEmpty` / `composeSearchQuery`).
- [Text-mode drift from the json work] → early-exit guard is the only text-path change; existing tests unmodified is an acceptance criterion.
- [Payload/text divergence over time] → builders consume the same internal objects the text renderers consume — single source of truth.
- [`file_read` binary + json choice surprises] → contract is spec'd and the error is explicit; text mode unchanged.
- [`pr_create` post-create view fails] → payload falls back to input-derived identity fields; envelope stays present.
- [`run_watch` json loses log context] → `logFiles` carry saved paths; tails remain in text mode; trade-off is explicit in the contract.
- [Skill drifts into duplicating the tool description] → complement-not-duplicate rule + ~150-line budget; op tables live in exactly one place.

## Migration Plan

Land in ticket order: 01 skill → 02 json read-ops → 03 json write-ops → 04 spike → 05 union (gated on 04) → 06 docs/ADRs. Everything is additive and independently revertible; a union revert restores the flat schema in one file with the dispatch unchanged. No data migrations. Rollback is `git revert` per ticket.

## Open Questions

- Exact per-op parameter partition for the union (settled during the spike/union tickets against runtime reads; the specs don't change either way).
- Which known public image path the live image + json test uses (picked during ticket 02).
- Whether the conventional `skills/` directory is auto-discovered or needs the explicit `pi.skills` entry (the ticket-01 smoke decides; the spec has a scenario for both).

## Why

pi-fabric captures pi-git's `github` tool as `extensions.github` and, in full-code mode, statically type-checks calls against the captured JSON schema. The interop works today but is text-shaped and flat: results are formatted prose that fabric programs must string-scrape out of the content channel, the flat schema makes every parameter optional for every op so missing required arguments only fail at runtime, and no skill steers an agent to prefer the tool over `pi.bash` + `gh`. Closing these gaps makes the tool first-class for fabric programs — machine-readable results and check-time argument validation — without changing the default model-facing output.

## What Changes

- **Packaged agent skill** (workstream 1): ship `skills/pi-git/SKILL.md`. Pi loads package `skills/` directories, so no `package.json` change is expected (verify in smoke). The skill carries workflow-level guidance — PR flow (`pr_checkout` → work → `pr_push` / `pr_create` with `fill`), search qualifier syntax pointer, `run_watch` polling semantics, worktree expectations, `/commit` flags in one block, and a fabric-exec section steering `extensions.github(...)` over `pi.bash` + `gh` — and complements, never duplicates, the op tables in the tool description. Decision recorded as ADR-0006.
- **`format: "json"` opt-in** (workstream 2): new optional `format` param (`"text"` | `"json"`, omitted = text) on the `github` tool. In json mode the content channel carries `{ "op", "repo"?, "data" }` with per-op payloads reusing existing internal shapes (`GhRepoViewData`, normalized search items, `GhPrCheckoutSummary[]`, …). Default path stays byte-identical — all existing tests pass unmodified; `details` stays populated in both modes. Decision recorded as ADR-0007.
- **Discriminated per-op schema union, gated** (workstream 3): replace the flat object with a `Type.Union` of 11 per-op objects (`op` literal + exactly that op's params), tightening requiredness (`file_read.path`, `pr_checkout.pr`, `search_code.query` required). Landing is blocked on a spike verifying (a) pi `registerTool` accepts and validates a top-level `anyOf`, (b) pi-fabric `tools.list` surfaces the union intact, (c) fabric captured-type generation maps `anyOf` to a real TS union — plus a prompt-bloat sanity check. Fallback on any failed leg: keep the flat schema + runtime requiredness, record findings, draft an upstream pi-fabric issue. Decision recorded as ADR-0008.
- **Tickets + docs**: six implementation tickets at `.scratch/fabric-compat/issues/` (per the repo issue-tracker convention), README updates (skill + fabric interop sections), ADR-0006..0008.

Not in scope: npm publishing / package.json parity, an MCP server wrapper. Not breaking: default output is unchanged.

## Capabilities

### New Capabilities

- `pi-git-skill`: a packaged skill steering pi sessions — interactive and fabric — to the `github` tool and `/commit` over ad-hoc shell `gh`, carrying workflow-level guidance without duplicating the tool description.
- `github-json-output`: an opt-in json output mode on the `github` tool that returns a stable per-op JSON envelope, machine-readable by fabric programs, with the default text output byte-identical.
- `github-op-schema`: the `github` tool's parameter schema — per-op requiredness enforced, with the discriminated per-op union adopted only if the pi/pi-fabric spike verifies support; otherwise the flat schema is retained and the decision recorded.

### Modified Capabilities

None — `openspec/specs/` has no capabilities yet; this change establishes the first three.

## Impact

- **Code (modified)**: `extensions/lib/gh/schema.ts` (format param; union or retained flat schema), `extensions/lib/gh/types.ts` (`GithubInput.format`, envelope types), `extensions/lib/gh/format.ts` (envelope builder), `extensions/lib/gh/ops/*.ts` (per-op json payload builders), `extensions/lib/github-tool.ts` (format wiring into dispatch).
- **New files**: `skills/pi-git/SKILL.md`, `docs/adr/0006`..`0008`, json tests, `.scratch/fabric-compat/issues/01..06`, spike report under `.scratch/fabric-compat/`.
- **Dependencies**: `typebox` (existing peer — `Type.Union` is standard); pi `registerTool` anyOf handling (spike subject, no new peers); pi-fabric captured-type generation (external, spike subject).
- **Invariants preserved**: single `github` tool with `op` dispatch (ADR-0003); `details` channel and renderers unchanged; text mode keeps omp parity; `/commit` and git readers untouched.
- **Tests**: existing suites must pass unmodified; new live json tests (`repo_view`, `search_issues`, `search_prs`), unit tests for write-op envelope builders, `file_read` image + json error case, and a check-time failure demo for the union.

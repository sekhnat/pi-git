# 03 — json write/watch ops

Status: done — payload builders + json wiring landed for pr_create (input fallbacks), pr_checkout (GhPrCheckoutSummary reuse, all three return paths), pr_push (post-push headSha via resolveRef, single-element pushed), run_watch (per-run entries, logFiles grouped per run, no tails; all five return paths). 4 builder unit tests with synthetic values; byte-identity gate green: typecheck + 63/63 tests, zero existing-test modifications (git-verified); ADR-0007 recorded. Note: the json spec payload contract (authoritative) has no title field, so design D3's "title fallback" has no landing spot.

Workstream 2 (write side): json payloads for `pr_create`, `pr_checkout`, `pr_push`, `run_watch` + the byte-identity gate.

## Scope

- Payload builders + json wiring per design D3: `pr_create` (parsed URL/number + best-effort view, input fallbacks), `pr_checkout` (`GhPrCheckoutSummary[]` reuse), `pr_push` (`PrBranchPushTarget`, post-push `headSha`, single-element `pushed`), `run_watch` (per-run entries: runId/url/status/conclusion/failedJobs/logFiles; no log tails).
- Unit tests with synthetic internal values for the four builders.

## Acceptance

- [x] Unit tests for the `pr_create` / `pr_checkout` / `pr_push` / `run_watch` envelope builders pass (9/9 in `tests/gh-json.test.ts`)
- [x] Byte-identity gate: `npm run typecheck` + `npm test` green (63/63), zero modifications to existing tests (git-verified)
- [x] ADR-0007 recorded (`docs/adr/0007-opt-in-json-envelope.md`)

Refs: `openspec/changes/fabric-compat/specs/github-json-output/spec.md`; design D1–D3, D8.

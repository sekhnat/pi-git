# 05 — union implementation (gated on 04)

Status: done — GO path landed. schema.ts is now an 11-variant discriminated union (slim descriptions, 3403 chars JSON ≤ 4096 cap; format on every variant; file_read.path / pr_checkout.pr / search_code.query required); execute() annotated to the flat GithubInput so the never-default dispatch stays exhaustive; typecheck green, 63/63 tests. Check-time demo recorded with an honest nuance: the union is captured and validated at dispatch (missing pr rejected before execution, live in two fresh sessions) and the captured-type channel renders a real TS union (tsc-verified), but pi-fabric's main fabric_exec path filters TYPE_CORRECTNESS_CODES (TS2345/2339) — only Jev programs enforce them today; upstream pi-fabric issue draft included in the spike report. Prompt bloat: +1600 chars schema JSON (measured, not fallback grounds). ADR-0008 recorded.

Workstream 3, implementation: land the discriminated per-op schema union, or take the documented fallback.

## Scope

- On GO: replace the flat schema with 11 per-op objects (`op` literal + exactly that op's params; `file_read.path`, `pr_checkout.pr`, `search_code.query` required; `format` on every variant). `GithubToolInput` becomes the union `Static`; dispatch stays exhaustive (`never` default).
- On NO-GO: keep the flat schema + runtime requiredness; the spike report's findings + upstream issue draft stand as the record.
- Either way: ADR-0008 records the outcome.

## Acceptance

- [x] Union landed: `tsc --noEmit` green (0 errors), exhaustive dispatch (`never` default intact); demo recorded — missing `pr` fails before execution at dispatch validation in live sessions (spike report "Post-spike deep-dive"); the TS-layer check fires for Jev-style includeTypeCorrectness surfaces and is requested upstream for the main path
- [x] (or fallback documented) — fallback branch not taken (GO); findings + upstream pi-fabric issue draft are in the spike report
- [x] Prompt bloat sanity-checked against the spike numbers (+1600 chars, within caps)
- [x] ADR-0008 matches the landed state (`docs/adr/0008-discriminated-per-op-schema-union.md`)

Refs: `openspec/changes/fabric-compat/specs/github-op-schema/spec.md`; design D6.

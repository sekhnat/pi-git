# 04 — union spike (blocking for 05)

Status: done — GO. (a) live pi session: spike anyOf tool registered, valid call dispatched, invalid call rejected with per-branch anyOf messages; validator probe on the 11-variant union rejects missing pr/path/query. (b) schema channel surfaces anyOf verbatim (tools.list + live dispatch). (c) fabric's generator renders the union as a real 11-member TS union; tsc probe yields exactly 3 TS2345 errors on the missing-required calls. (d) flat 1803 vs slim union 3403 chars (≤ 4096 cap); described union 5654 > cap → silent loose fallback (trap documented). Report: .scratch/fabric-compat/spike-report.md; evidence: .scratch/fabric-compat/spike/.

Workstream 3, research: verify pi + pi-fabric support for a top-level `anyOf` tool schema before any schema change.

## Scope

Throwaway scratch extension registering a dummy tool with a `Type.Union` schema, then (design D7):

- (a) pi `registerTool` accepts the union and validates args (valid + invalid calls in a live session)
- (b) fabric `tools.list` / `tools.describe` surfaces the union intact
- (c) fabric captured-type generation maps `anyOf` to a real TS union — a full-code program omitting a required param fails at check time
- (d) prompt bloat: measure the model-facing tool listing, flat vs union

## Acceptance

- [x] Evidence for (a)–(d) captured (`spike/run-spike.mjs`, `run-spike2.mjs`, `live-session.jsonl`, `guest-union-slim.d.ts`, `probe-union-slim.ts`, `spike-evidence*.json`)
- [x] `.scratch/fabric-compat/spike-report.md` written with per-leg evidence + explicit GO
- [x] On any failed leg: upstream pi-fabric issue draft — N/A, all legs passed (report records the size-cap trap + constraint instead)

Refs: `openspec/changes/fabric-compat/specs/github-op-schema/spec.md`; design D6–D7.

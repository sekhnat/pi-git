# Union spike report — discriminated per-op schema for the `github` tool

**Verdict: GO** — land the 11-variant discriminated union. All four spike legs pass with recorded evidence below, subject to one binding constraint (schema-source size, see (d)).

Spike date: 2026-09-18. pi: @earendil-works/pi-coding-agent (skills/dist as installed); fabric: pi-fabric (dist chunks as installed). Artifacts under `.scratch/fabric-compat/spike/`.

## (a) pi `registerTool` accepts a top-level `anyOf` and validates arguments — PASS

- **Live session** (`pi -e .scratch/fabric-compat/spike-ext/index.ts`, session log `spike/live-session.jsonl`): a throwaway extension registered `spike_union` with a 3-variant `Type.Union` schema. In a real headless pi session driven through fabric_exec:
  - Valid call `extensions.spike_union({ op: "add", a: 1, b: 2 })` → dispatched, no error.
  - Invalid call `extensions.spike_union({ op: "add" })` → **rejected at dispatch**: `Invalid arguments for extensions.spike_union: must be equal to constant; must have required properties a, b; must have required properties text; must be equal to constant; must match a schema in anyOf`.
- **Validator probe** (`spike/run-spike.mjs`, `spike-evidence.json`): the exact agent-loop validator (`validateToolArguments` from `@earendil-works/pi-ai`, invoked at `pi-agent-core/dist/agent-loop.js:411` and `harness/execution/tools.js:29`) run against the drafted 11-variant github union: missing `pr` / `path` / `query` and unknown `op` values all throw; valid calls pass.

## (b) pi-fabric's schema channel surfaces the union intact — PASS

- `tools.list` in a fabric session surfaces captured `inputSchema` verbatim — the github tool's existing nested `anyOf` (`pr: string | string[]`) round-trips byte-intact.
- The live dispatch error above quotes per-branch anyOf messages, proving the union reached the dispatch validator through the capture channel without flattening.
- fabric's program-schema allowlist (`pi-fabric/dist/chunks/chunk-Z63R5GVN.js`) explicitly permits `anyOf`/`oneOf`/`allOf` (≤ 16 alternates); we need 11.

## (c) Captured-type generation maps `anyOf` to a real TS union; missing required args fail at check time — PASS

- `buildDynamicGuestDeclarations` (fabric's exact generator, `pi-fabric/dist/chunks/chunk-KYXZJNV6.js`, rendered per-execution "from the captured extension tool catalog") maps a top-level `anyOf` via `unionType` → real TS union.
- Rendered declaration for the slim 11-variant union: `.scratch/fabric-compat/spike/guest-union-slim.d.ts` — 11 members with `op` literals, 2027 chars (≤ the 2500-char member cap; ≤ 12-member cap).
- tsc probe (`spike/probe-union-slim.ts` + `guest-union-slim.d.ts`): valid calls (`pr_checkout` with `pr`, `file_read` with `path` + `format: "json"`, `search_code` with `query`) compile clean; the three missing-required calls produce **exactly 3 × TS2345**, one per line:
  - `(8)` `{ op: "pr_checkout" }` → not assignable (missing `pr`)
  - `(9)` `{ op: "file_read", repo }` → not assignable (missing `path`)
  - `(10)` `{ op: "search_code", repo }` → not assignable (missing `query`)
- The end-to-end in-fabric demo (a `fabric_exec` full-code program omitting `pr` on `pr_checkout` failing at check time) lands with the union in task 5.1 — it requires a session started after the schema change, since captures are point-in-time (this session's captured github schema predates even the `format` param).

## (d) Prompt bloat + the size trap — PASS with a binding constraint

| variant | schema JSON chars | within fabric's 4096-char source cap | guest declaration |
|---|---|---|---|
| flat (current) | 1803 | yes | typed (919 chars) |
| union **with per-param descriptions** | 5654 | **NO → loose `Record<string, unknown>` fallback** | untyped (318 chars) |
| union **slim** (descriptions only on `op` + the three tightened requireds) | 3403 | **yes** | typed, real union (2027 chars) |

- The trap, measured: a fully-described union **silently loses all type safety** — the generator falls back to the loose declaration when `JSON.stringify(inputSchema)` exceeds `MAX_SCHEMA_SOURCE_CHARS = 4096` (`chunk-KYXZJNV6.js: renderMember`). No error is raised; the union just stops being typed. The landed union MUST stay under 4096 chars.
- Model-facing cost of the slim union: +1600 chars of schema JSON (~+89% for this tool's schema; the tool description is unchanged at ~1.7 KB). Against a system prompt already carrying dozens of KB of tool listings, this is modest — not fallback grounds.
- Trade-off accepted with GO: per-parameter descriptions are dropped from the schema (they duplicate the tool description's `<instruction>` block, which stays the single source of per-op guidance); the three tightened params keep short "(required)" notes.

## Constraints task 5.1 must honor

1. Union schema JSON ≤ 4096 chars (slim descriptions as measured: 3403).
2. Rendered declaration ≤ 2500 chars (measured: 2027).
3. ≤ 12 union members (11).
4. `pr` stays `string | string[]` — note the minor asymmetry that the runtime coerces numeric `pr` (typebox `Value.Convert`) while the static type correctly rejects it; callers should pass strings.
5. Dispatch stays exhaustive (`never` default) under `tsc --noEmit`.

## Post-spike deep-dive: check-time enforcement on the main fabric_exec path (recorded 2026-09-18, during task 5.1's demo)

Landing the union exposed one nuance leg (c)'s final clause — worth recording precisely:

- **The union renders and validates everywhere it needs to.** With the union landed, fresh-session demos (`spike/demo-pr-checkout.jsonl`, `demo-pr-checkout-fullcode.jsonl`) show the captured schema carrying per-branch requiredness: `extensions.github({ op: "pr_checkout" })` (missing `pr`) is **rejected before the executor runs** with `Invalid arguments for extensions.github: … must have required properties pr` — in both default and `PI_FABRIC_FULL_CODE_MODE=true` sessions.
- **The TS assignability diagnostic is advisory on the main fabric_exec path.** pi-fabric's checker filters `TYPE_CORRECTNESS_CODES` (TS2345/TS2339/2322/…, `dist/chunks/chunk-N5GUXC6F.js:22,118`) unless `includeTypeCorrectness` is passed. The main fabric_exec prepare call (`dist/fabric-runtime-state.js:2857`) omits the 6th argument, so those diagnostics never gate execution; only **Jev programs** pass `includeTypeCorrectness=true` (`chunk-DW5MTOJP.js:132`) and enforce them today.
- **Schema enforce mode is not a workaround.** With `.pi/fabric.json` `schema.mode: "enforce"` (temporarily flipped for the demo, `demo-pr-checkout-enforce.jsonl`, then reverted), the QuickJS sandbox did not register the `extensions` provider at all (`Unknown Fabric provider: extensions`), so enforce mode neither helps nor is usable for this demo.

**Net:** the union satisfies leg (c)'s substance — the captured-type channel maps `anyOf` to a real TS union, and missing required args fail **before execution** (dispatch validation) in every live session tested. The TS-layer check-time failure on the main fabric_exec path awaits a pi-fabric change (pass `includeTypeCorrectness` from config, or stop filtering `TYPE_CORRECTNESS_CODES` for captured-tool surfaces). Upstream draft follows.

### Upstream pi-fabric issue draft

**Title:** Main fabric_exec path filters type-correctness diagnostics — captured-tool argument shapes (anyOf unions) can't fail at check time

**Body:**

`TypeScriptKernelRuntime.prepare` accepts `includeTypeCorrectness` (default `false`), and the main fabric_exec call site (`fabric-runtime-state.js`, `runtime.prepare(options.code, effectiveFullCodeMode, …, guestTypeSources, coreOverrides)`) omits it. `FabricTypeChecker.check` then filters `TYPE_CORRECTNESS_CODES` (TS2322/2339/2345/…), so argument-shape mistakes against the dynamic `extensions.*` guest declarations — including required members of a captured `anyOf` tool schema — surface only as dispatch-time validation errors, never as pre-execution type errors.

The dynamic guest declarations are otherwise correct: `buildDynamicGuestDeclarations` renders a top-level `anyOf` tool schema as a real TS union (verified against a discriminated 11-variant schema; `tsc --strict` flags exactly the missing-required calls with TS2345). Jev programs already pass `includeTypeCorrectness = true` and get the enforcement. Request: expose type-correctness enforcement for the main fabric_exec path (config flag and/or schema enforce mode), so captured-tool argument mistakes fail the check before the sandbox runs. Also noting: with `schema.mode: "enforce"`, the QuickJS guest's registered provider set excluded `extensions` entirely (`Unknown Fabric provider: extensions`), which currently makes enforce mode unusable for captured-tool calls.

Environment: pi-fabric dist as installed 2026-09-18; reproduction artifacts under `.scratch/fabric-compat/spike/`.

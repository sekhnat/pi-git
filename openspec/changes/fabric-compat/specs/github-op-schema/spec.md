## Purpose

Defines the `github` tool's parameter-schema contract: per-op required arguments, and a discriminated per-op schema union adopted only when pi and pi-fabric support is verified — otherwise a documented flat-schema fallback.

## ADDED Requirements

### Requirement: Per-op required arguments

Calls that omit a required argument SHALL fail. `file_read` requires `path`; `pr_checkout` requires `pr`; `search_code` requires `query`. All other parameters keep their current optionality.

#### Scenario: Required arguments fail without them
- **WHEN** an op runs without a required argument — `file_read` without `path`, `pr_checkout` without `pr`, or `search_code` without `query`
- **THEN** the call fails with a clear message naming the missing argument

#### Scenario: Optional parameters stay optional
- **WHEN** any other parameter is omitted for any op
- **THEN** the call proceeds exactly as today

### Requirement: Spike gates union adoption

The discriminated schema union SHALL NOT land until a spike verifies, with recorded evidence committed to the feature's scratch directory: (a) pi's tool registration accepts a top-level `anyOf` schema and validates arguments against it; (b) pi-fabric's tool schema channel surfaces the union intact; (c) pi-fabric's captured-type generation maps `anyOf` to a real TypeScript union, so a full-code fabric program omitting `pr` on `pr_checkout` fails at check time.

#### Scenario: Spike evidence exists before landing
- **WHEN** the union lands
- **THEN** a spike report with registration, schema-surfacing, and type-generation evidence is committed under `.scratch/fabric-compat/`

### Requirement: Union or documented fallback

The change SHALL either replace the flat schema with a JSON-Schema union (`anyOf`) of 11 per-op objects — each an `op` literal plus exactly that op's parameters, preserving every existing parameter (including `format`) on its op — or, when any spike leg fails, retain the flat schema with runtime requiredness, record the findings, and draft an upstream pi-fabric issue. Either outcome SHALL be recorded as an ADR, and the internal op dispatch SHALL remain exhaustive under `tsc --noEmit` in both states.

#### Scenario: Union lands
- **WHEN** every spike leg passes
- **THEN** the schema is a union of 11 per-op objects and a fabric full-code program omitting `pr` on `pr_checkout` fails type-checking

#### Scenario: Fallback taken
- **WHEN** any spike leg fails
- **THEN** the flat schema is retained, findings plus the upstream issue draft are recorded, and the ADR documents the decision

#### Scenario: Prompt bloat is fallback grounds
- **WHEN** the union's model-facing tool listing bloats the system prompt unacceptably
- **THEN** that alone justifies the fallback path

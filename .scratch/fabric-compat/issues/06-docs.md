# 06 — README + ADR records + tracker hygiene

Status: done — README gained JSON-output, pi-git skill (loading convention + the pi.skills manifest deviation), and Fabric interop sections plus ADR-0006..0008 in the Design highlights; ADR-0003's "twelve operations" corrected to eleven; docs/adr/ holds 0001-0008 matching landed reality; tickets 01-06 Status lines all record their outcomes.

Docs: surface the skill and the fabric interop, and make the ADR trail complete and truthful.

## Scope

- README: document the skill (loading convention, what it steers) and add a fabric interop section (`extensions.github(...)`, `format: "json"`, `tools.list` for the schema). Correct ADR-0003's "twelve operations" to 11 in passing.
- Verify ADR-0006/0007/0008 exist and match landed reality (each lands with its workstream; this ticket is the completeness check).
- Keep `.scratch/fabric-compat/issues/01..06` Status lines current; each ticket records its outcome on completion.

## Acceptance

- [x] README sections present and accurate against the implementation
- [x] `docs/adr/` contains 0006–0008 matching what landed
- [x] Every scratch ticket's `Status:` line matches its outcome

Refs: proposal Impact; `openspec/changes/fabric-compat/specs/pi-git-skill/spec.md`; design D5, Migration Plan.

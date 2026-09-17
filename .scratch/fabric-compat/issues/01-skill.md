# 01 — pi-git agent skill

Status: done — SKILL.md authored (90-line body, workflow-only, no op tables); `pi.skills` entry ADDED to package.json because the `pi` manifest suppresses conventional `skills/` discovery (deviation recorded in ADR-0006); smoke via the pi resource loader lists `pi-git` with valid frontmatter and no diagnostics; ADR-0006 recorded.

Workstream 1 of `.scratch/fabric-compat/spec.md`: author and smoke the packaged skill that steers agents to the `github` tool and `/commit`.

## Scope

- Create `skills/pi-git/SKILL.md`: frontmatter `name: pi-git` + task-matching description (GitHub repos, PRs, searches, Actions runs, atomic commits from pi sessions).
- Body = workflow-level guidance only: PR flow (`pr_checkout` → work → `pr_push` / `pr_create` with `fill`), search qualifier syntax pointer, `run_watch` polling semantics, worktree expectations, `/commit` flags in one block, one fabric-exec section (`extensions.github(...)`, prefer over `pi.bash` + `gh`, `tools.list` for the schema, `file_read` over `curl`/`wget`).
- Op tables / per-op parameter rules stay only in the tool description — no verbatim duplication. Body ≤ ~150 lines.

## Acceptance

- [x] `pi -e .` smoke: skill listed, valid frontmatter — `pi.skills` entry added (discovery missed the conventional dir; deviation recorded in ADR-0006)
- [x] No verbatim op-table duplication vs `extensions/lib/github-tool.ts` tool description
- [x] Body ≤ ~150 lines (90 lines)
- [x] ADR-0006 recorded on landing (`docs/adr/0006-agent-skill-complements-tool-description.md`)

Refs: `openspec/changes/fabric-compat/specs/pi-git-skill/spec.md`; design D5.

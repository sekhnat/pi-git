# Extract oh-my-pi git/gh features into a pi package

**Status**: built — all acceptance checks green

Extract the git/gh features of https://github.com/can1357/oh-my-pi (MIT, itself a Pi fork) into a pi package named `pi-git`, installable via `pi install`, targeting the installed `@earendil-works/pi-coding-agent` 0.84.x.

## Settled (round 1)

- **Scope**: `github` tool (12 ops over `gh`), git working-tree readers (`git_overview`, `git_file_diff`, `git_hunk`), agentic `/commit`. No TUI, no status-line chrome. (ADR-0001)
- **Fidelity**: behavior-level port; identical schemas/prompts/error semantics; infrastructure rewritten for pi; omp's github cache dropped. MIT + attribution headers. (ADR-0002)
- **Tool surface**: single `github` tool with `op` enum. (ADR-0003)
- **Gating**: register when `gh` is on PATH; always active; users opt out via `pi config`.
- **Package identity**: `pi-git` (unclaimed on npm); conventional `extensions/` layout; npm publish optional at the end.
- **Verification**: live read-op integration tests + local git fixtures; write ops by manual consent-gated smoke.

## Settled (round 2)

- **`/commit` mechanism**: nested in-memory agent via pi SDK; current session model, `--model` override. (ADR-0004)
- **`/commit` gate**: plan → confirm → execute; `--dry-run`, `--push`, `--context`, `--model`; headless requires `--yes` else dry-run. (ADR-0005)
- **Git readers visibility**: commit-agent-only (omp parity); main session uses bash git.
- **`run_watch` logs**: capped failure-job tails inline; full logs to `os.tmpdir()` file, path reported in result.
- **Repo layout**: package at repo root; `extensions/` + `package.json` pi manifest; pi packages as `peerDependencies: "*"`; `tsc --noEmit` + `node --test`; no build step.

## Acceptance ledger

- [x] `pi install <repo>` loads the package; `github` tool + `/commit` command appear in a session (SDK smoke: github REGISTERED, extensions/index.ts loaded)
- [x] All 12 ops reachable through the `op` enum; schemas match upstream semantics (exhaustive switch, tsc-verified)
- [x] Read ops verified live (`repo_view`, `file_read`, `search_repos`, `search_issues`) against can1357/oh-my-pi
- [x] `git_overview`/`git_file_diff`/`git_hunk` verified against a fixture repo (tests/git-fixture.test.ts)
- [x] `/commit --dry-run` produces a plan on a scratch repo via the real nested agent (tests/commit-smoke-driver.ts → feat(math): added multiplication function)
- [x] Plan execution (post-confirm) writes the planned commits in topo order, hunk-level split reproduces the staged state (tests/git-fixture.test.ts)
- [x] `tsc --noEmit` + `node --test` green (48/48)
- [x] Attribution headers on every ported module

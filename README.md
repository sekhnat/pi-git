# pi-git

Git and GitHub tools for [pi](https://github.com/earendil-works/pi-coding-agent) — a behavior-level port of [oh-my-pi](https://github.com/can1357/oh-my-pi)'s git/gh features.

- **`github` tool** — one op-dispatched tool wrapping the `gh` CLI: repo views, hosted file reads (text and images), PR create/checkout/push, five GitHub searches, and an Actions `run_watch` that polls runs to completion and saves failed-job logs.
- **`/commit` command** — agentic atomic commits: a nested, isolated agent inspects your staged changes through git reader tools, then proposes one conventional commit or a dependency-ordered split plan, validated against oh-my-pi's exact rules (past-tense summaries, scope candidates, lock-file placement, hunk-level splits).

PR checkouts land in dedicated git worktrees under `~/.cache/pi-git/worktrees` — never your working tree.

## Install

```bash
pi install /path/to/pi-git        # local
pi install git:github.com/you/pi-git@v1  # git
pi install npm:pi-git             # npm (once published)
```

The `github` tool registers only when the `gh` CLI is on PATH (and stays available wherever `gh` is authenticated); opt out per project with `pi config`.

## The `github` tool

Select an operation via `op`:

| op | what it does |
|---|---|
| `repo_view` | repo metadata (omit `repo` → current checkout) |
| `file_read` | read a hosted file (text, or image content for models with vision) |
| `pr_create` | open a PR (`fill` auto-fills from commits; `reviewer`/`assignee`/`label`/`draft`) |
| `pr_checkout` | check out PR(s) into dedicated worktrees; array `pr` batches |
| `pr_push` | push a checked-out PR branch back (requires prior `pr_checkout`) |
| `search_issues` / `search_prs` / `search_code` / `search_commits` / `search_repos` | GitHub search with `since`/`until` date bounds (`3d`, `2w`, `YYYY-MM-DD`, …) |
| `run_watch` | watch an Actions run (or every run for current HEAD) to completion; failed-job log tails inline, full logs saved under the OS temp dir |

`repo` takes `[host/]owner/repo` — qualify the host for GitHub Enterprise. Errors surface gh's own hints (`gh auth login`, missing repo context) instead of raw output.

## `/commit`

```bash
/commit                  # plan → confirm → commit
/commit --dry-run        # show the plan, commit nothing
/commit --push           # push after committing
/commit --context "notes"# extra context for the agent
/commit --model provider/model  # override the commit agent's model
/commit --yes            # headless (no UI): execute without the confirm dialog
```

Stages everything when nothing is staged yet, fast-paths whitespace/import-only changes, and falls back to a deterministic proposal if the agent fails. The split executor re-applies the saved staged diff per commit in topological order, so hunk-level splits reproduce exactly the staged state even when the working tree has further unstaged edits. Nothing is lost on a mid-series failure: progress and remaining staged files are reported.

The commit agent runs in its own in-memory session (your main context stays clean) with six private tools: `git_overview`, `git_file_diff`, `git_hunk`, `recent_commits`, `propose_commit`, `split_commit`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test             # node --test tests/*.test.ts
```

Tests include live read-only `gh` operations (auto-skip without auth) and end-to-end commit machinery on temp git repos. Manual drivers:

```bash
node tests/commit-smoke-driver.ts                    # full /commit dry run (real model)
PI_GIT_SMOKE_MODEL=openrouter/x node tests/debug-agent.ts  # agent event trace
```

## Design

Decisions are recorded in `docs/adr/`; the glossary lives in `CONTEXT.md`. Highlights: behavior-level port (ADR-0002), one op-dispatched tool (ADR-0003), nested SDK agent for `/commit` (ADR-0004), confirm gate before writing history (ADR-0005 — a deliberate deviation from upstream). The git TUI and changelog integration are intentionally out of scope (ADR-0001).

## License

MIT — see [LICENSE](./LICENSE). Ported from [oh-my-pi](https://github.com/can1357/oh-my-pi) by Can Bölük (itself a fork of pi-mono by Mario Zechner), with attribution headers preserved in every ported module.

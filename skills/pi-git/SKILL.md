---
name: pi-git
description: GitHub repository views, hosted file reads, PR operations (checkout, push, create), GitHub searches, and Actions run watching via the pi-git package's github tool, plus atomic /commit workflow. Use whenever a pi session needs GitHub data or PR/commit work — prefer this over ad-hoc shell gh/git.
---

# pi-git — GitHub ops & atomic commits

This package gives a session two surfaces:

- The **`github` tool** — one op-dispatched tool covering repo views, hosted file
  reads, PR create/checkout/push, five GitHub searches, and Actions `run_watch`.
  The tool's own description is the source of truth for per-op parameters and
  wiring; this skill adds the workflow around it.
- The **`/commit` command** — agentic atomic commits via a nested agent.

## PR workflow

The checkout → work → push loop never touches your working tree:

1. `op: pr_checkout` fetches the PR and creates a **dedicated git worktree**
   under `~/.cache/pi-git/worktrees/<pr>-<hash>`, with a local branch
   `pr-<number>` configured to push back to the PR head branch. Re-running for
   an already-checked-out PR reuses that worktree.
2. Do the work **inside the reported worktree path** — not the main checkout.
   Edits, builds, and tests all happen there.
3. Push the branch back with `op: pr_push` (run inside the worktree; it reads
   the push config the checkout wrote). `forceWithLease: true` rewrites a
   pushed branch.
4. To open a new PR instead, `op: pr_create` with `fill: true` derives the
   title and body from the branch's commits — the low-friction default when a
   dedicated PR description is not required.

Batch multiple PRs by passing `pr` as an array to `pr_checkout`; each gets its
own worktree, and partial failures are reported per PR.

## Searching GitHub

Search ops accept the GitHub search qualifier syntax directly in `query` —
`repo:owner/name`, `org:`, `user:`, `is:pr`, `is:issue`, `language:`, and so
on. See GitHub's "Searching issues and pull requests" docs for the full
qualifier list; there is no separate flag vocabulary to learn.

Date bounds go in `since`/`until` (relative like `3d`/`2w` or ISO dates), with
`dateField` choosing created-vs-updated semantics. A search without `repo`
scopes to the current checkout's repo unless the query already carries a
`repo:`/`org:`/`user:` qualifier.

## Watching Actions runs

`op: run_watch` polls until the watched work is terminal:

- Without `run`, it watches **every workflow run for the current HEAD** of the
  checkout's repo (or pass `branch` to watch another branch's head).
- With `run` (numeric ID or run URL), it watches that single run.
- Polling starts fast (every few seconds for the first minute) then backs off;
  a first job failure fails the watch fast instead of waiting for the run.
- Failed-job log **tails** appear inline; **full logs** are written under the
  OS temp dir and reported by path — read those files for full context.

## /commit

```bash
/commit                  # plan → confirm → commit
/commit --dry-run        # show the plan, commit nothing
/commit --push           # push after committing
/commit --context "..."  # extra context for the agent
/commit --model p/m      # override the commit agent's model
/commit --yes            # headless (no UI): execute without the confirm dialog
```

It stages everything when nothing is staged, and can split work into a
dependency-ordered series of conventional commits. One confirmation gates the
write (use `--yes` only in headless sessions).

## Using the github tool from fabric programs

Inside `fabric_exec` full-code mode the tool is captured as
`extensions.github(...)`:

- **Prefer `extensions.github(...)` over `pi.bash` + `gh`** for GitHub work —
  the capture carries the tool's schema, structured `details`, and error
  shaping; shelling out to `gh` loses all of it.
- Inspect the live parameter schema with `tools.list` (or `tools.describe`)
  rather than guessing parameter names from memory.
- Read GitHub-hosted files with `op: "file_read"` — never `curl`/`wget` (auth,
  enterprise hosts, and binary handling are already handled).
- Pass `format: "json"` to get a machine-readable
  `{ op, repo?, data }` envelope on the content channel instead of rendered
  text — the right choice when a program consumes fields rather than showing
  prose to a model. Default (omitted) stays human-readable text.

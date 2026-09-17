# pi-git

A pi package extracting oh-my-pi's git/GitHub capabilities into pi's extension model.

## Language

**Package**:
An installable bundle pi loads extensions, skills, and themes from.
_Avoid_: plugin, add-on

**Extension**:
A TypeScript module that registers tools and commands into a session.
_Avoid_: plugin

**Tool**:
A capability the model can call.

**Command**:
A user-invoked slash command.

**op**:
The discriminator the github tool dispatches on; selects one GitHub operation.

**gh**:
The GitHub CLI every GitHub operation runs through.
_Avoid_: GitHub API (we never call it directly)

**Repo ref**:
An identifier in `[host/]owner/repo` form.
_Avoid_: repository slug, repo spec

**Working tree**:
The checked-out files of the current repository.

**PR worktree**:
A dedicated git worktree a PR is checked out into; never the working tree.
_Avoid_: worktree (unqualified, when a PR checkout is meant)

**Commit agent**:
The sub-agent that inspects the working tree and produces a commit plan.

**Commit plan**:
An ordered series of atomic commits covering the working tree's changes.

**Atomic commit**:
A commit holding a single logical change.

**Topo order**:
Commit plan ordering in which a change lands before the changes that depend on it.

**Dry run**:
Producing a commit plan without writing any commits.

**Run log**:
The captured log of a GitHub Actions job.

# Behavior-level port, not a line-level transplant

oh-my-pi's sources import `@oh-my-pi/*` internals everywhere (result builders, prompt templating, agent core, its TUI). We port behavior, not code layout: tool schemas, op semantics, tool prompt text, error messages, non-interactive subprocess environment, output caps, and PR-worktree semantics stay identical to upstream; infrastructure is rewritten against pi's `ExtensionAPI`. omp's in-memory github cache is dropped in v1 (pi sessions are short-lived; the invalidation complexity buys little).

## Consequences

- Every module carries an MIT + attribution header crediting oh-my-pi (Can Bölük) and pi-mono (Mario Zechner).
- Diffs against upstream will not be mergeable; upstream evolution is tracked manually.

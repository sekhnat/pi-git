# One github tool, op-dispatched

All twelve GitHub operations register as a single `github` tool dispatched on an `op` enum, matching oh-my-pi's production-tested shape. Per-operation tools (`gh_pr`, `gh_search`, …) were rejected: they bloat the system prompt with N snippets and diverge from upstream for no behavioral gain.

## Consequences

- New operations extend the `op` enum; no new tool registrations.
- The git working-tree readers remain separate small tools (they serve the commit agent, see ADR-0001).

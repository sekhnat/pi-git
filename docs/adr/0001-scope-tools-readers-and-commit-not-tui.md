# Scope: github tool, git readers, and /commit — not the TUI

oh-my-pi's git/gh surface spans four features: the `github` tool (12 ops over `gh`), three git working-tree reader tools, an agentic atomic-commit pipeline, and a fullscreen git TUI with status-line chrome. We extract the first three and exclude the TUI: it is built on oh-my-pi's own TUI internals, so "porting" it is a ground-up rewrite on pi's different component API — a separate project, not an extraction.

## Consequences

- The TUI and status-line chrome may be built later on `ctx.ui.custom()` without revisiting this decision.
- Changelog integration and oh-my-pi's model-selection setting are also out; `/commit` uses the current session model.

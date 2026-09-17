# Nested SDK agent for /commit

`/commit` runs its analysis in a separate in-memory agent (pi SDK `createAgentSession` + `SessionManager.inMemory()`, empty resource loader, custom tools) rather than in the main session or via heuristics. The main session's context must stay clean and the commit loop needs a controlled tool set and structured plan output; heuristics cannot produce omp-quality atomic commits. Uses the current session model; `--model` overrides.

## Considered Options

- Main-session message injection: pollutes the live context, no tool-loop control. Rejected.
- Pure heuristics (file grouping, no LLM): loses the feature's entire value proposition. Rejected.

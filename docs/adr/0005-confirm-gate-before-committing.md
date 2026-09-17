# Confirm gate before /commit writes history

A deliberate deviation from upstream: omp's `commit` writes commits immediately; pi-git's `/commit` presents the commit plan and asks for one confirmation (`ctx.ui.confirm`) before executing. Writing real history in a fresh environment warrants one glance at the plan; `--dry-run` still shows the plan without any prompt, `--push` pushes after commits. Headless (no UI): `/commit` degrades to dry-run unless `--yes` is passed.

## Purpose

Steers pi sessions — interactive and fabric-driven — to the package's `github` tool and `/commit` command instead of ad-hoc shell `gh`/`git`, via a skill that pi loads on demand.

## ADDED Requirements

### Requirement: The package ships a discoverable agent skill

The package SHALL ship a skill named `pi-git` that pi discovers from the package's conventional `skills/` directory with no extra configuration. Its frontmatter SHALL declare `name: pi-git` and a task-matching `description` covering GitHub repository views, hosted file reads, PR operations, GitHub searches, Actions runs, and atomic commits.

#### Scenario: Skill is listed in a session
- **WHEN** a pi session loads this package
- **THEN** the `pi-git` skill appears in the session's skill list with valid frontmatter

#### Scenario: No package.json declaration needed
- **WHEN** the skill directory follows the package convention
- **THEN** pi discovers the skill without a `pi.skills` entry in `package.json`; if discovery misses it, the entry is added and the deviation recorded

### Requirement: The skill carries workflow guidance, not op tables

The skill body SHALL provide workflow-level guidance: the PR flow (`pr_checkout` → work → `pr_push` / `pr_create` with `fill`), a pointer to search qualifier syntax, `run_watch` polling semantics, PR worktree expectations, and the `/commit` flags in one block. It SHALL NOT reproduce the op tables or per-op parameter rules that live in the `github` tool description, and the body SHALL stay within approximately 150 lines.

#### Scenario: No verbatim duplication of the tool description
- **WHEN** the skill body is compared against the `github` tool description
- **THEN** neither op tables nor per-op parameter rules appear verbatim

#### Scenario: Body within budget
- **WHEN** the skill body is measured
- **THEN** it is at most ~150 lines

### Requirement: The skill steers fabric programs to the captured tool

The skill body SHALL contain a fabric-exec section that names the captured call `extensions.github(...)`, directs agents to prefer it over `pi.bash` + `gh` for GitHub work, points to `tools.list` for the live schema, and prefers `file_read` over `curl`/`wget` for GitHub-hosted files.

#### Scenario: Fabric guidance present
- **WHEN** an agent reads the skill inside a fabric session
- **THEN** it finds the captured tool name, the preference over shell gh, and how to inspect the schema

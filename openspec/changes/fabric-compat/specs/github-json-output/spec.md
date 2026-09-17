## Purpose

Gives fabric programs and other machine consumers a stable opt-in JSON output mode for every `github` tool op, while keeping the default model-facing text output byte-identical.

## ADDED Requirements

### Requirement: Opt-in format parameter

The `github` tool SHALL accept an optional `format` parameter taking `"text"` or `"json"`. An omitted value or `"text"` MUST produce exactly the current output — content and details byte-identical — so every existing test passes unmodified.

#### Scenario: Default is unchanged
- **WHEN** any op runs without `format`
- **THEN** the result's content and details are byte-identical to the current implementation

#### Scenario: JSON opt-in
- **WHEN** any op runs with `format: "json"`
- **THEN** the content channel carries one JSON document in place of the formatted text

### Requirement: JSON envelope

In json mode every op SHALL return a single JSON document on the content channel: `{ "op": <the op>, "repo": "<owner/repo>", "data": <per-op payload> }`. The `repo` member SHALL be present when the op was given or resolved a target repository and absent otherwise. The `details` channel SHALL stay populated exactly as in text mode; renderers are unchanged.

#### Scenario: Envelope structure
- **WHEN** `repo_view` runs with `format: "json"` against a named repository
- **THEN** the content parses as JSON whose `op` is `"repo_view"`, whose `repo` is the `owner/repo`, and whose `data` is the repository payload

#### Scenario: Details channel preserved
- **WHEN** any op returns in json mode
- **THEN** the structured details carry the same metadata a text-mode call would (source URL, worktree paths, run ids, checkouts, …)

### Requirement: Per-op data payloads

Each op's `data` payload SHALL follow this contract, reusing the shapes the ops already compute internally:

- `repo_view`: the repository metadata object (nameWithOwner, description, url, sshUrl, default branch, homepage, star/fork counts, archived/fork flags, primary language, topics, timestamps, viewer permission, visibility).
- `file_read`: `{ repo, branch, path, content }` with decoded UTF-8 `content` — text files only.
- `search_issues`/`search_prs`/`search_code`/`search_commits`/`search_repos`: `{ total_count, incomplete_results, items }` with the existing normalized item shapes.
- `pr_create`: PR identity — `number`, `url`, `state`, `isDraft`, `baseRefName`, `headRefName` — with input-derived fallbacks when the post-create view lookup is unavailable.
- `pr_checkout`: `{ checkouts: [...] }` — one entry per checked-out PR with `prNumber`, `url`, `branch`, `worktreePath`, `remote`, `remoteBranch`, `reused`.
- `pr_push`: `{ pushed: [...], headSha }` — one push target (remote name, remote branch, remote url, PR url, maintainer/cross-repo flags) plus the pushed head SHA.
- `run_watch`: `{ runs: [...], branch?, headSha? }` — per run: `runId`, `url`, `status`, `conclusion`, `failedJobs` (job names), `logFiles` (saved log paths). Log tails stay a text-mode presentation and SHALL NOT be embedded in the JSON.

#### Scenario: repo_view payload
- **WHEN** `repo_view` runs in json mode
- **THEN** `data` carries the repository metadata fields above

#### Scenario: search payload
- **WHEN** `search_issues` runs in json mode
- **THEN** `data` has `total_count`, `incomplete_results`, and `items` in the existing normalized shape

#### Scenario: pr_create payload
- **WHEN** `pr_create` succeeds in json mode
- **THEN** `data` has `number`, `url`, `state`, `isDraft`, `baseRefName`, `headRefName`

#### Scenario: pr_checkout payload
- **WHEN** `pr_checkout` checks out two PRs in one call in json mode
- **THEN** `data.checkouts` has two entries with worktree paths and branch names

#### Scenario: run_watch payload
- **WHEN** `run_watch` observes a failing run in json mode
- **THEN** the run entry lists failed job names and saved log file paths, and no log tail text appears in `data`

### Requirement: file_read json mode is text-only

`file_read` with `format: "json"` SHALL fail with a clear error for image files and for files that are not decodable UTF-8 text; the error names the file and, for images, points to text mode. Text-mode behavior for both cases is unchanged.

#### Scenario: Image read in json mode
- **WHEN** `file_read` requests an image with `format: "json"`
- **THEN** the call fails with an error explaining json mode cannot return image content

#### Scenario: Binary read in json mode
- **WHEN** `file_read` requests a binary file with `format: "json"`
- **THEN** the call fails with a clear error instead of returning non-text `content`

### Requirement: Failures keep the existing channel

Op failures SHALL surface as tool errors in both modes; json mode SHALL NOT envelope failures into the content channel.

#### Scenario: Error in json mode
- **WHEN** an op fails while `format: "json"` is set
- **THEN** the failure surfaces as a tool error, not as a JSON envelope

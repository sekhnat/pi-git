# 02 — format param + json read ops

Status: done — `format` param on the schema + `GithubInput`; `extensions/lib/gh/json.ts` with envelope/`buildJsonResult` + read-op payload builders (5 unit tests); early-exit json wiring in repo-view / file-read / all five search executors; `file_read` json rejects images (github/explore png) and non-UTF-8 binaries (google/fonts ttf) with named-file ToolErrors; live json tests for repo_view / search_issues / search_prs / file_read text; full suite 59/59 green with zero modifications to existing tests.

Workstream 2 (read side): the `format` opt-in, the envelope builder, and json payloads for `repo_view`, `file_read`, `search_*`.

## Scope

- `Type.Optional(StringEnum(["text", "json"]))` on the schema (design D4); omitted = today's output, byte-identical.
- New `extensions/lib/gh/json.ts`: envelope type `{ op, repo?, data }`, `buildJsonResult`, payload builders for the read ops (design D1–D3).
- Early-exit json branches in repo-view / file-read / search executors; `file_read` + json rejects images and non-UTF-8 files with a clear `ToolError` (text-only contract).

## Acceptance

- [x] `format` param added; every existing test passes unmodified (59/59)
- [x] Live json tests: `repo_view`, `search_issues`, `search_prs` (skip without gh auth) assert envelope + payload (`tests/gh-json-live.test.ts`)
- [x] `file_read` image + json → clear error (live: `github/explore` topic PNG; binary branch covered live via `google/fonts` TTF)

Refs: `openspec/changes/fabric-compat/specs/github-json-output/spec.md`; design D1–D4, D8.

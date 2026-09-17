# Opt-in `format: "json"` on the single tool, not a separate or always-on channel

The `github` tool gains an optional `format` parameter (`"text"` | `"json"`, omitted = text). In json mode each op returns one compact `{ op, repo?, data }` envelope on the content channel, with per-op payloads built from the **same internal objects the text renderers consume** (single source of truth — payload/text divergence is structurally prevented). Omitted or `"text"` output is byte-identical to the pre-change behavior; `details` stays populated identically in both modes; failures are never enveloped — they keep the existing tool-error channel.

Rejected alternatives:

- **A separate `github_json` tool** — doubles the system-prompt footprint, fragments the op enum, and breaks the one-tool shape recorded in ADR-0003.
- **Always-json output** — the rendered text is the model-facing contract (omp parity); json-for-everything taxes every interactive call for the benefit of the few programmatic ones.
- **Json only via the `details` channel** — fabric programs read `content`, not `details`; putting payloads only in details would leave the machine channel invisible to the consumers this exists for.

The early-exit seam (per-executor guard before the text render) is the only text-path change; the full existing suite passing unmodified is the acceptance gate, not a courtesy.

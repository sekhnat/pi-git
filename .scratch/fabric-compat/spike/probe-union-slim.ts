/// <reference path="./fabric-stub.d.ts" />
/// <reference path="./guest-union-slim.d.ts" />
// (1) valid calls — must compile:
extensions.github({ op: "pr_checkout", pr: "27" });
extensions.github({ op: "file_read", path: "LICENSE", format: "json" });
extensions.github({ op: "search_code", query: "hello" });
// (2) missing required args — must FAIL type-check:
extensions.github({ op: "pr_checkout" });
extensions.github({ op: "file_read", repo: "o/r" });
extensions.github({ op: "search_code", repo: "o/r" });
export {};
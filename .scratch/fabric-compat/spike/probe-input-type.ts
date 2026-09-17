import type { GithubToolInput } from "../../extensions/lib/gh/schema.ts";
// Force an error revealing the resolved type:
const probe: GithubToolInput = 12345 as never;
export { probe };

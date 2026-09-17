/**
 * pi-git tests — diff parsing and hunk selection (ported machinery).
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { extractPathFromRename, parseDiffHunks, parseFileDiffs, parseNumstat } from "../extensions/lib/git/diff.ts";
import { buildSelectedPatch, validateHunkSelections } from "../extensions/lib/git/stage.ts";

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,6 @@
 import x from "x";
+import y from "y";
 
 function main() {
+  console.log("hi");
 }
@@ -10,3 +12,4 @@
 // tail
 // more
+// end
`;

test("parseNumstat handles plain paths and renames", () => {
	const entries = parseNumstat("3\t1\tsrc/app.ts\n0\t0\tsrc/{old.ts => new.ts}\n");
	assert.equal(entries.length, 2);
	assert.deepEqual(entries[0], { path: "src/app.ts", additions: 3, deletions: 1 });
	assert.equal(entries[1]!.path, "src/new.ts");
});

test("extractPathFromRename handles arrow without braces", () => {
	assert.equal(extractPathFromRename("old.ts => new.ts"), "new.ts");
});

test("parseFileDiffs splits file sections and counts additions/deletions", () => {
	const files = parseFileDiffs(SAMPLE_DIFF);
	assert.equal(files.length, 1);
	const file = files[0]!;
	assert.equal(file.filename, "src/app.ts");
	assert.equal(file.additions, 3);
	assert.equal(file.deletions, 0);
});

test("parseDiffHunks extracts hunk headers and line ranges", () => {
	const [fileHunks] = parseDiffHunks(SAMPLE_DIFF);
	assert.ok(fileHunks);
	assert.equal(fileHunks.filename, "src/app.ts");
	assert.equal(fileHunks.hunks.length, 2);
	assert.equal(fileHunks.hunks[0]!.newStart, 1);
	assert.equal(fileHunks.hunks[0]!.newLines, 6);
	assert.equal(fileHunks.hunks[1]!.newStart, 12);
});

test("buildSelectedPatch keeps only selected hunks with the file header", () => {
	const patch = buildSelectedPatch(SAMPLE_DIFF, [
		{ path: "src/app.ts", kind: "indices", indices: [2] },
	]);
	assert.ok(patch.includes("diff --git a/src/app.ts b/src/app.ts"));
	assert.ok(patch.includes("@@ -10,3 +12,4 @@"));
	assert.ok(!patch.includes("@@ -1,4 +1,6 @@"));
	assert.ok(patch.includes("// end"));
});

test("buildSelectedPatch selects by line range", () => {
	const patch = buildSelectedPatch(SAMPLE_DIFF, [
		{ path: "src/app.ts", kind: "lines", start: 1, end: 6 },
	]);
	assert.ok(patch.includes("@@ -1,4 +1,6 @@"));
	assert.ok(!patch.includes("@@ -10,3 +12,4 @@"));
});

test("buildSelectedPatch with kind all returns the full file diff", () => {
	const patch = buildSelectedPatch(SAMPLE_DIFF, [{ path: "src/app.ts", kind: "all" }]);
	assert.ok(patch.includes("@@ -1,4 +1,6 @@"));
	assert.ok(patch.includes("@@ -10,3 +12,4 @@"));
});

test("buildSelectedPatch throws for unknown path", () => {
	assert.throws(() => buildSelectedPatch(SAMPLE_DIFF, [{ path: "missing.ts", kind: "all" }]));
});

test("validateHunkSelections flags out-of-range indices and binary files", () => {
	const binaryDiff = `diff --git a/logo.png b/logo.png
index 111..222 100644
Binary files a/logo.png and b/logo.png differ
`;
	const errors = validateHunkSelections(binaryDiff, [{ path: "logo.png", kind: "indices", indices: [1] }]);
	assert.equal(errors.length, 1);
	assert.ok(errors[0]!.message.includes("binary"));

	const textErrors = validateHunkSelections(SAMPLE_DIFF, [
		{ path: "src/app.ts", kind: "indices", indices: [99] },
	]);
	assert.equal(textErrors.length, 1);
	assert.ok(textErrors[0]!.message.includes("No hunks selected"));
});

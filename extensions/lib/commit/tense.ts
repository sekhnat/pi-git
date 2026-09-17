/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 *
 * Tense lookup tables come from oh-my-pi's validation_data.json, carried over
 * verbatim into validation-data.json beside this module.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface ValidationData {
	past_tense: Array<[string, string]>;
	irregular_past: string[];
	ed_blocklist: string[];
	d_blocklist: string[];
	[key: string]: unknown;
}

function loadValidationData(): ValidationData {
	const dataPath = fileURLToPath(new URL("./validation-data.json", import.meta.url));
	return JSON.parse(readFileSync(dataPath, "utf8")) as ValidationData;
}

const data = loadValidationData();

const PAST_BY_PRESENT: Record<string, string> = {};
const IRREGULAR_PAST = new Set<string>(data.irregular_past.map(value => value.toLowerCase()));
for (const pair of data.past_tense) {
	const present = pair[0]?.toLowerCase();
	const past = pair[1]?.toLowerCase();
	if (!present || !past) continue;
	PAST_BY_PRESENT[present] = past;
	if (present === past) IRREGULAR_PAST.add(past);
}
const ED_BLOCKLIST = new Set(data.ed_blocklist.map(value => value.toLowerCase()));
const D_BLOCKLIST = new Set(data.d_blocklist.map(value => value.toLowerCase()));

/** Return the configured past-tense form for a present-tense verb. */
export function presentToPast(present: string): string | undefined {
	return PAST_BY_PRESENT[present.toLowerCase()];
}

/** Rewrite a leading present-tense verb, or return null when no repair applies. */
export function repairSummaryTense(summary: string): string | null {
	const words = summary.split(/\s+/, 2);
	if (!words[0]) return null;
	const past = presentToPast(words[0]);
	if (!past) return null;
	return words.length === 1 ? past : `${past} ${summary.slice(words[0].length).trimStart()}`;
}

/** Split the leading ASCII verb segment from punctuation or suffix text. */
export function splitVerbToken(token: string): [string, string] | null {
	let index = 0;
	for (const character of token) {
		if (!/^[A-Za-z]$/.test(character)) break;
		index += 1;
	}
	return index === 0 ? null : [token.slice(0, index), token.slice(index)];
}

export function verbStem(token: string): string | null {
	const split = splitVerbToken(token);
	if (!split || split[0] === split[0].toUpperCase()) return null;
	return split[0].toLowerCase();
}

/** Return whether a bare word looks like a past-tense verb. */
export function isPastTenseVerb(word: string): boolean {
	const lower = word.toLowerCase();
	for (const present in PAST_BY_PRESENT) {
		if (PAST_BY_PRESENT[present] === lower && present !== lower) return true;
	}
	if (lower.endsWith("ed")) return !ED_BLOCKLIST.has(lower);
	if (lower.length >= 4 && lower.endsWith("d") && "aeiou".includes(lower.at(-2) ?? "")) {
		return !D_BLOCKLIST.has(lower);
	}
	return IRREGULAR_PAST.has(lower);
}

/** Return whether a raw first summary token is acceptable past tense. */
export function isPastTenseFirstWord(token: string): boolean {
	if (!token) return false;
	if (isPastTenseVerb(token.toLowerCase())) return true;
	const stem = verbStem(token);
	if (stem && isPastTenseVerb(stem)) return true;
	const split = splitVerbToken(token);
	if (!split) return false;
	const [stemRaw, suffix] = split;
	if (stemRaw!.toLowerCase() !== "re" || !suffix.startsWith("-")) return false;
	const innerMatch = suffix.slice(1).match(/^[A-Za-z]+/);
	if (!innerMatch) return false;
	const inner = innerMatch[0]!.toLowerCase();
	return isPastTenseVerb(inner) || presentToPast(inner) !== undefined;
}

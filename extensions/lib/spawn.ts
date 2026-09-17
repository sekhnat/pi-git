/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { ToolAbortError, throwIfAborted } from "./errors.ts";

export interface SpawnResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/** True when either stream exceeded the capture cap. */
	truncated: boolean;
}

export interface SpawnOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Per-stream capture cap in bytes (default 8 MiB). */
	capBytes?: number;
	/** Optional stdin payload (e.g. a patch piped into git apply). */
	input?: string;}

export const DEFAULT_CAP_BYTES = 8 * 1024 * 1024;

export const TRUNCATED_MARKER = "\n[output truncated after 8 MiB]\n";

/** Capture a subprocess with bounded output, deadline, and abort support. */
export function spawnCapture(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
	const { cwd, signal, timeoutMs, capBytes = DEFAULT_CAP_BYTES } = options;
	throwIfAborted(signal);
	const timeoutSignal = timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;
	const combinedSignal = signal && timeoutSignal ? AbortSignal.any([signal, timeoutSignal]) : (signal ?? timeoutSignal);

	return new Promise<SpawnResult>((resolve, reject) => {
		const env = options.env ? { ...process.env, ...options.env } : { ...process.env };
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: [options.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
			windowsHide: true,
			signal: combinedSignal,
		});
		if (options.input !== undefined) {
			child.stdin!.on("error", () => {});
			child.stdin!.end(options.input);
		}

		let stdout = "";
		let stderr = "";
		let truncated = false;
		let settled = false;

		const readCapped = (stream: NodeJS.ReadableStream, sink: (text: string) => void): void => {
			stream.setEncoding("utf8");
			let captured = 0;
			let buffer = "";
			stream.on("data", (chunk: string) => {
				const bytes = Buffer.byteLength(chunk);
				if (captured + bytes <= capBytes) {
					buffer += chunk;
					captured += bytes;
				} else {
					const take = Math.max(0, capBytes - captured);
					if (take > 0) buffer += Buffer.from(chunk).subarray(0, take).toString("utf8");
					captured = capBytes;
					truncated = true;
				}
				sink(buffer);
			});
		};

		if (child.stdout) readCapped(child.stdout, text => { stdout = text; });
		if (child.stderr) readCapped(child.stderr, text => { stderr = text; });

		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			if (signal?.aborted) reject(new ToolAbortError());
			else reject(error);
		};

		child.on("error", fail);
		child.on("close", (code, killSignal) => {
			if (settled) return;
			settled = true;
			if (signal?.aborted) {
				reject(new ToolAbortError());
				return;
			}
			if (timeoutSignal?.aborted) {
				reject(new Error(`${command} command timed out: ${command} ${args.join(" ")}`));
				return;
			}
			resolve({
				exitCode: killSignal ? 1 : (code ?? 0),
			stdout,
			stderr,
			truncated,
		});
		});
	});
}

/** Non-interactive environment for git and gh subprocesses. */
export function nonInteractiveEnv(): Record<string, string | undefined> {
	return {
		GIT_ASKPASS: "true",
		GIT_EDITOR: "true",
		GIT_TERMINAL_PROMPT: "0",
		LC_ALL: undefined,
		LC_MESSAGES: "C",
		// Reject SSH credential prompts instead of hanging.
		SSH_ASKPASS: "false",
		GH_PROMPT_DISABLED: "1",
	};
}

/** Check whether an executable is on PATH (no subprocess spawn). */
export function whichSync(command: string): string | undefined {
	const pathEnv = process.env.PATH;
	if (!pathEnv) return undefined;
	const candidates = process.platform === "win32" ? [command, `${command}.cmd`, `${command}.exe`] : [command];
	for (const dir of pathEnv.split(pathEnv.includes(";") ? ";" : ":")) {
		if (!dir) continue;
		for (const candidate of candidates) {
			const full = `${dir}${dir.endsWith("/") ? "" : "/"}${candidate}`;
			try {
				fs.accessSync(full, fs.constants.X_OK);
				return full;
			} catch {
				continue;
			}
		}
	}
	return undefined;
}

/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

/** A structured tool failure with a readable, actionable message. */
export class ToolError extends Error {
	readonly context?: unknown;

	constructor(message: string, context?: unknown) {
		super(message);
		this.name = "ToolError";
		this.context = context;
	}
}

/** Thrown when an operation was aborted through its AbortSignal. */
export class ToolAbortError extends Error {
	constructor() {
		super("aborted");
		this.name = "ToolAbortError";
	}
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new ToolAbortError();
}

/** Run a promise, unwinding immediately when the signal fires. */
export async function untilAborted<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
	if (!signal) return promise;
	const abortPromise = new Promise<never>((_resolve, reject) => {
		const listener = () => reject(new ToolAbortError());
		signal.addEventListener("abort", listener, { once: true });
		void promise.finally(() => signal.removeEventListener("abort", listener));
	});
	return Promise.race([promise, abortPromise]);
}

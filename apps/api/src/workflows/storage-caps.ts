/**
 * Storage caps (pattern harvested from Postiz `truncateForTemporal`):
 * workflow history payloads are truncated before persistence so large inputs,
 * outputs and error traces can never bloat the run ledger. Text truncation is
 * character-based with an explicit marker; JSON values are structurally
 * pruned (depth + breadth caps).
 */

export const MAX_TEXT = 4000;
export const MAX_JSON_CHARS = 2000;
export const MAX_ARRAY_ITEMS = 50;
export const MAX_OBJECT_KEYS = 50;
export const MAX_DEPTH = 8;

const TRUNCATION_MARKER = "…[truncated]";

export function truncateText(value: string, max = MAX_TEXT): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

export function truncateForStorage(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return truncateText(value);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (depth >= MAX_DEPTH) return "[depth-truncated]";

	if (Array.isArray(value)) {
		const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => truncateForStorage(item, depth + 1));
		if (value.length > MAX_ARRAY_ITEMS) items.push(`…[${value.length - MAX_ARRAY_ITEMS} more items]`);
		return items;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		const result: Record<string, unknown> = {};
		for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
			result[key] = truncateForStorage(item, depth + 1);
		}
		if (entries.length > MAX_OBJECT_KEYS) result.__truncated = `${entries.length - MAX_OBJECT_KEYS} more keys`;
		return result;
	}

	return String(value);
}

/** Caps a JSON payload to a character budget (Postiz 2000/4000 semantics). */
export function capJson(value: unknown, maxChars = MAX_JSON_CHARS): unknown {
	const structured = truncateForStorage(value);
	let encoded = JSON.stringify(structured) ?? "null";
	if (encoded.length <= maxChars) return structured;

	// Budget exceeded: degrade gracefully to a compact summary marker.
	let depth = 1;
	while (encoded.length > maxChars && depth < MAX_DEPTH) {
		const shrunk: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(structured as Record<string, unknown>)) {
			shrunk[key] = typeof item === "object" && item !== null ? `[object:${depth}]` : truncateText(String(item), 100);
		}
		depth += 1;
		encoded = JSON.stringify(shrunk) ?? "null";
		if (encoded.length <= maxChars) return shrunk;
	}
	return { __truncated: true, originalChars: encoded.length };
}

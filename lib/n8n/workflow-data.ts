/**
 * Workflow data handling: object augmentation, expression sandboxing, and type guards.
 * Following patterns from n8n-workflow.txt for safe manipulation of workflow data.
 */

import { redactSensitiveData } from "@/lib/security";

/** A workflow link with its known fields plus passthrough extras. */
export type WorkflowLink = {
	source: string;
	target: string;
	[key: string]: unknown;
};

/** Incoming and outgoing links for one node. */
export type NodeConnections = {
	incoming: WorkflowLink[];
	outgoing: WorkflowLink[];
};

/** Every value the expression sandbox can produce. */
export type ExpressionValue =
	| boolean
	| string
	| number
	| null
	| undefined
	| Record<string, unknown>
	| unknown[];

// ── Type Guards ──

/**
 * Check if a value is a plain object (not array, null, Date, etc.).
 */
export function isPlainObject(
	value: unknown,
): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date) &&
		!(value instanceof RegExp)
	);
}

/**
 * Check if a value is a workflow node (has id and type).
 */
export function isWorkflowNode(
	value: unknown,
): value is { id: string; type: string } {
	return (
		isPlainObject(value) &&
		typeof value.id === "string" &&
		typeof value.type === "string"
	);
}

/**
 * Check if a value is a workflow connection (has source and target).
 */
export function isWorkflowConnection(
	value: unknown,
): value is { source: string; target: string } {
	return (
		isPlainObject(value) &&
		typeof value.source === "string" &&
		typeof value.target === "string"
	);
}

/**
 * Check if a value is a valid workflow structure.
 */
export function isValidWorkflow(value: unknown): boolean {
	if (!isPlainObject(value)) return false;
	const hasNodes =
		Array.isArray(value.nodes) && value.nodes.every(isWorkflowNode);
	const hasConnections =
		Array.isArray(value.connections) &&
		value.connections.every(isWorkflowConnection);
	return hasNodes && hasConnections;
}

// ── Object Augmentation ──

/**
 * An augmented view of workflow data that provides safe access patterns.
 * Wraps raw workflow data and provides:
 * - Immutable access to nodes and connections
 * - Redacted views of sensitive fields
 * - Helper methods for common queries
 */
export class WorkflowDataProxy {
	private _raw: Record<string, unknown>;
	private _redacted: Record<string, unknown>;

	constructor(data: Record<string, unknown>) {
		this._raw = data;
		this._redacted = redactSensitiveData(data) as Record<string, unknown>;
	}

	/**
	 * Get the raw data (use with caution — may contain sensitive fields).
	 */
	get raw(): Record<string, unknown> {
		return Object.freeze({ ...this._raw });
	}

	/**
	 * Get a redacted view of the data (sensitive fields masked).
	 */
	get redacted(): Record<string, unknown> {
		return Object.freeze({ ...this._redacted });
	}

	/**
	 * Get nodes from the workflow.
	 */
	get nodes(): Array<{ id: string; type: string; [key: string]: unknown }> {
		const nodes = this._raw.nodes;
		if (!Array.isArray(nodes)) return [];
		return nodes.filter(isWorkflowNode).map(
			(node) =>
				Object.freeze({ ...node }) as {
					id: string;
					type: string;
					[key: string]: unknown;
				},
		);
	}

	/**
	 * Get connections from the workflow.
	 */
	get connections(): Array<{
		source: string;
		target: string;
		[key: string]: unknown;
	}> {
		const connections = this._raw.connections;
		if (!Array.isArray(connections)) return [];
		return connections.filter(isWorkflowConnection).map(
			(conn) =>
				Object.freeze({ ...conn }) as {
					source: string;
					target: string;
					[key: string]: unknown;
				},
		);
	}

	/**
	 * Find a node by ID.
	 */
	findNode(
		id: string,
	): { id: string; type: string; [key: string]: unknown } | undefined {
		return this.nodes.find((node) => node.id === id);
	}

	/**
	 * Get all connections for a node (both incoming and outgoing).
	 */
	getNodeConnections(nodeId: string): NodeConnections {
		const incoming: WorkflowLink[] = [];
		const outgoing: WorkflowLink[] = [];

		for (const conn of this.connections) {
			if (conn.target === nodeId) incoming.push(conn);
			if (conn.source === nodeId) outgoing.push(conn);
		}

		return { incoming, outgoing };
	}

	/**
	 * Get node IDs that are reachable from a starting node.
	 */
	getReachableNodes(startNodeId: string): Set<string> {
		const visited = new Set<string>();
		const queue = [startNodeId];

		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) continue;
			if (visited.has(current)) continue;
			visited.add(current);

			const { outgoing } = this.getNodeConnections(current);
			for (const conn of outgoing) {
				queue.push(conn.target);
			}
		}

		return visited;
	}
}

// ── Expression Sandboxing ──

/**
 * A sandboxed expression evaluator for workflow expressions.
 * Supports basic arithmetic, string operations, and safe property access.
 * Does NOT support: function calls, assignments, or access to global scope.
 */
export class ExpressionSandbox {
	private _context: Record<string, unknown>;

	constructor(context: Record<string, unknown>) {
		this._context = context;
	}

	/**
	 * Evaluate a simple expression string.
	 * Supports: property access (a.b.c), arithmetic (+, -, *, /), comparison (==, !=, <, >, <=, >=), logical (&&, ||, !), and string literals.
	 *
	 * For security, this is a restricted evaluator — it does not use eval() or new Function().
	 */
	evaluate(expression: string): unknown {
		const tokens = this._tokenize(expression);
		const ast = this._parse(tokens);
		return this._evalNode(ast);
	}

	private _tokenize(expr: string): string[] {
		const tokens: string[] = [];
		let current = "";
		let inString = false;
		let stringChar = "";

		for (let i = 0; i < expr.length; i++) {
			const ch = expr[i];

			if (inString) {
				if (ch === stringChar && expr[i - 1] !== "\\") {
					inString = false;
					tokens.push(`"${current}"`);
					current = "";
				} else {
					current += ch;
				}
				continue;
			}

			if (ch === '"' || ch === "'") {
				inString = true;
				stringChar = ch;
				if (current) {
					tokens.push(current);
					current = "";
				}
				continue;
			}

			if (ch === " " || ch === "\t" || ch === "\n") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				continue;
			}

			if ("+-*/(){}[]".includes(ch)) {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push(ch);
				continue;
			}

			if (ch === "&" && expr[i + 1] === "&") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("&&");
				i++;
				continue;
			}

			if (ch === "|" && expr[i + 1] === "|") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("||");
				i++;
				continue;
			}

			if (ch === "=" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("==");
				i++;
				continue;
			}

			if (ch === "!" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("!=");
				i++;
				continue;
			}

			if (ch === "<" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("<=");
				i++;
				continue;
			}

			if (ch === ">" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push(">=");
				i++;
				continue;
			}

			if ("<>!".includes(ch)) {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push(ch);
				continue;
			}

			current += ch;
		}

		if (current) tokens.push(current);
		return tokens;
	}

	private _parse(tokens: string[]): unknown {
		// Simplified parser — handles basic expressions
		// For production use, consider a proper parser generator
		let pos = 0;

		const peek = () => tokens[pos];
		const consume = () => tokens[pos++];

		const parsePrimary = (): ExpressionValue => {
			const token = consume();
			if (token === undefined) throw new Error("Unexpected end of expression");
			if (token === "(") {
				const expr = parseExpression();
				if (consume() !== ")") throw new Error("Expected )");
				return expr;
			}
			if (token === "!") {
				return !parsePrimary();
			}
			if (token === "{") {
				// Object literal
				const obj: Record<string, unknown> = {};
				while (peek() !== "}") {
					const key = String(consume());
					if (consume() !== ":") throw new Error("Expected :");
					obj[key] = parseExpression();
					if (peek() === ",") consume();
				}
				consume(); // }
				return obj;
			}
			if (token === "[") {
				// Array literal
				const arr: unknown[] = [];
				while (peek() !== "]") {
					arr.push(parseExpression());
					if (peek() === ",") consume();
				}
				consume(); // ]
				return arr;
			}
			if (token.startsWith('"')) {
				return token.slice(1, -1);
			}
			if (!Number.isNaN(Number(token))) {
				return Number(token);
			}
			if (token === "true") return true;
			if (token === "false") return false;
			if (token === "null") return null;
			// Property access
			return this._resolvePath(token) as ExpressionValue;
		};

		const parseExpression = (): unknown => {
			const left = parsePrimary();
			while (
				peek() === "+" ||
				peek() === "-" ||
				peek() === "*" ||
				peek() === "/" ||
				peek() === "==" ||
				peek() === "!=" ||
				peek() === "<" ||
				peek() === ">" ||
				peek() === "<=" ||
				peek() === ">=" ||
				peek() === "&&" ||
				peek() === "||"
			) {
				const op = consume();
				if (op === undefined) throw new Error("Unexpected end of expression");
				const right = parsePrimary();
				switch (op) {
					case "+":
						return (left as number) + (right as number);
					case "-":
						return (left as number) - (right as number);
					case "*":
						return (left as number) * (right as number);
					case "/":
						return (left as number) / (right as number);
					case "==":
						return left === right;
					case "!=":
						return left !== right;
					case "<":
						return (left as number) < (right as number);
					case ">":
						return (left as number) > (right as number);
					case "<=":
						return (left as number) <= (right as number);
					case ">=":
						return (left as number) >= (right as number);
					case "&&":
						return Boolean(left) && Boolean(right);
					case "||":
						return Boolean(left) || Boolean(right);
				}
			}
			return left;
		};

		return parseExpression();
	}

	private _evalNode(node: unknown): unknown {
		if (node === null || node === undefined) return node;
		if (typeof node !== "object") return node;
		return node;
	}

	private _resolvePath(path: string): unknown {
		const parts = path.split(".");
		let current: unknown = this._context;
		for (const part of parts) {
			if (current === null || current === undefined) return undefined;
			if (typeof current !== "object") return undefined;
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}
}

// ── Custom Expression Functions ──

/**
 * Custom functions available in workflow expressions.
 */
export const EXPRESSION_FUNCTIONS = {
	upper: (s: unknown) => String(s).toUpperCase(),
	lower: (s: unknown) => String(s).toLowerCase(),
	trim: (s: unknown) => String(s).trim(),
	length: (s: unknown) => (Array.isArray(s) ? s.length : String(s).length),
	contains: (s: unknown, sub: unknown) => String(s).includes(String(sub)),
	startsWith: (s: unknown, prefix: unknown) =>
		String(s).startsWith(String(prefix)),
	endsWith: (s: unknown, suffix: unknown) => String(s).endsWith(String(suffix)),
	replace: (s: unknown, from: unknown, to: unknown) =>
		String(s).replace(String(from), String(to)),
	split: (s: unknown, sep: unknown) => String(s).split(String(sep)),
	join: (arr: unknown, sep: unknown) =>
		Array.isArray(arr) ? arr.join(String(sep)) : String(arr),
	abs: (n: unknown) => Math.abs(Number(n)),
	min: (...args: unknown[]) => Math.min(...args.map(Number)),
	max: (...args: unknown[]) => Math.max(...args.map(Number)),
	round: (n: unknown) => Math.round(Number(n)),
	floor: (n: unknown) => Math.floor(Number(n)),
	ceil: (n: unknown) => Math.ceil(Number(n)),
	sum: (arr: unknown) =>
		Array.isArray(arr) ? arr.reduce((a: number, b) => a + Number(b), 0) : 0,
	avg: (arr: unknown) => {
		if (!Array.isArray(arr) || arr.length === 0) return 0;
		return arr.reduce((a: number, b) => a + Number(b), 0) / arr.length;
	},
	now: () => new Date().toISOString(),
	date: (n: unknown) => new Date(Number(n)).toISOString(),
	json: (v: unknown) => JSON.stringify(v),
	parseJson: (s: unknown) => {
		try {
			return JSON.parse(String(s));
		} catch {
			return null;
		}
	},
} satisfies Record<string, (...args: unknown[]) => unknown>;

// ── Deep Clone ──

/**
 * Deep clone a value, handling circular references.
 */
export function deepClone<T>(
	value: T,
	seen = new WeakMap<object, unknown>(),
): T {
	if (value === null || typeof value !== "object") return value;

	if (value instanceof Date) return new Date(value.getTime()) as T;
	if (value instanceof RegExp)
		return new RegExp(value.source, value.flags) as T;

	if (seen.has(value)) return seen.get(value) as T;

	if (Array.isArray(value)) {
		const clone: unknown[] = [];
		seen.set(value, clone);
		for (let i = 0; i < value.length; i++) {
			clone[i] = deepClone(value[i], seen);
		}
		return clone as T;
	}

	const clone: Record<string, unknown> = {};
	seen.set(value, clone);
	for (const key of Object.keys(value)) {
		clone[key] = deepClone((value as Record<string, unknown>)[key], seen);
	}
	return clone as T;
}

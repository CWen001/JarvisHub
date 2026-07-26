import type { Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../types";

export class AppError extends Error {
	status: number;
	code: string;
	details?: unknown;

	constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
		super(message);
		this.name = "AppError";
		this.status = options?.status ?? 400;
		this.code = options?.code ?? "bad_request";
		this.details = options?.details;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function normalizeHttpStatus(value: unknown, fallback: ContentfulStatusCode): ContentfulStatusCode {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	const status = Math.trunc(n);
	if (status < 400 || status > 599) return fallback;
	return status as ContentfulStatusCode;
}

function safeRead(err: unknown, key: string): unknown {
	if (!isRecord(err)) return undefined;
	try {
		return err[key];
	} catch {
		return undefined;
	}
}

function safeReadString(err: unknown, key: string): string | undefined {
	const value = safeRead(err, key);
	return typeof value === "string" ? value : undefined;
}

function safeReadNumber(err: unknown, key: string): number | undefined {
	const value = safeRead(err, key);
	return typeof value === "number" ? value : undefined;
}

function safeStringify(value: unknown): string {
	try {
		if (typeof value === "string") return value;
		return String(value);
	} catch {
		return "(unstringifiable error)";
	}
}

export type NormalizedError = {
	name: string | undefined;
	message: string | undefined;
	status: number | undefined;
	code: string | undefined;
	details: unknown;
	stack: string | undefined;
};

export function safeNormalizeError(err: unknown): NormalizedError {
	return {
		name: safeReadString(err, "name"),
		message: safeReadString(err, "message"),
		status: safeReadNumber(err, "status"),
		code: safeReadString(err, "code"),
		details: safeRead(err, "details"),
		stack: safeReadString(err, "stack"),
	};
}

function looksLikeAppError(normalized: NormalizedError, err: unknown): boolean {
	if (err instanceof AppError) return true;
	if (normalized.name === "AppError") return true;
	return typeof normalized.status === "number" && typeof normalized.code === "string";
}

export function honoErrorHandler(err: unknown, c: AppContext) {
	const normalized = safeNormalizeError(err);

	if (looksLikeAppError(normalized, err)) {
		const status = normalizeHttpStatus(normalized.status, 400);
		const code = normalized.code && normalized.code.trim() ? normalized.code : "bad_request";
		const message = normalized.message && normalized.message.trim() ? normalized.message : "Bad Request";
		return c.json(
			{
				message,
				error: message,
				code,
				details: normalized.details,
			},
			status,
		);
	}

	try {
		const name = normalized.name ?? typeof err;
		const message = normalized.message ?? safeStringify(err);
		const stack = normalized.stack ?? "";
		console.error(`Unhandled error: ${name}: ${message}\n${stack}`);
	} catch {
		console.error("Unhandled error (failed to stringify)");
	}

	const message = normalized.message ?? "Internal Server Error";
	return c.json(
		{
			message,
			error: "Internal Server Error",
			code: "internal_error",
			details: {
				name: normalized.name,
				stack: normalized.stack,
			},
		},
		500,
	);
}

export async function errorMiddleware(c: AppContext, next: Next) {
	try {
		await next();
	} catch (err) {
		return honoErrorHandler(err, c);
	}
}

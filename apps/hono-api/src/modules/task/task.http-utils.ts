import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { AppContext } from "../../types";

function trimTrailingSlashes(raw: string | null | undefined): string {
	const value = (raw || "").trim();
	return value ? value.replace(/\/+$/, "") : "";
}

export function resolveRequiredVendorHttpContext(
	ctx: { baseUrl: string; apiKey: string },
	options: {
		errorMessage: string;
		errorCode: string;
		fallbackBaseUrl?: string;
	},
): { baseUrl: string; apiKey: string } {
	const baseUrl =
		trimTrailingSlashes(ctx.baseUrl) ||
		trimTrailingSlashes(options.fallbackBaseUrl || "");
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl || !apiKey) {
		throw new AppError(options.errorMessage, {
			status: 400,
			code: options.errorCode,
		});
	}
	return { baseUrl, apiKey };
}

export async function fetchJsonWithDebug(
	c: AppContext,
	input: {
		url: string;
		init: RequestInit;
		tag: string;
		requestFailedMessage: string;
		requestFailedCode: string;
		provider?: string;
	},
): Promise<{ response: Response; data: unknown }> {
	let response: Response;
	try {
		response = await fetchWithHttpDebugLog(c, input.url, input.init, { tag: input.tag });
	} catch (error) {
		throw new AppError(input.requestFailedMessage, {
			status: 502,
			code: input.requestFailedCode,
			details: { message: (error as Error)?.message ?? String(error) },
		});
	}
	const provider = input.provider || input.tag.split(":")[0] || "vendor";
	let rawText: string;
	try {
		rawText = await response.text();
	} catch (err) {
		throw new AppError(`${provider} 响应体读取失败`, {
			status: 502,
			code: `${provider}_response_read_failed`,
			details: {
				httpStatus: response.status,
				upstreamUrl: input.url,
				method: typeof input.init.method === "string" ? input.init.method : "GET",
				readError: (err as Error).message,
			},
		});
	}
	const trimmed = rawText.trim();
	let data: unknown = null;
	if (response.status >= 200 && response.status < 300) {
		if (!trimmed) {
			throw new AppError(`${provider} 返回了空响应体`, {
				status: 502,
				code: `${provider}_empty_response`,
				details: {
					httpStatus: response.status,
					upstreamUrl: input.url,
					method: typeof input.init.method === "string" ? input.init.method : "GET",
				},
			});
		}
		try {
			data = JSON.parse(trimmed) as unknown;
		} catch (err) {
			throw new AppError(`${provider} 返回了非 JSON 响应体`, {
				status: 502,
				code: `${provider}_invalid_json`,
				details: {
					httpStatus: response.status,
					upstreamUrl: input.url,
					method: typeof input.init.method === "string" ? input.init.method : "GET",
					bodyExcerpt: trimmed.slice(0, 200),
					parseError: (err as Error).message,
				},
			});
		}
	} else if (trimmed) {
		try {
			data = JSON.parse(trimmed) as unknown;
		} catch {
			data = { __rawBodyExcerpt: trimmed.slice(0, 200) };
		}
	}
	return { response, data };
}

export function extractUpstreamErrorMessage(
	data: unknown,
	fallback: string,
): string {
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		const error = record.error;
		if (error && typeof error === "object") {
			const errMessage = (error as Record<string, unknown>).message;
			if (typeof errMessage === "string" && errMessage) return errMessage;
		}
		if (typeof error === "string" && error) return error;
		const directMessage = record.message;
		if (typeof directMessage === "string" && directMessage) return directMessage;
		const msg = record.msg;
		if (typeof msg === "string" && msg) return msg;
	}
	return fallback;
}

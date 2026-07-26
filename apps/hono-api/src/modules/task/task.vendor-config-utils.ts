import { normalizeBaseUrl, normalizeVendorKey } from "./task.vendor-utils";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.beqlee.icu";
const LEGACY_GEMINI_BASE_HOST = "generativelanguage.googleapis.com";

export function defaultBaseUrlForVendor(vendor: string): string | null {
	const v = normalizeVendorKey(vendor);
	if (v === "openai") return "https://api.openai.com";
	if (v === "gemini") return DEFAULT_GEMINI_BASE_URL;
	if (v === "qwen") return "https://dashscope.aliyuncs.com";
	if (v === "anthropic") return "https://api.anthropic.com/v1";
	if (v === "apimart") return "https://api.apimart.ai";
	if (v === "tuzi") return "https://api.tu-zi.com";
	if (v === "video-gateway") return "https://video.example.com";
	if (v === "veo") return "https://api.grsai.com";
	return null;
}

export function normalizeGeminiBaseUrl(raw: string): string {
	const normalized = normalizeBaseUrl(raw || "") || "";
	if (!normalized) return DEFAULT_GEMINI_BASE_URL;
	try {
		const url = new URL(normalized);
		if (url.hostname.toLowerCase() !== LEGACY_GEMINI_BASE_HOST) {
			return normalized;
		}
		const target = new URL(DEFAULT_GEMINI_BASE_URL);
		url.protocol = target.protocol;
		url.hostname = target.hostname;
		url.port = target.port;
		return url.toString().replace(/\/+$/, "");
	} catch {
		return normalized;
	}
}

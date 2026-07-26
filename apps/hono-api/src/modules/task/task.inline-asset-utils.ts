import { PutObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import {
	createRustfsClient,
	resolveRustfsConfig,
} from "../asset/rustfs.client";

export function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").trim();
	if (!cleaned) return new Uint8Array(0);
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function detectImageExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct === "image/png") return "png";
	if (ct === "image/jpeg") return "jpg";
	if (ct === "image/webp") return "webp";
	if (ct === "image/gif") return "gif";
	return "bin";
}

export function detectAssetExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct.startsWith("image/")) return detectImageExtensionFromMimeType(ct);
	if (ct === "video/mp4") return "mp4";
	if (ct === "video/webm") return "webm";
	if (ct === "video/quicktime") return "mov";
	if (ct === "video/x-matroska") return "mkv";
	return "bin";
}

function buildInlineAssetKey(userId: string, ext: string, prefix: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const dir = prefix ? prefix.replace(/^\/+|\/+$/g, "") : "gen";
	return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

export async function uploadInlineAssetBytesToRustfs(options: {
	c: AppContext;
	userId: string;
	mimeType: string;
	bytes: Uint8Array;
	prefix?: string;
}): Promise<string> {
	const { c, userId, mimeType, bytes } = options;
	const rustfs = resolveRustfsConfig(c.env);
	if (!rustfs) {
		throw new AppError("Object storage is not configured", {
			status: 500,
			code: "oss_not_configured",
			details: {
				bindings: [
					"R2_BUCKET_URL",
					"R2_ENDPOINT_URL",
					"R2_BUCKET",
					"RUSTFS_ENDPOINT_URL",
					"RUSTFS_BUCKET",
				],
			},
		});
	}

	const contentType = mimeType || "application/octet-stream";
	const ext = detectAssetExtensionFromMimeType(contentType);
	const key = buildInlineAssetKey(userId, ext, options.prefix || "gen/assets");
	const client = createRustfsClient(c.env);
	await client.send(
		new PutObjectCommand({
			Bucket: rustfs.bucket,
			Key: key,
			Body: bytes,
			ContentType: contentType,
		}),
	);

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

export async function uploadInlineImageToRustfs(options: {
	c: AppContext;
	userId: string;
	mimeType: string;
	base64: string;
	prefix?: string;
}): Promise<string> {
	const { c, userId, mimeType, base64 } = options;
	const bytes = decodeBase64ToBytes(base64);
	return uploadInlineAssetBytesToRustfs({
		c,
		userId,
		mimeType,
		bytes,
		prefix: options.prefix || "gen/images",
	});
}

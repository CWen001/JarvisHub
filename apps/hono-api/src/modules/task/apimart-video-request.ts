export type ApimartVideoImageWithRole = {
	url: string;
	role: "reference_image";
};

export type ApimartVideoGenerationRequestBody = {
	model: string;
	prompt: string;
	image_with_roles: ApimartVideoImageWithRole[];
	size?: string;
	duration?: number;
	resolution?: string;
	generate_audio?: boolean;
	return_last_frame?: boolean;
	seed?: number;
};

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function readPositiveNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushStringValues(target: string[], value: unknown): void {
	const items = Array.isArray(value) ? value : [value];
	for (const item of items) {
		const url = readString(item);
		if (url) target.push(url);
	}
}

function pushAssetInputUrls(target: string[], value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = readString(item.url);
		if (url) target.push(url);
	}
}

function pushImageWithRoleUrls(target: string[], value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = readString(item.url);
		if (url) target.push(url);
	}
}

function uniqueUrls(urls: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const url of urls) {
		const trimmed = url.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

export function buildApimartVideoImageWithRoles(
	extras: Record<string, unknown>,
): ApimartVideoImageWithRole[] {
	const urls: string[] = [];
	pushImageWithRoleUrls(urls, extras.image_with_roles);
	pushImageWithRoleUrls(urls, extras.imageWithRoles);
	pushStringValues(urls, extras.image_urls);
	pushStringValues(urls, extras.imageUrls);
	pushStringValues(urls, extras.url);
	pushStringValues(urls, extras.urls);
	pushStringValues(urls, extras.image);
	pushStringValues(urls, extras.imageUrl);
	pushStringValues(urls, extras.referenceImages);
	pushStringValues(urls, extras.reference_images);
	pushAssetInputUrls(urls, extras.assetInputs);
	return uniqueUrls(urls)
		.slice(0, 14)
		.map((url) => ({ url, role: "reference_image" }));
}

export function buildApimartVideoGenerationRequestBody(input: {
	model: string;
	prompt: string;
	extras: Record<string, unknown>;
	imageWithRoles: ApimartVideoImageWithRole[];
}): ApimartVideoGenerationRequestBody {
	const size = readString(input.extras.size) || readString(input.extras.aspectRatio);
	const resolution = readString(input.extras.resolution);
	const durationSeconds =
		readPositiveNumber(input.extras.durationSeconds) ??
		readPositiveNumber(input.extras.duration);
	const generateAudio =
		readBoolean(input.extras.generate_audio) ?? readBoolean(input.extras.generateAudio);
	const returnLastFrame =
		readBoolean(input.extras.return_last_frame) ??
		readBoolean(input.extras.returnLastFrame);
	const seed =
		typeof input.extras.seed === "number" && Number.isFinite(input.extras.seed)
			? Math.trunc(input.extras.seed)
			: undefined;

	return {
		model: input.model,
		prompt: input.prompt,
		image_with_roles: input.imageWithRoles,
		...(size ? { size } : {}),
		...(typeof durationSeconds === "number" ? { duration: durationSeconds } : {}),
		...(resolution ? { resolution } : {}),
		...(typeof generateAudio === "boolean" ? { generate_audio: generateAudio } : {}),
		...(typeof returnLastFrame === "boolean" ? { return_last_frame: returnLastFrame } : {}),
		...(typeof seed === "number" ? { seed } : {}),
	};
}

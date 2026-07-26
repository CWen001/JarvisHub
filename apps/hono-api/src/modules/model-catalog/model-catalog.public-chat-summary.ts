import type { AppContext } from "../../types";
import { normalizeDispatchVendor } from "../task/task.vendor";
import type {
	ModelCatalogImageOptions,
	ModelCatalogModelDto,
	ModelCatalogVideoOptions,
} from "./model-catalog.schemas";
import { listExecutableVendorKeysForCatalogKind } from "./model-catalog.executable";
import { listModelCatalogModels, listModelCatalogVendors } from "./model-catalog.service";

type UnknownRecord = Record<string, unknown>;

type VendorAvailabilityFlags = {
	system: boolean;
	user: boolean;
};

export type PublicChatModelAvailability = "system" | "user" | "system+user";

export type PublicChatEnabledImageModelSummary = {
	vendorKey: string;
	modelKey: string;
	modelAlias: string | null;
	labelZh: string;
	availability: PublicChatModelAvailability;
	useCases: string[];
	imageOptions: {
		defaultAspectRatio: string | null;
		defaultImageSize: string | null;
		aspectRatioOptions: string[];
		imageSizeOptions: Array<{
			value: string;
			label: string;
		}>;
		resolutionOptions: string[];
		supportsReferenceImages: boolean | null;
		supportsTextToImage: boolean | null;
		supportsImageToImage: boolean | null;
	} | null;
};

export type PublicChatEnabledVideoModelSummary = {
	vendorKey: string;
	modelKey: string;
	modelAlias: string | null;
	labelZh: string;
	availability: PublicChatModelAvailability;
	useCases: string[];
	videoOptions: {
		defaultDurationSeconds: number | null;
		defaultSize: string | null;
		defaultResolution: string | null;
		maxDurationSeconds: number | null;
		durationOptions: Array<{
			value: number;
			label: string;
		}>;
		sizeOptions: Array<{
			value: string;
			label: string;
			orientation: "portrait" | "landscape" | null;
			aspectRatio: string | null;
		}>;
		resolutionOptions: Array<{
			value: string;
			label: string;
		}>;
		orientationOptions: Array<{
			value: "portrait" | "landscape";
			label: string;
			size: string | null;
			aspectRatio: string | null;
		}>;
	} | null;
};

export type PublicChatEnabledModelCatalogSummary = {
	imageModels: PublicChatEnabledImageModelSummary[];
	videoModels: PublicChatEnabledVideoModelSummary[];
};

export type PublicChatEnabledModelCatalogSummaryResult = {
	summary: PublicChatEnabledModelCatalogSummary | null;
	error: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeStringArray(values: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const normalized = normalizeNonEmptyString(value);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function readModelUseCases(meta: unknown): string[] {
	if (!isRecord(meta)) return [];
	const raw = meta.useCases;
	return Array.isArray(raw) ? normalizeStringArray(raw) : [];
}

function readImageOptions(
	meta: unknown,
): PublicChatEnabledImageModelSummary["imageOptions"] {
	if (!isRecord(meta) || !isRecord(meta.imageOptions)) return null;
	const imageOptions = meta.imageOptions as ModelCatalogImageOptions;
	const defaultAspectRatio = normalizeNonEmptyString(
		imageOptions.defaultAspectRatio,
	);
	const defaultImageSize = normalizeNonEmptyString(imageOptions.defaultImageSize);
	const aspectRatioOptions = Array.isArray(imageOptions.aspectRatioOptions)
		? normalizeStringArray(imageOptions.aspectRatioOptions)
		: [];
	const imageSizeOptions = Array.isArray(imageOptions.imageSizeOptions)
		? imageOptions.imageSizeOptions
				.map((option) => {
					if (typeof option === "string") {
						const value = normalizeNonEmptyString(option);
						if (!value) return null;
						return { value, label: value };
					}
					if (!isRecord(option)) return null;
					const value = normalizeNonEmptyString(option.value);
					const label =
						normalizeNonEmptyString(option.label) ||
						normalizeNonEmptyString(option.size) ||
						value;
					if (!value || !label) return null;
					return {
						value,
						label,
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
					} => option !== null,
				)
				.filter((option, index, list) =>
					list.findIndex((item) => item.value === option.value) === index,
				)
		: [];
	const resolutionOptions = Array.isArray(imageOptions.resolutionOptions)
		? normalizeStringArray(imageOptions.resolutionOptions)
		: [];
	const supportsReferenceImages = normalizeOptionalBoolean(
		imageOptions.supportsReferenceImages,
	);
	const supportsTextToImage = normalizeOptionalBoolean(
		imageOptions.supportsTextToImage,
	);
	const supportsImageToImage = normalizeOptionalBoolean(
		imageOptions.supportsImageToImage,
	);
	if (
		defaultAspectRatio === null &&
		defaultImageSize === null &&
		aspectRatioOptions.length === 0 &&
		imageSizeOptions.length === 0 &&
		resolutionOptions.length === 0 &&
		supportsReferenceImages === null &&
		supportsTextToImage === null &&
		supportsImageToImage === null
	) {
		return null;
	}
	return {
		defaultAspectRatio,
		defaultImageSize,
		aspectRatioOptions,
		imageSizeOptions,
		resolutionOptions,
		supportsReferenceImages,
		supportsTextToImage,
		supportsImageToImage,
	};
}

function readVideoOptions(
	meta: unknown,
): PublicChatEnabledVideoModelSummary["videoOptions"] {
	if (!isRecord(meta) || !isRecord(meta.videoOptions)) return null;
	const videoOptions = meta.videoOptions as ModelCatalogVideoOptions;
	const durationOptions = Array.isArray(videoOptions.durationOptions)
		? videoOptions.durationOptions
				.map((option) => {
					const label = normalizeNonEmptyString(option.label);
					const value =
						typeof option.value === "number" && Number.isFinite(option.value)
							? Math.trunc(option.value)
							: null;
					if (!label || value === null || value <= 0) return null;
					return {
						value,
						label,
					};
				})
				.filter(
					(
						option,
					): option is {
						value: number;
						label: string;
					} => option !== null,
				)
		: [];
	const sizeOptions = Array.isArray(videoOptions.sizeOptions)
		? videoOptions.sizeOptions
				.map((option) => {
					const value = normalizeNonEmptyString(option.value);
					const label = normalizeNonEmptyString(option.label);
					if (!value || !label) return null;
					return {
						value,
						label,
						orientation:
							option.orientation === "portrait" || option.orientation === "landscape"
								? option.orientation
								: null,
						aspectRatio: normalizeNonEmptyString(option.aspectRatio),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
						orientation: "portrait" | "landscape" | null;
						aspectRatio: string | null;
					} => option !== null,
				)
		: [];
	const resolutionOptions = Array.isArray(videoOptions.resolutionOptions)
		? videoOptions.resolutionOptions
				.map((option) => {
					const value = normalizeNonEmptyString(option.value);
					const label = normalizeNonEmptyString(option.label);
					if (!value || !label) return null;
					return {
						value,
						label,
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
					} => option !== null,
				)
		: [];
	const orientationOptions = Array.isArray(videoOptions.orientationOptions)
		? videoOptions.orientationOptions
				.map((option) => {
					const label = normalizeNonEmptyString(option.label);
					if (
						!label ||
						(option.value !== "portrait" && option.value !== "landscape")
					) {
						return null;
					}
					return {
						value: option.value,
						label,
						size: normalizeNonEmptyString(option.size),
						aspectRatio: normalizeNonEmptyString(option.aspectRatio),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: "portrait" | "landscape";
						label: string;
						size: string | null;
						aspectRatio: string | null;
					} => option !== null,
				)
		: [];
	const defaultDurationSeconds =
		typeof videoOptions.defaultDurationSeconds === "number" &&
		Number.isFinite(videoOptions.defaultDurationSeconds) &&
		videoOptions.defaultDurationSeconds > 0
			? Math.trunc(videoOptions.defaultDurationSeconds)
			: null;
	const defaultSize = normalizeNonEmptyString(videoOptions.defaultSize);
	const defaultResolution = normalizeNonEmptyString(videoOptions.defaultResolution);
	const maxDurationSeconds =
		durationOptions.length > 0
			? durationOptions.reduce(
					(maxValue, option) => (option.value > maxValue ? option.value : maxValue),
					0,
				)
			: defaultDurationSeconds;
	if (
		defaultDurationSeconds === null &&
		defaultSize === null &&
		defaultResolution === null &&
		maxDurationSeconds === null &&
		durationOptions.length === 0 &&
		sizeOptions.length === 0 &&
		resolutionOptions.length === 0 &&
		orientationOptions.length === 0
	) {
		return null;
	}
	return {
		defaultDurationSeconds,
		defaultSize,
		defaultResolution,
		maxDurationSeconds,
		durationOptions,
		sizeOptions,
		resolutionOptions,
		orientationOptions,
	};
}

function toModelAvailability(
	flags: VendorAvailabilityFlags,
): PublicChatModelAvailability {
	if (flags.system && flags.user) return "system+user";
	return flags.system ? "system" : "user";
}

function compareModelIdentity(
	a: { modelAlias: string | null; modelKey: string },
	b: { modelAlias: string | null; modelKey: string },
): number {
	const aIdentity = a.modelAlias || a.modelKey;
	const bIdentity = b.modelAlias || b.modelKey;
	return aIdentity.localeCompare(bIdentity);
}

function buildImageModelSummary(
	model: ModelCatalogModelDto,
	flags: VendorAvailabilityFlags,
): PublicChatEnabledImageModelSummary {
	return {
		vendorKey: model.vendorKey,
		modelKey: model.modelKey,
		modelAlias: normalizeNonEmptyString(model.modelAlias),
		labelZh: model.labelZh,
		availability: toModelAvailability(flags),
		useCases: readModelUseCases(model.meta),
		imageOptions: readImageOptions(model.meta),
	};
}

function buildVideoModelSummary(
	model: ModelCatalogModelDto,
	flags: VendorAvailabilityFlags,
): PublicChatEnabledVideoModelSummary {
	return {
		vendorKey: model.vendorKey,
		modelKey: model.modelKey,
		modelAlias: normalizeNonEmptyString(model.modelAlias),
		labelZh: model.labelZh,
		availability: toModelAvailability(flags),
		useCases: readModelUseCases(model.meta),
		videoOptions: readVideoOptions(model.meta),
	};
}

export function buildPublicChatEnabledModelCatalogSummaryFromModels(
	models: readonly ModelCatalogModelDto[],
	vendorAvailabilityMap: ReadonlyMap<string, VendorAvailabilityFlags>,
): PublicChatEnabledModelCatalogSummary {
	const imageModels: PublicChatEnabledImageModelSummary[] = [];
	const videoModels: PublicChatEnabledVideoModelSummary[] = [];
	for (const model of models) {
		if (!model.enabled) continue;
		const flags = vendorAvailabilityMap.get(model.vendorKey);
		if (!flags) continue;
		if (model.kind === "image") {
			imageModels.push(buildImageModelSummary(model, flags));
			continue;
		}
		if (model.kind === "video") {
			videoModels.push(buildVideoModelSummary(model, flags));
		}
	}
	imageModels.sort(compareModelIdentity);
	videoModels.sort(compareModelIdentity);
	return {
		imageModels,
		videoModels,
	};
}

async function listEnabledUserVendorKeys(
	c: AppContext,
	userId: string,
): Promise<Set<string>> {
	void c;
	void userId;
	return new Set<string>();
}

export async function loadPublicChatEnabledModelCatalogSummary(
	c: AppContext,
	userId: string,
): Promise<PublicChatEnabledModelCatalogSummaryResult> {
	try {
		const [
			vendors,
			models,
			enabledUserVendorKeys,
			executableImageVendorKeys,
			executableVideoVendorKeys,
		] = await Promise.all([
			listModelCatalogVendors(c),
			listModelCatalogModels(c, { enabled: true }),
			listEnabledUserVendorKeys(c, userId),
			listExecutableVendorKeysForCatalogKind(c, "image"),
			listExecutableVendorKeysForCatalogKind(c, "video"),
		]);

		const vendorAvailabilityMap = new Map<string, VendorAvailabilityFlags>();
		for (const vendor of vendors) {
			if (!vendor.enabled) continue;
			const vendorKey = normalizeDispatchVendor(vendor.key);
			if (!vendorKey) continue;
			const hasSystemAccess =
				vendor.authType === "none" || vendor.hasApiKey === true;
			const hasUserAccess = enabledUserVendorKeys.has(vendorKey);
			if (!hasSystemAccess && !hasUserAccess) continue;
			vendorAvailabilityMap.set(vendorKey, {
				system: hasSystemAccess,
				user: hasUserAccess,
			});
		}
		const executableModels = models.filter((model) => {
			if (model.kind !== "image" && model.kind !== "video") return true;
			const vendorKey = normalizeDispatchVendor(model.vendorKey);
			if (!vendorKey) return false;
			if (model.kind === "image") return executableImageVendorKeys.has(vendorKey);
			return executableVideoVendorKeys.has(vendorKey);
		});

		return {
			summary: buildPublicChatEnabledModelCatalogSummaryFromModels(
				executableModels,
				vendorAvailabilityMap,
			),
			error: null,
		};
	} catch (error) {
		const message =
			error instanceof Error && error.message.trim()
				? error.message.trim()
				: "enabled model catalog summary unavailable";
		return {
			summary: null,
			error: message,
		};
	}
}

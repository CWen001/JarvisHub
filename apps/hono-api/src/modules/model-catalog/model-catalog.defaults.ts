import type {
	ModelCatalogModelDto,
	ModelCatalogVendorDto,
} from "./model-catalog.schemas";

export const DEFAULT_MODEL_CATALOG_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const DEFAULT_MODEL_CATALOG_VENDOR: ModelCatalogVendorDto = {
	key: "apimart",
	name: "APIMart",
	enabled: true,
	hasApiKey: false,
	baseUrlHint: "https://api.apimart.ai",
	authType: "bearer",
	authHeader: null,
	authQueryParam: null,
	meta: {
		source: "builtin-default",
	},
	createdAt: DEFAULT_MODEL_CATALOG_TIMESTAMP,
	updatedAt: DEFAULT_MODEL_CATALOG_TIMESTAMP,
};

export const DEFAULT_MODEL_CATALOG_MODELS: readonly ModelCatalogModelDto[] = [
	{
		modelKey: "gpt-image-2",
		vendorKey: "apimart",
		modelAlias: "gpt-image-2",
		labelZh: "GPT Image 2",
		kind: "image",
		enabled: true,
		meta: {
			useCases: ["文本生图", "参考图改图", "画布图片节点"],
			imageOptions: {
				defaultAspectRatio: "1:1",
				defaultImageSize: "1k",
				aspectRatioOptions: [
					"auto",
					"1:1",
					"3:2",
					"2:3",
					"4:3",
					"3:4",
					"5:4",
					"4:5",
					"16:9",
					"9:16",
					"2:1",
					"1:2",
					"21:9",
					"9:21",
				],
				imageSizeOptions: [
					{ value: "1k", label: "1K" },
					{ value: "2k", label: "2K" },
					{ value: "4k", label: "4K" },
				],
				resolutionOptions: ["1k", "2k", "4k"],
				supportsReferenceImages: true,
				supportsTextToImage: true,
				supportsImageToImage: true,
			},
		},
		createdAt: DEFAULT_MODEL_CATALOG_TIMESTAMP,
		updatedAt: DEFAULT_MODEL_CATALOG_TIMESTAMP,
	},
];

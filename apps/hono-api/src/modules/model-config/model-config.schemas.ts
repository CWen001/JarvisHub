import { z } from "zod";

export const ModelConfigAuthTypeSchema = z.enum([
	"none",
	"bearer",
	"x-api-key",
	"query",
]);

export type ModelConfigAuthType = z.infer<typeof ModelConfigAuthTypeSchema>;

export const ModelConfigApiProtocolSchema = z.string().trim().min(1);

export type ModelConfigApiProtocol = z.infer<typeof ModelConfigApiProtocolSchema>;

export const ModelConfigKindSchema = z.enum(["multimodal", "image", "video"]);

export type ModelConfigKind = z.infer<typeof ModelConfigKindSchema>;

export const ModelConfigDefaultSlotSchema = z.enum([
	"multimodal",
	"image",
	"video",
	"agent",
]);

export type ModelConfigDefaultSlot = z.infer<
	typeof ModelConfigDefaultSlotSchema
>;

export const AGENT_BACKBONE_REQUIRED_KIND: ModelConfigKind = "multimodal";

export const ModelConfigProviderSchema = z.object({
	key: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	baseUrl: z.string().nullable(),
	authType: ModelConfigAuthTypeSchema,
	authHeader: z.string().nullable(),
	authQueryParam: z.string().nullable(),
	apiProtocol: ModelConfigApiProtocolSchema.nullable().optional(),
	apiKeyConfigured: z.boolean(),
	meta: z.unknown().optional(),
});

export type ModelConfigProviderDto = z.infer<typeof ModelConfigProviderSchema>;

export const ModelConfigModelSchema = z.object({
	modelKey: z.string(),
	providerKey: z.string(),
	modelAlias: z.string().nullable(),
	label: z.string(),
	kind: ModelConfigKindSchema,
	enabled: z.boolean(),
	options: z.unknown().optional(),
});

export type ModelConfigModelDto = z.infer<typeof ModelConfigModelSchema>;

export const ModelConfigDefaultModelSchema = z.object({
	slot: ModelConfigDefaultSlotSchema,
	vendorKey: z.string(),
	modelKey: z.string(),
	modelAlias: z.string().nullable(),
	label: z.string(),
	kind: ModelConfigKindSchema,
	options: z.unknown().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelConfigDefaultModelDto = z.infer<
	typeof ModelConfigDefaultModelSchema
>;

export const ModelConfigSchema = z.object({
	providers: z.array(ModelConfigProviderSchema),
	models: z.array(ModelConfigModelSchema),
	defaults: z.array(ModelConfigDefaultModelSchema),
});

export type ModelConfigDto = z.infer<typeof ModelConfigSchema>;

export const UpsertModelConfigProviderSchema = z.object({
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	baseUrl: z.string().nullable().optional(),
	authType: ModelConfigAuthTypeSchema.optional(),
	authHeader: z.string().nullable().optional(),
	authQueryParam: z.string().nullable().optional(),
	apiProtocol: ModelConfigApiProtocolSchema.nullable().optional(),
	meta: z.unknown().optional(),
});

export const UpsertModelConfigApiKeySchema = z.object({
	apiKey: z.string().min(1),
	enabled: z.boolean().optional(),
});

export const UpsertModelConfigModelSchema = z.object({
	modelAlias: z.string().nullable().optional(),
	label: z.string().min(1),
	kind: ModelConfigKindSchema,
	enabled: z.boolean().optional(),
	options: z.unknown().optional(),
});

export const UpsertModelConfigDefaultModelSchema = z.object({
	vendorKey: z.string().min(1),
	modelKey: z.string().min(1),
});

export const ModelConfigImportProviderSchema = z.object({
	key: z.string().min(1),
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	baseUrl: z.string().nullable().optional(),
	authType: ModelConfigAuthTypeSchema.optional(),
	authHeader: z.string().nullable().optional(),
	authQueryParam: z.string().nullable().optional(),
	apiProtocol: ModelConfigApiProtocolSchema.nullable().optional(),
	apiKey: z.string().optional(),
});

export const ModelConfigImportModelSchema = z.object({
	providerKey: z.string().min(1),
	modelKey: z.string().min(1),
	modelAlias: z.string().nullable().optional(),
	label: z.string().min(1),
	kind: ModelConfigKindSchema,
	enabled: z.boolean().optional(),
	options: z.unknown().optional(),
});

export const ModelConfigImportPackageSchema = z.object({
	version: z.literal(1).optional(),
	providers: z.array(ModelConfigImportProviderSchema).default([]),
	models: z.array(ModelConfigImportModelSchema).default([]),
});

export type ModelConfigImportPackageDto = z.infer<typeof ModelConfigImportPackageSchema>;

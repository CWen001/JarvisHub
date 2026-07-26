import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	deleteCatalogDefaultModelRow,
	deleteCatalogModelRow,
	deleteCatalogVendorApiKeyRow,
	getCatalogDefaultModel,
	getCatalogModelByVendorAndKey,
	getCatalogVendorApiKeyByVendorKey,
	getCatalogVendorByKey,
	listCatalogDefaultModels,
	listCatalogModels,
	listCatalogVendorApiKeys,
	listCatalogVendors,
	upsertCatalogDefaultModelRow,
	upsertCatalogModelRow,
	upsertCatalogVendorApiKeyRow,
	upsertCatalogVendorRow,
} from "../model-catalog/model-catalog.repo";
import {
	AGENT_BACKBONE_REQUIRED_KIND,
	ModelConfigAuthTypeSchema,
	ModelConfigApiProtocolSchema,
	ModelConfigImportPackageSchema,
	ModelConfigKindSchema,
	ModelConfigSchema,
	ModelConfigDefaultModelSchema,
	ModelConfigDefaultSlotSchema,
	type ModelConfigDto,
	type ModelConfigDefaultModelDto,
	type ModelConfigDefaultSlot,
	type ModelConfigImportPackageDto,
	type ModelConfigModelDto,
	type ModelConfigProviderDto,
	type ModelConfigAuthType,
	type ModelConfigApiProtocol,
	type ModelConfigKind,
} from "./model-config.schemas";

type JsonObject = Record<string, unknown>;

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseJson(value: string | null): unknown | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function extractModelOptions(meta: unknown): unknown | undefined {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
	const record = meta as JsonObject;
	if ("imageOptions" in record) return record.imageOptions;
	if ("videoOptions" in record) return record.videoOptions;
	return meta;
}

function parseAuthType(value: unknown): ModelConfigAuthType {
	const parsed = ModelConfigAuthTypeSchema.safeParse(value);
	return parsed.success ? parsed.data : "bearer";
}

function parseApiProtocol(value: unknown): ModelConfigApiProtocol | null {
	const parsed = ModelConfigApiProtocolSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function parseModelKind(value: unknown): ModelConfigKind | null {
	const parsed = ModelConfigKindSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function requiredKindForSlot(slot: ModelConfigDefaultSlot): ModelConfigKind {
	if (slot === "agent") return AGENT_BACKBONE_REQUIRED_KIND;
	return slot;
}

/**
 * Cascade-clear the slot=agent default when its preconditions break.
 *
 * Why: resolver requires (vendor enabled + baseUrl + apiKey + model enabled);
 * any write that flips one of those off would leave a default pointing at a
 * combo that throws at chat time. We delete the default proactively so the UI
 * surfaces "未设置" instead of stale-green state.
 *
 * Single source of truth: re-runs resolver and only clears on its own
 * `agent_llm_credentials_missing` failure modes — no drift.
 */
async function selfHealAgentDefault(c: AppContext): Promise<void> {
	const existing = await getCatalogDefaultModel(c.env.DB, "agent");
	if (!existing) return;
	try {
		await resolveAgentLlmCredentials(c);
	} catch (err) {
		if (!(err instanceof AppError)) throw err;
		if (err.code !== "agent_llm_credentials_missing") throw err;
		const reason = (err.details as { reason?: string } | undefined)?.reason;
		if (!reason || reason === "default_slot_unset") return;
		await deleteCatalogDefaultModelRow(c.env.DB, "agent");
	}
}

function mapProvider(
	row: {
		key: string;
		name: string;
		enabled: number;
		base_url_hint: string | null;
		auth_type: string | null;
		auth_header: string | null;
		auth_query_param: string | null;
		api_protocol: string | null;
		meta: string | null;
	},
	apiKeyProviderKeys: Set<string>,
): ModelConfigProviderDto {
	const key = normalizeKey(row.key);
	return {
		key,
		name: row.name,
		enabled: Number(row.enabled ?? 1) !== 0,
		baseUrl: normalizeOptionalString(row.base_url_hint),
		authType: parseAuthType(row.auth_type),
		authHeader: normalizeOptionalString(row.auth_header),
		authQueryParam: normalizeOptionalString(row.auth_query_param),
		apiProtocol: parseApiProtocol(row.api_protocol),
		apiKeyConfigured: apiKeyProviderKeys.has(key),
		meta: parseJson(row.meta),
	};
}

function mapModel(row: {
	model_key: string;
	vendor_key: string;
	model_alias: string | null;
	label_zh: string;
	kind: string;
	enabled: number;
	meta: string | null;
}): ModelConfigModelDto | null {
	const kind = parseModelKind(row.kind);
	if (!kind) return null;
	const meta = parseJson(row.meta);
	return {
		modelKey: row.model_key,
		providerKey: normalizeKey(row.vendor_key),
		modelAlias: normalizeOptionalString(row.model_alias),
		label: row.label_zh,
		kind,
		enabled: Number(row.enabled ?? 1) !== 0,
		options: extractModelOptions(meta),
	};
}

function mapDefaultModel(
	defaultRow: {
		slot: string;
		vendor_key: string;
		model_key: string;
		created_at: string;
		updated_at: string;
	},
	modelRow: {
		model_key: string;
		vendor_key: string;
		model_alias: string | null;
		label_zh: string;
		kind: string;
		enabled: number;
		meta: string | null;
	},
): ModelConfigDefaultModelDto | null {
	const slot = ModelConfigDefaultSlotSchema.safeParse(defaultRow.slot);
	const model = mapModel(modelRow);
	if (!slot.success || !model) return null;
	return ModelConfigDefaultModelSchema.parse({
		slot: slot.data,
		vendorKey: normalizeKey(defaultRow.vendor_key),
		modelKey: defaultRow.model_key,
		modelAlias: model.modelAlias,
		label: model.label,
		kind: model.kind,
		options: model.options,
		createdAt: defaultRow.created_at,
		updatedAt: defaultRow.updated_at,
	});
}

async function listModelConfigDefaults(
	c: AppContext,
): Promise<ModelConfigDefaultModelDto[]> {
	const defaultRows = await listCatalogDefaultModels(c.env.DB);
	const out: ModelConfigDefaultModelDto[] = [];
	for (const defaultRow of defaultRows) {
		const modelRow = await getCatalogModelByVendorAndKey(c.env.DB, {
			vendorKey: defaultRow.vendor_key,
			modelKey: defaultRow.model_key,
		});
		if (!modelRow) continue;
		const mapped = mapDefaultModel(defaultRow, modelRow);
		if (mapped) out.push(mapped);
	}
	return out;
}

export async function getModelConfig(c: AppContext): Promise<ModelConfigDto> {
	const [vendorRows, apiKeyRows, modelRows, defaults] = await Promise.all([
		listCatalogVendors(c.env.DB),
		listCatalogVendorApiKeys(c.env.DB),
		listCatalogModels(c.env.DB),
		listModelConfigDefaults(c),
	]);
	const apiKeyProviderKeys = new Set(
		apiKeyRows
			.filter((row) => Number(row.enabled ?? 1) !== 0)
			.map((row) => normalizeKey(row.vendor_key))
			.filter(Boolean),
	);
	const providers = vendorRows.map((row) => mapProvider(row, apiKeyProviderKeys));
	const models = modelRows
		.map(mapModel)
		.filter((model): model is ModelConfigModelDto => model !== null);
	return ModelConfigSchema.parse({ providers, models, defaults });
}

export async function resolveModelConfigDefaultModel(
	c: AppContext,
	slot: ModelConfigDefaultSlot,
): Promise<ModelConfigDefaultModelDto | null> {
	const parsedSlot = ModelConfigDefaultSlotSchema.parse(slot);
	const defaultRow = await getCatalogDefaultModel(c.env.DB, parsedSlot);
	if (!defaultRow) return null;
	const vendorKey = normalizeKey(defaultRow.vendor_key);
	const modelKey = defaultRow.model_key;
	const [vendorRow, modelRow] = await Promise.all([
		getCatalogVendorByKey(c.env.DB, vendorKey),
		getCatalogModelByVendorAndKey(c.env.DB, { vendorKey, modelKey }),
	]);
	if (!vendorRow) {
		throw new AppError("default model provider not found", {
			status: 400,
			code: "default_model_provider_not_found",
			details: { slot: parsedSlot, vendorKey },
		});
	}
	if (Number(vendorRow.enabled ?? 1) === 0) {
		throw new AppError("default model provider is disabled", {
			status: 400,
			code: "default_model_provider_disabled",
			details: { slot: parsedSlot, vendorKey },
		});
	}
	if (!modelRow) {
		throw new AppError("default model not found", {
			status: 400,
			code: "default_model_not_found",
			details: { slot: parsedSlot, vendorKey, modelKey },
		});
	}
	if (Number(modelRow.enabled ?? 1) === 0) {
		throw new AppError("default model is disabled", {
			status: 400,
			code: "default_model_disabled",
			details: { slot: parsedSlot, vendorKey, modelKey },
		});
	}
	const modelKind = parseModelKind(modelRow.kind);
	const expectedKind = requiredKindForSlot(parsedSlot);
	if (!modelKind || modelKind !== expectedKind) {
		throw new AppError("default model kind does not match slot", {
			status: 400,
			code: "default_model_kind_mismatch",
			details: {
				slot: parsedSlot,
				vendorKey,
				modelKey,
				modelKind: modelKind ?? modelRow.kind,
				expectedKind,
			},
		});
	}
	return mapDefaultModel(defaultRow, modelRow);
}

export async function upsertModelConfigDefaultModel(
	c: AppContext,
	slotRaw: string,
	input: { vendorKey: string; modelKey: string },
): Promise<ModelConfigDefaultModelDto> {
	const slot = ModelConfigDefaultSlotSchema.safeParse(slotRaw);
	if (!slot.success) {
		throw new AppError("invalid default model slot", {
			status: 400,
			code: "invalid_default_model_slot",
			details: { slot: slotRaw },
		});
	}
	const vendorKey = normalizeKey(input.vendorKey);
	const modelKey = input.modelKey.trim();
	if (!vendorKey || !modelKey) {
		throw new AppError("vendorKey and modelKey are required", {
			status: 400,
			code: "default_model_key_required",
		});
	}
	const [vendorRow, modelRow] = await Promise.all([
		getCatalogVendorByKey(c.env.DB, vendorKey),
		getCatalogModelByVendorAndKey(c.env.DB, { vendorKey, modelKey }),
	]);
	if (!vendorRow) {
		throw new AppError("provider not found", {
			status: 400,
			code: "provider_not_found",
			details: { vendorKey },
		});
	}
	if (Number(vendorRow.enabled ?? 1) === 0) {
		throw new AppError("provider is disabled", {
			status: 400,
			code: "provider_disabled",
			details: { vendorKey },
		});
	}
	if (!modelRow) {
		throw new AppError("model not found", {
			status: 400,
			code: "model_not_found",
			details: { vendorKey, modelKey },
		});
	}
	if (Number(modelRow.enabled ?? 1) === 0) {
		throw new AppError("model is disabled", {
			status: 400,
			code: "model_disabled",
			details: { vendorKey, modelKey },
		});
	}
	const modelKind = parseModelKind(modelRow.kind);
	const expectedKind = requiredKindForSlot(slot.data);
	if (!modelKind || modelKind !== expectedKind) {
		throw new AppError("model kind does not match default slot", {
			status: 400,
			code: "default_model_kind_mismatch",
			details: {
				slot: slot.data,
				vendorKey,
				modelKey,
				modelKind: modelKind ?? modelRow.kind,
				expectedKind,
			},
		});
	}
	if (slot.data === "agent") {
		const baseUrl = normalizeOptionalString(vendorRow.base_url_hint);
		if (!baseUrl) {
			throw new AppError("agent backbone provider has no base URL", {
				status: 400,
				code: "agent_default_invalid",
				details: { reason: "base_url_missing", vendorKey },
			});
		}
		const apiKeyRow = await getCatalogVendorApiKeyByVendorKey(c.env.DB, vendorKey);
		if (!apiKeyRow || Number(apiKeyRow.enabled ?? 1) === 0) {
			throw new AppError("agent backbone provider has no API key", {
				status: 400,
				code: "agent_default_invalid",
				details: { reason: "api_key_missing", vendorKey },
			});
		}
		if (!String(apiKeyRow.api_key || "").trim()) {
			throw new AppError("agent backbone provider has empty API key", {
				status: 400,
				code: "agent_default_invalid",
				details: { reason: "api_key_empty", vendorKey },
			});
		}
	}
	const defaultRow = await upsertCatalogDefaultModelRow(
		c.env.DB,
		{ slot: slot.data, vendorKey, modelKey },
		new Date().toISOString(),
	);
	const mapped = mapDefaultModel(defaultRow, modelRow);
	if (!mapped) {
		throw new AppError("default model is invalid", {
			status: 500,
			code: "invalid_default_model",
		});
	}
	return mapped;
}

export async function clearModelConfigDefaultModel(
	c: AppContext,
	slotRaw: string,
): Promise<{ ok: true }> {
	const slot = ModelConfigDefaultSlotSchema.safeParse(slotRaw);
	if (!slot.success) {
		throw new AppError("invalid default model slot", {
			status: 400,
			code: "invalid_default_model_slot",
			details: { slot: slotRaw },
		});
	}
	await deleteCatalogDefaultModelRow(c.env.DB, slot.data);
	return { ok: true };
}

export async function upsertModelConfigProvider(
	c: AppContext,
	providerKey: string,
	input: {
		name: string;
		enabled?: boolean;
		baseUrl?: string | null;
		authType?: ModelConfigAuthType;
		authHeader?: string | null;
		authQueryParam?: string | null;
		apiProtocol?: string | null;
		meta?: unknown;
	},
): Promise<ModelConfigProviderDto> {
	const key = normalizeKey(providerKey);
	if (!key) {
		throw new AppError("provider key is required", {
			status: 400,
			code: "provider_key_required",
		});
	}
	const row = await upsertCatalogVendorRow(
		c.env.DB,
		{
			key,
			name: input.name.trim(),
			enabled: input.enabled ?? true,
			baseUrlHint: normalizeOptionalString(input.baseUrl),
			authType: input.authType ?? "bearer",
			authHeader: normalizeOptionalString(input.authHeader),
			authQueryParam: normalizeOptionalString(input.authQueryParam),
			apiProtocol:
				typeof input.apiProtocol === "undefined"
					? undefined
					: normalizeOptionalString(input.apiProtocol),
			meta:
				typeof input.meta === "undefined"
					? null
					: JSON.stringify(input.meta),
		},
		new Date().toISOString(),
	);
	const apiKeyRows = await listCatalogVendorApiKeys(c.env.DB);
	const apiKeyProviderKeys = new Set(
		apiKeyRows
			.filter((keyRow) => Number(keyRow.enabled ?? 1) !== 0)
			.map((keyRow) => normalizeKey(keyRow.vendor_key)),
	);
	await selfHealAgentDefault(c);
	return mapProvider(row, apiKeyProviderKeys);
}

export async function upsertModelConfigApiKey(
	c: AppContext,
	providerKey: string,
	input: { apiKey: string; enabled?: boolean },
): Promise<{ providerKey: string; apiKeyConfigured: boolean; enabled: boolean }> {
	const key = normalizeKey(providerKey);
	if (!key) {
		throw new AppError("provider key is required", {
			status: 400,
			code: "provider_key_required",
		});
	}
	await upsertCatalogVendorApiKeyRow(
		c.env.DB,
		{
			vendorKey: key,
			apiKey: input.apiKey.trim(),
			enabled: input.enabled ?? true,
		},
		new Date().toISOString(),
	);
	await selfHealAgentDefault(c);
	return { providerKey: key, apiKeyConfigured: true, enabled: input.enabled ?? true };
}

export async function deleteModelConfigApiKey(
	c: AppContext,
	providerKey: string,
): Promise<{ providerKey: string; apiKeyConfigured: boolean; enabled: boolean }> {
	const key = normalizeKey(providerKey);
	if (!key) {
		throw new AppError("provider key is required", {
			status: 400,
			code: "provider_key_required",
		});
	}
	await deleteCatalogVendorApiKeyRow(c.env.DB, key);
	await selfHealAgentDefault(c);
	return { providerKey: key, apiKeyConfigured: false, enabled: false };
}

export async function upsertModelConfigModel(
	c: AppContext,
	providerKey: string,
	modelKey: string,
	input: {
		modelAlias?: string | null;
		label: string;
		kind: ModelConfigKind;
		enabled?: boolean;
		options?: unknown;
	},
): Promise<ModelConfigModelDto> {
	const provider = normalizeKey(providerKey);
	const model = modelKey.trim();
	if (!provider || !model) {
		throw new AppError("provider key and model key are required", {
			status: 400,
			code: "model_config_key_required",
		});
	}
	const meta =
		typeof input.options === "undefined"
			? null
			: JSON.stringify(
					input.kind === "image"
						? { imageOptions: input.options }
						: input.kind === "video"
							? { videoOptions: input.options }
							: input.options,
				);
	const row = await upsertCatalogModelRow(
		c.env.DB,
		{
			modelKey: model,
			vendorKey: provider,
			modelAlias:
				typeof input.modelAlias === "undefined"
					? undefined
					: normalizeOptionalString(input.modelAlias),
			labelZh: input.label.trim(),
			kind: input.kind,
			enabled: input.enabled ?? true,
			meta,
		},
		new Date().toISOString(),
	);
	const mapped = mapModel(row);
	if (!mapped) {
		throw new AppError("model kind is invalid", {
			status: 400,
			code: "invalid_model_kind",
		});
	}
	await selfHealAgentDefault(c);
	return mapped;
}

export async function deleteModelConfigModel(
	c: AppContext,
	providerKey: string,
	modelKey: string,
): Promise<void> {
	const provider = normalizeKey(providerKey);
	const model = modelKey.trim();
	if (!provider || !model) return;
	await deleteCatalogModelRow(c.env.DB, { vendorKey: provider, modelKey: model });
	await selfHealAgentDefault(c);
}

export async function exportModelConfig(
	c: AppContext,
	input: { includeApiKeys: boolean },
): Promise<ModelConfigImportPackageDto & { exportedAt: string }> {
	const config = await getModelConfig(c);
	const apiKeys = input.includeApiKeys
		? new Map(
				(await listCatalogVendorApiKeys(c.env.DB))
					.filter((row) => Number(row.enabled ?? 1) !== 0)
					.map((row) => [normalizeKey(row.vendor_key), row.api_key] as const),
			)
		: new Map<string, string>();
	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		providers: config.providers.map((provider) => ({
			key: provider.key,
			name: provider.name,
			enabled: provider.enabled,
			baseUrl: provider.baseUrl,
			authType: provider.authType,
			authHeader: provider.authHeader,
			authQueryParam: provider.authQueryParam,
			apiProtocol: provider.apiProtocol,
			...(input.includeApiKeys && apiKeys.has(provider.key)
				? { apiKey: apiKeys.get(provider.key) }
				: {}),
		})),
		models: config.models.map((model) => ({
			providerKey: model.providerKey,
			modelKey: model.modelKey,
			modelAlias: model.modelAlias,
			label: model.label,
			kind: model.kind,
			enabled: model.enabled,
			options: model.options,
		})),
	};
}

export async function importModelConfig(
	c: AppContext,
	input: unknown,
	options: { includeApiKeys: boolean },
): Promise<{ imported: { providers: number; apiKeys: number; models: number } }> {
	const parsed = ModelConfigImportPackageSchema.parse(input);
	let providers = 0;
	let apiKeys = 0;
	let models = 0;

	for (const provider of parsed.providers) {
		const key = normalizeKey(provider.key);
		await upsertModelConfigProvider(c, key, {
			name: provider.name,
			enabled: provider.enabled ?? true,
			baseUrl: provider.baseUrl ?? null,
			authType: provider.authType ?? "bearer",
			authHeader: provider.authHeader ?? null,
			authQueryParam: provider.authQueryParam ?? null,
			apiProtocol:
				typeof provider.apiProtocol === "undefined"
					? undefined
					: provider.apiProtocol,
		});
		providers += 1;

		const apiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
		if (options.includeApiKeys && apiKey) {
			await upsertModelConfigApiKey(c, key, { apiKey, enabled: true });
			apiKeys += 1;
		}
	}

	for (const model of parsed.models) {
		await upsertModelConfigModel(c, model.providerKey, model.modelKey, {
			modelAlias:
				typeof model.modelAlias === "undefined"
					? undefined
					: model.modelAlias,
			label: model.label,
			kind: model.kind,
			enabled: model.enabled ?? true,
			options: model.options,
		});
		models += 1;
	}

	return { imported: { providers, apiKeys, models } };
}

export type AgentLlmCredentials = {
	apiKey: string;
	baseUrl: string;
	modelKey: string;
	modelAlias: string | null;
	vendorKey: string;
	apiProtocol: string | null;
};

export async function resolveAgentLlmCredentials(
	c: AppContext,
): Promise<AgentLlmCredentials> {
	const defaultRow = await getCatalogDefaultModel(c.env.DB, "agent");
	if (!defaultRow) {
		throw new AppError("agent backbone model is not configured", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "default_slot_unset", slot: "agent" },
		});
	}
	const vendorKey = normalizeKey(defaultRow.vendor_key);
	const modelKey = defaultRow.model_key;
	const [vendorRow, modelRow, apiKeyRow] = await Promise.all([
		getCatalogVendorByKey(c.env.DB, vendorKey),
		getCatalogModelByVendorAndKey(c.env.DB, { vendorKey, modelKey }),
		getCatalogVendorApiKeyByVendorKey(c.env.DB, vendorKey),
	]);
	if (!vendorRow) {
		throw new AppError("agent backbone provider not found", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "vendor_missing", vendorKey },
		});
	}
	if (Number(vendorRow.enabled ?? 1) === 0) {
		throw new AppError("agent backbone provider is disabled", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "vendor_disabled", vendorKey },
		});
	}
	if (!modelRow) {
		throw new AppError("agent backbone model not found", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "model_missing", vendorKey, modelKey },
		});
	}
	if (Number(modelRow.enabled ?? 1) === 0) {
		throw new AppError("agent backbone model is disabled", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "model_disabled", vendorKey, modelKey },
		});
	}
	const baseUrl = normalizeOptionalString(vendorRow.base_url_hint);
	if (!baseUrl) {
		throw new AppError("agent backbone provider has no base URL", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "base_url_missing", vendorKey },
		});
	}
	if (!apiKeyRow || Number(apiKeyRow.enabled ?? 1) === 0) {
		throw new AppError("agent backbone provider has no API key", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "api_key_missing", vendorKey },
		});
	}
	const apiKey = String(apiKeyRow.api_key || "").trim();
	if (!apiKey) {
		throw new AppError("agent backbone provider has empty API key", {
			status: 400,
			code: "agent_llm_credentials_missing",
			details: { reason: "api_key_empty", vendorKey },
		});
	}
	return {
		apiKey,
		baseUrl,
		modelKey,
		modelAlias: normalizeOptionalString(modelRow.model_alias),
		vendorKey,
		apiProtocol: normalizeOptionalString(
			(vendorRow as { api_protocol?: string | null }).api_protocol,
		),
	};
}

export async function resolveMultimodalLlmCredentials(
	c: AppContext,
): Promise<AgentLlmCredentials | null> {
	const defaultRow = await getCatalogDefaultModel(c.env.DB, "multimodal");
	if (!defaultRow) return null;
	const vendorKey = normalizeKey(defaultRow.vendor_key);
	const modelKey = defaultRow.model_key;
	const [vendorRow, modelRow, apiKeyRow] = await Promise.all([
		getCatalogVendorByKey(c.env.DB, vendorKey),
		getCatalogModelByVendorAndKey(c.env.DB, { vendorKey, modelKey }),
		getCatalogVendorApiKeyByVendorKey(c.env.DB, vendorKey),
	]);
	if (!vendorRow || Number(vendorRow.enabled ?? 1) === 0) return null;
	if (!modelRow || Number(modelRow.enabled ?? 1) === 0) return null;
	const baseUrl = normalizeOptionalString(vendorRow.base_url_hint);
	if (!baseUrl) return null;
	if (!apiKeyRow || Number(apiKeyRow.enabled ?? 1) === 0) return null;
	const apiKey = String(apiKeyRow.api_key || "").trim();
	if (!apiKey) return null;
	return {
		apiKey,
		baseUrl,
		modelKey,
		modelAlias: normalizeOptionalString(modelRow.model_alias),
		vendorKey,
		apiProtocol: normalizeOptionalString(
			(vendorRow as { api_protocol?: string | null }).api_protocol,
		),
	};
}

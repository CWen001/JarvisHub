import type { PrismaClient } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	DEFAULT_MODEL_CATALOG_MODELS,
	DEFAULT_MODEL_CATALOG_VENDOR,
} from "./model-catalog.defaults";

export type ModelCatalogVendorRow = {
	key: string;
	name: string;
	enabled: number;
	base_url_hint: string | null;
	auth_type: string | null;
	auth_header: string | null;
	auth_query_param: string | null;
	api_protocol: string | null;
	meta: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogVendorApiKeyRow = {
	vendor_key: string;
	api_key: string;
	enabled: number;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogModelRow = {
	model_key: string;
	vendor_key: string;
	model_alias: string | null;
	label_zh: string;
	kind: string;
	enabled: number;
	meta: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogDefaultModelRow = {
	slot: string;
	vendor_key: string;
	model_key: string;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogMappingRow = {
	id: string;
	vendor_key: string;
	task_kind: string;
	name: string;
	enabled: number;
	request_profile: string | null;
	result_path: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;
let schemaEnsuring: Promise<void> | null = null;

function vendorToRow(v: {
	key: string;
	name: string;
	enabled: number;
	base_url_hint: string | null;
	auth_type: string;
	auth_header: string | null;
	auth_query_param: string | null;
	api_protocol?: string | null;
	meta: string | null;
	created_at: string;
	updated_at: string;
}): ModelCatalogVendorRow {
	return {
		key: v.key,
		name: v.name,
		enabled: Number(v.enabled ?? 0),
		base_url_hint: v.base_url_hint,
		auth_type: v.auth_type,
		auth_header: v.auth_header,
		auth_query_param: v.auth_query_param,
		api_protocol: v.api_protocol ?? null,
		meta: v.meta,
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

function vendorApiKeyToRow(v: {
	vendor_key: string;
	api_key: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}): ModelCatalogVendorApiKeyRow {
	return {
		vendor_key: v.vendor_key,
		api_key: v.api_key,
		enabled: Number(v.enabled ?? 0),
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

function modelToRow(v: {
	model_key: string;
	vendor_key: string;
	model_alias: string | null;
	label_zh: string;
	kind: string;
	enabled: number;
	meta: string | null;
	created_at: string;
	updated_at: string;
}): ModelCatalogModelRow {
	return {
		model_key: v.model_key,
		vendor_key: v.vendor_key,
		model_alias: v.model_alias,
		label_zh: v.label_zh,
		kind: v.kind,
		enabled: Number(v.enabled ?? 0),
		meta: v.meta,
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

function defaultModelToRow(v: {
	slot: string;
	vendor_key: string;
	model_key: string;
	created_at: string;
	updated_at: string;
}): ModelCatalogDefaultModelRow {
	return {
		slot: v.slot,
		vendor_key: v.vendor_key,
		model_key: v.model_key,
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

function mappingToRow(v: {
	id: string;
	vendor_key: string;
	task_kind: string;
	name: string;
	enabled: number;
	request_profile: string | null;
	result_path: string | null;
	created_at: string;
	updated_at: string;
}): ModelCatalogMappingRow {
	return {
		id: v.id,
		vendor_key: v.vendor_key,
		task_kind: v.task_kind,
		name: v.name,
		enabled: Number(v.enabled ?? 0),
		request_profile: v.request_profile,
		result_path: v.result_path,
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

async function migrateTextModelsToMultimodal(): Promise<void> {
	const prisma = getPrismaClient();
	await prisma.model_catalog_models.updateMany({
		where: { kind: "text" },
		data: { kind: "multimodal" },
	});
}

export async function ensureModelCatalogSchema(_db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	if (schemaEnsuring) {
		await schemaEnsuring;
		return;
	}
	// Runtime schema DDL is handled by bootstrap + app startup pipeline.
	schemaEnsuring = (async () => {
		await migrateTextModelsToMultimodal();
		await seedDefaultModelCatalogRows();
		schemaEnsured = true;
	})().finally(() => {
		schemaEnsuring = null;
	});
	await schemaEnsuring;
}

async function seedDefaultModelCatalogRows(): Promise<void> {
	const prisma = getPrismaClient();
	const existingVendor = await prisma.model_catalog_vendors.findUnique({
		where: { key: DEFAULT_MODEL_CATALOG_VENDOR.key },
		select: { key: true },
	});

	const nowIso = new Date().toISOString();
	if (!existingVendor) {
		if (!DEFAULT_MODEL_CATALOG_VENDOR.authType) {
			throw new Error("Default model catalog vendor authType is required");
		}
		await prisma.model_catalog_vendors.create({
			data: {
				key: DEFAULT_MODEL_CATALOG_VENDOR.key,
				name: DEFAULT_MODEL_CATALOG_VENDOR.name,
				enabled: DEFAULT_MODEL_CATALOG_VENDOR.enabled ? 1 : 0,
				base_url_hint: DEFAULT_MODEL_CATALOG_VENDOR.baseUrlHint ?? null,
				auth_type: DEFAULT_MODEL_CATALOG_VENDOR.authType,
				auth_header: DEFAULT_MODEL_CATALOG_VENDOR.authHeader ?? null,
				auth_query_param: DEFAULT_MODEL_CATALOG_VENDOR.authQueryParam ?? null,
				meta:
					typeof DEFAULT_MODEL_CATALOG_VENDOR.meta === "undefined"
						? null
						: JSON.stringify(DEFAULT_MODEL_CATALOG_VENDOR.meta),
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
	}

	for (const model of DEFAULT_MODEL_CATALOG_MODELS) {
		const existingModel = await prisma.model_catalog_models.findUnique({
			where: {
				vendor_key_model_key: {
					vendor_key: model.vendorKey,
					model_key: model.modelKey,
				},
			},
			select: { model_key: true },
		});
		if (existingModel) continue;
		await prisma.model_catalog_models.create({
			data: {
				model_key: model.modelKey,
				vendor_key: model.vendorKey,
				model_alias: model.modelAlias ?? null,
				label_zh: model.labelZh,
				kind: model.kind,
				enabled: model.enabled ? 1 : 0,
				meta:
					typeof model.meta === "undefined" ? null : JSON.stringify(model.meta),
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
	}
}

export async function listCatalogVendors(
	db: PrismaClient,
): Promise<ModelCatalogVendorRow[]> {
	await ensureModelCatalogSchema(db);
	const rows = await getPrismaClient().model_catalog_vendors.findMany({
		orderBy: { key: "asc" },
	});
	return rows.map(vendorToRow);
}

export async function listCatalogVendorApiKeys(
	db: PrismaClient,
): Promise<ModelCatalogVendorApiKeyRow[]> {
	await ensureModelCatalogSchema(db);
	const rows = await getPrismaClient().model_catalog_vendor_api_keys.findMany({
		orderBy: { vendor_key: "asc" },
	});
	return rows.map(vendorApiKeyToRow);
}

export async function getCatalogVendorApiKeyByVendorKey(
	db: PrismaClient,
	vendorKey: string,
): Promise<ModelCatalogVendorApiKeyRow | null> {
	await ensureModelCatalogSchema(db);
	const key = String(vendorKey || "").trim().toLowerCase();
	if (!key) return null;
	const row = await getPrismaClient().model_catalog_vendor_api_keys.findUnique({
		where: { vendor_key: key },
	});
	return row ? vendorApiKeyToRow(row) : null;
}

export async function upsertCatalogVendorApiKeyRow(
	db: PrismaClient,
	input: { vendorKey: string; apiKey: string; enabled: boolean },
	nowIso: string,
): Promise<ModelCatalogVendorApiKeyRow> {
	await ensureModelCatalogSchema(db);
	const key = String(input.vendorKey || "").trim().toLowerCase();
	if (!key) throw new Error("vendorKey is required");
	const row = await getPrismaClient().model_catalog_vendor_api_keys.upsert({
		where: { vendor_key: key },
		create: {
			vendor_key: key,
			api_key: input.apiKey,
			enabled: input.enabled ? 1 : 0,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			api_key: input.apiKey,
			enabled: input.enabled ? 1 : 0,
			updated_at: nowIso,
		},
	});
	return vendorApiKeyToRow(row);
}

export async function deleteCatalogVendorApiKeyRow(
	db: PrismaClient,
	vendorKey: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const key = String(vendorKey || "").trim().toLowerCase();
	if (!key) return;
	await getPrismaClient().model_catalog_vendor_api_keys.deleteMany({
		where: { vendor_key: key },
	});
}

export async function getCatalogVendorByKey(
	db: PrismaClient,
	key: string,
): Promise<ModelCatalogVendorRow | null> {
	await ensureModelCatalogSchema(db);
	const vendorKey = String(key || "").trim().toLowerCase();
	if (!vendorKey) return null;
	const row = await getPrismaClient().model_catalog_vendors.findUnique({
		where: { key: vendorKey },
	});
	return row ? vendorToRow(row) : null;
}

export async function upsertCatalogVendorRow(
	db: PrismaClient,
	input: {
		key: string;
		name: string;
		enabled: boolean;
		baseUrlHint?: string | null;
		authType: string;
		authHeader?: string | null;
		authQueryParam?: string | null;
		apiProtocol?: string | null;
		meta?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogVendorRow> {
	await ensureModelCatalogSchema(db);
	const key = String(input.key || "").trim().toLowerCase();
	if (!key) throw new Error("vendor key is required");
	const row = await getPrismaClient().model_catalog_vendors.upsert({
		where: { key },
		create: {
			key,
			name: input.name,
			enabled: input.enabled ? 1 : 0,
			base_url_hint: input.baseUrlHint ?? null,
			auth_type: input.authType,
			auth_header: input.authHeader ?? null,
			auth_query_param: input.authQueryParam ?? null,
			api_protocol: input.apiProtocol ?? null,
			meta: input.meta ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			name: input.name,
			enabled: input.enabled ? 1 : 0,
			base_url_hint: input.baseUrlHint ?? null,
			auth_type: input.authType,
			auth_header: input.authHeader ?? null,
			auth_query_param: input.authQueryParam ?? null,
			...(typeof input.apiProtocol === "undefined"
				? {}
				: { api_protocol: input.apiProtocol }),
			meta: input.meta ?? null,
			updated_at: nowIso,
		},
	});
	return vendorToRow(row);
}

export async function deleteCatalogVendorRow(
	db: PrismaClient,
	key: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const vendorKey = String(key || "").trim().toLowerCase();
	if (!vendorKey) return;
	await getPrismaClient().model_catalog_vendors.deleteMany({
		where: { key: vendorKey },
	});
}

export async function deleteCatalogVendorCascade(
	db: PrismaClient,
	vendorKey: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const vk = String(vendorKey || "").trim().toLowerCase();
	if (!vk) return;
	await getPrismaClient().$transaction(async (tx) => {
		await tx.model_catalog_mappings.deleteMany({ where: { vendor_key: vk } });
		await tx.model_catalog_models.deleteMany({ where: { vendor_key: vk } });
		await tx.model_catalog_vendor_api_keys.deleteMany({ where: { vendor_key: vk } });
		await tx.model_catalog_vendors.deleteMany({ where: { key: vk } });
	});
}

export async function listCatalogModels(
	db: PrismaClient,
	filter?: { vendorKey?: string; kind?: string; enabled?: boolean },
): Promise<ModelCatalogModelRow[]> {
	await ensureModelCatalogSchema(db);
	const rows = await getPrismaClient().model_catalog_models.findMany({
		where: {
			...(filter?.vendorKey ? { vendor_key: filter.vendorKey } : {}),
			...(filter?.kind ? { kind: filter.kind } : {}),
			...(typeof filter?.enabled === "boolean"
				? { enabled: filter.enabled ? 1 : 0 }
				: {}),
		},
		orderBy: [{ vendor_key: "asc" }, { model_key: "asc" }],
	});
	return rows.map(modelToRow);
}

export async function listCatalogModelsByModelKey(
	db: PrismaClient,
	modelKey: string,
): Promise<ModelCatalogModelRow[]> {
	await ensureModelCatalogSchema(db);
	const mk = String(modelKey || "").trim();
	if (!mk) return [];
	const rows = await getPrismaClient().model_catalog_models.findMany({
		where: { model_key: mk },
		orderBy: { vendor_key: "asc" },
	});
	return rows.map(modelToRow);
}

export async function listCatalogModelsByModelAlias(
	db: PrismaClient,
	modelAlias: string,
): Promise<ModelCatalogModelRow[]> {
	await ensureModelCatalogSchema(db);
	const alias = String(modelAlias || "").trim();
	if (!alias) return [];
	const rows = await getPrismaClient().model_catalog_models.findMany({
		where: { model_alias: { equals: alias, mode: "insensitive" } },
		orderBy: [{ vendor_key: "asc" }, { model_key: "asc" }],
	});
	return rows.map(modelToRow);
}

export async function getCatalogModelByVendorKindAndAlias(
	db: PrismaClient,
	input: { vendorKey: string; kind: string; modelAlias: string },
): Promise<ModelCatalogModelRow | null> {
	await ensureModelCatalogSchema(db);
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	const kind = String(input.kind || "").trim();
	const alias = String(input.modelAlias || "").trim();
	if (!vk || !kind || !alias) return null;
	const row = await getPrismaClient().model_catalog_models.findFirst({
		where: {
			vendor_key: vk,
			kind,
			model_alias: { equals: alias, mode: "insensitive" },
		},
	});
	return row ? modelToRow(row) : null;
}

export async function getCatalogModelByVendorAndKey(
	db: PrismaClient,
	input: { vendorKey: string; modelKey: string },
): Promise<ModelCatalogModelRow | null> {
	await ensureModelCatalogSchema(db);
	const mk = String(input.modelKey || "").trim();
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	if (!mk || !vk) return null;
	const row = await getPrismaClient().model_catalog_models.findUnique({
		where: {
			vendor_key_model_key: { vendor_key: vk, model_key: mk },
		},
	});
	return row ? modelToRow(row) : null;
}

export async function upsertCatalogModelRow(
	db: PrismaClient,
	input: {
		modelKey: string;
		vendorKey: string;
		modelAlias?: string | null;
		labelZh: string;
		kind: string;
		enabled: boolean;
		meta?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogModelRow> {
	await ensureModelCatalogSchema(db);
	const mk = String(input.modelKey || "").trim();
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	if (!mk || !vk) throw new Error("vendorKey/modelKey is required");
	const hasModelAlias = typeof input.modelAlias !== "undefined";
	const aliasRaw =
		typeof input.modelAlias === "string" ? input.modelAlias.trim() : "";
	const kind = String(input.kind || "").trim();
	if (input.enabled && aliasRaw && kind) {
		const conflict = await getPrismaClient().model_catalog_models.findFirst({
			where: {
				kind,
				enabled: 1,
				model_alias: aliasRaw,
				NOT: { vendor_key: vk, model_key: mk },
			},
			select: { vendor_key: true, model_key: true },
		});
		if (conflict) {
			throw new AppError(
				`model_alias "${aliasRaw}" is already enabled for ${conflict.vendor_key}/${conflict.model_key} (kind=${kind})`,
				{
					status: 409,
					code: "model_alias_conflict",
					details: {
						kind,
						modelAlias: aliasRaw,
						existing: {
							vendorKey: conflict.vendor_key,
							modelKey: conflict.model_key,
						},
						attempted: { vendorKey: vk, modelKey: mk },
					},
				},
			);
		}
	}
	const row = await getPrismaClient().model_catalog_models.upsert({
		where: {
			vendor_key_model_key: { vendor_key: vk, model_key: mk },
		},
		create: {
			model_key: mk,
			vendor_key: vk,
			model_alias: aliasRaw || null,
			label_zh: input.labelZh,
			kind: input.kind,
			enabled: input.enabled ? 1 : 0,
			meta: input.meta ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			...(hasModelAlias ? { model_alias: aliasRaw || null } : {}),
			label_zh: input.labelZh,
			kind: input.kind,
			enabled: input.enabled ? 1 : 0,
			meta: input.meta ?? null,
			updated_at: nowIso,
		},
	});
	return modelToRow(row);
}

export async function deleteCatalogModelRow(
	db: PrismaClient,
	input: { vendorKey: string; modelKey: string },
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const mk = String(input.modelKey || "").trim();
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	if (!mk || !vk) return;
	await getPrismaClient().model_catalog_models.deleteMany({
		where: { vendor_key: vk, model_key: mk },
	});
}

export async function listCatalogDefaultModels(
	db: PrismaClient,
): Promise<ModelCatalogDefaultModelRow[]> {
	await ensureModelCatalogSchema(db);
	const rows = await getPrismaClient().model_catalog_default_models.findMany({
		orderBy: { slot: "asc" },
	});
	return rows.map(defaultModelToRow);
}

export async function getCatalogDefaultModel(
	db: PrismaClient,
	slot: string,
): Promise<ModelCatalogDefaultModelRow | null> {
	await ensureModelCatalogSchema(db);
	const normalizedSlot = String(slot || "").trim();
	if (!normalizedSlot) return null;
	const row = await getPrismaClient().model_catalog_default_models.findUnique({
		where: { slot: normalizedSlot },
	});
	return row ? defaultModelToRow(row) : null;
}

export async function upsertCatalogDefaultModelRow(
	db: PrismaClient,
	input: { slot: string; vendorKey: string; modelKey: string },
	nowIso: string,
): Promise<ModelCatalogDefaultModelRow> {
	await ensureModelCatalogSchema(db);
	const slot = String(input.slot || "").trim();
	const vendorKey = String(input.vendorKey || "").trim().toLowerCase();
	const modelKey = String(input.modelKey || "").trim();
	if (!slot || !vendorKey || !modelKey) {
		throw new Error("slot/vendorKey/modelKey is required");
	}
	const row = await getPrismaClient().model_catalog_default_models.upsert({
		where: { slot },
		create: {
			slot,
			vendor_key: vendorKey,
			model_key: modelKey,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			vendor_key: vendorKey,
			model_key: modelKey,
			updated_at: nowIso,
		},
	});
	return defaultModelToRow(row);
}

export async function deleteCatalogDefaultModelRow(
	db: PrismaClient,
	slot: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const normalizedSlot = String(slot || "").trim();
	if (!normalizedSlot) return;
	await getPrismaClient().model_catalog_default_models.deleteMany({
		where: { slot: normalizedSlot },
	});
}

export async function deleteCatalogModelsByVendorKey(
	db: PrismaClient,
	vendorKey: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const vk = String(vendorKey || "").trim().toLowerCase();
	if (!vk) return;
	await getPrismaClient().model_catalog_models.deleteMany({
		where: { vendor_key: vk },
	});
}

export async function listCatalogMappings(
	db: PrismaClient,
	filter?: { vendorKey?: string; taskKind?: string; enabled?: boolean },
): Promise<ModelCatalogMappingRow[]> {
	await ensureModelCatalogSchema(db);
	const rows = await getPrismaClient().model_catalog_mappings.findMany({
		where: {
			...(filter?.vendorKey ? { vendor_key: filter.vendorKey } : {}),
			...(filter?.taskKind ? { task_kind: filter.taskKind } : {}),
			...(typeof filter?.enabled === "boolean"
				? { enabled: filter.enabled ? 1 : 0 }
				: {}),
		},
		orderBy: [{ vendor_key: "asc" }, { task_kind: "asc" }, { name: "asc" }],
	});
	return rows.map(mappingToRow);
}

export async function getCatalogMappingById(
	db: PrismaClient,
	id: string,
): Promise<ModelCatalogMappingRow | null> {
	await ensureModelCatalogSchema(db);
	const mappingId = String(id || "").trim();
	if (!mappingId) return null;
	const row = await getPrismaClient().model_catalog_mappings.findUnique({
		where: { id: mappingId },
	});
	return row ? mappingToRow(row) : null;
}

export async function getCatalogMappingByUnique(
	db: PrismaClient,
	input: { vendorKey: string; taskKind: string; name: string },
): Promise<ModelCatalogMappingRow | null> {
	await ensureModelCatalogSchema(db);
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	const taskKind = String(input.taskKind || "").trim();
	const name = String(input.name || "").trim();
	if (!vk || !taskKind || !name) return null;
	const row = await getPrismaClient().model_catalog_mappings.findUnique({
		where: {
			vendor_key_task_kind_name: {
				vendor_key: vk,
				task_kind: taskKind,
				name,
			},
		},
	});
	return row ? mappingToRow(row) : null;
}

export async function upsertCatalogMappingRow(
	db: PrismaClient,
	input: {
		id?: string;
		vendorKey: string;
		taskKind: string;
		name: string;
		enabled: boolean;
		requestMapping?: string | null;
		responseMapping?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogMappingRow> {
	await ensureModelCatalogSchema(db);
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	const taskKind = String(input.taskKind || "").trim();
	const name = String(input.name || "").trim();
	if (!vk || !taskKind || !name) {
		throw new Error("vendorKey/taskKind/name is required");
	}

	if (input.id) {
		const id = String(input.id || "").trim();
		if (!id) throw new Error("mapping id is invalid");
		const row = await getPrismaClient().model_catalog_mappings.update({
			where: { id },
			data: {
				vendor_key: vk,
				task_kind: taskKind,
				name,
				enabled: input.enabled ? 1 : 0,
				request_profile: input.requestMapping ?? null,
				result_path: input.responseMapping ?? null,
				updated_at: nowIso,
			},
		});
		return mappingToRow(row);
	}

	const row = await getPrismaClient().model_catalog_mappings.upsert({
		where: {
			vendor_key_task_kind_name: {
				vendor_key: vk,
				task_kind: taskKind,
				name,
			},
		},
		create: {
			id: crypto.randomUUID(),
			vendor_key: vk,
			task_kind: taskKind,
			name,
			enabled: input.enabled ? 1 : 0,
			request_profile: input.requestMapping ?? null,
			result_path: input.responseMapping ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			enabled: input.enabled ? 1 : 0,
			request_profile: input.requestMapping ?? null,
			result_path: input.responseMapping ?? null,
			updated_at: nowIso,
		},
	});
	return mappingToRow(row);
}

export async function deleteCatalogMappingRow(
	db: PrismaClient,
	id: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const mappingId = String(id || "").trim();
	if (!mappingId) return;
	await getPrismaClient().model_catalog_mappings.deleteMany({
		where: { id: mappingId },
	});
}

export async function deleteCatalogMappingsByVendorKey(
	db: PrismaClient,
	vendorKey: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const vk = String(vendorKey || "").trim().toLowerCase();
	if (!vk) return;
	await getPrismaClient().model_catalog_mappings.deleteMany({
		where: { vendor_key: vk },
	});
}

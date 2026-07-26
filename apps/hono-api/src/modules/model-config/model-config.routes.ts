import { Hono } from "hono";
import type { AppEnv } from "../../types";
import {
	UpsertModelConfigApiKeySchema,
	UpsertModelConfigDefaultModelSchema,
	ModelConfigImportPackageSchema,
	UpsertModelConfigModelSchema,
	UpsertModelConfigProviderSchema,
} from "./model-config.schemas";
import {
	clearModelConfigDefaultModel,
	deleteModelConfigApiKey,
	deleteModelConfigModel,
	exportModelConfig,
	getModelConfig,
	importModelConfig,
	upsertModelConfigDefaultModel,
	upsertModelConfigApiKey,
	upsertModelConfigModel,
	upsertModelConfigProvider,
} from "./model-config.service";

export const modelConfigRouter = new Hono<AppEnv>();

modelConfigRouter.get("/", async (c) => {
	const config = await getModelConfig(c);
	return c.json(config);
});

modelConfigRouter.put("/defaults/:slot", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelConfigDefaultModelSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const model = await upsertModelConfigDefaultModel(
		c,
		c.req.param("slot"),
		parsed.data,
	);
	return c.json(model);
});

modelConfigRouter.delete("/defaults/:slot", async (c) => {
	const result = await clearModelConfigDefaultModel(c, c.req.param("slot"));
	return c.json(result);
});

modelConfigRouter.get("/export", async (c) => {
	const includeApiKeys = c.req.query("includeApiKeys") === "true";
	const confirmed = c.req.query("confirmIncludeApiKeys") === "true";
	if (includeApiKeys && !confirmed) {
		return c.json(
			{
				error: "API key export requires explicit confirmation",
				code: "api_key_export_confirmation_required",
			},
			400,
		);
	}
	const exported = await exportModelConfig(c, { includeApiKeys });
	return c.json(exported);
});

modelConfigRouter.post("/import", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ModelConfigImportPackageSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const includeApiKeys = c.req.query("includeApiKeys") === "true";
	const result = await importModelConfig(c, parsed.data, { includeApiKeys });
	return c.json(result);
});

modelConfigRouter.put("/providers/:key", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelConfigProviderSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const provider = await upsertModelConfigProvider(
		c,
		c.req.param("key"),
		parsed.data,
	);
	return c.json(provider);
});

modelConfigRouter.put("/providers/:key/api-key", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelConfigApiKeySchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const status = await upsertModelConfigApiKey(
		c,
		c.req.param("key"),
		parsed.data,
	);
	return c.json(status);
});

modelConfigRouter.delete("/providers/:key/api-key", async (c) => {
	const status = await deleteModelConfigApiKey(c, c.req.param("key"));
	return c.json(status);
});

modelConfigRouter.put("/providers/:key/models/:modelKey", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelConfigModelSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const model = await upsertModelConfigModel(
		c,
		c.req.param("key"),
		c.req.param("modelKey"),
		parsed.data,
	);
	return c.json(model);
});

modelConfigRouter.delete("/providers/:key/models/:modelKey", async (c) => {
	await deleteModelConfigModel(
		c,
		c.req.param("key"),
		c.req.param("modelKey"),
	);
	return c.json({ ok: true });
});

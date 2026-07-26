import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	FlowSchema,
	FlowVersionSchema,
	UpsertFlowSchema,
} from "./flow.schemas";
import {
	createUserManualFlowVersion,
	deleteUserFlow,
	getUserFlow,
	listUserFlows,
	listUserFlowVersions,
	rollbackUserFlow,
	upsertUserFlow,
} from "./flow.service";

export const flowRouter = new Hono<AppEnv>();

flowRouter.use("*", authMiddleware);

flowRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.query("projectId") || undefined;
	const scopeTypeRaw = c.req.query("scopeType") || undefined;
	const scopeId = c.req.query("scopeId") || undefined;
	const scopeType =
		scopeTypeRaw === "project" || scopeTypeRaw === "chapter" || scopeTypeRaw === "shot"
			? scopeTypeRaw
			: undefined;
	const flows = await listUserFlows(c, userId, projectId, { scopeType, scopeId });
	return c.json(FlowSchema.array().parse(flows));
});

flowRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const flow = await getUserFlow(c, id, userId);
	return c.json(FlowSchema.parse(flow));
});

flowRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertFlowSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const flow = await upsertUserFlow(c, userId, {
		id: parsed.data.id,
		name: parsed.data.name,
		data: parsed.data.data,
		projectId: parsed.data.projectId,
		baseUpdatedAt: parsed.data.baseUpdatedAt,
		scopeType: parsed.data.scopeType,
		scopeId: parsed.data.scopeId,
		allowEmptyGraphOverwrite: parsed.data.allowEmptyGraphOverwrite,
	});
	return c.json(FlowSchema.parse(flow));
});

flowRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteUserFlow(c, id, userId);
	return c.body(null, 204);
});

flowRouter.get("/:id/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const versions = await listUserFlowVersions(c, id, userId);
	return c.json(FlowVersionSchema.array().parse(versions));
});

flowRouter.post("/:id/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const label = typeof body.label === "string" ? body.label : "";
	if (!label.trim()) {
		return c.json(
			{ error: "Invalid request body", issues: ["label is required"] },
			400,
		);
	}
	const created = await createUserManualFlowVersion(c, id, label, userId);
	return c.json(FlowVersionSchema.parse(created), 201);
});

flowRouter.post("/:id/rollback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const versionId = typeof body.versionId === "string" ? body.versionId : "";
	const baseUpdatedAt = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : "";
	if (!versionId) {
		return c.json(
			{ error: "Invalid request body", issues: ["versionId is required"] },
			400,
		);
	}
	if (!baseUpdatedAt) {
		return c.json(
			{ error: "Invalid request body", issues: ["baseUpdatedAt is required"] },
			400,
		);
	}
	const flow = await rollbackUserFlow(c, id, { versionId, baseUpdatedAt }, userId);
	return c.json(FlowSchema.parse(flow));
});

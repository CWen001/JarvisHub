import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext, AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
	getFlowForOwner,
	mapFlowRowToDto,
	listFlowsByProject,
	listFlowsByOwner,
	type FlowRow,
} from "./flow.repo";
import { sanitizeFlowDataForStorage } from "./flow.service";
import { optimisticCanvasWrite } from "./flow.optimistic-write";
import {
	PublicFlowGraphSchema,
	PublicFlowGetResponseSchema,
	PublicFlowPatchRequestSchema,
	PublicFlowPatchResponseSchema,
	PublicProjectFlowsResponseSchema,
} from "./flow.public.schemas";
import { applyPublicFlowGraphPatch, migrateFlowLayoutOnRead } from "./flow.public.service";
import {
	assertWebHeroFinalCodeMutationSource,
	narrowWebHeroPolicyGraph,
} from "./flow.webhero-code-policy";
import { assertCanonicalWebHeroStyleReferencePatch } from "./flow.webhero-style-reference";

function requireUserId(c: AppContext): string {
	const userId = c.get("userId");
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return String(userId);
}

function isDevBypassEnabled(c: AppContext): boolean {
	return Boolean(c.get("devPublicBypass"));
}

const PublicFlowGetRoute = createRoute({
	method: "get",
	path: "/flows/{id}",
	tags: ["Public API"],
	request: {
		params: z.object({
			id: z.string().min(1),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicFlowGetResponseSchema,
				},
			},
			description: "flow graph payload",
		},
	},
});

const PublicFlowPatchRoute = createRoute({
	method: "post",
	path: "/flows/{id}/patch",
	tags: ["Public API"],
	request: {
		params: z.object({
			id: z.string().min(1),
		}),
		body: {
			content: {
				"application/json": {
					schema: PublicFlowPatchRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicFlowPatchResponseSchema,
				},
			},
			description: "patched flow data",
		},
	},
});

const PublicProjectFlowsRoute = createRoute({
	method: "get",
	path: "/projects/{projectId}/flows",
	tags: ["Public API"],
	summary: "Dev-only: list project flows",
	description:
		"列出 project 下的 flow。开源单工作区下不再按用户过滤。",
	request: {
		params: z.object({
			projectId: z.string().min(1),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicProjectFlowsResponseSchema,
				},
			},
			description: "OK",
		},
	},
});

export function registerPublicFlowRoutes(publicApiRouter: OpenAPIHono<AppEnv>) {
	publicApiRouter.openapi(PublicProjectFlowsRoute, async (c) => {
		const devBypass = isDevBypassEnabled(c);
		const userId = requireUserId(c);
		const projectId = c.req.param("projectId");
		void devBypass;
		const rows = await listFlowsByOwner(c.env.DB, userId, projectId);
		return c.json(
			PublicProjectFlowsResponseSchema.parse({
				items: rows.map((r) => ({
					id: r.id,
					name: r.name,
					updatedAt: r.updated_at,
				})),
			}),
		);
	});

	publicApiRouter.openapi(PublicFlowGetRoute, async (c) => {
		const id = c.req.param("id");
		const devBypass = isDevBypassEnabled(c);
		const userId = requireUserId(c);
		void devBypass;
		const row = await getFlowForOwner(c.env.DB, id, userId);
		if (!row) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const dto = mapFlowRowToDto(row);
		const data = sanitizeFlowDataForStorage(dto.data ?? {});
		const parsed = PublicFlowGraphSchema.safeParse(data);
		if (!parsed.success) {
			throw new AppError("Flow data invalid", {
				status: 500,
				code: "flow_data_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const migration = migrateFlowLayoutOnRead({ data: parsed.data });
		return c.json(
			PublicFlowGetResponseSchema.parse({ ...dto, data: migration.data }),
		);
	});

	publicApiRouter.openapi(PublicFlowPatchRoute, async (c) => {
		const id = c.req.param("id");
		const devBypass = isDevBypassEnabled(c);
		const requestUserId = requireUserId(c);
		const body = await c.req.json();
		const parsed = PublicFlowPatchRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new AppError("Invalid request body", {
				status: 400,
				code: "invalid_request_body",
				details: { issues: parsed.error.issues },
			});
		}
		let appliedStats: ReturnType<typeof applyPublicFlowGraphPatch>["stats"] | null = null;
		let appliedIdMap: ReturnType<typeof applyPublicFlowGraphPatch>["idMap"] | undefined;
		let nextDataParsed: z.infer<typeof PublicFlowGraphSchema> | null = null;
		const { updatedRow: updated } = await optimisticCanvasWrite({
			db: c.env.DB,
			flowId: id,
			requestUserId,
			devBypass,
			versionLabel: "flow-patch",
			redisUrl: String(c.env.REDIS_URL || "").trim(),
			buildNextState: (latestRow: FlowRow) => {
				const dto = mapFlowRowToDto(latestRow);
				const current = sanitizeFlowDataForStorage(dto.data ?? {});
				const currentParsed = PublicFlowGraphSchema.safeParse(current);
				if (!currentParsed.success) {
					throw new AppError("Flow data invalid", {
						status: 500,
						code: "flow_data_invalid",
						details: { issues: currentParsed.error.issues },
					});
				}
				const webHeroPolicyGraph = narrowWebHeroPolicyGraph(currentParsed.data);
				assertWebHeroFinalCodeMutationSource(parsed.data, "generic", webHeroPolicyGraph);
				assertCanonicalWebHeroStyleReferencePatch(webHeroPolicyGraph, parsed.data);
				const applied = applyPublicFlowGraphPatch({ current, patch: parsed.data });
				const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
				const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
				if (!nextParsed.success) {
					throw new AppError("Flow patch produced invalid data", {
						status: 500,
						code: "flow_patch_invalid",
						details: { issues: nextParsed.error.issues },
					});
				}
				appliedStats = applied.stats;
				appliedIdMap = applied.idMap;
				nextDataParsed = nextParsed.data;
				return {
					name: latestRow.name,
					data: JSON.stringify(sanitizedNext ?? {}),
				};
			},
		});

		return c.json(
			PublicFlowPatchResponseSchema.parse({
				ok: true,
				flowId: updated.id,
				updatedAt: updated.updated_at,
				stats: appliedStats,
				...(appliedIdMap ? { idMap: appliedIdMap } : {}),
				data: nextDataParsed,
			}),
		);
	});
}

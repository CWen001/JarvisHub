import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ExecutionTraceWriteRequestSchema,
	MemoryContextRequestSchema,
	MemoryProjectChatArtifactSessionsRequestSchema,
	MemorySearchRequestSchema,
	MemoryWriteRequestSchema,
	MemoryStatusSchema,
} from "./memory.schemas";
import {
	buildUserMemoryContext,
	formatMemoryContextForPrompt,
	listUserProjectChatArtifactSessions,
	loadUserSessionRecentConversation,
	searchUserMemoryEntries,
	writeUserExecutionTrace,
	writeUserMemoryEntries,
	updateMemoryEntry,
	deleteMemoryEntry,
	listMemoryEntriesByScope,
} from "./memory.service";

export const memoryRouter = new Hono<AppEnv>();

memoryRouter.use("*", authMiddleware);

memoryRouter.post("/context", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryContextRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const entries = await buildUserMemoryContext(c, userId, {
		projectId: parsed.data.projectId,
		limitPerScope: parsed.data.limitPerScope,
	});
	const recentConversation = await loadUserSessionRecentConversation(c, userId, {
		sessionKey: parsed.data.sessionKey,
		recentConversationLimit: parsed.data.recentConversationLimit,
	});
	return c.json({
		entries,
		promptText: formatMemoryContextForPrompt(entries),
		context: { recentConversation },
	});
});

memoryRouter.post("/write", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryWriteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const ids = await writeUserMemoryEntries(c, userId, parsed.data);
	return c.json({ success: true, items: ids.map((id) => ({ id })) });
});

memoryRouter.post("/search", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemorySearchRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await searchUserMemoryEntries(c, userId, parsed.data);
	return c.json({ items });
});

memoryRouter.post("/project-chat-artifacts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryProjectChatArtifactSessionsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await listUserProjectChatArtifactSessions(c, userId, parsed.data);
	return c.json({ items });
});

memoryRouter.post("/trace", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ExecutionTraceWriteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const id = await writeUserExecutionTrace(c, userId, parsed.data);
	return c.json({ success: true, item: { id } });
});

const MemoryListRequestSchema = z.object({
	scopeType: z.enum(["user", "project"]),
	scopeId: z.string().min(1).max(120),
	memoryTypes: z.array(z.string()).max(10).optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

memoryRouter.post("/list", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryListRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await listMemoryEntriesByScope(c, userId, parsed.data);
	return c.json({ items });
});

const MemoryUpdateRequestSchema = z.object({
	id: z.string().min(1).max(120),
	title: z.string().max(200).optional(),
	summaryText: z.string().max(2000).optional(),
	content: z.record(z.string(), z.unknown()).optional(),
	importance: z.number().min(0).max(1).optional(),
	status: MemoryStatusSchema.optional(),
	pinned: z.boolean().optional(),
	tags: z.array(z.string().min(1).max(80)).max(20).optional(),
});

memoryRouter.patch("/entry", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryUpdateRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await updateMemoryEntry(c, userId, parsed.data);
	if (!result) return c.json({ error: "Not found" }, 404);
	return c.json({ success: true, item: result });
});

const MemoryDeleteRequestSchema = z.object({
	id: z.string().min(1).max(120),
});

memoryRouter.delete("/entry", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryDeleteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const success = await deleteMemoryEntry(c, userId, parsed.data.id);
	if (!success) return c.json({ error: "Not found" }, 404);
	return c.json({ success: true });
});

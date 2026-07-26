import { z } from "zod";

import { optionalNonEmptyString } from "./flow.public.schemas";

export const FlowSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: z.unknown(),
	scopeType: z.string().nullable().optional(),
	scopeId: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type FlowDto = z.infer<typeof FlowSchema>;

export const UpsertFlowSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
	data: z.unknown(),
	projectId: z.string().nullable().optional(),
	baseUpdatedAt: z.string().optional(),
	scopeType: z.enum(["project", "chapter", "shot"]).optional(),
	scopeId: optionalNonEmptyString,
	allowEmptyGraphOverwrite: z.literal(true).optional(),
});

export const FlowVersionReasonSchema = z.enum([
	"manual_save",
	"agent_turn",
	"agent_explicit",
	"rollback",
	"execution",
	"internal_cleanup",
	"legacy",
]);

export type FlowVersionReason = z.infer<typeof FlowVersionReasonSchema>;

export const FlowVersionSchema = z.object({
	id: z.string(),
	name: z.string(),
	label: z.string().nullable(),
	reason: FlowVersionReasonSchema,
	createdAt: z.string(),
});

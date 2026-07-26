import { z } from "zod";

export const AdminProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	ownerId: z.string().nullable(),
	owner: z.string().nullable(),
	ownerName: z.string().nullable(),
	flowCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type AdminProjectDto = z.infer<typeof AdminProjectSchema>;

export const ListAdminProjectsQuerySchema = z.object({
	q: z.string().max(128).optional(),
	ownerId: z.string().max(128).optional(),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const AdminUpdateProjectRequestSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
});

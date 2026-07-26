import { AppError } from "../../middleware/error";

export const OPEN_WORKSPACE_USER_ID = "local-workspace";

export function isOpenWorkspaceUserId(userId: string): boolean {
	return userId === OPEN_WORKSPACE_USER_ID;
}

export function assertOpenWorkspaceDataScope(input: {
	userId: string;
	resource: string;
	operation: string;
}): void {
	if (isOpenWorkspaceUserId(input.userId)) return;
	throw new AppError(
		"User-isolated persistence is unavailable in the current open workspace schema",
		{
			status: 501,
			code: "user_isolation_schema_unavailable",
			details: {
				userId: input.userId,
				resource: input.resource,
				operation: input.operation,
			},
		},
	);
}

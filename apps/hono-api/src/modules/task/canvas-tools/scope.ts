import { AppError } from "../../../middleware/error";

function normalizeId(value: string | null | undefined): string {
	return String(value || "").trim();
}

export function assertFlowProjectScope(input: {
	requestProjectId: string;
	flowProjectId: string | null | undefined;
}): void {
	const requestProjectId = normalizeId(input.requestProjectId);
	if (!requestProjectId) return;
	const flowProjectId = normalizeId(input.flowProjectId);
	if (flowProjectId === requestProjectId) return;
	throw new AppError("flow_project_scope_mismatch: flow does not belong to requested project", {
		status: 403,
		code: "flow_project_scope_mismatch",
		details: {
			projectId: requestProjectId,
			flowProjectId: flowProjectId || null,
		},
	});
}

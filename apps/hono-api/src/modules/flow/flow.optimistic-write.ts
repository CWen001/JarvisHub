import type { PrismaClient } from "../../types";
import { AppError } from "../../middleware/error";
import {
	getFlowByIdUnsafe,
	getFlowForOwner,
	updateFlowIfUpdatedAtMatches,
	updateFlowByIdUnsafeIfUpdatedAtMatches,
	createFlowVersion,
	type FlowRow,
	type FlowVersionReason,
} from "./flow.repo";
import { publishCanvasMutation } from "./flow.canvas-events";

export type OptimisticCanvasWriteInput = {
	db: PrismaClient;
	flowId: string;
	requestUserId: string;
	devBypass: boolean;
	buildNextState: (latestRow: FlowRow) => { data: string; name: string };
	versionLabel: string;
	versionReason?: FlowVersionReason;
	maxRetries?: number;
	baseDelayMs?: number;
	redisUrl?: string;
};

export type OptimisticCanvasWriteResult = {
	updatedRow: FlowRow;
	retriesUsed: number;
};

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 50;

export async function loadLatestFlowRow(input: {
	db: PrismaClient;
	flowId: string;
	requestUserId: string;
	devBypass: boolean;
}): Promise<FlowRow> {
	const row = input.devBypass
		? await getFlowByIdUnsafe(input.db, input.flowId)
		: await getFlowForOwner(input.db, input.flowId, input.requestUserId);
	if (!row) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	return row;
}

function jitteredDelay(baseMs: number, attempt: number): number {
	const exponential = baseMs * Math.pow(2, attempt);
	const jitter = Math.random() * baseMs;
	return exponential + jitter;
}

export async function optimisticCanvasWrite(
	input: OptimisticCanvasWriteInput,
): Promise<OptimisticCanvasWriteResult> {
	const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseDelayMs = input.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const latestRow = await loadLatestFlowRow({
			db: input.db,
			flowId: input.flowId,
			requestUserId: input.requestUserId,
			devBypass: input.devBypass,
		});

		const { data, name } = input.buildNextState(latestRow);
		const nowIso = new Date().toISOString();
		const baseUpdatedAt = latestRow.updated_at;

		const updated = input.devBypass
			? await updateFlowByIdUnsafeIfUpdatedAtMatches(input.db, {
					id: input.flowId,
					name,
					data,
					baseUpdatedAt,
					nowIso,
				})
			: await updateFlowIfUpdatedAtMatches(input.db, {
					id: input.flowId,
					name,
					data,
					ownerId: input.requestUserId,
					projectId: latestRow.project_id,
					baseUpdatedAt,
					nowIso,
				});

		if (updated) {
			await createFlowVersion(input.db, {
				id: crypto.randomUUID(),
				flowId: updated.id,
				name: updated.name,
				data: updated.data,
				userId: input.requestUserId,
				nowIso,
				reason: input.versionReason ?? "agent_turn",
				label: input.versionLabel,
			});

			void publishCanvasMutation(input.redisUrl, {
				flowId: input.flowId,
				updatedAt: updated.updated_at,
				source: input.versionLabel,
			});

			return { updatedRow: updated, retriesUsed: attempt };
		}

		if (attempt < maxRetries) {
			const delay = jitteredDelay(baseDelayMs, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw new AppError("Canvas write conflict: max retries exhausted", {
		status: 409,
		code: "canvas_write_conflict_exhausted",
		details: { flowId: input.flowId, maxRetries },
	});
}

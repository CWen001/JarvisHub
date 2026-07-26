import {
	assertPptDeckProjectInitPreconditions,
	readPptDeckWorkspaceId,
	type FlowGraphRecord,
} from "./agents-tool-bridge.ppt-master-step-gate";
import { initPptMasterProject } from "./agents-tool-bridge.ppt-master-runtime";

export async function initializePptMasterProjectForDeck(input: {
	graph: FlowGraphRecord;
	projectId: string;
	flowId: string;
	nodeId: string;
	projectName: string;
	format?: string;
	timeoutMs?: number;
}): Promise<Record<string, unknown>> {
	assertPptDeckProjectInitPreconditions(input.graph, input.nodeId);
	const workspaceId = readPptDeckWorkspaceId(input.graph, input.nodeId);
	return initPptMasterProject({
		projectName: input.projectName,
		scope: {
			projectId: input.projectId,
			flowId: input.flowId,
			nodeId: input.nodeId,
			workspaceId,
		},
		format: input.format,
		timeoutMs: input.timeoutMs,
	});
}

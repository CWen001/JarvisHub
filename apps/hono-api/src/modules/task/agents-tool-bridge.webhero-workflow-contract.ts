export const WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS = {
	approvedPreviewNodes: "webPageWorkflowContract.approvedPreviewNodes",
	selectedStyleReference: "webPageWorkflowContract.selectedStyleReference",
	sharedStyleBible: "webPageWorkflowContract.sharedStyleBible",
} as const;

export const WEBHERO_WORKFLOW_FIELD_PATH_ERROR = {
	code: "webhero_workflow_field_path_invalid",
	message: "WebHero workflow fields must be nested under webPageWorkflowContract",
} as const;

export const WEBHERO_WORKFLOW_FIELD_PATH_ISSUE_PARAM = "webHeroWorkflowFieldPath";

export type WebHeroWorkflowContractField = keyof typeof WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS;

export function findMisplacedWebHeroWorkflowFields(
	data: Record<string, unknown>,
): WebHeroWorkflowContractField[] {
	return (Object.keys(WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS) as WebHeroWorkflowContractField[])
		.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
}

export function requiredWebHeroWorkflowFieldPaths(
	fields: WebHeroWorkflowContractField[],
): Partial<Record<WebHeroWorkflowContractField, string>> {
	return Object.fromEntries(
		fields.map((field) => [field, WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS[field]]),
	);
}

// JSON-Schema `properties` guards that forbid the WebHero workflow fields at the
// patchNodeData[].data top level. `{ not: {} }` means "if this key is present, it
// matches nothing → invalid", so a generic JSON-Schema validator (including the
// agent CLI's pre-flight validator) rejects a misplaced field before any network
// call. Derived from the same WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS the server zod
// check uses, so the rule has one source of truth.
export function webHeroMisplacedFieldSchemaGuards(): Record<string, { not: Record<string, never>; description: string }> {
	return Object.fromEntries(
		(Object.keys(WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS) as WebHeroWorkflowContractField[])
			.map((field) => [field, {
				not: {},
				description: `${field} must be nested at ${WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS[field]}`,
			}]),
	);
}

import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { CanvasJsonSchema, CanvasToolSpec } from "./types";

export function buildCanvasJsonSchemaFromZod(schema: ZodTypeAny): CanvasJsonSchema {
	const rawSchema = zodToJsonSchema(schema, {
		$refStrategy: "none",
		target: "jsonSchema7",
	}) as Record<string, unknown>;
	const { $schema: _schema, definitions: _definitions, ...canvasSchema } = rawSchema;
	return canvasSchema;
}

export type CanvasToolSpecInput = Omit<CanvasToolSpec, "inputSchema">;

export function defineCanvasTool(input: CanvasToolSpecInput): CanvasToolSpec {
	return {
		...input,
		inputSchema: buildCanvasJsonSchemaFromZod(input.zodInputSchema),
	};
}

export function defineCanvasTools(specs: readonly CanvasToolSpecInput[]): CanvasToolSpec[] {
	return specs.map((spec) => defineCanvasTool(spec));
}

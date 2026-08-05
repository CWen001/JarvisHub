# Current Jarvis knowledge-to-image pipeline

This note records the current implementation seam relevant to integrating a private Design Kernel. It describes existing behavior; it is not yet the target architecture.

## Summary

Jarvis currently uses a model-driven, Skill-informed media Agent to author the final natural-language image prompt directly. Zod and JSON Schema strongly validate Tool arguments, references, task requests, and persisted Canvas state, but the generic image path does not require an intermediate domain-specific structured visual plan comparable to watch-openai's Concept Image BaseModel. Consequently, current schema enforcement protects execution correctness more than professional design semantics.

## Current path

1. The root Canvas Agent interprets the user request and delegates one scoped media phase to the `media` Sub-agent. Root/media separation is defined in `apps/agents-cli/src/core/root-persona.ts` and `apps/agents-cli/agent-definitions/canvas.json`.
2. Runtime Skill discovery scans configured, workspace, bundled, and optionally global Skill directories (`apps/agents-cli/src/runtime/skills.ts`). The model initially sees a compact Skill catalog.
3. The media Agent calls the `Skill` function Tool with a Skill name and optional package-relative resource. The Tool returns the selected Markdown/resource into model context (`apps/agents-cli/src/core/tools/skill.ts`).
4. The media Agent reads scoped Canvas text/media evidence, combines the request, loaded Skill instructions, and model reasoning, and directly authors the `prompt: string` argument for `canvas_image_generate_to_canvas`.
5. Hono validates the call with `AgentImageGenerateToCanvasArgsSchema`, a strict Zod object whose principal creative field remains a free-form non-empty `prompt` string (`apps/hono-api/src/modules/task/agents-tool-bridge.agent-media-schemas.ts`).
6. Hono converts stable references into Canvas/node inputs, resolves the configured image model and persisted media URLs, and mechanically augments the prompt only for camera/light controls, WebHero asset usage, or transparent-background post-processing (`apps/hono-api/src/modules/task/agents-tool-bridge.generate-image-to-canvas.ts`).
7. The resulting `TaskRequestDto` still sends one final natural-language `prompt` plus optional negative/system prompt, references, aspect and resolution to the provider (`apps/hono-api/src/modules/task/task.schemas.ts`).
8. Hono persists `generationContext.requestedPrompt`, `effectivePrompt`, applied transforms, provider/model/task identity, status, asset identity, and the resulting Canvas node. The media Agent must wait until `status=success` and `persisted=true`.
9. A separate `critic` Sub-agent may read the actual media and produce a dynamic rubric-based review, but this is downstream evaluation rather than an upstream structured watch-design contract.

## Schema technologies

- The active Hono/Canvas contracts use **Zod**.
- Canvas Tool Zod schemas are converted to JSON Schema 7 through `zod-to-json-schema` before being exposed as function Tool schemas (`apps/hono-api/src/modules/task/canvas-tools/schema.ts`).
- `agents-cli` sends ordinary JSON Schema function definitions to Chat Completions or Responses (`apps/agents-cli/src/llm/client.ts`). Some local Agent tools define their JSON Schema manually.
- TypeBox is present only transitively in current lockfiles; no active first-party TypeBox-based generic image-generation contract was found.

## What the schemas currently guarantee

- known Tool names and allowed arguments;
- required stable output identity and label;
- non-empty prompt;
- reference identity and URL safety rules;
- accepted aspect/resolution/purpose metadata;
- task kind, provider/model selection, persistence and lifecycle shape;
- Canvas graph/node consistency and wait-to-terminal behavior.

## What the generic image schema does not guarantee

- a complete authoritative Watch Concept exists before generation;
- selected Knowledge Atoms were applied;
- every required watch geometry/CMF/interface variable was resolved;
- knowledge provenance is bound to individual design decisions;
- the final prompt preserves every non-compressible Design Kernel field;
- the prompt was produced deterministically from a validated watch visual plan;
- omissions and `not_applicable` decisions are distinguishable;
- a later regeneration uses an immutable prior design plan rather than a rewritten prose summary.

`sourceEvidence` exists on the media Tool schema, but it is optional metadata and does not structurally determine the provider prompt.

## Architectural implication

Putting the Watch Design Kernel only in a long Markdown Skill would preserve Jarvis orchestration but would not preserve the Kernel's authority. The media model could omit, compress, reinterpret, or silently conflict with knowledge while still producing a schema-valid `prompt` string.

The likely extension seam is therefore immediately before the existing image-generation boundary: Jarvis remains responsible for Agent/Sub-agent selection and Tool execution, while a watch-specific structured contract must be validated and deterministically projected into the exact provider prompt. The projected prompt should reach the existing vendor/persistence pipeline without a later model rewrite.

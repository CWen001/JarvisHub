import { ToolHandler } from "./registry.js";
import { SkillLoader } from "../skills/loader.js";

function buildSkillToolDescription(loader: SkillLoader) {
  return loader.renderSkillToolDescription();
}

function unknownSkillResult(toolCallId: string, name: string) {
  const message = `未知 Skill '${name}'`;
  return {
    toolCallId,
    content: `Error: ${message}。请从 system prompt 的 Skills catalog 中选择精确 skill 名称后重试。`,
    isError: true,
    errorMessage: message,
  };
}

export function createSkillTool(loader: SkillLoader): ToolHandler {
  const definition = {
    name: "Skill",
    description: buildSkillToolDescription(loader),
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "技能名称" },
        resource: {
          type: "string",
          description: "可选。读取该 skill 目录下的相对资源路径，例如 references/foo.md 或 scripts/foo.py。",
        },
      },
      required: ["skill"],
    },
  };

  return {
    definition,
    isReadOnly: true,
    isConcurrencySafe: () => true,
    async execute(args, ctx, toolCallId) {
      const name = String(args.skill ?? "").trim();
      const resource = String(args.resource ?? "").trim();
      if (resource) {
        let resourceResult = loader.getSkillResourceContent(name, resource);
        if (!resourceResult) {
          loader.reloadSkills();
          definition.description = buildSkillToolDescription(loader);
          resourceResult = loader.getSkillResourceContent(name, resource);
        }
        if (!resourceResult) {
          return unknownSkillResult(toolCallId, name);
        }
        if (!resourceResult.ok) {
          return {
            toolCallId,
            content: resourceResult.error,
            isError: true,
            errorMessage: resourceResult.error,
          };
        }
        return {
          toolCallId,
          content: `<skill-resource-loaded name="${name}" resource="${resourceResult.resource}">
${resourceResult.content}
</skill-resource-loaded>

请遵循上述 Skill 资源补充完成用户任务。`,
        };
      }
      let content = loader.getSkillContent(name);
      if (!content) {
        loader.reloadSkills();
        definition.description = buildSkillToolDescription(loader);
        content = loader.getSkillContent(name);
      }
      if (!content) {
        return unknownSkillResult(toolCallId, name);
      }

      return {
        toolCallId,
        content: `<skill-loaded name="${name}">
${content}
</skill-loaded>

请遵循上述 Skill 的指引完成用户任务。`,
      };
    },
  };
}

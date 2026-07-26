import fs from "node:fs";
import path from "node:path";

export type Skill = {
  name: string;
  description: string;
  body: string;
  dir: string;
  path: string;
};

type ShadowedSkill = {
  name: string;
  activePath: string;
  ignoredPath: string;
};

type SkillResourceResult =
  | {
      ok: true;
      resource: string;
      content: string;
    }
  | {
      ok: false;
      error: string;
    };

export class SkillLoader {
  private skills = new Map<string, Skill>();
  private shadowedSkills: ShadowedSkill[] = [];
  private loadErrors: string[] = [];
  private readonly skillDirs: string[];

  constructor(skillsDirs: string | string[]) {
    this.skillDirs = Array.from(
      new Set(
        (Array.isArray(skillsDirs) ? skillsDirs : [skillsDirs])
          .map((dir) => path.resolve(String(dir || "").trim()))
          .filter(Boolean)
      )
    );
    this.loadSkills();
  }

  reloadSkills() {
    this.skills.clear();
    this.shadowedSkills = [];
    this.loadErrors = [];
    this.loadSkills();
  }

  getLoadErrors(): string[] {
    return this.loadErrors.slice();
  }

  assertNoLoadErrors(): void {
    if (this.loadErrors.length === 0) return;
    throw new Error(
      ["Skill 加载失败:", ...this.loadErrors.map((error) => `- ${error}`)].join("\n"),
    );
  }

  private parseSkillMd(content: string, skillPath: string): Skill | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return null;
    const [, frontmatter, body] = match;
    const meta = parseFrontmatter(frontmatter);
    const name = typeof meta.name === "string" ? meta.name.trim() : "";
    const descriptionRaw = typeof meta.description === "string" ? meta.description : "";
    const description = normalizeDescription(descriptionRaw);
    if (!name || !description) return null;
    return {
      name,
      description,
      body: body.trim(),
      dir: path.dirname(skillPath),
      path: skillPath,
    };
  }

  private loadSkills() {
    const errors: string[] = [];
    for (const skillsDir of this.skillDirs) {
      if (!fs.existsSync(skillsDir)) continue;
      let dirs: string[] = [];
      try {
        dirs = fs
          .readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        errors.push(`${skillsDir}: ${formatSkillLoadError(error)}`);
        continue;
      }

      for (const dir of dirs) {
        const skillPath = path.join(skillsDir, dir, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) continue;
          const content = fs.readFileSync(skillPath, "utf-8");
          const skill = this.parseSkillMd(content, skillPath);
          if (skill) {
            const existing = this.skills.get(skill.name);
            if (existing) {
              if (getSkillRoot(existing.path) === getSkillRoot(skill.path)) {
                errors.push(`${skillPath}: duplicate skill name "${skill.name}" already loaded from ${existing.path}`);
              } else {
                this.shadowedSkills.push({
                  name: skill.name,
                  activePath: existing.path,
                  ignoredPath: skill.path,
                });
              }
              continue;
            }
            this.skills.set(skill.name, skill);
          } else {
            errors.push(`${skillPath}: invalid SKILL.md frontmatter; name and description are required`);
          }
        } catch (error) {
          errors.push(`${skillPath}: ${formatSkillLoadError(error)}`);
        }
      }
    }
    this.loadErrors = errors;
  }

  listSkills() {
    return Array.from(this.skills.keys());
  }

  listSkillSummaries() {
    return Array.from(this.skills.values())
      .map((skill) => ({ name: skill.name, description: skill.description, path: skill.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listShadowedSkills(): ShadowedSkill[] {
    return this.shadowedSkills.slice();
  }

  getDescriptions() {
    if (this.skills.size === 0) return "（暂无可用技能）";
    return Array.from(this.skills.values())
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join("\n");
  }

  getDescriptionsFor(names: string[]) {
    const wanted = Array.from(
      new Set(
        (Array.isArray(names) ? names : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    if (wanted.length === 0) return this.getDescriptions();
    const lines = wanted
      .map((name) => {
        const skill = this.skills.get(name);
        if (!skill) return "";
        return `- ${skill.name}: ${skill.description}`;
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n") : this.getDescriptions();
  }

  renderSkillsSection(options?: { requiredSkills?: string[]; compact?: boolean }) {
    const requiredSkills = Array.from(
      new Set(
        (Array.isArray(options?.requiredSkills) ? options?.requiredSkills : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    const lines: string[] = [];
    lines.push("## Skills");
    lines.push("Skills are local task instructions managed by the runtime skill loader.");
    lines.push("- Choose skills directly from the catalog below by matching the user task to each description.");
    lines.push("- Load the full instructions with the `Skill` tool when the current phase clearly matches a skill description.");
    lines.push("- If required skills are listed below, load those exact names with the `Skill` tool before executing.");
    lines.push("- Load only the skill needed for the current phase; do not infer filesystem paths or load unrelated skills.");
    lines.push(`Required skills for this run: ${requiredSkills.length > 0 ? requiredSkills.join(", ") : "none"}.`);
    lines.push("");
    lines.push("<available_skills>");
    for (const skill of Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push("  <skill>");
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      lines.push("  </skill>");
    }
    lines.push("</available_skills>");
    return lines.join("\n");
  }

  renderSkillToolDescription(options?: { requiredSkills?: string[] }) {
    const requiredSkills = Array.from(
      new Set(
        (Array.isArray(options?.requiredSkills) ? options?.requiredSkills : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    const lines = [
      "加载技能以获得领域知识。`skill` 必须是 system prompt 的 Skills catalog 或 required skills 中列出的精确名称。",
      "如果已加载的 Skill 指向相对资源，可再次调用本工具并传 `resource`，由 skill loader 校验并读取该 skill 目录内的资源；不要推断绝对路径。",
      "未显式指定 skill 时，根据 Skills catalog 的 description 自主判断是否匹配；不需要检索工具。",
      "加载后只遵循与当前任务相关的部分，不要把无关 skill 正文带入当前回合。",
      "多阶段任务不要预加载未来阶段的 Skill；每轮只加载当前 phase 必须用到的 Skill，先完成 stage decision 再进入下一个 specialist。",
    ];
    if (requiredSkills.length > 0) {
      lines.push(`Run-specific requested skills: ${requiredSkills.join(", ")}.`);
    }
    return lines.join("\n");
  }

  getSkillContent(name: string) {
    const skill = this.skills.get(name);
    if (!skill) return null;
    let content = `# Skill: ${skill.name}\n\n${skill.body}`;
    const resources: string[] = [];
    for (const [folder, label] of [
      ["scripts", "脚本（scripts）"],
      ["references", "参考（references）"],
      ["assets", "资源（assets）"],
    ] as const) {
      const folderPath = path.join(skill.dir, folder);
      if (!fs.existsSync(folderPath)) continue;
      const files = fs.readdirSync(folderPath);
      if (files.length > 0) {
        resources.push(`${label}: ${files.join(", ")}`);
      }
    }
    if (resources.length > 0) {
      content += "\n\n**该技能目录可用资源：**\n";
      content += resources.map((r) => `- ${r}`).join("\n");
    }
    return content;
  }

  getSkillResourceContent(name: string, resourcePath: string): SkillResourceResult | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    const normalizedResource = normalizeSkillResourcePath(resourcePath);
    if (!normalizedResource) {
      return { ok: false, error: "Error: invalid Skill resource path" };
    }
    const resolved = path.resolve(skill.dir, normalizedResource);
    const skillDir = path.resolve(skill.dir);
    if (!isPathInside(resolved, skillDir)) {
      return { ok: false, error: "Error: invalid Skill resource path" };
    }
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { ok: false, error: `Error: Skill resource not found: ${normalizedResource}` };
      }
      return {
        ok: true,
        resource: normalizedResource,
        content: fs.readFileSync(resolved, "utf-8"),
      };
    } catch {
      return { ok: false, error: `Error: Skill resource not found: ${normalizedResource}` };
    }
  }

}

function getSkillRoot(skillPath: string): string {
  return path.dirname(path.dirname(skillPath));
}

function normalizeSkillResourcePath(resourcePath: string): string | null {
  const raw = String(resourcePath || "").trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0")) return null;
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) return null;
  const normalized = path.normalize(raw).replace(/\\/g, "/");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatSkillLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error || "").trim();
  return text || "unknown error";
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const lines = String(frontmatter || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  const meta: Record<string, string> = {};
  let blockKey: string | null = null;
  let blockStyle: "literal" | "folded" | null = null;
  let blockIndent: number | null = null;
  let blockLines: string[] = [];

  const flushBlock = () => {
    if (!blockKey) return;
    const raw = blockLines.join("\n");
    meta[blockKey] = blockStyle === "folded" ? raw.replace(/\n+/g, "\n") : raw;
    blockKey = null;
    blockStyle = null;
    blockIndent = null;
    blockLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const isKeyLine = !!keyMatch && !/^\s/.test(line);

    if (isKeyLine) {
      flushBlock();
      const key = String(keyMatch?.[1] || "").trim();
      const valueRaw = String(keyMatch?.[2] || "");
      const value = unquote(valueRaw);
      if (!key) continue;

      const block = value.trim();
      const isLiteral = block === "|" || block === "|-" || block === "|+";
      const isFolded = block === ">" || block === ">-" || block === ">+";
      if (isLiteral || isFolded) {
        blockKey = key;
        blockStyle = isFolded ? "folded" : "literal";
        continue;
      }

      meta[key] = value;
      continue;
    }

    if (blockKey) {
      if (line.trim() === "") {
        blockLines.push("");
        continue;
      }

      const indentMatch = line.match(/^(\s+)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      if (blockIndent === null) blockIndent = indent;
      const start = Math.min(blockIndent, line.length);
      blockLines.push(line.slice(start));
    }
  }

  flushBlock();
  return meta;
}

function normalizeDescription(raw: string): string {
  const trimmed = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

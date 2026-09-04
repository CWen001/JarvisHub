import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("references/kernel-manifest.json"));
const files = [
  "SKILL.md",
  manifest.base_contract.resource,
  manifest.baseline.resource,
  manifest.design_judgment_schema.resource,
  manifest.design_judgment_model.resource,
  manifest.design_dialogue.resource,
  manifest.sources,
];
const errors = [];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing ${file}`);
}

const skill = read("SKILL.md");
const contract = read(manifest.base_contract.resource);
const baseline = read(manifest.baseline.resource);
const schema = read(manifest.design_judgment_schema.resource);
const model = JSON.parse(read(manifest.design_judgment_model.resource));
const dialogue = read(manifest.design_dialogue.resource);

for (const text of [
  "name: phone-design-kernel",
  "Phone Dual-View Hero",
  "Always show every generated image",
  "provider-ready prompt",
]) {
  if (!skill.includes(text)) errors.push(`SKILL.md missing: ${text}`);
}
for (const text of ["Dual-View Hero invariant", "Camera Architecture", "CMF integrity", "Visible credibility only"]) {
  if (!contract.includes(text)) errors.push(`Base Contract missing: ${text}`);
}
for (const text of ["Holistic silhouette", "Human thinness", "One Leading Departure", "Legacy warning signs"]) {
  if (!baseline.includes(text)) errors.push(`Baseline missing: ${text}`);
}
for (const text of ["Turn 1", "Turn 2", "Revision", "Market Context", "Learning review"]) {
  if (!dialogue.includes(text)) errors.push(`Dialogue missing: ${text}`);
}
if (manifest.status !== "learning" || manifest.baseline.year !== 2026) errors.push("manifest maturity anchor is invalid");
if (manifest.source?.repository !== "wen-skills" || !/^[0-9a-f]{40}$/.test(manifest.source?.revision || "")) errors.push("vendored source revision is invalid");
if (!manifest.source?.status?.includes("no build-time or runtime dependency")) errors.push("vendored package must remain self-contained");
if (!contract.startsWith(`# Phone Base Contract ${manifest.base_contract.version}`)) errors.push("Base Contract version differs from manifest");
if (!baseline.startsWith(`# 2026 Contemporary Baseline ${manifest.baseline.version}`)) errors.push("Baseline version differs from manifest");
if (!schema.startsWith(`# Phone Design Judgment Schema ${manifest.design_judgment_schema.version}`)) errors.push("Design Judgment Schema version differs from manifest");
if (!skill.includes(`phone-kernel@${manifest.version}-learning`)) errors.push("Skill kernel evidence differs from manifest");
if (!skill.includes(`phone-base-contract@${manifest.base_contract.version}`)) errors.push("Skill Base Contract evidence differs from manifest");
if (!skill.includes(`phone-contemporary-baseline:2026@${manifest.baseline.version}`)) errors.push("Skill baseline evidence differs from manifest");
if (!skill.includes(`phone-design-judgment-schema@${manifest.design_judgment_schema.version}`)) errors.push("Skill Design Judgment Schema evidence differs from manifest");
if (!skill.includes(`phone-design-judgment-model@${manifest.design_judgment_model.version}`)) errors.push("Skill Design Judgment model evidence differs from manifest");
if (model.$id !== "phone-design-judgment.schema.json" || model.type !== "object") errors.push("Design Judgment model identity is invalid");
if (!model.title?.endsWith(manifest.design_judgment_model.version)) errors.push("Design Judgment model version differs from manifest");
if (!model.properties?.functional_form?.properties?.camera_architecture?.properties?.topology_originality) errors.push("Design Judgment model lacks topology originality");
if (/candidate/i.test(JSON.stringify(model))) errors.push("Design Judgment model still contains candidate markers");
if (/Jarvis|canvas_image_generate_to_canvas|\/Users\//.test(files.map(read).join("\n"))) errors.push("kernel contains a host-specific or absolute-path dependency");

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, name: manifest.name, version: manifest.version, status: manifest.status, files: files.length }, null, 2));

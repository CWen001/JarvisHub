import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readText = (relativePath) => fs.readFileSync(path.join(skillDir, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const errors = [];
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

const skill = readText("SKILL.md");
const baseModel = readText("references/concept-sketch-base-model.md");
const dialogue = readText("references/design-dialogue.md");
const quality = readText("references/quality-benchmark.md");
const artifactGuidance = readText("references/artifact-guidance.md");
const manifest = readJson("references/kernel-manifest.json");
const catalog = readJson("references/catalog.json");
const knowledge = readJson("references/knowledge.json");
const ledger = readJson("references/approval-ledger.json");

assert(skill.includes("name: tablet-design-kernel"), "SKILL.md has the wrong Skill name");
assert(skill.includes("sourceEvidence"), "SKILL.md must require native sourceEvidence provenance");
assert(skill.includes("task_contract.userConstraints"), "SKILL.md must carry accepted decisions through userConstraints");
assert(skill.includes("按此策略生成") && skill.includes("调整策略"), "SKILL.md must use the two native dialogue options");
assert(skill.includes("question` itself must literally contain all 3–6 complete Markdown cards"), "SKILL.md must require cards inside ask_user.question");
assert(!skill.includes("strategyCards"), "SKILL.md must not extend the ask_user schema");
assert(skill.includes("new directional generation must allocate a fresh outputKey"), "SKILL.md must prevent historical outputKey collisions");
assert(skill.includes("must not become a visual reference merely because it exists"), "SKILL.md must preserve explicit reference authority");
assert(!skill.includes('"outputKey": "tablet_concept_01"'), "SKILL.md must not prescribe one reusable Tablet outputKey");
assert(manifest.design_dialogue?.recommended_card_count?.minimum === 3, "dialogue minimum must be 3");
assert(manifest.design_dialogue?.recommended_card_count?.maximum === 6, "dialogue maximum must be 6");

for (const heading of ["When dialogue is required", "Professional Design Strategy Card", "Generation readiness"]) {
  assert(dialogue.includes(heading), `Design Dialogue is missing section: ${heading}`);
}

const baseEvidence = `tablet-base-model:concept-sketch@${manifest.base_model.version}`;
const qualityEvidence = `tablet-quality-benchmark@${manifest.quality_benchmark.version}`;
const catalogEvidence = `tablet-knowledge-catalog@${manifest.knowledge.catalog_version}`;
assert(skill.includes(baseEvidence), "BaseModel sourceEvidence differs from manifest");
assert(skill.includes(qualityEvidence), "quality sourceEvidence differs from manifest");
assert(skill.includes(catalogEvidence), "catalog sourceEvidence differs from manifest");
assert(catalog.version === manifest.knowledge.catalog_version, "catalog version differs from manifest");
assert(knowledge.version === manifest.knowledge.catalog_version, "knowledge version differs from manifest");
assert(ledger.published_version === manifest.knowledge.catalog_version, "ledger version differs from manifest");
assert(catalog.atom_count === manifest.knowledge.atom_count, "catalog atom count differs from manifest");
assert(knowledge.atoms.length === manifest.knowledge.atom_count, "knowledge atom count differs from manifest");
assert(catalog.design_areas.length === manifest.knowledge.design_area_count, "design area count differs from manifest");

for (const heading of [
  "Frame invariant",
  "Design Identity",
  "Portfolio Position and Maturity Anchor",
  "Product elements and relationships",
  "Hero State and carry relationship",
  "Dimensional intent and proportions",
  "Display, glass, and front hierarchy",
  "Bare enclosure, rear surface, and product nodes",
  "Human contact, handling, and carrying",
  "Input, controls, and feedback",
  "Integrated Design Resolutions",
  "Concrete CMF and touch",
  "Process-boundary honesty",
  "Visual thesis and evidence priority",
  "Camera, lighting, and environment",
  "Forbidden visual outcomes",
]) {
  assert(baseModel.includes(heading), `BaseModel is missing section: ${heading}`);
}
assert(quality.includes("Zero-knowledge invariant"), "quality benchmark must preserve zero-knowledge generation");
assert(quality.includes("Do not automatically call Critic"), "quality benchmark must reject automatic Critic");

const ledgerByAtom = new Map();
for (const entry of ledger.atoms ?? []) {
  assert(!ledgerByAtom.has(entry.atom_id), `duplicate approval-ledger atom: ${entry.atom_id}`);
  assert(/^[a-f0-9]{64}$/.test(entry.review_digest ?? ""), `invalid review digest: ${entry.atom_id}`);
  ledgerByAtom.set(entry.atom_id, entry);
}

const atomIds = new Set();
const designAreas = new Set();
for (const atom of knowledge.atoms ?? []) {
  assert(!atomIds.has(atom.atom_id), `duplicate atom id: ${atom.atom_id}`);
  atomIds.add(atom.atom_id);
  designAreas.add(atom.category);
  assert(atom.review_status === "approved", `non-approved atom in runtime package: ${atom.atom_id}`);
  assert(Array.isArray(atom.cues) && atom.cues.length > 0, `atom lacks perceptible cues: ${atom.atom_id}`);
  assert(Array.isArray(atom.limits) && atom.limits.length > 0, `atom lacks limits: ${atom.atom_id}`);
  assert(Array.isArray(atom.tradeoffs) && atom.tradeoffs.length > 0, `atom lacks tradeoffs: ${atom.atom_id}`);
  const ledgerEntry = ledgerByAtom.get(atom.atom_id);
  assert(Boolean(ledgerEntry), `atom lacks immutable review digest: ${atom.atom_id}`);
  const { review_status: _reviewStatus, ...digestValue } = atom;
  const canonical = JSON.stringify(digestValue, Object.keys(digestValue).sort());
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");
  assert(ledgerEntry?.review_digest === digest, `atom review digest differs: ${atom.atom_id}`);
}
for (const area of catalog.design_areas ?? []) assert(designAreas.has(area), `knowledge does not cover design area: ${area}`);
for (const atomId of ledgerByAtom.keys()) assert(atomIds.has(atomId), `ledger references missing atom: ${atomId}`);
for (const pair of knowledge.explicit_tension_pairs ?? []) {
  assert(Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1] && atomIds.has(pair[0]) && atomIds.has(pair[1]), `invalid tension pair: ${JSON.stringify(pair)}`);
}

const artifactHeadings = [
  "Concept Sketch",
  "Use Storyboard",
  "Four Panel Promo",
  "Six View Concept",
  "Material / CMF Direction",
  "Structure Concept",
  "Posture / Use Relationship",
  "Proportion / Dimension Direction",
  "Design Rationale Map",
];
for (const heading of artifactHeadings) assert(artifactGuidance.includes(`## ${heading}`), `Artifact guidance is missing: ${heading}`);
assert(manifest.artifacts.packaged_targets.length === 9, "manifest must preserve nine registered Tablet targets");
assert(manifest.artifacts.acceptance_backed_target === "concept_sketch", "Concept Sketch must be the first acceptance-backed target");

for (const file of [skill, baseModel, dialogue, quality, artifactGuidance, JSON.stringify(manifest), JSON.stringify(catalog), JSON.stringify(knowledge), JSON.stringify(ledger)]) {
  assert(!file.includes("/Users/"), "runtime package must not contain an absolute sibling-repository dependency");
  assert(!file.includes("tablet_studio/"), "runtime package must not depend on retired Python Tablet Studio");
}

if (errors.length) {
  console.error(["Tablet Design Kernel validation failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
  process.exit(1);
}

console.log(`Tablet Design Kernel valid: ${knowledge.atoms.length} approved atoms across ${designAreas.size} design areas; ${manifest.artifacts.packaged_targets.length} packaged targets.`);

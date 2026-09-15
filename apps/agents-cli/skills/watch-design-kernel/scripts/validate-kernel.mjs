import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referencesDir = path.join(skillDir, "references");
const readText = (relativePath) => fs.readFileSync(path.join(skillDir, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const errors = [];
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

const skill = readText("SKILL.md");
const baseModel = readText("references/concept-image-base-model.md");
const designJudgmentSchema = readText("references/design-judgment-schema.md");
const designDialogue = readText("references/design-dialogue.md");
const manifest = readJson("references/kernel-manifest.json");
const catalog = readJson("references/catalog.json");
const ledger = readJson("references/approval-ledger.json");

assert(skill.includes("name: watch-design-kernel"), "SKILL.md has the wrong skill name");
assert(skill.includes("sourceEvidence"), "SKILL.md must require native sourceEvidence provenance");
assert(skill.includes("decision tree") && skill.includes("current frontier"), "SKILL.md must run dialogue from the unresolved decision frontier");
assert(skill.includes("normally use two turns and at most three"), "SKILL.md must require sufficient depth for a new direction");
assert(skill.includes("series request") && skill.includes("parent Design Spine") && skill.includes("inherited relationships"), "SKILL.md must derive a series through structural inheritance");
assert(skill.includes("ask_user.options") && skill.includes("valid image URLs"), "SKILL.md must use native text options and user-authorized image cards");
assert(skill.includes("recommendation") && skill.includes("free text"), "SKILL.md must recommend an answer while accepting free text");
assert(skill.includes("explicit waiver") && skill.includes("professional defaults"), "SKILL.md must support an explicit dialogue waiver");
assert(skill.includes("Design Judgment Schema readiness invariant"), "SKILL.md must gate prompt authorship on resolved design judgment");
assert(skill.includes("Non-Jarvis host fallback") && skill.includes("portable generation packet"), "SKILL.md must support prompt-only hosts such as Pi");
assert(skill.includes("one Critic review") && skill.includes("actual pixels"), "SKILL.md must require one actual-image Critic review");
assert(skill.includes("2–3 visible evidence points") && skill.includes("No automatic retry"), "SKILL.md must bound review output and prohibit retry loops");
for (const legacy of ["Professional Design Strategy Card", "按此策略生成", "调整策略", "all 3–6 complete Markdown cards", "strategyCards"]) {
  assert(!skill.includes(legacy), `SKILL.md retains legacy dialogue contract: ${legacy}`);
}
assert(skill.includes("task_contract.userConstraints"), "SKILL.md must carry visible decisions through userConstraints");
assert(skill.includes("new directional generation must allocate a fresh outputKey"), "SKILL.md must prevent historical outputKey collisions");
assert(skill.includes("must not become a visual reference merely because it exists"), "SKILL.md must preserve explicit reference authority");
assert(!skill.includes('"outputKey": "watch_concept_01"'), "SKILL.md must not prescribe one reusable Watch outputKey");
assert(!("recommended_card_count" in (manifest.design_dialogue ?? {})), "manifest must not prescribe dialogue card counts");
for (const heading of ["Decision tree and frontier", "Product thesis", "Form system", "Portfolio or free exploration", "Generation readiness", "Actual-image review"]) {
  assert(designDialogue.includes(heading), `Design Dialogue is missing section: ${heading}`);
}
assert(designDialogue.includes(`Watch Design Dialogue ${manifest.design_dialogue.version}`), "Design Dialogue version differs from the manifest");
assert(designDialogue.includes("Normally use two turns and at most three"), "Design Dialogue must use two turns for a new direction by default");
assert(designDialogue.includes("thickness budget") && designDialogue.includes("Hero-visible Craft Carrier") && designDialogue.includes("Functional Scale") && designDialogue.includes("Keep the strap quiet"), "Design Dialogue must prioritize functional detail and quiet supporting parts");
assert(designDialogue.includes("One confirmation authorizes the whole explicit batch"), "Design Dialogue must confirm a batch only once");
assert(
  skill.includes(`watch-base-model:concept-image@${manifest.base_model.version}`),
  "SKILL.md BaseModel evidence version differs from the manifest",
);
assert(
  skill.includes(`watch-design-judgment-schema@${manifest.design_judgment_schema.version}`),
  "SKILL.md Design Judgment Schema evidence version differs from the manifest",
);
assert(
  skill.includes(`watch-knowledge-catalog@${manifest.knowledge.catalog_version}`),
  "SKILL.md catalog evidence version differs from the manifest",
);
assert(catalog.version === manifest.knowledge.catalog_version, "catalog version differs from the manifest");
assert(catalog.domains.length === manifest.knowledge.domains.length, "manifest/catalog domain count differs");

const requiredBaseModelSections = [
  "Frame invariant",
  "Visual thesis and evidence priority",
  "Single-product composition",
  "Case architecture and proportions",
  "Display and glass",
  "Controls and openings",
  "Attachment and complete strap",
  "Surface and CMF zones",
  "One visible interface state",
  "Detail hierarchy",
  "Lighting and environment",
  "Forbidden visual outcomes",
];
for (const section of requiredBaseModelSections) {
  assert(baseModel.includes(section), `BaseModel is missing section: ${section}`);
}

assert(designJudgmentSchema.includes(`Watch Design Judgment Schema ${manifest.design_judgment_schema.version}`), "Design Judgment Schema version differs from the manifest");
for (const judgment of [
  "Constraint dialect",
  "Controlled choice",
  "Relational quantity",
  "Derived default",
  "Compact Internal Design State",
  "role → proven archetype → proportion envelope → thickness budget → carrier capacity",
  "maturityPrior",
  "designSpine",
  "culturalGrammar",
  "sourceRelationships[2..3]",
  "abstractionOperation[1]",
  "craftResolution.primaryCarrier",
  "heroVisibleArea",
  "craftResolution.processBinding",
  "visibleScaleAndDepth",
  "partBoundaryRule",
  "secondaryEchoes[1..2]",
  "functionalResolution",
  "physicalFunctionalScale",
  "displayIndependence",
  "constructionResolution",
  "materialZones",
  "ornamentalResolution",
  "salienceOrder",
  "productDistanceRead",
  "inspectionDistanceRead",
  "familyInheritance",
  "Resolve the primary Craft Carrier",
  "Bind process to substrate",
  "Compose craft loci",
  "Resolve detail by purpose",
  "Readiness invariant",
]) {
  assert(designJudgmentSchema.includes(judgment), `Design Judgment Schema is missing generative relation: ${judgment}`);
}
assert(designJudgmentSchema.includes("Do not write the Prompt until every line in the Compact Internal Design State is either concretely resolved or explicitly non-applicable"), "Design Judgment Schema must resolve the compact Design State before Provider execution");
assert(!designJudgmentSchema.includes("leadingComposition"), "Design Judgment Schema must not duplicate craft composition in leadingComposition");

const ledgerByAtom = new Map();
for (const entry of ledger.atoms ?? []) {
  assert(!ledgerByAtom.has(entry.atom_id), `duplicate approval-ledger atom: ${entry.atom_id}`);
  assert(/^[a-f0-9]{64}$/.test(entry.review_digest ?? ""), `invalid review digest: ${entry.atom_id}`);
  ledgerByAtom.set(entry.atom_id, entry);
}

const atomIds = new Set();
let approvedCount = 0;
for (const domain of catalog.domains ?? []) {
  const domainPath = path.join(referencesDir, path.basename(domain.resource));
  assert(fs.existsSync(domainPath), `missing domain resource: ${domain.resource}`);
  if (!fs.existsSync(domainPath)) continue;
  const payload = JSON.parse(fs.readFileSync(domainPath, "utf8"));
  assert(payload.domain === domain.id, `domain id mismatch: ${domain.id}`);
  assert(payload.atoms.length === domain.atom_count, `atom count mismatch: ${domain.id}`);
  for (const atom of payload.atoms) {
    assert(!atomIds.has(atom.atom_id), `duplicate atom id: ${atom.atom_id}`);
    atomIds.add(atom.atom_id);
    assert(atom.review_status === "approved", `non-approved atom in runtime package: ${atom.atom_id}`);
    assert(ledgerByAtom.has(atom.atom_id), `atom lacks immutable approval digest: ${atom.atom_id}`);
    if (atom.review_status === "approved") approvedCount += 1;
  }
}

for (const atomId of ledgerByAtom.keys()) {
  assert(atomIds.has(atomId), `approval ledger references missing atom: ${atomId}`);
}
assert(approvedCount === 60, `expected 60 approved atoms, found ${approvedCount}`);

if (errors.length) {
  console.error(["Watch Design Kernel validation failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
  process.exit(1);
}

console.log(`Watch Design Kernel valid: ${approvedCount} approved atoms across ${catalog.domains.length} domains.`);

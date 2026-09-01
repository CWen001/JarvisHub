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
const designDialogue = readText("references/design-dialogue.md");
const manifest = readJson("references/kernel-manifest.json");
const catalog = readJson("references/catalog.json");
const ledger = readJson("references/approval-ledger.json");

assert(skill.includes("name: watch-design-kernel"), "SKILL.md has the wrong skill name");
assert(skill.includes("sourceEvidence"), "SKILL.md must require native sourceEvidence provenance");
assert(skill.includes("Use safe professional defaults"), "SKILL.md must prefer safe defaults over routine questioning");
assert(skill.includes("explicit artifact request"), "SKILL.md must treat explicit artifact intent as generation authorization");
assert(skill.includes("non-blocking direction summary"), "SKILL.md must keep its inferred direction visible without a confirmation gate");
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
for (const heading of ["When to ask", "Generation readiness", "Actual-image review"]) {
  assert(designDialogue.includes(heading), `Design Dialogue is missing section: ${heading}`);
}
assert(
  skill.includes(`watch-base-model:concept-image@${manifest.base_model.version}`),
  "SKILL.md BaseModel evidence version differs from the manifest",
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

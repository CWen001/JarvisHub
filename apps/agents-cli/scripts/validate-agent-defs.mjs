#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const canvasToolSetPath = path.join(repoRoot, "src", "runtime", "canvas-tool-set.ts");
const canvasToolSetSource = ts.createSourceFile(
  canvasToolSetPath,
  readFileSync(canvasToolSetPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function unwrapConstArrayInitializer(node) {
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrapConstArrayInitializer(node.expression);
  }
  return null;
}

function readStringArrayConst(name) {
  let out = null;
  for (const statement of canvasToolSetSource.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const array = declaration.initializer ? unwrapConstArrayInitializer(declaration.initializer) : null;
      if (!array) {
        throw new Error(`${name} must be initialized as a const string array`);
      }
      out = array.elements.map((element) => {
        if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
          return element.text;
        }
        throw new Error(`${name} must contain only string literals`);
      });
    }
  }
  if (!out) throw new Error(`${name} not found in ${canvasToolSetPath}`);
  return out;
}

const LOCAL_CANVAS_TOOLS = readStringArrayConst("LOCAL_CANVAS_TOOLS");
const KNOWN_REMOTE_CANVAS_TOOLS = readStringArrayConst("KNOWN_REMOTE_CANVAS_TOOLS");

const CANVAS_TOOLS_UNIVERSE = new Set([...LOCAL_CANVAS_TOOLS, ...KNOWN_REMOTE_CANVAS_TOOLS]);

const KNOWN_PROVIDERS = new Set(["openai-chat", "openai-responses", "google-v1beta"]);

const REQUIRED_FIELDS = ["name", "description", "tools", "prompt"];

const errors = [];

function fail(file, agentName, msg) {
  errors.push(`[${file}${agentName ? ` :: ${agentName}` : ""}] ${msg}`);
}

function loadJson(file) {
  const full = path.join(repoRoot, "agent-definitions", file);
  if (!existsSync(full)) {
    fail(file, null, "missing agent-definitions file");
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    fail(file, null, `invalid JSON: ${err.message}`);
    return null;
  }
}

function validateAgent(file, def, { strictWhitelist }) {
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    fail(file, null, "definition must be a JSON object");
    return;
  }
  const name = typeof def.name === "string" ? def.name : "<unnamed>";
  for (const field of REQUIRED_FIELDS) {
    if (!(field in def)) {
      fail(file, name, `missing required field '${field}'`);
    }
  }
  if (typeof def.name !== "string" || !def.name.trim()) {
    fail(file, name, "name must be non-empty string");
  }
  if (typeof def.description !== "string" || !def.description.trim()) {
    fail(file, name, "description must be non-empty string");
  }
  if (typeof def.prompt !== "string" || def.prompt.length < 20) {
    fail(file, name, "prompt missing or too short (<20 chars)");
  }
  if (!Array.isArray(def.tools) || def.tools.length === 0) {
    fail(file, name, "tools must be a non-empty array");
    return;
  }
  for (const t of def.tools) {
    if (typeof t !== "string" || !t.trim()) {
      fail(file, name, `tools entry must be a non-empty string, got ${JSON.stringify(t)}`);
    }
  }
  if (def.disallowedTools && !Array.isArray(def.disallowedTools)) {
    fail(file, name, "disallowedTools must be an array if present");
  }
  if (def.isReadOnly !== undefined && typeof def.isReadOnly !== "boolean") {
    fail(file, name, "isReadOnly must be boolean");
  }
  if (def.background !== undefined && typeof def.background !== "boolean") {
    fail(file, name, "background must be boolean");
  }
  if (def.maxTurns !== undefined && (!Number.isInteger(def.maxTurns) || def.maxTurns <= 0)) {
    fail(file, name, "maxTurns must be a positive integer");
  }
  if (def.modelProvider !== undefined && !KNOWN_PROVIDERS.has(def.modelProvider)) {
    fail(file, name, `unknown modelProvider '${def.modelProvider}' (allowed: ${[...KNOWN_PROVIDERS].join(", ")})`);
  }
  if (def.modelProvider && (!def.model || typeof def.model !== "string" || !def.model.trim())) {
    fail(file, name, "modelProvider declared but model is missing/empty");
  }
  if (def.useMultimodalSlot !== undefined && typeof def.useMultimodalSlot !== "boolean") {
    fail(file, name, "useMultimodalSlot must be boolean");
  }
  if (def.useMultimodalSlot === true && def.modelProvider) {
    fail(file, name, "useMultimodalSlot:true conflicts with modelProvider — drop modelProvider so the slot's apiProtocol drives dispatch");
  }

  if (strictWhitelist) {
    if (def.tools.includes("*")) {
      fail(file, name, "wildcard 'tools: [\"*\"]' not allowed in canvas harness — declare explicit tool names");
    }
    for (const t of def.tools) {
      if (t === "*") continue;
      if (!CANVAS_TOOLS_UNIVERSE.has(t)) {
        fail(file, name, `tool '${t}' not in canvas runtime universe (LOCAL ∪ KNOWN_REMOTE)`);
      }
    }
    if (def.disallowedTools) {
      for (const t of def.disallowedTools) {
        if (typeof t !== "string") continue;
        if (!CANVAS_TOOLS_UNIVERSE.has(t) && t !== "Agent") {
          fail(file, name, `disallowedTools entry '${t}' not in canvas runtime universe`);
        }
      }
    }
  }
}

function validateFile(file, opts) {
  const data = loadJson(file);
  if (!data) return;
  if (!Array.isArray(data)) {
    fail(file, null, "top-level JSON must be an array of agent definitions");
    return;
  }
  const seen = new Set();
  for (const def of data) {
    validateAgent(file, def, opts);
    if (def && typeof def.name === "string") {
      if (seen.has(def.name)) {
        fail(file, def.name, "duplicate agent name");
      }
      seen.add(def.name);
    }
  }
}

validateFile("canvas.json", { strictWhitelist: true });

if (errors.length > 0) {
  console.error(`agent-definitions validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("agent-definitions validation passed.");

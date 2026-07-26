#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const OPEN_SCHEMA_RESET_CONFIRMATION = "DROP_OLD_JARVISHUB_SCHEMA";

const OPEN_SCHEMA_APP_TABLES = [
	"tasks",
	"projects",
	"flows",
	"flow_versions",
	"workflow_executions",
	"workflow_node_runs",
	"workflow_execution_events",
	"model_catalog_vendors",
	"model_catalog_vendor_api_keys",
	"model_catalog_models",
	"model_catalog_default_models",
	"model_catalog_mappings",
	"prompt_samples",
	"llm_node_presets",
	"agent_skills",
	"agent_presets",
	"agent_pipeline_runs",
	"assets",
	"chapters",
	"storyboard_assets",
	"storyboard_asset_views",
	"storyboard_shots",
	"storyboard_render_jobs",
	"storyboard_timeline_tracks",
	"storyboard_diagnostic_logs",
	"material_assets",
	"material_asset_versions",
	"shot_material_refs",
	"vendor_api_call_logs",
	"api_request_logs",
	"prompt_evolution_runs",
	"prompt_evolution_runtime",
	"task_statuses",
	"task_results",
	"video_generation_histories",
	"vendor_task_refs",
	"public_chat_sessions",
	"public_chat_messages",
	"public_chat_turn_runs",
	"agent_tool_invocations",
	"memory_entries",
	"memory_entry_tags",
	"memory_links",
	"execution_traces",
	"dreamina_accounts",
	"dreamina_project_bindings",
];

function apiRootDir() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function quoteIdent(identifier) {
	return `"${identifier.replace(/"/g, `""`)}"`;
}

function buildDropStatements() {
	return [...OPEN_SCHEMA_APP_TABLES]
		.reverse()
		.map((table) => `DROP TABLE IF EXISTS ${quoteIdent(table)} CASCADE;`);
}

function parseMode(argv) {
	const args = argv.slice(2).filter((arg) => arg !== "--");
	const execute = args.includes("--execute") || args.includes("--no-dry-run");
	const unknown = args.filter(
		(arg) => !["--dry-run", "--execute", "--no-dry-run"].includes(arg),
	);
	if (unknown.length) {
		throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
	}
	return { dryRun: !execute };
}

function ensureDatabaseUrl() {
	const databaseUrl = String(process.env.DATABASE_URL || "").trim();
	if (!databaseUrl) throw new Error("DATABASE_URL is required for open schema reset");
	return databaseUrl;
}

function ensureExplicitConfirmation() {
	const actual = String(process.env.CONFIRM_OPEN_SCHEMA_RESET || "").trim();
	if (actual !== OPEN_SCHEMA_RESET_CONFIRMATION) {
		throw new Error(
			`Refusing destructive reset. Set CONFIRM_OPEN_SCHEMA_RESET=${OPEN_SCHEMA_RESET_CONFIRMATION}`,
		);
	}
}

function runNodeScript(scriptName) {
	const result = spawnSync(process.execPath, [path.join(apiRootDir(), "scripts", scriptName)], {
		cwd: apiRootDir(),
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(`${scriptName} failed with exit code ${result.status ?? "unknown"}`);
	}
}

function runPrismaGenerate() {
	const result = spawnSync(
		"pnpm",
		["exec", "prisma", "generate", "--schema", "prisma/schema.prisma"],
		{
			cwd: apiRootDir(),
			stdio: "inherit",
			env: process.env,
		},
	);
	if (result.status !== 0) {
		throw new Error(`prisma generate failed with exit code ${result.status ?? "unknown"}`);
	}
}

function printDryRun(dropStatements) {
	console.log("[open-schema-reset] dry run");
	console.log(`[open-schema-reset] app tables to drop: ${OPEN_SCHEMA_APP_TABLES.length}`);
	for (const table of OPEN_SCHEMA_APP_TABLES) console.log(`  - ${table}`);
	console.log("[open-schema-reset] drop SQL:");
	console.log(dropStatements.join("\n"));
	console.log("[open-schema-reset] bootstrap: scripts/bootstrap-postgres-schema.mjs");
	console.log("[open-schema-reset] generate: pnpm exec prisma generate --schema prisma/schema.prisma");
	console.log(
		`[open-schema-reset] execute requires --execute and CONFIRM_OPEN_SCHEMA_RESET=${OPEN_SCHEMA_RESET_CONFIRMATION}`,
	);
}

async function dropAppTables(dropStatements) {
	const prisma = new PrismaClient();
	try {
		await prisma.$transaction(async (tx) => {
			for (const statement of dropStatements) {
				await tx.$executeRawUnsafe(statement);
			}
		});
	} finally {
		await prisma.$disconnect();
	}
}

async function main() {
	const { dryRun } = parseMode(process.argv);
	const dropStatements = buildDropStatements();
	if (dryRun) {
		printDryRun(dropStatements);
		return;
	}

	ensureDatabaseUrl();
	ensureExplicitConfirmation();
	console.log("[open-schema-reset] creating backup before destructive reset");
	runNodeScript("backup-postgres.mjs");
	console.log("[open-schema-reset] dropping explicit JarvisHub app tables");
	await dropAppTables(dropStatements);
	console.log("[open-schema-reset] bootstrapping open schema");
	runNodeScript("bootstrap-postgres-schema.mjs");
	console.log("[open-schema-reset] regenerating Prisma client");
	runPrismaGenerate();
	console.log("[open-schema-reset] complete");
}

main().catch((error) => {
	console.error("[open-schema-reset] failed:", error);
	process.exit(1);
});

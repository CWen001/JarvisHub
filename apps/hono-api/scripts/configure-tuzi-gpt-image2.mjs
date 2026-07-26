#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(SCRIPT_DIR, "..");

const DEFAULT_API_ENV_FILE = resolve(API_DIR, ".env");
const DEFAULT_VENDOR_KEY = "tuzi";
const DEFAULT_VENDOR_NAME = "Tuzi";
const DEFAULT_BASE_URL = "https://api.tu-zi.com";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_ALIAS = "tuzi-gpt-image-2";
const DEFAULT_SLOT = "image";
const DEFAULT_KIND = "image";
const API_PROTOCOL = "openai-images";

function parseArgs(argv) {
	const options = {
		apiEnvFile: DEFAULT_API_ENV_FILE,
		vendorKey: DEFAULT_VENDOR_KEY,
		vendorName: DEFAULT_VENDOR_NAME,
		baseUrl: DEFAULT_BASE_URL,
		model: DEFAULT_MODEL,
		modelAlias: DEFAULT_ALIAS,
		slot: DEFAULT_SLOT,
		setDefault: true,
		disableImageMappings: true,
		dryRun: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === "--api-env-file" && next) {
			options.apiEnvFile = next;
			index += 1;
		} else if (arg === "--vendor-key" && next) {
			options.vendorKey = next;
			index += 1;
		} else if (arg === "--vendor-name" && next) {
			options.vendorName = next;
			index += 1;
		} else if (arg === "--base-url" && next) {
			options.baseUrl = next;
			index += 1;
		} else if (arg === "--model" && next) {
			options.model = next;
			index += 1;
		} else if (arg === "--model-alias" && next) {
			options.modelAlias = next;
			index += 1;
		} else if (arg === "--slot" && next) {
			options.slot = next;
			index += 1;
		} else if (arg === "--api-key" && next) {
			options.apiKey = next;
			index += 1;
		} else if (arg === "--no-default") {
			options.setDefault = false;
		} else if (arg === "--keep-mappings") {
			options.disableImageMappings = false;
		} else if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "-h" || arg === "--help") {
			options.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function printHelp() {
	console.log(`Usage:
  node apps/hono-api/scripts/configure-tuzi-gpt-image2.mjs [options]

Options:
  --api-env-file <path>   Defaults to ${DEFAULT_API_ENV_FILE}
  --vendor-key <key>      Defaults to ${DEFAULT_VENDOR_KEY}
  --vendor-name <name>    Defaults to ${DEFAULT_VENDOR_NAME}
  --base-url <url>        Defaults to TUZI_BASE_URL, then ${DEFAULT_BASE_URL}
  --model <model>         Defaults to TUZI_IMAGE_MODEL, then ${DEFAULT_MODEL}
  --model-alias <alias>   Defaults to ${DEFAULT_ALIAS}
  --api-key <key>         Defaults to TUZI_API_KEY
  --slot <slot>           Defaults to ${DEFAULT_SLOT}
  --no-default            Do not update model_catalog_default_models
  --keep-mappings         Keep existing Tuzi text_to_image/image_edit mappings enabled
  --dry-run               Print non-secret config without writing DB
`);
}

function loadEnvFile(path, override = false) {
	const envPath = resolve(process.cwd(), path);
	if (!existsSync(envPath)) return false;
	const raw = readFileSync(envPath, "utf8");
	for (const lineRaw of raw.split(/\r?\n/)) {
		const line = lineRaw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith("\"") && value.endsWith("\"")) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key && (override || !(key in process.env))) process.env[key] = value;
	}
	return true;
}

function normalizeKey(value) {
	return String(value || "").trim().toLowerCase();
}

function pickApiKey(options) {
	return String(options.apiKey || process.env.TUZI_API_KEY || "").trim();
}

function describeDefault(row) {
	if (!row) return "<unset>";
	return `${row.vendor_key}/${row.model_key}`;
}

async function readDefault(prisma, slot) {
	return prisma.model_catalog_default_models.findUnique({ where: { slot } });
}

function imageModelMeta() {
	return JSON.stringify({
		apiProtocol: API_PROTOCOL,
		endpoints: {
			generations: "/v1/images/generations",
			edits: "/v1/images/edits",
		},
		useCases: ["文本生图", "参考图改图", "画布图片节点"],
		imageOptions: {
			defaultAspectRatio: "1:1",
			defaultImageSize: "2k",
			aspectRatioOptions: [
				"auto",
				"1:1",
				"3:2",
				"2:3",
				"4:3",
				"3:4",
				"5:4",
				"4:5",
				"16:9",
				"9:16",
				"2:1",
				"1:2",
				"21:9",
				"9:21",
			],
			imageSizeOptions: [
				{ value: "1k", label: "1K" },
				{ value: "2k", label: "2K" },
				{ value: "4k", label: "4K" },
			],
			resolutionOptions: ["1k", "2k", "4k"],
			supportsReferenceImages: true,
			supportsTextToImage: true,
			supportsImageToImage: true,
		},
	});
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	const apiEnvLoaded = loadEnvFile(options.apiEnvFile);
	const databaseUrl = String(process.env.DATABASE_URL || "").trim();
	if (!databaseUrl) throw new Error("DATABASE_URL is required.");

	const vendorKey = normalizeKey(options.vendorKey);
	const vendorName = String(options.vendorName || DEFAULT_VENDOR_NAME).trim();
	const baseUrl = String(
		options.baseUrl || process.env.TUZI_BASE_URL || DEFAULT_BASE_URL,
	).trim();
	const model = String(
		options.model || process.env.TUZI_IMAGE_MODEL || DEFAULT_MODEL,
	).trim();
	const modelAlias = String(options.modelAlias || DEFAULT_ALIAS).trim();
	const slot = String(options.slot || DEFAULT_SLOT).trim();
	const apiKey = pickApiKey(options);

	if (!vendorKey) throw new Error("vendor key is required.");
	if (!vendorName) throw new Error("vendor name is required.");
	if (!baseUrl) throw new Error("base URL is required.");
	if (!model) throw new Error("model is required.");
	if (!modelAlias) throw new Error("model alias is required.");
	if (!apiKey) throw new Error("TUZI_API_KEY is required.");
	if (options.setDefault && !slot) throw new Error("default slot is required.");

	console.log("[tuzi-gpt-image2] resolved config");
	console.log(`  api_env_file_loaded: ${apiEnvLoaded ? "yes" : "no"}`);
	console.log(`  vendor_key: ${vendorKey}`);
	console.log(`  model: ${model}`);
	console.log(`  model_alias: ${modelAlias}`);
	console.log(`  base_url: ${baseUrl}`);
	console.log(`  api_protocol: ${API_PROTOCOL}`);
	console.log(`  kind: ${DEFAULT_KIND}`);
	console.log("  api_key_present: yes");
	console.log(`  set_default: ${options.setDefault ? slot : "no"}`);
	console.log(
		`  disable_image_mappings: ${options.disableImageMappings ? "yes" : "no"}`,
	);

	const prisma = new PrismaClient();
	try {
		const previousDefault = options.setDefault ? await readDefault(prisma, slot) : null;
		console.log(`  previous_default: ${describeDefault(previousDefault)}`);

		if (options.dryRun) {
			console.log("[tuzi-gpt-image2] dry-run, no DB writes performed");
			return;
		}

		const nowIso = new Date().toISOString();
		let disabledMappings = 0;
		await prisma.$transaction(async (tx) => {
			await tx.model_catalog_vendors.upsert({
				where: { key: vendorKey },
				create: {
					key: vendorKey,
					name: vendorName,
					enabled: 1,
					base_url_hint: baseUrl,
					auth_type: "bearer",
					auth_header: null,
					auth_query_param: null,
					api_protocol: API_PROTOCOL,
					meta: JSON.stringify({
						source: "configure-tuzi-gpt-image2",
						mode: "direct-openai-images-endpoints",
					}),
					created_at: nowIso,
					updated_at: nowIso,
				},
				update: {
					name: vendorName,
					enabled: 1,
					base_url_hint: baseUrl,
					auth_type: "bearer",
					auth_header: null,
					auth_query_param: null,
					api_protocol: API_PROTOCOL,
					meta: JSON.stringify({
						source: "configure-tuzi-gpt-image2",
						mode: "direct-openai-images-endpoints",
					}),
					updated_at: nowIso,
				},
			});

			await tx.model_catalog_vendor_api_keys.upsert({
				where: { vendor_key: vendorKey },
				create: {
					vendor_key: vendorKey,
					api_key: apiKey,
					enabled: 1,
					created_at: nowIso,
					updated_at: nowIso,
				},
				update: {
					api_key: apiKey,
					enabled: 1,
					updated_at: nowIso,
				},
			});

			await tx.model_catalog_models.upsert({
				where: {
					vendor_key_model_key: { vendor_key: vendorKey, model_key: model },
				},
				create: {
					vendor_key: vendorKey,
					model_key: model,
					model_alias: modelAlias,
					label_zh: "Tuzi GPT Image 2",
					kind: DEFAULT_KIND,
					enabled: 1,
					meta: imageModelMeta(),
					created_at: nowIso,
					updated_at: nowIso,
				},
				update: {
					model_alias: modelAlias,
					label_zh: "Tuzi GPT Image 2",
					kind: DEFAULT_KIND,
					enabled: 1,
					meta: imageModelMeta(),
					updated_at: nowIso,
				},
			});

			if (options.disableImageMappings) {
				const result = await tx.model_catalog_mappings.updateMany({
					where: {
						vendor_key: vendorKey,
						task_kind: { in: ["text_to_image", "image_edit"] },
						enabled: 1,
					},
					data: {
						enabled: 0,
						updated_at: nowIso,
					},
				});
				disabledMappings = Number(result?.count ?? 0);
			}

			if (options.setDefault) {
				await tx.model_catalog_default_models.upsert({
					where: { slot },
					create: {
						slot,
						vendor_key: vendorKey,
						model_key: model,
						created_at: nowIso,
						updated_at: nowIso,
					},
					update: {
						vendor_key: vendorKey,
						model_key: model,
						updated_at: nowIso,
					},
				});
			}
		});

		const currentDefault = options.setDefault ? await readDefault(prisma, slot) : null;
		const vendor = await prisma.model_catalog_vendors.findUnique({
			where: { key: vendorKey },
			select: {
				key: true,
				enabled: true,
				base_url_hint: true,
				api_protocol: true,
			},
		});
		const modelRow = await prisma.model_catalog_models.findUnique({
			where: {
				vendor_key_model_key: { vendor_key: vendorKey, model_key: model },
			},
			select: {
				vendor_key: true,
				model_key: true,
				model_alias: true,
				kind: true,
				enabled: true,
			},
		});
		const keyRow = await prisma.model_catalog_vendor_api_keys.findUnique({
			where: { vendor_key: vendorKey },
			select: { enabled: true },
		});
		const enabledImageMappings = await prisma.model_catalog_mappings.count({
			where: {
				vendor_key: vendorKey,
				task_kind: { in: ["text_to_image", "image_edit"] },
				enabled: 1,
			},
		});

		console.log("[tuzi-gpt-image2] DB configured");
		console.log(`  current_default: ${describeDefault(currentDefault)}`);
		console.log(`  vendor_enabled: ${vendor?.enabled === 1 ? "yes" : "no"}`);
		console.log(`  vendor_base_url: ${vendor?.base_url_hint || ""}`);
		console.log(`  vendor_api_protocol: ${vendor?.api_protocol || ""}`);
		console.log(`  model_kind: ${modelRow?.kind || ""}`);
		console.log(`  model_alias: ${modelRow?.model_alias || ""}`);
		console.log(`  model_enabled: ${modelRow?.enabled === 1 ? "yes" : "no"}`);
		console.log(`  api_key_enabled: ${keyRow?.enabled === 1 ? "yes" : "no"}`);
		console.log(`  disabled_image_mappings: ${disabledMappings}`);
		console.log(`  enabled_image_mappings_remaining: ${enabledImageMappings}`);

		if (
			!vendor ||
			vendor.enabled !== 1 ||
			vendor.api_protocol !== API_PROTOCOL ||
			!modelRow ||
			modelRow.kind !== DEFAULT_KIND ||
			modelRow.enabled !== 1 ||
			!keyRow ||
			keyRow.enabled !== 1 ||
			(options.setDefault && describeDefault(currentDefault) !== `${vendorKey}/${model}`) ||
			(options.disableImageMappings && enabledImageMappings !== 0)
		) {
			throw new Error("verification failed: DB state does not match expected config.");
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(
		`[tuzi-gpt-image2] failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function resolvePatchDir() {
	const candidates = [
		path.resolve(process.cwd(), "sql/patch"),
		path.resolve(process.cwd(), "../sql/patch"),
		path.resolve(process.cwd(), "../../sql/patch"),
		path.resolve(process.cwd(), "apps/hono-api/sql/patch"),
		path.resolve(process.cwd(), "apps/hono-api/../../sql/patch"),
	];
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) continue;
		if (!fs.statSync(candidate).isDirectory()) continue;
		return candidate;
	}
	return null;
}

function listPatchFiles(dir) {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
		.map((entry) => path.join(dir, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

function stripSqlComments(sql) {
	return sql
		.split("\n")
		.filter((line) => !line.trim().startsWith("--"))
		.join("\n");
}

function normalizePatchStatements(sql) {
	return stripSqlComments(sql)
		.split(";")
		.map((stmt) => stmt.trim())
		.filter((stmt) => stmt.length > 0)
		.filter((stmt) => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmt));
}

function isUnsafeStatement(stmt) {
	const s = normalizeSqlForGuard(stmt).toUpperCase();
	if (!s) return false;
	return (
		/\bDROP\s+(TABLE|INDEX|SCHEMA|DATABASE|COLUMN)\b/.test(s) ||
		/\bTRUNCATE\b/.test(s) ||
		/\bDELETE\s+FROM\b/.test(s) ||
		(/\bALTER\s+TABLE\b/.test(s) && !/\bADD\s+COLUMN\b/.test(s)) ||
		/\bCREATE\s+(SCHEMA|DATABASE)\b/.test(s)
	);
}

function normalizeSqlForGuard(stmt) {
	return stmt.replace(/\s+/g, " ").trim();
}

function isAllowedPatchStatement(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	return (
		/^INSERT\s+INTO\s+/i.test(normalized) ||
		/^UPDATE\s+/i.test(normalized) ||
		/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(normalized) ||
		/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+/i.test(normalized) ||
		/^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN(\s+IF\s+NOT\s+EXISTS)?\s+/i.test(normalized)
	);
}

function validatePatchStatements(filePath, statements) {
	for (const stmt of statements) {
		if (isUnsafeStatement(stmt)) {
			throw new Error(`[seed] unsafe patch statement blocked in ${filePath}: ${stmt}`);
		}
		if (!isAllowedPatchStatement(stmt)) {
			throw new Error(
				`[seed] unsupported patch statement in ${filePath}; only INSERT, UPDATE, CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, or ALTER TABLE ... ADD COLUMN is allowed: ${stmt}`,
			);
		}
	}
}

function isIgnorablePatchError(error) {
	const code = String(error?.code || "");
	if (["42P01", "42703", "42P07", "42710"].includes(code)) return true;
	const message = String(error?.message || error || "");
	return (
		/relation\s+".+"\s+does not exist/i.test(message) ||
		/column\s+".+"\s+does not exist/i.test(message) ||
		/already exists/i.test(message)
	);
}

function describeIgnorablePatchError(error) {
	const code = String(error?.code || "unknown");
	const message = String(error?.message || error || "").replace(/\s+/g, " ").trim();
	return `${code}${message ? ` ${message}` : ""}`;
}

async function executePatchStatement(prisma, filePath, stmt) {
	try {
		await prisma.$executeRawUnsafe(stmt);
		return { applied: true, skipped: false };
	} catch (error) {
		if (!isIgnorablePatchError(error)) {
			throw error;
		}
		console.log(
			`[seed] skipped patch stmt: ${path.basename(filePath)} (${describeIgnorablePatchError(error)})`,
		);
		return { applied: false, skipped: true };
	}
}

async function executePatchFile(prisma, filePath) {
	const raw = fs.readFileSync(filePath, "utf8");
	if (!raw.trim()) {
		console.log(`[seed] skip empty patch: ${path.basename(filePath)}`);
		return { file: filePath, statements: 0, skipped: 0 };
	}
	const statements = normalizePatchStatements(raw);
	validatePatchStatements(filePath, statements);
	if (statements.length === 0) {
		console.log(`[seed] skip no-op patch: ${path.basename(filePath)}`);
		return { file: filePath, statements: 0, skipped: 0 };
	}
	let applied = 0;
	let skipped = 0;
	for (const stmt of statements) {
		const result = await executePatchStatement(prisma, filePath, stmt);
		if (result.applied) applied += 1;
		if (result.skipped) skipped += 1;
	}
	console.log(
		`[seed] applied patch: ${path.basename(filePath)} statements=${applied} skipped=${skipped}`,
	);
	return { file: filePath, statements: applied, skipped };
}

async function main() {
	if (!String(process.env.DATABASE_URL || "").trim()) {
		throw new Error("DATABASE_URL is required for Postgres seed patches");
	}
	const patchDir = resolvePatchDir();
	if (!patchDir) {
		console.log("[seed] sql/patch directory not found, skip");
		return;
	}
	const files = listPatchFiles(patchDir);
	if (files.length === 0) {
		console.log("[seed] no sql patch files found, skip");
		return;
	}

	const prisma = new PrismaClient();
	try {
		let totalStatements = 0;
		let totalSkipped = 0;
		for (const filePath of files) {
			const result = await executePatchFile(prisma, filePath);
			totalStatements += result.statements;
			totalSkipped += result.skipped || 0;
		}
		console.log(
			`[seed] postgres seed patches ready, files=${files.length}, statements=${totalStatements}, skipped=${totalSkipped}`,
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[seed] seed-postgres-patches failed:", error);
	process.exit(1);
});

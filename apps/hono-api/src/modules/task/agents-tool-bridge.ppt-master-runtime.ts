import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { copyFile, link, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { DOMParser } from "@xmldom/xmldom";

import { AppError } from "../../middleware/error";

export type PptMasterRuntimeInfo = {
	available: boolean;
	skillDir: string | null;
	scriptsDir: string | null;
	pythonBin: string;
	reason?: string;
};

export type PptMasterCommandResult = {
	ok: true;
	stdout: string;
	stderr: string;
};

export type PptMasterWorkspaceScope = {
	projectId: string;
	flowId: string;
	nodeId: string;
	workspaceId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePptMasterWorkspaceScope(
	scope: PptMasterWorkspaceScope,
): PptMasterWorkspaceScope {
	const normalized = {
		projectId: scope?.projectId?.trim() || "",
		flowId: scope?.flowId?.trim() || "",
		nodeId: scope?.nodeId?.trim() || "",
		workspaceId: scope?.workspaceId?.trim() || "",
	};
	const invalid = ["projectId", "flowId", "workspaceId"].filter(
		(key) => !UUID_RE.test(normalized[key as "projectId" | "flowId" | "workspaceId"]),
	);
	if (!normalized.nodeId) invalid.push("nodeId");
	if (invalid.length) {
		throw new AppError("PPT Master workspace identity is invalid", {
			status: 409,
			code: "ppt_master_workspace_identity_invalid",
			details: { invalidFields: invalid },
		});
	}
	return normalized;
}

export function resolvePptMasterWorkspaceBaseDir(
	scope: PptMasterWorkspaceScope,
): string {
	const normalized = normalizePptMasterWorkspaceScope(scope);
	const nodeHash = createHash("sha256").update(normalized.nodeId).digest("hex");
	return resolve(
		getPptMasterProjectsRoot(),
		"projects",
		normalized.projectId,
		"flows",
		normalized.flowId,
		"nodes",
		nodeHash,
		"workspaces",
		normalized.workspaceId,
	);
}

export function assertPptMasterProjectOwnedByScope(
	projectPathInput: string,
	scope: PptMasterWorkspaceScope,
): void {
	const projectPath = resolve(projectPathInput || ".");
	const workspaceBaseDir = resolvePptMasterWorkspaceBaseDir(scope);
	const lexicallyOwned = projectPath !== workspaceBaseDir &&
		projectPath.startsWith(`${workspaceBaseDir}${sep}`);
	let realpathOwned = true;
	try {
		if (existsSync(workspaceBaseDir) && existsSync(projectPath)) {
			const workspaceReal = realpathSync(workspaceBaseDir);
			const projectReal = realpathSync(projectPath);
			realpathOwned = projectReal !== workspaceReal &&
				projectReal.startsWith(`${workspaceReal}${sep}`);
		}
	} catch {
		realpathOwned = false;
	}
	if (lexicallyOwned && realpathOwned) return;
	throw new AppError("PPT Master project does not belong to the current workspace", {
		status: 409,
		code: "ppt_master_project_scope_mismatch",
		details: {
			projectId: scope.projectId,
			flowId: scope.flowId,
			nodeId: scope.nodeId,
			workspaceId: scope.workspaceId,
			projectPath,
			workspaceBaseDir,
		},
	});
}

function hasPptMasterScripts(skillDir: string): boolean {
	return existsSync(join(skillDir, "SKILL.md")) &&
		existsSync(join(skillDir, "scripts", "project_manager.py")) &&
		existsSync(join(skillDir, "scripts", "svg_to_pptx.py"));
}

const REPO_ROOT_CANDIDATES = [
	process.env.JARVISHUB_REPO_ROOT,
	process.cwd(),
	resolve(process.cwd(), ".."),
	resolve(process.cwd(), "../.."),
	resolve(process.cwd(), "../../.."),
].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

function vendoredSkillDirCandidates(): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const root of REPO_ROOT_CANDIDATES) {
		const absolute = resolve(root.trim(), "vendor", "ppt-master", "skills", "ppt-master");
		if (seen.has(absolute)) continue;
		seen.add(absolute);
		out.push(absolute);
	}
	return out;
}

export function resolvePptMasterRuntime(): PptMasterRuntimeInfo {
	const pythonBin = readPythonBin();
	const candidates = [
		process.env.PPT_MASTER_HOME,
		process.env.PPT_MASTER_SKILL_DIR,
		...vendoredSkillDirCandidates(),
	].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

	const checked: string[] = [];
	for (const candidate of candidates) {
		const skillDir = resolve(candidate.trim());
		if (!hasPptMasterScripts(skillDir)) {
			checked.push(skillDir);
			continue;
		}
		return {
			available: true,
			skillDir,
			scriptsDir: join(skillDir, "scripts"),
			pythonBin,
		};
	}

	return {
		available: false,
		skillDir: null,
		scriptsDir: null,
		pythonBin,
		reason:
			"PPT Master skill directory not found. Set PPT_MASTER_HOME to <repo>/vendor/ppt-master/skills/ppt-master, " +
			"or run scripts/dev.sh local to auto-clone. Checked: " + checked.join(", "),
	};
}

function readPythonBin(): string {
	return (process.env.PPT_MASTER_PYTHON || "python3").trim() || "python3";
}

async function assertPptMasterPythonSupported(pythonBin: string): Promise<void> {
	const probe = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveProbe, reject) => {
		const child = spawn(
			pythonBin,
			["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
			{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			child.kill("SIGTERM");
			reject(new AppError("PPT Master Python version probe timed out", {
				status: 504,
				code: "ppt_master_python_probe_failed",
				details: { pythonBin, timeoutMs: 5_000 },
			}));
		}, 5_000);

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new AppError("Failed to start PPT Master Python", {
				status: 500,
				code: "ppt_master_spawn_failed",
				details: { pythonBin, message: error.message },
			}));
		});
		child.on("close", (status) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveProbe({ status, stdout, stderr });
		});
	});

	const detectedVersion = probe.stdout.trim();
	const match = detectedVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
	if (probe.status !== 0 || !match) {
		throw new AppError("Failed to detect PPT Master Python version", {
			status: 500,
			code: "ppt_master_python_probe_failed",
			details: {
				pythonBin,
				status: probe.status,
				stdout: detectedVersion,
				stderr: probe.stderr.trim(),
			},
		});
	}
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major < 3 || (major === 3 && minor < 10)) {
		throw new AppError("PPT Master requires Python 3.10 or newer", {
			status: 500,
			code: "ppt_master_python_unsupported",
			details: { pythonBin, detectedVersion, requiredVersion: "3.10+" },
		});
	}
}

async function runPptMasterCommand(
	pythonBin: string,
	args: string[],
	options?: { cwd?: string; timeoutMs?: number },
): Promise<PptMasterCommandResult> {
	await assertPptMasterPythonSupported(pythonBin);
	return new Promise((resolveResult, reject) => {
		const child = spawn(pythonBin, args, {
			cwd: options?.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
		const timeoutMs = Math.max(5_000, Math.min(10 * 60_000, options?.timeoutMs ?? 120_000));
		const timer = setTimeout(() => {
			if (settled) return;
			timedOut = true;
			child.kill("SIGTERM");
			forceKillTimer = setTimeout(() => {
				if (!settled) child.kill("SIGKILL");
			}, 250);
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			if (timedOut) return;
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			reject(new AppError("Failed to start PPT Master command", {
				status: 500,
				code: "ppt_master_spawn_failed",
				details: { pythonBin, message: error.message, args },
			}));
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			if (timedOut) {
				reject(new AppError("PPT Master command timed out", {
					status: 504,
					code: "ppt_master_timeout",
					details: { args, timeoutMs },
				}));
				return;
			}
			if (code !== 0) {
				reject(new AppError("PPT Master command failed", {
					status: 500,
					code: "ppt_master_command_failed",
					details: { pythonBin, code, args, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) },
				}));
				return;
			}
			resolveResult({ ok: true, stdout, stderr });
		});
	});
}

type RequiredRuntime = {
	available: true;
	skillDir: string;
	scriptsDir: string;
	pythonBin: string;
	reason?: string;
};

function requireRuntime(): RequiredRuntime {
	const runtime = resolvePptMasterRuntime();
	if (!runtime.available || !runtime.skillDir || !runtime.scriptsDir) {
		throw new AppError("PPT Master runtime is not configured", {
			status: 400,
			code: "ppt_master_runtime_missing",
			details: runtime,
		});
	}
	return {
		available: true,
		skillDir: runtime.skillDir,
		scriptsDir: runtime.scriptsDir,
		pythonBin: runtime.pythonBin,
		reason: runtime.reason,
	};
}

const projectOperationQueues = new Map<string, Promise<void>>();

export async function serializePptMasterProjectOperation<T>(
	projectPathInput: string,
	operation: () => Promise<T>,
): Promise<T> {
	const projectPath = resolve(projectPathInput);
	const previous = projectOperationQueues.get(projectPath) || Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolveCurrent) => {
		release = resolveCurrent;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	projectOperationQueues.set(projectPath, tail);
	await previous.catch(() => undefined);
	try {
		return await operation();
	} finally {
		release();
		if (projectOperationQueues.get(projectPath) === tail) projectOperationQueues.delete(projectPath);
	}
}

function nearestExistingAncestor(target: string): string {
	let current = resolve(target);
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}

function assertPptMasterInitBaseDirRealpathSafe(baseDir: string, projectsRoot: string): void {
	if (!existsSync(projectsRoot)) return;
	try {
		const rootReal = realpathSync(projectsRoot);
		const ancestorReal = realpathSync(nearestExistingAncestor(baseDir));
		if (ancestorReal === rootReal || ancestorReal.startsWith(`${rootReal}${sep}`)) return;
	} catch {
		// The common error below is intentionally stable for missing and escaping ancestors.
	}
	throw new AppError("baseDir resolves outside PPT_MASTER_PROJECTS_ROOT", {
		status: 400,
		code: "ppt_master_project_outside_root",
		details: { baseDir, root: projectsRoot },
	});
}

export async function initPptMasterProject(input: {
	projectName: string;
	scope: PptMasterWorkspaceScope;
	format?: string;
	timeoutMs?: number;
}): Promise<Record<string, unknown>> {
	const projectsRoot = getPptMasterProjectsRoot();
	const baseDir = resolvePptMasterWorkspaceBaseDir(input.scope);
	const projectName = input.projectName.trim();
	if (!projectName || projectName === "." || projectName === ".." || /[\\/]/.test(projectName)) {
		throw new AppError("projectName must be a plain name without path separators", {
			status: 400,
			code: "invalid_tool_args",
			details: { field: "projectName" },
		});
	}
	const normalizedFormat = normalizePptMasterFormat(input.format || "ppt169");
	const datedSuffix = `_${normalizedFormat}_${localDateStamp()}`;
	const projectDirName = new RegExp(`_${normalizedFormat}_\\d{8}$`).test(projectName)
		? projectName
		: `${projectName}${datedSuffix}`;
	const expectedProjectPath = resolve(baseDir, projectDirName);
	assertPptMasterProjectOwnedByScope(expectedProjectPath, input.scope);
	assertPptMasterInitBaseDirRealpathSafe(baseDir, projectsRoot);
	const runtime = requireRuntime();
	return serializePptMasterProjectOperation(expectedProjectPath, async () => {
		if (existsSync(expectedProjectPath)) {
			if (!isMaterializedPptMasterProject(expectedProjectPath)) {
				throw new AppError("PPT Master project path already exists but is not a valid project", {
					status: 409,
					code: "ppt_master_project_conflict",
					details: { projectPath: expectedProjectPath },
				});
			}
			return {
				ok: true,
				reused: true,
				projectPath: expectedProjectPath,
				projectsRoot,
				baseDir,
				runtime,
				stdout: `Project reused: ${expectedProjectPath}\n`,
				stderr: "",
			};
		}
		try {
			mkdirSync(baseDir, { recursive: true });
		} catch (error) {
			throw new AppError("Failed to create PPT Master projects root", {
				status: 500,
				code: "ppt_master_projects_root_unwritable",
				details: { baseDir, message: error instanceof Error ? error.message : String(error) },
			});
		}
		assertPptMasterInitBaseDirRealpathSafe(baseDir, projectsRoot);
		const args = [
			join(runtime.scriptsDir, "project_manager.py"),
			"init",
			projectDirName,
			"--format",
			normalizedFormat,
			"--dir",
			baseDir,
		];
		const result = await runPptMasterCommand(runtime.pythonBin, args, {
			cwd: runtime.skillDir,
			timeoutMs: input.timeoutMs,
		});
		const projectPath = result.stdout.match(/Project created:\s*(.+)/)?.[1]?.trim() || "";
		if (resolve(projectPath || ".") !== expectedProjectPath) {
			throw new AppError("PPT Master returned an unexpected project path", {
				status: 500,
				code: "ppt_master_project_path_mismatch",
				details: { projectPath, expectedProjectPath, pythonBin: runtime.pythonBin },
			});
		}
		if (!isMaterializedPptMasterProject(projectPath)) {
			throw new AppError("PPT Master project initialization did not materialize a valid project", {
				status: 500,
				code: "ppt_master_project_init_invalid",
				details: { projectPath, projectsRoot, pythonBin: runtime.pythonBin },
			});
		}
		return {
			ok: true,
			reused: false,
			projectPath,
			projectsRoot,
			baseDir,
			runtime,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	});
}

function normalizePptMasterFormat(format: string): string {
	const normalized = format.trim().toLowerCase();
	if (normalized === "xhs") return "xiaohongshu";
	if (["ppt169", "ppt43", "story"].includes(normalized)) return normalized;
	throw new AppError("Unsupported PPT Master format", {
		status: 400,
		code: "invalid_tool_args",
		details: { field: "format", format },
	});
}

function localDateStamp(now = new Date()): string {
	return [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("");
}

export function allocatePptMasterExportOutputPath(projectPath: string): string {
	return resolve(projectPath, "exports", `ppt_export_${randomUUID()}.pptx`);
}

export function resolvePptMasterExportOutputPath(
	projectPath: string,
	expectedOutputPathInput: string,
	stdout: string,
): string {
	const exportsDir = resolve(projectPath, "exports");
	const expectedOutputPath = resolve(expectedOutputPathInput);
	const reportedPath = Array.from(stdout.matchAll(/^\s*Output file:\s*(.+?\.pptx)\s*$/gim))[0]?.[1]?.trim() || "";
	const outputPath = reportedPath ? resolve(reportedPath) : "";
	if (
		!outputPath
		|| expectedOutputPath !== outputPath
		|| !expectedOutputPath.startsWith(`${exportsDir}${sep}`)
		|| !existsSync(outputPath)
	) {
		throw new AppError("PPT Master export did not report a valid output file", {
			status: 500,
			code: "ppt_master_export_output_invalid",
			details: { projectPath, expectedOutputPath, reportedPath },
		});
	}
	try {
		const exportsEntry = lstatSync(exportsDir);
		const outputEntry = lstatSync(outputPath);
		if (
			exportsEntry.isSymbolicLink()
			|| !exportsEntry.isDirectory()
			|| outputEntry.isSymbolicLink()
			|| !outputEntry.isFile()
		) {
			throw new Error("exports and output must be concrete directory/file entries");
		}
		const projectReal = realpathSync(projectPath);
		const exportsReal = realpathSync(exportsDir);
		const outputReal = realpathSync(outputPath);
		if (
			!exportsReal.startsWith(`${projectReal}${sep}`)
			|| !outputReal.startsWith(`${exportsReal}${sep}`)
			|| !statSync(outputReal).isFile()
		) {
			throw new Error("reported output is not a regular file inside exports");
		}
	} catch {
		throw new AppError("PPT Master export output is outside the project exports directory", {
			status: 500,
			code: "ppt_master_export_output_invalid",
			details: { projectPath, expectedOutputPath, reportedPath },
		});
	}
	return outputPath;
}

export type PptMasterSlideArtifact = {
	index: number;
	svgPath: string;
};

function assertConcreteProjectDirectory(
	projectPathInput: string,
	directoryName: string,
	create: boolean,
): string {
	const projectPath = resolve(projectPathInput);
	const directoryPath = join(projectPath, directoryName);
	if (create) mkdirSync(directoryPath, { recursive: true });
	try {
		const entry = lstatSync(directoryPath);
		const projectReal = realpathSync(projectPath);
		const directoryReal = realpathSync(directoryPath);
		if (
			entry.isSymbolicLink()
			|| !entry.isDirectory()
			|| directoryReal !== resolve(projectReal, directoryName)
			|| !directoryReal.startsWith(`${projectReal}${sep}`)
		) {
			throw new Error(`${directoryName} must be a concrete project directory`);
		}
	} catch (error) {
		throw new AppError(`PPT Master ${directoryName} directory is unsafe`, {
			status: 409,
			code: "ppt_master_project_invalid",
			details: {
				projectPath,
				directoryPath,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return directoryPath;
}

export function assertPptMasterSlideArtifactsOwned(
	projectPathInput: string,
	artifactsInput: ReadonlyArray<PptMasterSlideArtifact>,
): PptMasterSlideArtifact[] {
	const projectPath = resolve(projectPathInput);
	const artifactsDir = assertConcreteProjectDirectory(projectPath, "svg_artifacts", false);
	if (!artifactsInput.length) {
		throw new AppError("PPT Master export requires persisted SVG artifacts", {
			status: 409,
			code: "ppt_master_slide_artifact_invalid",
			details: { projectPath },
		});
	}
	const seenIndexes = new Set<number>();
	const normalized = artifactsInput.map((artifact) => {
		const index = Number(artifact?.index);
		const svgPath = resolve(artifact?.svgPath || ".");
		const fileName = basename(svgPath);
		const expectedPrefix = `${String(index).padStart(2, "0")}_slide_`;
		if (
			!Number.isInteger(index)
			|| index < 1
			|| index > 99
			|| seenIndexes.has(index)
			|| !fileName.startsWith(expectedPrefix)
			|| !/^[0-9a-f]{64}\.svg$/i.test(fileName.slice(expectedPrefix.length))
			|| dirname(svgPath) !== artifactsDir
		) {
			throw new AppError("PPT Master slide artifact identity is invalid", {
				status: 409,
				code: "ppt_master_slide_artifact_invalid",
				details: { projectPath, index, svgPath },
			});
		}
		seenIndexes.add(index);
		try {
			const entry = lstatSync(svgPath);
			if (entry.isSymbolicLink() || !entry.isFile()) {
				throw new Error("artifact must be a concrete file inside svg_artifacts");
			}
			const artifactsReal = realpathSync(artifactsDir);
			const artifactReal = realpathSync(svgPath);
			if (
				dirname(artifactReal) !== artifactsReal
				|| !statSync(artifactReal).isFile()
			) {
				throw new Error("artifact must be a concrete file inside svg_artifacts");
			}
			const expectedDigest = fileName.slice(expectedPrefix.length, -".svg".length).toLowerCase();
			const actualDigest = createHash("sha256").update(readFileSync(artifactReal)).digest("hex");
			if (actualDigest !== expectedDigest) {
				throw new Error("artifact bytes do not match the content-addressed filename");
			}
		} catch (error) {
			throw new AppError("PPT Master slide artifact is missing or unsafe", {
				status: 409,
				code: "ppt_master_slide_artifact_invalid",
				details: {
					projectPath,
					index,
					svgPath,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		}
		return { index, svgPath };
	});
	return normalized.sort((left, right) => left.index - right.index);
}

export async function exportPptMasterProject(input: {
	projectPath: string;
	scope: PptMasterWorkspaceScope;
	slideArtifacts: ReadonlyArray<PptMasterSlideArtifact>;
	timeoutMs?: number;
}): Promise<Record<string, unknown>> {
	const projectPath = resolve(input.projectPath);
	if (!isPathInsideConfiguredProjectsRoot(projectPath)) {
		throw new AppError("projectPath must live inside PPT_MASTER_PROJECTS_ROOT", {
			status: 400,
			code: "ppt_master_project_outside_root",
			details: { projectPath, root: getPptMasterProjectsRoot() },
		});
	}
	assertPptMasterProjectOwnedByScope(projectPath, input.scope);
	if (!isMaterializedPptMasterProject(projectPath)) {
		throw new AppError("projectPath is not an initialized PPT Master project", {
			status: 409,
			code: "ppt_master_project_invalid",
			details: { projectPath },
		});
	}
	const runtime = requireRuntime();
	return serializePptMasterProjectOperation(projectPath, async () => {
		const slideArtifacts = assertPptMasterSlideArtifactsOwned(projectPath, input.slideArtifacts);
		const sourceDirectoryName = `export_source_${randomUUID()}`;
		const sourceDirectory = join(projectPath, sourceDirectoryName);
		mkdirSync(sourceDirectory);
		try {
			const sourceEntry = lstatSync(sourceDirectory);
			if (sourceEntry.isSymbolicLink() || !sourceEntry.isDirectory()) {
				throw new AppError("PPT Master export snapshot directory is unsafe", {
					status: 409,
					code: "ppt_master_project_invalid",
				});
			}
			for (const artifact of slideArtifacts) {
				const fileName = `${String(artifact.index).padStart(2, "0")}_slide.svg`;
				await copyFile(artifact.svgPath, join(sourceDirectory, fileName), constants.COPYFILE_EXCL);
			}
			const expectedOutputPath = allocatePptMasterExportOutputPath(projectPath);
			const args = [
				join(runtime.scriptsDir, "svg_to_pptx.py"),
				projectPath,
				"-s",
				sourceDirectoryName,
				"-o",
				expectedOutputPath,
			];
			const result = await runPptMasterCommand(runtime.pythonBin, args, {
				cwd: runtime.skillDir,
				timeoutMs: input.timeoutMs ?? 300_000,
			});
			const exportsDir = join(projectPath, "exports");
			const pptxPath = resolvePptMasterExportOutputPath(projectPath, expectedOutputPath, result.stdout);
			return {
				ok: true,
				projectPath,
				pptxPath,
				exportsDir,
				runtime,
				stdout: result.stdout,
				stderr: result.stderr,
			};
		} finally {
			await rm(sourceDirectory, { recursive: true, force: true });
		}
	});
}

function vendoredProjectsRootCandidates(): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const root of REPO_ROOT_CANDIDATES) {
		const absolute = resolve(root.trim(), "var", "ppt-master-projects");
		if (seen.has(absolute)) continue;
		seen.add(absolute);
		out.push(absolute);
	}
	return out;
}

export function getPptMasterProjectsRoot(): string {
	const envRoot = process.env.PPT_MASTER_PROJECTS_ROOT;
	if (envRoot && envRoot.trim()) return resolve(envRoot.trim());
	const [vendored] = vendoredProjectsRootCandidates();
	return vendored || resolve("./var/ppt-master-projects");
}

export function isPathInsideConfiguredProjectsRoot(target: string): boolean {
	if (!target) return false;
	const abs = resolve(target);
	const root = resolve(getPptMasterProjectsRoot());
	return abs === root || abs.startsWith(`${root}${sep}`);
}

/**
 * The smallest on-disk contract shared by project_init and SVG writing.
 * README.md and svg_output are upstream validation requirements; svg_final is
 * additionally required by this integration's write tool.
 */
export function isMaterializedPptMasterProject(target: string): boolean {
	if (!isPathInsideConfiguredProjectsRoot(target)) return false;
	const projectPath = resolve(target);
	if (projectPath === resolve(getPptMasterProjectsRoot())) return false;
	try {
		const rootReal = realpathSync(getPptMasterProjectsRoot());
		const projectReal = realpathSync(projectPath);
		if (projectReal === rootReal || !projectReal.startsWith(`${rootReal}${sep}`)) return false;
		const required = [
			[projectPath, "directory"],
			[join(projectPath, "README.md"), "file"],
			[join(projectPath, "svg_output"), "directory"],
			[join(projectPath, "svg_final"), "directory"],
		] as const;
		return required.every(([path, kind]) => {
			const entry = lstatSync(path);
			if (entry.isSymbolicLink()) return false;
			return kind === "file" ? entry.isFile() : entry.isDirectory();
		});
	} catch {
		return false;
	}
}

export type WriteSlideSvgInput = {
	projectPath: string;
	scope: PptMasterWorkspaceScope;
	slideIndex: number;
	svg: string;
};

export type WriteSlideSvgResult = {
	ok: true;
	slideIndex: number;
	fileName: string;
	absolutePath: string;
	bytes: number;
};

const SVG_MAX_BYTES = 256 * 1024;

export function validatePptMasterSvgMarkup(svg: string): string {
	const svgTrim = (svg ?? "").trim();
	if (!svgTrim.toLowerCase().startsWith("<svg")) {
		throw new AppError("svg payload must start with <svg>", {
			status: 400,
			code: "invalid_tool_args",
			details: { field: "svg" },
		});
	}
	if (Buffer.byteLength(svgTrim, "utf8") > SVG_MAX_BYTES) {
		throw new AppError(`svg payload exceeds ${SVG_MAX_BYTES} bytes`, {
			status: 413,
			code: "ppt_master_svg_too_large",
		});
	}
	if (/<script[\s>]/i.test(svgTrim)) {
		throw new AppError("svg payload may not contain <script>", {
			status: 400,
			code: "ppt_master_svg_unsafe",
		});
	}
	const xmlErrors: string[] = [];
	const document = new DOMParser({
		errorHandler: {
			warning: (message) => xmlErrors.push(String(message)),
			error: (message) => xmlErrors.push(String(message)),
			fatalError: (message) => xmlErrors.push(String(message)),
		},
	}).parseFromString(svgTrim, "image/svg+xml");
	const rootName = document.documentElement?.localName || document.documentElement?.nodeName || "";
	const rootNamespace = document.documentElement?.namespaceURI || "";
	const namespaceValid = !rootNamespace || rootNamespace === "http://www.w3.org/2000/svg";
	if (xmlErrors.length || rootName !== "svg" || !namespaceValid) {
		throw new AppError("svg payload must be well-formed XML with an <svg> root", {
			status: 400,
			code: "ppt_master_svg_invalid",
			details: {
				reason: xmlErrors[0] ||
					(rootName !== "svg"
						? `unexpected root element: ${rootName || "missing"}`
						: `unexpected SVG namespace: ${rootNamespace}`),
			},
		});
	}

	const forbiddenElements = new Set(["script", "foreignobject", "iframe", "object", "embed"]);
	const unsafeValue = /(?:javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|expression\s*\(|@import\b)/i;
	const rejectUnsafe = (reason: string): never => {
		throw new AppError("svg payload contains active content", {
			status: 400,
			code: "ppt_master_svg_unsafe",
			details: { reason },
		});
	};
	const inspectElement = (element: {
		localName?: string | null;
		nodeName?: string | null;
		textContent?: string | null;
		attributes?: { length: number; item(index: number): { name?: string; nodeName?: string; value?: string | null; nodeValue?: string | null } | null } | null;
		firstChild?: unknown;
	}): void => {
		const elementName = String(element.localName || element.nodeName || "").toLowerCase();
		if (forbiddenElements.has(elementName)) rejectUnsafe(`forbidden element: ${elementName}`);
		if (elementName === "style" && unsafeValue.test(String(element.textContent || ""))) {
			rejectUnsafe("active CSS content");
		}

		const attributes = element.attributes;
		for (let index = 0; attributes && index < attributes.length; index += 1) {
			const attribute = attributes.item(index);
			if (!attribute) continue;
			const attributeName = String(attribute.name || attribute.nodeName || "").toLowerCase();
			const attributeValue = String(attribute.value ?? attribute.nodeValue ?? "");
			if (attributeName.startsWith("on")) rejectUnsafe(`event attribute: ${attributeName}`);
			if (unsafeValue.test(attributeValue)) rejectUnsafe(`active attribute value: ${attributeName}`);
		}

		let child = element.firstChild as {
			nodeType?: number;
			localName?: string | null;
			nodeName?: string | null;
			textContent?: string | null;
			attributes?: { length: number; item(index: number): { name?: string; nodeName?: string; value?: string | null; nodeValue?: string | null } | null } | null;
			firstChild?: unknown;
			nextSibling?: unknown;
		} | null;
		while (child) {
			if (child.nodeType === 1) inspectElement(child);
			child = child.nextSibling as typeof child;
		}
	};
	inspectElement(document.documentElement);
	return svgTrim;
}

export function validatePptMasterSlideSvgInput(
	input: Pick<WriteSlideSvgInput, "slideIndex" | "svg">,
): { slideIndex: number; svg: string } {
	const idx = Number(input.slideIndex);
	if (!Number.isInteger(idx) || idx < 1 || idx > 99) {
		throw new AppError("slideIndex must be an integer between 1 and 99", {
			status: 400,
			code: "invalid_tool_args",
			details: { field: "slideIndex" },
		});
	}
	return { slideIndex: idx, svg: validatePptMasterSvgMarkup(input.svg) };
}

export async function writePptMasterSlideSvg(
	input: WriteSlideSvgInput,
): Promise<WriteSlideSvgResult> {
	const { slideIndex: idx, svg: svgTrim } = validatePptMasterSlideSvgInput(input);
	const projectPath = resolve(input.projectPath || "");
	return serializePptMasterProjectOperation(projectPath, async () => {
		if (!isPathInsideConfiguredProjectsRoot(projectPath)) {
			throw new AppError("projectPath must live inside PPT_MASTER_PROJECTS_ROOT", {
				status: 400,
				code: "ppt_master_project_outside_root",
				details: { projectPath, root: getPptMasterProjectsRoot() },
			});
		}
		assertPptMasterProjectOwnedByScope(projectPath, input.scope);
		if (!existsSync(projectPath)) {
			throw new AppError("projectPath does not exist on disk", {
				status: 404,
				code: "ppt_master_project_missing",
				details: { projectPath },
			});
		}
		if (!isMaterializedPptMasterProject(projectPath)) {
			throw new AppError("projectPath is not an initialized PPT Master project", {
				status: 409,
				code: "ppt_master_project_invalid",
				details: { projectPath },
			});
		}

		const finalSvg = svgTrim.endsWith("\n") ? svgTrim : `${svgTrim}\n`;
		const digest = createHash("sha256").update(finalSvg).digest("hex");
		const fileName = `${String(idx).padStart(2, "0")}_slide_${digest}.svg`;
		const artifactsDir = assertConcreteProjectDirectory(projectPath, "svg_artifacts", true);
		const targetPath = join(artifactsDir, fileName);
		const tempPath = join(artifactsDir, `.${fileName}.${randomUUID()}.tmp`);
		try {
			await writeFile(tempPath, finalSvg, { encoding: "utf8", flag: "wx" });
			try {
				await link(tempPath, targetPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
				const targetEntry = lstatSync(targetPath);
				if (
					targetEntry.isSymbolicLink()
					|| !targetEntry.isFile()
					|| readFileSync(targetPath, "utf8") !== finalSvg
				) {
					throw new AppError("Existing PPT Master slide artifact does not match its content hash", {
						status: 409,
						code: "ppt_master_slide_artifact_invalid",
						details: { projectPath, slideIndex: idx, targetPath },
					});
				}
			}
		} finally {
			await unlink(tempPath).catch(() => undefined);
		}

		return {
			ok: true,
			slideIndex: idx,
			fileName,
			absolutePath: targetPath,
			bytes: Buffer.byteLength(finalSvg, "utf8"),
		};
	});
}

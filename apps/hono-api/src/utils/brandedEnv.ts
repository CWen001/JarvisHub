const PREFIX = "JARVISHUB_";
const LEGACY_PREFIX = "TAPCANVAS_";

export function readBrandedEnv(env: unknown, suffix: string): string {
	if (!env || typeof env !== "object") return "";
	const record = env as Record<string, unknown>;
	const value = record[PREFIX + suffix];
	if (typeof value === "string" && value.trim()) return value.trim();
	return "";
}

export function readBrandedProcessEnv(suffix: string): string {
	return readBrandedEnv(process.env, suffix);
}

export function readBrandedEnvBool(env: unknown, suffix: string): boolean {
	const raw = readBrandedEnv(env, suffix).toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

let warnedLegacyEnvKeys = false;

export function warnIfLegacyBrandedEnvKeysPresent(env: unknown = process.env): void {
	if (warnedLegacyEnvKeys) return;
	if (!env || typeof env !== "object") return;
	const legacyKeys = Object.keys(env as Record<string, unknown>).filter((k) =>
		k.startsWith(LEGACY_PREFIX),
	);
	if (legacyKeys.length === 0) return;
	warnedLegacyEnvKeys = true;
	const renamed = legacyKeys.map((k) => `${k} → ${PREFIX}${k.slice(LEGACY_PREFIX.length)}`);
	// eslint-disable-next-line no-console
	console.warn(
		`[env] ignoring ${legacyKeys.length} legacy ${LEGACY_PREFIX}* env key(s); rename to ${PREFIX}*:\n  ${renamed.join("\n  ")}`,
	);
}

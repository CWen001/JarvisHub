import type { WorkerEnv } from "./types";

export type AppConfig = {
	jwtSecret: string;
	loginUrl: string | null;
};

export function getConfig(env: WorkerEnv): AppConfig {
	return {
		jwtSecret: env.JWT_SECRET || "dev-secret",
		loginUrl: env.LOGIN_URL ?? null,
	};
}

import type { Context } from "hono";
import type {
	DurableObjectNamespace as CloudflareDurableObjectNamespace,
	Queue,
} from "@cloudflare/workers-types";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";
export type DurableObjectNamespace = CloudflareDurableObjectNamespace;
export type D1Database = PrismaClientType;

export type WorkerEnv = Record<string, unknown> & {
	DB: PrismaClientType;
	// Workflow engine bindings (Cloudflare)
	EXECUTION_DO?: CloudflareDurableObjectNamespace;
	WORKFLOW_NODE_QUEUE?: Queue;
	JWT_SECRET: string;
	// Internal ops endpoints (self-host helpers)
	INTERNAL_WORKER_TOKEN?: string;
	LOGIN_URL?: string;
	REDIS_URL?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
	// Object storage (Cloudflare R2 / RustFS-compatible S3) credentials
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ENDPOINT_URL?: string;
	R2_REGION?: string;
	R2_BUCKET?: string;
	R2_BUCKET_URL?: string;
	R2_PUBLIC_BASE_URL?: string;
	RUSTFS_ACCESS_KEY_ID?: string;
	RUSTFS_SECRET_ACCESS_KEY?: string;
	RUSTFS_ENDPOINT_URL?: string;
	RUSTFS_REGION?: string;
	RUSTFS_BUCKET?: string;
	RUSTFS_PUBLIC_BASE_URL?: string;
	// Local debug: HTTP request/response logging (stdout; use `pnpm dev:log` to tee into log.txt)
	DEBUG_HTTP_LOG?: string;
	DEBUG_HTTP_LOG_UNSAFE?: string;
	DEBUG_HTTP_LOG_BODY_LIMIT?: string;
	// Optional: Public API vendor routing preference config (JSON string)
	PUBLIC_VENDOR_ROUTING?: string;
	// Optional: fixed APIMart image generation/edit path for local/simple deployments
	APIMART_IMAGE_API_KEY?: string;
	APIMART_API_KEY?: string;
	APIMART_GEMINI_API_KEY?: string;
		APIMART_API_BASE?: string;
		APIMART_IMAGE_MODEL?: string;
		JARVISHUB_FIXED_IMAGE_VENDOR?: string;
		JARVISHUB_FIXED_IMAGE_MODEL?: string;
		JARVISHUB_SEEDANCE2_VIDEO_VENDOR?: string;
		JARVISHUB_SEEDANCE2_VIDEO_MODEL?: string;
		SEEDANCE_ARK_API_KEY?: string;
		SEEDANCE_ARK_API_BASE?: string;
	// Optional: Local agents HTTP bridge (dev / sidecar)
	AGENTS_BRIDGE_BASE_URL?: string;
	AGENTS_BRIDGE_TOKEN?: string;
	AGENTS_BRIDGE_TIMEOUT_MS?: string;
	API_INTERNAL_BASE?: string;
	CANVAS_API_BASE_URL?: string;
	// Optional: JarvisHub upstream config for agents bridge tools
	JARVISHUB_API_BASE_URL?: string;
	JARVISHUB_API_KEY?: string;
	AGENTS_BRIDGE_USE_REQUEST_AUTH?: string;
	TASK_LOCAL_MODE?: string;
	TASK_LOCAL_ROOT?: string;
	TASK_LOCAL_EXEC_TIMEOUT_MS?: string;
	TASK_LOCAL_GENERATOR_BIN?: string;
	TASK_LOCAL_GENERATOR_ARGS_JSON?: string;
	TASK_LOCAL_GENERATOR_TIMEOUT_MS?: string;
	TASK_LOCAL_GENERATOR_MODE?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_USER_ID?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_VENDOR?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_MODEL_ALIAS?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_ASPECT_RATIO?: string;
	TASK_LOCAL_GENERATOR_POLL_INTERVAL_MS?: string;
	TASK_LOCAL_PROMPT_AGENT_MODEL_ALIAS?: string;
	TASK_LOCAL_PROMPT_AGENT_USER_ID?: string;
	// Local dev: allow /public auth bypass on loopback with explicit secret header.
	JARVISHUB_DEV_PUBLIC_BYPASS?: string;
	JARVISHUB_DEV_PUBLIC_BYPASS_SECRET?: string;
	JARVISHUB_DEV_PUBLIC_BYPASS_USER_ID?: string;
	JARVISHUB_DEV_PUBLIC_BYPASS_ROLE?: string;
		ASSET_HOSTING_DISABLED?: string;
	};

export type AppEnv = {
	Bindings: WorkerEnv;
	Variables: {
		userId?: string;
		auth?: unknown;
		apiKeyId?: string;
		apiKeyOwnerId?: string;
		requestId?: string;
		traceStartedAtMs?: number;
		traceStage?: string;
		traceEvents?: unknown;
		publicApi?: boolean;
		devPublicBypass?: boolean;
		// Public API routing hints (set by /public endpoints)
		routingTaskKind?: string;
		proxyVendorHint?: string;
		proxyDisabled?: boolean;
	};
};

export type AppContext = Context<AppEnv>;

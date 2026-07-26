import type { Next } from "hono";
import type { AppContext } from "../types";
import { getConfig } from "../config";
import { getCookie } from "hono/cookie";
import { verifyJwtHS256 } from "../jwt";
import { isLocalDevRequest, resolveLocalDevRole } from "../modules/auth/local-admin";
import { OPEN_WORKSPACE_USER_ID } from "../modules/auth/open-workspace-data-scope";

export type AuthPayload = {
	sub: string;
	login: string;
	name?: string;
	avatarUrl?: string | null;
	email?: string | null;
	phone?: string | null;
	hasPassword?: boolean;
	role?: string | null;
	guest?: boolean;
};

export { OPEN_WORKSPACE_USER_ID };

function createOpenWorkspacePayload(): AuthPayload {
	return {
		sub: OPEN_WORKSPACE_USER_ID,
		login: OPEN_WORKSPACE_USER_ID,
		name: "Local Workspace",
		role: "admin",
		guest: false,
	};
}

export function readAuthToken(c: AppContext): string | null {
	const authHeader = c.req.header("Authorization") || "";
	const headerToken = authHeader.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: null;
	const cookieToken = getCookie(c, "jh_token") || null;
	return headerToken || cookieToken;
}

export async function resolveAuth(
	c: AppContext,
): Promise<{ token: string; payload: AuthPayload } | null> {
	if (isLocalDevRequest(c)) {
		return { token: OPEN_WORKSPACE_USER_ID, payload: createOpenWorkspacePayload() };
	}

	const token = readAuthToken(c);
	if (!token) return null;

	const config = getConfig(c.env);

	const payload = await verifyJwtHS256<AuthPayload>(
		token,
		config.jwtSecret,
	);

	if (!payload || !payload.sub) {
		return null;
	}

	return { token, payload };
}

export async function authMiddleware(c: AppContext, next: Next) {
	const resolved = await resolveAuth(c);

	if (!resolved) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	c.set("userId", resolved.payload.sub);
	c.set("auth", {
		...resolved.payload,
		role: resolveLocalDevRole(c, resolved.payload.role),
	});

	return next();
}

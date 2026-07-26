import { Hono } from "hono";
import { getConfig } from "../../config";
import { resolveAuth, type AuthPayload } from "../../middleware/auth";
import type { AppContext, AppEnv } from "../../types";

export const authRuntimeRouter = new Hono<AppEnv>();

function normalizeRedirectTarget(
	raw: string | null,
	base?: string | null,
): string | null {
	if (!raw) return null;
	try {
		const candidate = base ? new URL(raw, base) : new URL(raw);
		return candidate.protocol === "http:" || candidate.protocol === "https:"
			? candidate.toString()
			: null;
	} catch {
		return null;
	}
}

function buildLoginRedirectUrl(
	loginUrl: string | null,
	redirectTarget: string | null,
): string | null {
	if (!loginUrl) return null;
	try {
		const url = new URL(loginUrl);
		if (redirectTarget) url.searchParams.set("redirect", redirectTarget);
		return url.toString();
	} catch {
		if (!redirectTarget) return loginUrl;
		const separator = loginUrl.includes("?") ? "&" : "?";
		return `${loginUrl}${separator}redirect=${encodeURIComponent(redirectTarget)}`;
	}
}

function appendAuthParams(
	redirectTarget: string,
	token: string,
	user: AuthPayload,
): string | null {
	try {
		const url = new URL(redirectTarget);
		url.searchParams.set("jh_token", token);
		url.searchParams.set("jh_user", encodeURIComponent(JSON.stringify(user)));
		return url.toString();
	} catch {
		return null;
	}
}

authRuntimeRouter.get("/session", async (c) => {
	const config = getConfig(c.env);
	const requestedRedirect =
		c.req.query("redirect") || c.req.query("redirect_uri") || null;
	const normalizedRedirect = normalizeRedirectTarget(
		requestedRedirect,
		config.loginUrl ?? c.req.url,
	);

	const resolved = await resolveAuth(c);
	if (resolved) {
		if (normalizedRedirect) {
			const redirectWithAuth = appendAuthParams(
				normalizedRedirect,
				resolved.token,
				resolved.payload,
			);
			if (redirectWithAuth) return c.redirect(redirectWithAuth, 302);
		}
		return c.json({
			authenticated: true,
			token: resolved.token,
			user: resolved.payload,
		});
	}

	const loginRedirect = buildLoginRedirectUrl(config.loginUrl, normalizedRedirect);
	if (loginRedirect && normalizedRedirect) return c.redirect(loginRedirect, 302);
	if (loginRedirect) {
		return c.json(
			{ authenticated: false, error: "Unauthorized", loginUrl: loginRedirect },
			401,
		);
	}
	return c.json({ authenticated: false, error: "Unauthorized" }, 401);
});

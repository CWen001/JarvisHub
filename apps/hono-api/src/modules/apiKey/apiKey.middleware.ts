import type { Next } from "hono";
import type { AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";

export async function apiKeyAuthMiddleware(c: AppContext, next: Next) {
	return authMiddleware(c, next);
}

import type { AppContext } from "../../types";

function isLocalDevRequest(c: AppContext): boolean {
	try {
		const url = new URL(c.req.url);
		const host = url.hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

export function isAdminRequest(c: AppContext): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth");
	if (!auth || typeof auth !== "object") return false;
	const role = "role" in auth ? auth.role : null;
	return role === "admin";
}

import type { MemoryEntry, MemoryStoreKind } from "../memory/store.js";

type SyncPayload =
  | { action: "save"; entry: MemoryEntry; scopeType?: "user" | "project" }
  | { action: "forget"; ids: string[] };

function mapStoreToMemoryType(store: MemoryStoreKind): string {
  switch (store) {
    case "core": return "preference";
    case "procedural": return "feedback";
    case "vault": return "reference";
    case "episodic": return "fact";
    case "semantic": return "fact";
  }
}

export function syncToRemoteMemory(
  meta: Record<string, unknown> | undefined,
  payload: SyncPayload,
): void {
  if (!meta) return;
  const url = typeof meta.memorySyncUrl === "string" ? meta.memorySyncUrl.trim() : "";
  const userId = typeof meta.userId === "string" ? meta.userId.trim() : "";
  if (!url || !userId) return;

  const projectId = typeof meta.memorySyncProjectId === "string" ? meta.memorySyncProjectId.trim() : "";
  const remoteToolConfig = meta.remoteToolConfig as { authToken?: string } | undefined;
  const authToken = typeof remoteToolConfig?.authToken === "string" ? remoteToolConfig.authToken : "";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
  }

  if (payload.action === "save") {
    const { entry } = payload;
    const explicitScope = payload.scopeType;
    const scopeType = explicitScope ?? (projectId ? "project" : "user");
    const scopeId = scopeType === "user" ? userId : (projectId || userId);

    void fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entries: [{
          scopeType,
          scopeId,
          memoryType: mapStoreToMemoryType(entry.store),
          title: entry.title || entry.content.slice(0, 60),
          summaryText: entry.content.slice(0, 2000),
          content: { text: entry.content.slice(0, 10000), cliId: entry.id, store: entry.store, source: entry.source },
          sourceKind: "agent_output" as const,
          importance: entry.importance,
          tags: [`cli:${entry.id}`, ...entry.tags.slice(0, 19)],
          status: "active" as const,
        }],
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn(`[memory-sync] save failed ${res.status} ${url}: ${text.slice(0, 200)}`);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[memory-sync] save error ${url}: ${message}`);
      });

    return;
  }

  if (payload.action === "forget") {
    const baseUrl = url.replace(/\/memory\/write$/, "");
    const searchUrl = `${baseUrl}/memory/search`;
    const patchUrl = `${baseUrl}/memory/entry`;

    for (const cliId of payload.ids) {
      void (async () => {
        try {
          const scopes: Array<{ scopeType: string; scopeId: string }> = [{ scopeType: "user", scopeId: userId }];
          if (projectId) scopes.push({ scopeType: "project", scopeId: projectId });

          const searchRes = await fetch(searchUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ tags: [`cli:${cliId}`], scopes, limit: 1 }),
          });
          if (!searchRes.ok) {
            const text = await searchRes.text().catch(() => "");
            console.warn(`[memory-sync] forget search failed ${searchRes.status} ${searchUrl}: ${text.slice(0, 200)}`);
            return;
          }
          const data = (await searchRes.json()) as { items?: Array<{ id: string }> };
          const match = data.items?.[0];
          if (!match) return;

          const patchRes = await fetch(patchUrl, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ id: match.id, status: "archived" }),
          });
          if (!patchRes.ok) {
            const text = await patchRes.text().catch(() => "");
            console.warn(`[memory-sync] forget patch failed ${patchRes.status} ${patchUrl}: ${text.slice(0, 200)}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[memory-sync] forget error cliId=${cliId}: ${message}`);
        }
      })();
    }
  }
}

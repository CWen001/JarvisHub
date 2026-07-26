import React, { useCallback, useEffect, useState } from "react";
import { ActionIcon, AppShell, Button, Code, Group, Loader, ScrollArea, Stack, Switch, Text, TextInput } from "@mantine/core";
import type { TraceTreeView } from "../../shared/runView";
import { fetchJson, type LoadState } from "./api";
import { SessionsPanel } from "./sessions/SessionsPanel";
import { RawEvents } from "./timeline/RawEvents";
import { Timeline } from "./timeline/Timeline";

interface SessionSummary {
  sessionId: string;
  runCount: number;
  lastTs: string;
  lastPromptPreview: string;
}

interface RawPage {
  events: unknown[];
  nextCursor?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [sessions, setSessions] = useState<LoadState<SessionSummary[]>>({ status: "loading" });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [view, setView] = useState<LoadState<TraceTreeView> | null>(null);
  const [viewVersion, setViewVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [rawPage, setRawPage] = useState<RawPage>({ events: [] });
  const [rawLoading, setRawLoading] = useState(false);
  const [payloadPreview, setPayloadPreview] = useState<string | null>(null);

  const loadSessions = useCallback(async (showLoading = true) => {
    if (showLoading) setSessions({ status: "loading" });
    try { setSessions({ status: "ready", data: await fetchJson<SessionSummary[]>("/api/sessions") }); }
    catch (error) { setSessions({ status: "error", message: errorMessage(error) }); }
  }, []);

  useEffect(() => {
    void loadSessions();
    void fetchJson<any[]>("/api/projects").then((data) => {
      const map: Record<string, string> = {};
      for (const project of data) map[project.id] = project.name;
      setProjects(map);
    }).catch(() => {});
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedRunId) { setView(null); return; }
    const controller = new AbortController();
    setView({ status: "loading" });
    fetchJson<TraceTreeView>(`/api/runs/${encodeURIComponent(selectedRunId)}/view`, { signal: controller.signal })
      .then((data) => setView({ status: "ready", data }))
      .catch((error) => {
        if ((error as Error)?.name !== "AbortError") setView({ status: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [selectedRunId, viewVersion]);

  const loadRaw = useCallback(async (cursor = 0) => {
    if (!selectedRunId) return;
    setRawLoading(true);
    try {
      const page = await fetchJson<RawPage>(`/api/runs/${encodeURIComponent(selectedRunId)}/events?cursor=${cursor}&limit=200`);
      setRawPage((previous) => ({ events: cursor ? [...previous.events, ...page.events] : page.events, nextCursor: page.nextCursor }));
    } finally { setRawLoading(false); }
  }, [selectedRunId]);

  useEffect(() => {
    setRawPage({ events: [] });
    setPayloadPreview(null);
    if (showRaw && selectedRunId) void loadRaw(0);
  }, [showRaw, selectedRunId, loadRaw]);

  useEffect(() => {
    if (!live) return;
    const source = new EventSource("/api/catalog/stream");
    source.addEventListener("catalog.changed", () => { void loadSessions(false); });
    return () => source.close();
  }, [live, loadSessions]);

  useEffect(() => {
    if (!live || !selectedRunId) return;
    const source = new EventSource(`/api/runs/${encodeURIComponent(selectedRunId)}/stream`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("run.changed", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.rootRunId !== selectedRunId) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setViewVersion((value) => value + 1), 150);
      } catch { /* ignore malformed invalidation */ }
    });
    return () => { if (timer) clearTimeout(timer); source.close(); };
  }, [live, selectedRunId]);

  const openPayload = useCallback(async (ref: string) => {
    if (!selectedRunId) return;
    try {
      const payload = await fetchJson<unknown>(`/api/runs/${encodeURIComponent(selectedRunId)}/payload?ref=${encodeURIComponent(ref)}`);
      setPayloadPreview(JSON.stringify(payload, null, 2));
    } catch (error) { setPayloadPreview(errorMessage(error)); }
  }, [selectedRunId]);

  return <AppShell navbar={{ width: 300, breakpoint: "sm" }} header={{ height: 50 }} padding="md">
    <AppShell.Header><Group className="trace-viewer-header" h="100%" px="md" justify="space-between">
      <Text fw={700} size="lg">Trace Viewer</Text>
      <Group gap="sm">
        <TextInput className="trace-search-input" placeholder="Search messages..." size="xs" value={search} onChange={(event) => setSearch(event.currentTarget.value)} style={{ width: 200 }} />
        <Switch className="trace-live-toggle" label="Live" checked={live} onChange={(event) => setLive(event.currentTarget.checked)} size="xs" />
        <Switch className="trace-raw-toggle" label="Raw" checked={showRaw} onChange={(event) => setShowRaw(event.currentTarget.checked)} size="xs" />
        <ActionIcon variant="subtle" size="sm" aria-label="Refresh" onClick={() => { void loadSessions(); setViewVersion((value) => value + 1); }}>↻</ActionIcon>
      </Group>
    </Group></AppShell.Header>

    <AppShell.Navbar p="xs"><ScrollArea className="trace-sessions-scroll"><SessionsPanel
      sessions={sessions} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} projects={projects}
      eventsLoading={view?.status === "loading"} onRetry={() => { void loadSessions(); }}
    /></ScrollArea></AppShell.Navbar>

    <AppShell.Main>
      {!selectedRunId && <Text className="trace-empty-state" c="dimmed" ta="center" mt="xl">Select a run from the left panel to view its trace</Text>}
      {selectedRunId && view?.status === "loading" && <Group justify="center" mt="xl"><Loader size="sm" /><Text c="dimmed">Loading trace...</Text></Group>}
      {selectedRunId && view?.status === "error" && <Stack align="center" mt="xl"><Text c="red">{view.message}</Text><Button size="xs" onClick={() => setViewVersion((value) => value + 1)}>Retry</Button></Stack>}
      {selectedRunId && view?.status === "ready" && <Stack>
        <Timeline view={view.data} search={search} />
        {showRaw && <RawEvents events={rawPage.events} nextCursor={rawPage.nextCursor} loading={rawLoading} onLoadMore={() => { if (rawPage.nextCursor !== undefined) void loadRaw(rawPage.nextCursor); }} onOpenPayload={(ref) => { void openPayload(ref); }} />}
        {showRaw && payloadPreview && <Code block style={{ maxHeight: 600, overflow: "auto" }}>{payloadPreview}</Code>}
      </Stack>}
    </AppShell.Main>
  </AppShell>;
}

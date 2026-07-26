import React, { useState, useEffect } from "react";
import { NavLink, Text, Badge, Stack, Loader, Group, Box, Button } from "@mantine/core";
import { fetchJson, type LoadState } from "../api";

interface SessionSummary {
  sessionId: string;
  runCount: number;
  lastTs: string;
  lastPromptPreview: string;
}

interface RunEntry {
  sessionId: string;
  firstTs: string;
  lastTs: string;
  prompt?: string;
}

interface Props {
  sessions: LoadState<SessionSummary[]>;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  projects: Record<string, string>;
  eventsLoading: boolean;
  onRetry: () => void;
}

function parseSessionInfo(sessionId: string): { projectId: string; conversation: string; skill: string; lane: string } {
  if (sessionId === "__no_session__") return { projectId: "", conversation: "", skill: "", lane: "" };
  if (!sessionId.startsWith("project:")) return { projectId: "", conversation: sessionId, skill: "", lane: "" };

  const parts = sessionId.split(":");
  const projectId = parts[1] ?? "";
  const convIdx = parts.indexOf("conversation");
  const laneIdx = parts.indexOf("lane");
  const skillIdx = parts.indexOf("skill");

  const conversation = convIdx >= 0 ? parts[convIdx + 1] ?? "" : "";
  const lane = laneIdx >= 0 ? parts[laneIdx + 1] ?? "" : "";
  const skill = skillIdx >= 0 ? parts.slice(skillIdx + 1).join(":") : "";

  return { projectId, conversation, skill, lane };
}

function formatTime(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function SessionsPanel({ sessions, selectedRunId, onSelectRun, projects, eventsLoading, onRetry }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Array<RunEntry & { runId: string }>>>({});
  const [loadingRuns, setLoadingRuns] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    if (runs[expanded]) return;
    setLoadingRuns(expanded);
    fetchJson<RunEntry[]>(`/api/sessions/${encodeURIComponent(expanded)}/runs`)
      .then(data => {
        const mapped = (data as RunEntry[]).map((r, i) => ({
          ...r,
          runId: (r as any).runId ?? `${expanded}-run-${i}`,
        }));
        setRuns(prev => ({ ...prev, [expanded]: mapped }));
        if (mapped.length > 0 && !selectedRunId) {
          onSelectRun(mapped[0].runId);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRuns(null));
  }, [expanded]);

  if (sessions.status === "loading") {
    return <Group py="md" justify="center" gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Loading sessions...</Text></Group>;
  }
  if (sessions.status === "error") {
    return <Stack py="md" align="center" gap="xs"><Text size="sm" c="red" ta="center">{sessions.message}</Text><Button size="xs" variant="light" onClick={onRetry}>Retry</Button></Stack>;
  }
  const sessionItems = sessions.data;

  return (
    <Stack className="trace-sessions-panel" gap={0}>
      {sessionItems.map(s => {
        const info = parseSessionInfo(s.sessionId);
        const projectName = info.projectId ? (projects[info.projectId] ?? info.projectId.slice(0, 8)) : "";
        const time = formatTime(s.lastTs);

        let title = "";
        let subtitle = "";
        if (s.sessionId === "__no_session__") {
          title = "No Session";
        } else if (info.skill) {
          title = `${info.skill}`;
          subtitle = info.conversation;
        } else {
          title = s.lastPromptPreview || info.conversation || info.lane;
          subtitle = info.conversation ? `${info.conversation}` : "";
        }

        return (
          <div key={s.sessionId}>
            <NavLink
              className="trace-session-item"
              label={
                <Box>
                  {(projectName || time) && (
                    <Group gap={4} mb={2}>
                      {projectName && <Badge className="trace-session-project" size="xs" variant="light" color="indigo">{projectName}</Badge>}
                      {time && <Text size="xs" c="dimmed">{time}</Text>}
                    </Group>
                  )}
                  <Text size="xs" fw={500} lineClamp={1}>{title}</Text>
                </Box>
              }
              description={subtitle && <Text size="xs" c="dimmed" lineClamp={1}>{subtitle}</Text>}
              rightSection={<Badge size="xs" variant="light">{s.runCount}</Badge>}
              opened={expanded === s.sessionId}
              onClick={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}
              childrenOffset={28}
            >
              {expanded === s.sessionId && loadingRuns === s.sessionId && (
                <Group className="trace-runs-loading" py="xs" gap="xs">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">Loading runs...</Text>
                </Group>
              )}
              {expanded === s.sessionId && runs[s.sessionId]?.map((run, idx) => {
                const isSelected = selectedRunId === run.runId;
                const isLoading = isSelected && eventsLoading;
                const isLoaded = isSelected && !eventsLoading;
                return (
                  <NavLink
                    className="trace-run-item"
                    key={run.runId}
                    label={
                      <Group gap="xs" wrap="nowrap">
                        {isLoading && <Loader size={12} />}
                        {isLoaded && <Text size="xs" c="green" fw={700}>●</Text>}
                        <Text size="xs">#{idx + 1}</Text>
                        <Text size="xs" c="dimmed">{formatTime(run.firstTs)}</Text>
                      </Group>
                    }
                    description={<Text size="xs" c="dimmed" lineClamp={1}>{run.prompt ?? "—"}</Text>}
                    active={isSelected}
                    onClick={() => onSelectRun(run.runId)}
                  />
                );
              })}
            </NavLink>
          </div>
        );
      })}
      {sessionItems.length === 0 && (
        <Text className="trace-no-sessions" size="sm" c="dimmed" ta="center" mt="md">
          No sessions found
        </Text>
      )}
    </Stack>
  );
}

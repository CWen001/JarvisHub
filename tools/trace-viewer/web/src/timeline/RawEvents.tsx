import React from "react";
import { Badge, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";

interface Props {
  events: unknown[];
  nextCursor?: number;
  loading: boolean;
  onLoadMore: () => void;
  onOpenPayload: (ref: string) => void;
}

export function RawEvents({ events, nextCursor, loading, onLoadMore, onOpenPayload }: Props) {
  return <Stack gap="xs">
    <Badge color="gray" variant="light">Raw compact events ({events.length})</Badge>
    {events.map((event: any, index) => {
      const ref = event?.payload?.payloadRef;
      const streamRef = event?.payload?.streamRef;
      return <Paper key={`${event?.runId ?? "event"}:${event?.seq ?? index}`} p="xs" withBorder>
        <Group justify="space-between"><Text size="xs" fw={600}>{event?.type ?? "unknown"}</Text><Text size="xs" c="dimmed">{event?.ts ?? ""}</Text></Group>
        <Code block style={{ fontSize: 10, maxHeight: 220, overflow: "auto" }}>{JSON.stringify(event, null, 2)}</Code>
        {ref?.path && <Group mt="xs"><Text size="xs" c="dimmed">{ref.bytes} bytes</Text><Button size="compact-xs" variant="light" onClick={() => onOpenPayload(ref.path)}>Open payload</Button></Group>}
        {streamRef?.path && <Group mt="xs"><Text size="xs" c="dimmed">{streamRef.bytes} bytes</Text><Button size="compact-xs" variant="light" onClick={() => onOpenPayload(streamRef.path)}>Open stream</Button></Group>}
      </Paper>;
    })}
    {nextCursor !== undefined && <Button size="xs" variant="light" loading={loading} onClick={onLoadMore}>Load more</Button>}
  </Stack>;
}

import type { RunTranscript } from "./traceMessages.js";

export interface TraceRunView {
  runId: string;
  parentRunId?: string;
  depth: number;
  subagentName?: string;
  startedAt?: string;
  status: "running" | "finished" | "errored";
  transcript: RunTranscript;
  children: TraceRunView[];
}

export interface TraceTreeView {
  rootRunId: string;
  roots: TraceRunView[];
  rawEventCount: number;
}

export type RecoverableAgentToolCall = {
  name: string;
  status: string;
  errorMessage: string;
  inputJson: Record<string, unknown> | null;
};

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingSubagentTypeFailure(call: RecoverableAgentToolCall): boolean {
  return (
    call.name === "Agent" &&
    call.status === "failed" &&
    call.errorMessage.includes("subagent_type") &&
    (call.errorMessage.includes("必填") || call.errorMessage.toLowerCase().includes("required"))
  );
}

function isEquivalentSuccessfulDispatch(
  failed: RecoverableAgentToolCall,
  candidate: RecoverableAgentToolCall,
): boolean {
  if (candidate.name !== "Agent" || candidate.status !== "succeeded") return false;
  const candidateType = readTrimmed(candidate.inputJson?.subagent_type);
  if (!candidateType) return false;

  const failedDescription = readTrimmed(failed.inputJson?.description);
  const candidateDescription = readTrimmed(candidate.inputJson?.description);
  if (failedDescription && candidateDescription === failedDescription) return true;

  const failedPrompt = readTrimmed(failed.inputJson?.prompt);
  const candidatePrompt = readTrimmed(candidate.inputJson?.prompt);
  return Boolean(failedPrompt && candidatePrompt === failedPrompt);
}

/**
 * Counts schema-invalid Agent dispatches that were retried successfully for the same task.
 * The original failed call remains in the trace; this only prevents a recovered coordination
 * mistake from downgrading an otherwise successful turn to partial completion.
 */
export function countRecoveredAgentDispatchValidationFailures(
  calls: RecoverableAgentToolCall[],
): number {
  let recovered = 0;
  for (let index = 0; index < calls.length; index += 1) {
    const failed = calls[index];
    if (!failed || !isMissingSubagentTypeFailure(failed)) continue;
    if (calls.slice(index + 1).some((candidate) => isEquivalentSuccessfulDispatch(failed, candidate))) {
      recovered += 1;
    }
  }
  return recovered;
}

export const REPO_KNOWLEDGE_RUNTIME_ROOTS = ["skills"] as const;

const repoKnowledgeRuntimeRootSet = new Set<string>(REPO_KNOWLEDGE_RUNTIME_ROOTS);

export function isRepoKnowledgeRuntimeRoot(root: string): boolean {
  return repoKnowledgeRuntimeRootSet.has(root);
}

export function renderRepoKnowledgeRuntimeRoots(): string {
  return REPO_KNOWLEDGE_RUNTIME_ROOTS.join(", ");
}

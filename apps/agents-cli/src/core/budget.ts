const DEFAULT_PARENT_BUDGET_MAX = 24;
const DEFAULT_SUBAGENT_BUDGET_MAX = 12;
const NOTICE_THRESHOLD = 0.7;
const CRITICAL_THRESHOLD = 0.9;

export class IterationBudget {
  private readonly maxValue: number;
  private usedValue = 0;

  constructor(max: number) {
    const normalized = Math.max(1, Math.trunc(Number.isFinite(max) ? max : DEFAULT_PARENT_BUDGET_MAX));
    this.maxValue = normalized;
  }

  consume(): void {
    this.usedValue += 1;
  }

  get max(): number {
    return this.maxValue;
  }

  get used(): number {
    return this.usedValue;
  }

  remaining(): number {
    return Math.max(0, this.maxValue - this.usedValue);
  }

  usageRatio(): number {
    if (this.maxValue <= 0) return 1;
    return this.usedValue / this.maxValue;
  }

  isExhausted(): boolean {
    return this.usedValue >= this.maxValue;
  }

  snapshot(): { used: number; max: number; remaining: number; ratio: number } {
    return {
      used: this.usedValue,
      max: this.maxValue,
      remaining: this.remaining(),
      ratio: this.usageRatio(),
    };
  }
}

export function readParentBudgetMax(): number {
  const raw = Number(process.env.AGENTS_ITERATION_BUDGET_MAX);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PARENT_BUDGET_MAX;
  return Math.max(1, Math.trunc(raw));
}

export function readSubagentBudgetMax(): number {
  const raw = Number(process.env.AGENTS_SUBAGENT_BUDGET_MAX);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SUBAGENT_BUDGET_MAX;
  return Math.max(1, Math.trunc(raw));
}

export function createParentBudget(maxOverride?: number): IterationBudget {
  const max =
    typeof maxOverride === "number" && Number.isFinite(maxOverride) && maxOverride > 0
      ? Math.max(1, Math.trunc(maxOverride))
      : readParentBudgetMax();
  return new IterationBudget(max);
}

export function createSubagentBudget(maxOverride?: number): IterationBudget {
  const max =
    typeof maxOverride === "number" && Number.isFinite(maxOverride) && maxOverride > 0
      ? Math.max(1, Math.trunc(maxOverride))
      : readSubagentBudgetMax();
  return new IterationBudget(max);
}

export function renderBudgetNoticeIfAny(budget: IterationBudget | null | undefined): string {
  if (!budget) return "";
  const ratio = budget.usageRatio();
  if (ratio < NOTICE_THRESHOLD) return "";
  const remaining = budget.remaining();
  const max = budget.max;
  if (ratio >= CRITICAL_THRESHOLD) {
    return `\n\n<!-- BUDGET CRITICAL: only ${remaining} turns left of ${max}. Wrap up the current task and deliver the result now; stop exploratory branches. -->`;
  }
  return `\n\n<!-- BUDGET NOTICE: ${remaining} turns remaining of ${max}. Prioritize finishing the current task over exploration; avoid starting new tangents. -->`;
}

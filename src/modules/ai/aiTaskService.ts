import {
  AiTaskStateRow,
  AiTaskStateService,
  isActiveSnooze,
  isDoneToday,
} from "./aiTaskStateService";

export type AiTaskType = "approval" | "report" | "followup" | "finance" | "asset";
export type AiTaskGroupKey = "overdue" | "today" | "week";
export type AiTaskActionKind = "approve" | "assign" | "generate" | "sms" | "open";

export interface AiTaskAction {
  key: string;
  label: string;
  kind: AiTaskActionKind;
}

/** What a source collector returns before grouping/state-merge. */
export interface RawTask {
  id: string;
  source: string;
  type: AiTaskType;
  title: string;
  meta: string;
  why?: string;
  people?: string[];
  /** Due/needed-by date used for urgency; null = undated. */
  dueAt?: Date | null;
  /** Group to use when dueAt is null. */
  fallbackGroup: AiTaskGroupKey;
  actions: AiTaskAction[];
  screen?: string;
}

export interface AiTask {
  id: string;
  source: string;
  type: AiTaskType;
  title: string;
  meta: string;
  why?: string;
  people?: string[];
  group: AiTaskGroupKey;
  actions: AiTaskAction[];
  screen?: string;
  state?: "snoozed";
}

export interface AiTaskGroup {
  key: AiTaskGroupKey;
  label: string;
  color: string;
  items: AiTask[];
}

export interface AiTasksSummary {
  total: number;
  overdue: number;
  doneToday: number;
}

export interface AiTasksResponse {
  summary: AiTasksSummary;
  groups: AiTaskGroup[];
  warnings: string[];
}

export interface TaskCollectorContext {
  userId: number;
  branchId: number | null;
  now: Date;
}

/** A source produces raw tasks; failures are isolated so one bad source
 *  never fails the whole feed. */
export interface TaskCollector {
  source: string;
  collect: (ctx: TaskCollectorContext) => Promise<RawTask[]>;
}

const GROUP_META: { key: AiTaskGroupKey; label: string; color: string }[] = [
  { key: "overdue", label: "Overdue", color: "#B91C1C" },
  { key: "today", label: "Today", color: "#080D2D" },
  { key: "week", label: "Later this week", color: "#4B5563" },
];

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const classifyGroup = (task: RawTask, now: Date): AiTaskGroupKey => {
  if (!task.dueAt) return task.fallbackGroup;
  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const due = task.dueAt.getTime();
  if (due < todayStart) return "overdue";
  if (due < tomorrowStart) return "today";
  return "week";
};

const keyFor = (task: RawTask): string => `${task.source}:${task.id}`;

export class AiTaskService {
  private stateService = new AiTaskStateService();
  private collectors: TaskCollector[] = [];

  /** Register the source collectors (dependency-injected so each can be
   *  unit-reasoned and gated independently). */
  constructor(collectors: TaskCollector[] = []) {
    this.collectors = collectors;
  }

  async getTasks(ctx: TaskCollectorContext): Promise<AiTasksResponse> {
    const warnings: string[] = [];

    const rawLists = await Promise.all(
      this.collectors.map(async (collector) => {
        try {
          return await collector.collect(ctx);
        } catch (error) {
          warnings.push(`Couldn't load ${collector.source}.`);
          return [] as RawTask[];
        }
      }),
    );
    const raw = rawLists.flat();

    const states = await this.stateService.getStatesMap(ctx.userId);
    const doneToday = this.countDoneToday(states, ctx.now);

    const byGroup: Record<AiTaskGroupKey, AiTask[]> = { overdue: [], today: [], week: [] };
    let total = 0;

    for (const task of raw) {
      const state = states.get(keyFor(task));
      if (state?.state === "done") continue;
      if (state && isActiveSnooze(state, ctx.now)) continue;

      const group = classifyGroup(task, ctx.now);
      byGroup[group].push({
        id: task.id,
        source: task.source,
        type: task.type,
        title: task.title,
        meta: task.meta,
        why: task.why,
        people: task.people,
        group,
        actions: task.actions,
        screen: task.screen,
      });
      total += 1;
    }

    const groups = GROUP_META.map((meta) => ({
      ...meta,
      items: byGroup[meta.key],
    })).filter((group) => group.items.length > 0);

    return {
      summary: { total, overdue: byGroup.overdue.length, doneToday },
      groups,
      warnings,
    };
  }

  private countDoneToday(states: Map<string, AiTaskStateRow>, now: Date): number {
    let count = 0;
    states.forEach((row) => {
      if (isDoneToday(row, now)) count += 1;
    });
    return count;
  }
}

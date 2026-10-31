import { prisma } from "../../Models/context";

export type AiTaskStateValue = "done" | "snoozed";

export interface AiTaskStateRow {
  task_key: string;
  state: string;
  snoozed_until: Date | null;
  label: string | null;
  updated_at: Date;
}

export interface SetTaskStateInput {
  taskKey: string;
  state: AiTaskStateValue;
  snoozedUntil?: Date | null;
  label?: string | null;
}

export class AiTaskStateService {
  /** All per-user task states keyed by task_key. */
  async getStatesMap(userId: number): Promise<Map<string, AiTaskStateRow>> {
    const rows = await prisma.assistant_task_state.findMany({
      where: { user_id: userId },
      select: {
        task_key: true,
        state: true,
        snoozed_until: true,
        label: true,
        updated_at: true,
      },
    });
    return new Map(rows.map((row) => [row.task_key, row]));
  }

  async setState(userId: number, input: SetTaskStateInput): Promise<AiTaskStateRow> {
    const data = {
      state: input.state,
      snoozed_until: input.state === "snoozed" ? input.snoozedUntil ?? null : null,
      label: input.label ?? null,
    };

    const row = await prisma.assistant_task_state.upsert({
      where: { user_id_task_key: { user_id: userId, task_key: input.taskKey } },
      update: data,
      create: { user_id: userId, task_key: input.taskKey, ...data },
      select: {
        task_key: true,
        state: true,
        snoozed_until: true,
        label: true,
        updated_at: true,
      },
    });
    return row;
  }

  async clearState(userId: number, taskKey: string): Promise<void> {
    await prisma.assistant_task_state.deleteMany({
      where: { user_id: userId, task_key: taskKey },
    });
  }
}

/** A snoozed task is hidden until its snoozed_until passes. */
export const isActiveSnooze = (row: AiTaskStateRow, now: Date): boolean =>
  row.state === "snoozed" && (!row.snoozed_until || row.snoozed_until.getTime() > now.getTime());

/** Done today = state done with updated_at on the current calendar day. */
export const isDoneToday = (row: AiTaskStateRow, now: Date): boolean => {
  if (row.state !== "done") return false;
  const updated = row.updated_at;
  return (
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate()
  );
};

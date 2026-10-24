import { addDays, PeriodRange } from "./period";

/** Department attendance reports use `dept_att:<department_id>` as their report_key. */
export const DEPT_ATT_PREFIX = "dept_att:";

export const deptAttKey = (departmentId: number) => `${DEPT_ATT_PREFIX}${departmentId}`;

/** The department id in a `dept_att:<id>` key, or null for any other key. */
export const parseDeptAttKey = (raw: unknown): number | null => {
  const match = /^dept_att:(\d{1,10})$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Due on `dueDay` of the month after the period (ranges have an exclusive end). */
export const dueOnDayAfter = (range: PeriodRange, dueDay: number) => addDays(range.to, dueDay - 1);
